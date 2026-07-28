import fs from "node:fs";
import path from "node:path";
import { parseSkillFrontmatter, stripSkillFrontmatter } from "../../lib/skill-catalog.js";
import { hashCanonicalTree, listCanonicalTreeFiles } from "../integrity/canonical-tree.js";
import { PLUGIN_RUNTIME_ERROR_CODES, PluginRuntimeError } from "../runtime-errors.js";
import { assertSafePosixRelativePath, isStrictSemVer } from "../schemas/shared.js";
import { assertPackageWithinSource, assertSourceRoot } from "../sources/package-reader.js";
import { validatePluginManifest } from "../schemas/plugin-manifest.js";
import { compareUtf8 } from "../stable-order.js";
import {
  listOrdinaryDirectories,
  listOrdinaryMarkdownFiles,
  normalizeExternalId,
} from "./shared.js";

const OMITTED_COMPONENTS = Object.freeze([
  ["agents", "agents"],
  ["hooks", "hooks"],
  ["mcp", ".mcp.json"],
  ["lsp", ".lsp.json"],
  ["monitors", "monitors"],
  ["bin", "bin"],
  ["settings", "settings.json"],
  ["themes", "themes"],
  ["output-styles", "output-styles"],
  ["apps", ".app.json"],
]);

/**
 * 生成外部 Plugin 缺省内部版本。
 *
 * @param {string} commit 完整 commit
 * @param {string|number|Date} committedAt commit 时间
 * @returns {string} 严格 SemVer
 */
export function externalFallbackVersion(commit, committedAt) {
  const timestamp = Math.max(0, Math.floor(new Date(committedAt).getTime() / 1000));
  if (!Number.isFinite(timestamp) || timestamp === 0 || !/^[a-f0-9]{40}$/i.test(commit)) {
    throw new PluginRuntimeError("外部 Plugin 缺少可用于生成版本的 commit 时间或 SHA", {
      code: PLUGIN_RUNTIME_ERROR_CODES.FORMAT_UNSUPPORTED,
      path: commit,
    });
  }
  return `0.0.0-git.${timestamp}.sha${commit.slice(0, 12).toLowerCase()}`;
}

/**
 * 把 Skill frontmatter 规范化为安全名称与描述。
 *
 * @param {string} content 原始 Skill 内容
 * @param {string} name 规范化名称
 * @param {string} fallbackDescription 缺省描述
 * @returns {string} 规范化 Skill 内容
 */
function normalizedSkillContent(content, name, fallbackDescription) {
  const metadata = parseSkillFrontmatter(content);
  const description = String(metadata.description || fallbackDescription || `${name} 工作流`).replace(/[\r\n]+/g, " ").trim();
  const body = stripSkillFrontmatter(content).trimStart();
  return `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n\n${body}`.replace(/\s*$/, "\n");
}

/**
 * 复制并规范化一个 Skill 目录。
 *
 * @param {string} source Skill 源目录
 * @param {string} target Skill 目标目录
 * @param {string} name 规范化名称
 * @param {string} description 缺省描述
 */
function copySkill(source, target, name, description) {
  const skillFile = path.join(source, "SKILL.md");
  if (!fs.existsSync(skillFile) || !fs.lstatSync(skillFile).isFile()) {
    throw new PluginRuntimeError(`外部 Skill 缺少 SKILL.md:${source}`, {
      code: PLUGIN_RUNTIME_ERROR_CODES.FORMAT_UNSUPPORTED,
      path: source,
    });
  }
  fs.mkdirSync(target, { recursive: true });
  for (const file of listCanonicalTreeFiles(source)) {
    const destination = path.join(target, ...file.path.split("/"));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    if (file.path === "SKILL.md") {
      fs.writeFileSync(destination, normalizedSkillContent(
        fs.readFileSync(file.absolutePath, "utf8"),
        name,
        description,
      ));
    } else fs.copyFileSync(file.absolutePath, destination);
  }
}

/**
 * 复制并复核原生 Flower Plugin 包。
 *
 * @param {{pluginRoot:string,outputRoot:string}} options 规范化参数
 * @returns {{root:string,manifest:import("../contracts.js").PluginManifest,integrity:string,compatibilityReport:object,externalVersion:string,description:string}} 标准包
 */
export function normalizeFlowerPlugin(options) {
  const packageRoot = path.resolve(options.outputRoot);
  if (fs.existsSync(packageRoot)) {
    throw new PluginRuntimeError(`规范化包目标已存在:${packageRoot}`, {
      code: PLUGIN_RUNTIME_ERROR_CODES.CONTENT_CONFLICT,
      path: packageRoot,
    });
  }
  fs.mkdirSync(packageRoot, { recursive: true });
  try {
    for (const file of listCanonicalTreeFiles(options.pluginRoot)) {
      const destination = path.join(packageRoot, ...file.path.split("/"));
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(file.absolutePath, destination);
    }
    const manifest = validatePluginManifest(JSON.parse(
      fs.readFileSync(path.join(packageRoot, "plugin.json"), "utf8"),
    ));
    return {
      root: packageRoot,
      manifest,
      integrity: hashCanonicalTree(packageRoot),
      compatibilityReport: {
        status: "compatible",
        format: "flower",
        imported: Object.entries(manifest.content).flatMap(([kind, paths]) => (
          paths.map((value) => ({ kind, path: value }))
        )).sort((left, right) => compareUtf8(left.path, right.path)),
        omitted: [],
        diagnostics: [],
      },
      externalVersion: manifest.version,
      description: manifest.name,
    };
  } catch (error) {
    fs.rmSync(packageRoot, { recursive: true, force: true });
    throw error;
  }
}

/**
 * 解析 Adapter 声明的 Skill 根。
 *
 * @param {string} pluginRoot Plugin 根
 * @param {object} manifest 外部 manifest
 * @param {string} format 外部格式
 * @returns {string[]} Skill 根目录
 */
function skillRoots(pluginRoot, manifest, format) {
  const sourceRoot = assertSourceRoot(pluginRoot, `${format} Plugin 根`);
  const configured = manifest.skills;
  const values = typeof configured === "string"
    ? [configured]
    : Array.isArray(configured) ? configured.filter((value) => typeof value === "string") : [];
  const roots = values.length > 0 ? values : ["skills"];
  return [...new Set(roots.map((value) => {
    const normalized = value.replace(/^\.\//, "").replace(/\/+$/, "");
    return assertSafePosixRelativePath(normalized, `${format} Plugin skills 路径`);
  }))]
    .map((value) => path.join(sourceRoot, ...value.split("/")))
    .filter((value) => fs.existsSync(value))
    .map((value) => assertPackageWithinSource(sourceRoot, value));
}

/**
 * 构建外部格式的兼容性报告与标准 Flower package。
 *
 * @param {{pluginRoot:string,outputRoot:string,sourceId:string,format:"codex"|"claude-code"|"skill-only",manifest?:object,externalName?:string,externalVersion?:string,description?:string,commit:string,committedAt:string|number|Date,includeCommands?:boolean}} options 规范化参数
 * @returns {{root:string,manifest:import("../contracts.js").PluginManifest,integrity:string,compatibilityReport:object,externalVersion:string|null}} 标准包
 */
export function normalizeExternalPlugin(options) {
  const rawManifest = options.manifest || {};
  const pluginName = normalizeExternalId(
    options.externalName || rawManifest.name || path.basename(options.pluginRoot),
    "外部 Plugin 名称",
  );
  const externalVersion = options.externalVersion || rawManifest.version || null;
  const version = isStrictSemVer(externalVersion)
    ? externalVersion
    : externalFallbackVersion(options.commit, options.committedAt);
  const packageRoot = path.resolve(options.outputRoot);
  if (fs.existsSync(packageRoot)) {
    throw new PluginRuntimeError(`规范化包目标已存在:${packageRoot}`, {
      code: PLUGIN_RUNTIME_ERROR_CODES.CONTENT_CONFLICT,
      path: packageRoot,
    });
  }
  fs.mkdirSync(path.join(packageRoot, "skills"), { recursive: true });
  const names = new Map();
  const imported = [];
  const diagnostics = [];
  const registerName = (rawName, kind) => {
    const name = normalizeExternalId(rawName, `外部 ${kind} 名称`);
    const existing = names.get(name);
    if (existing) {
      throw new PluginRuntimeError(`外部组件名称规范化冲突:${existing.rawName}/${rawName} -> ${name}`, {
        code: PLUGIN_RUNTIME_ERROR_CODES.SOURCE_AMBIGUOUS,
        path: name,
      });
    }
    names.set(name, { rawName, kind });
    return name;
  };

  for (const root of skillRoots(options.pluginRoot, rawManifest, options.format)) {
    if (path.basename(root) === "skills") {
      for (const directory of listOrdinaryDirectories(root)) {
        const source = path.join(root, directory);
        if (!fs.existsSync(path.join(source, "SKILL.md"))) continue;
        const name = registerName(directory, "Skill");
        copySkill(source, path.join(packageRoot, "skills", name), name, `${pluginName} 的 ${name} 工作流`);
        imported.push({ kind: "skills", path: `skills/${name}` });
      }
    } else if (fs.existsSync(path.join(root, "SKILL.md"))) {
      const name = registerName(path.basename(root), "Skill");
      copySkill(root, path.join(packageRoot, "skills", name), name, `${pluginName} 的 ${name} 工作流`);
      imported.push({ kind: "skills", path: `skills/${name}` });
    }
  }

  if (options.includeCommands) {
    const commandRoot = path.join(options.pluginRoot, "commands");
    for (const file of listOrdinaryMarkdownFiles(commandRoot)) {
      const rawName = file.replace(/\.md$/i, "");
      const name = registerName(rawName, "Command");
      const content = fs.readFileSync(path.join(commandRoot, file), "utf8");
      fs.mkdirSync(path.join(packageRoot, "skills", name), { recursive: true });
      fs.writeFileSync(
        path.join(packageRoot, "skills", name, "SKILL.md"),
        normalizedSkillContent(content, name, `${pluginName} 的 ${name} 命令工作流`),
      );
      imported.push({ kind: "commands", path: `skills/${name}` });
      diagnostics.push({
        code: "external.command-converted",
        path: `commands/${file}`,
        message: `Claude legacy command 已转换为 Skill:${name}`,
        severity: "info",
      });
    }
  }

  const omitted = [];
  for (const [kind, relative] of OMITTED_COMPONENTS) {
    const target = path.join(options.pluginRoot, relative);
    if (!fs.existsSync(target)) continue;
    omitted.push({ kind, path: relative, reason: "首版只分发被动 Skill 内容", risk: "active-or-platform-specific" });
  }
  if (imported.length === 0) {
    fs.rmSync(packageRoot, { recursive: true, force: true });
    throw new PluginRuntimeError(`外部 Plugin 没有可安全导入的 Skill:${pluginName}`, {
      code: PLUGIN_RUNTIME_ERROR_CODES.FORMAT_UNSUPPORTED,
      path: options.pluginRoot,
      details: { omitted },
    });
  }
  const description = String(options.description || rawManifest.description || `${pluginName} 外部工作流`).trim();
  const manifest = validatePluginManifest({
    schemaVersion: 1,
    id: pluginName,
    name: String(rawManifest.interface?.displayName || rawManifest.displayName || rawManifest.name || pluginName),
    version,
    compatibility: { flower: ">=0.5.0 <1.0.0" },
    dependencies: {},
    capabilities: { profile: "standard", required: ["content.skills"] },
    content: {
      skills: imported.map(({ path: value }) => value).sort(compareUtf8),
    },
  });
  fs.writeFileSync(path.join(packageRoot, "plugin.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  const compatibilityReport = {
    status: omitted.length > 0 ? "partial" : "compatible",
    format: options.format,
    imported: imported.sort((left, right) => compareUtf8(left.path, right.path)),
    omitted,
    diagnostics,
  };
  return {
    root: packageRoot,
    manifest,
    integrity: hashCanonicalTree(packageRoot),
    compatibilityReport,
    externalVersion: externalVersion === null ? null : String(externalVersion),
    description,
  };
}
