import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { hashCanonicalTree, listCanonicalTreeFiles } from "../integrity/canonical-tree.js";
import { validateMarketplaceManifest } from "../schemas/marketplace-manifest.js";
import { validatePluginManifest } from "../schemas/plugin-manifest.js";
import {
  isGitCommit,
  isStrictSemVer,
  parseCanonicalPluginId,
} from "../schemas/shared.js";
import {
  PLUGIN_RUNTIME_ERROR_CODES,
  PluginRuntimeError,
} from "../runtime-errors.js";
import { compareUtf8 } from "../stable-order.js";

/** 作者工具默认生成的 Plugin 包目录。 */
export const AUTHOR_PLUGIN_DIRECTORY = ".flower-plugin";

/** scaffold ownership 摘要账本。 */
export const AUTHOR_SCAFFOLD_STATE_FILE = ".flower-plugin-scaffold.json";

/**
 * 生成稳定 JSON 文本。
 *
 * @param {object} value JSON 值
 * @returns {string} 两空格缩进且带结尾换行的文本
 */
function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * 计算受管文本的稳定摘要。
 *
 * @param {string} content 文件内容
 * @returns {string} SHA-256 摘要
 */
function contentDigest(content) {
  return `sha256:${crypto.createHash("sha256").update(content).digest("hex")}`;
}

/**
 * 校验并归一化 scaffold 参数。
 *
 * @param {object} options 原始参数
 * @returns {{id:string,sourceId:string,pluginId:string,name:string,version:string,profile:"standard"|"integration",includePatches:boolean,includeMarketplace:boolean,project:string,subdir:string,ref:string,commit:string,force:boolean}} 规范化参数
 */
function normalizeOptions(options) {
  const { sourceId, pluginId } = parseCanonicalPluginId(options.id);
  const name = String(options.name || "").trim();
  if (!name) throw new PluginRuntimeError("plugin init 需要非空 --name", {
    code: PLUGIN_RUNTIME_ERROR_CODES.USAGE_ERROR,
    path: "--name",
  });
  if (/[\r\n\u0000]/.test(name)) throw new PluginRuntimeError("--name 必须是单行文本", {
    code: PLUGIN_RUNTIME_ERROR_CODES.USAGE_ERROR,
    path: "--name",
  });
  const version = options.version || "1.0.0";
  if (!isStrictSemVer(version)) throw new PluginRuntimeError(`Plugin version 必须是严格 SemVer:${version}`, {
    code: PLUGIN_RUNTIME_ERROR_CODES.USAGE_ERROR,
    path: "--version",
  });
  const profile = options.profile || "standard";
  if (!new Set(["standard", "integration"]).has(profile)) {
    throw new PluginRuntimeError(`作者工具只允许 standard 或 integration:${profile}`, {
      code: PLUGIN_RUNTIME_ERROR_CODES.USAGE_ERROR,
      path: "--profile",
    });
  }
  const includePatches = options.includePatches === true;
  if (includePatches && profile !== "integration") {
    throw new PluginRuntimeError("只有 integration scaffold 可以包含受限 Patch 示例", {
      code: PLUGIN_RUNTIME_ERROR_CODES.USAGE_ERROR,
      path: "--patches",
    });
  }
  const commit = options.commit || "0".repeat(40);
  if (!isGitCommit(commit)) {
    throw new PluginRuntimeError("--commit 必须是 40 位 Git commit", {
      code: PLUGIN_RUNTIME_ERROR_CODES.USAGE_ERROR,
      path: "--commit",
    });
  }
  const ref = options.ref || `v${version}`;
  if (!(ref === `v${version}` || ref === `refs/tags/v${version}` || isGitCommit(ref))) {
    throw new PluginRuntimeError(`--ref 必须固定到 v${version} tag 或完整 commit`, {
      code: PLUGIN_RUNTIME_ERROR_CODES.USAGE_ERROR,
      path: "--ref",
    });
  }
  if (isGitCommit(ref) && ref.toLowerCase() !== commit.toLowerCase()) {
    throw new PluginRuntimeError("--ref 为完整 commit 时必须与 --commit 一致", {
      code: PLUGIN_RUNTIME_ERROR_CODES.USAGE_ERROR,
      path: "--ref",
    });
  }
  return {
    id: options.id,
    sourceId,
    pluginId,
    name,
    version,
    profile,
    includePatches,
    includeMarketplace: options.includeMarketplace === true,
    project: options.project || `${sourceId}/${pluginId}`,
    subdir: options.subdir || AUTHOR_PLUGIN_DIRECTORY,
    ref,
    commit: commit.toLowerCase(),
    force: options.force === true,
  };
}

/**
 * 渲染 Plugin 包内的确定性文件。
 *
 * @param {ReturnType<typeof normalizeOptions>} options 规范化参数
 * @returns {Map<string,string>} 相对路径到内容
 */
function renderPackageFiles(options) {
  const required = ["content.skills"];
  if (options.includePatches) required.push("patch.insert");
  const manifest = validatePluginManifest({
    schemaVersion: 1,
    id: options.pluginId,
    name: options.name,
    version: options.version,
    compatibility: { flower: ">=0.5.0 <1.0.0" },
    dependencies: {},
    capabilities: { profile: options.profile, required },
    content: {
      skills: [{
        name: options.pluginId,
        path: `skills/${options.pluginId}`,
        version: options.version,
        description: `${options.name}。用于执行该 Plugin 提供的专业工作流。`,
      }],
      tests: ["tests"],
    },
    ...(options.includePatches ? {
      patches: { catalog: "patches", bundles: "patches/bundles" },
    } : {}),
  });
  const files = new Map([
    ["plugin.json", stableJson(manifest)],
    [`skills/${options.pluginId}/SKILL.md`, `---\nname: ${options.pluginId}\ndescription: ${options.name}。用于执行该 Plugin 提供的专业工作流。\n---\n\n# ${options.name}\n\n先读取当前请求和项目上下文，再按 Plugin 约定完成任务。\n`],
    ["tests/plugin.test.js", `import assert from "node:assert/strict";\nimport fs from "node:fs";\nimport path from "node:path";\nimport test from "node:test";\nimport { fileURLToPath } from "node:url";\n\ntest("Plugin manifest 与 Skill 存在", () => {\n  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");\n  const manifest = JSON.parse(fs.readFileSync(path.join(root, "plugin.json"), "utf8"));\n  assert.equal(manifest.id, "${options.pluginId}");\n  assert.equal(fs.existsSync(path.join(root, "skills", "${options.pluginId}", "SKILL.md")), true);\n});\n`],
  ]);
  if (options.includePatches) {
    files.set("patches/example/patch.json", stableJson({
      schemaVersion: 2,
      id: "example-guidance",
      purpose: "integration_example",
      required: false,
      operations: [{
        id: "insert-example-guidance",
        operation: "insert",
        required: false,
        targetPolicy: "each-existing",
        targets: [{
          kind: "workflow",
          path: ".trellis/workflow.md",
          missing: "skip",
          markerStyle: "html",
        }],
        selector: { type: "workflow-hub", heading: "## Request Triage", expectedMatches: 1 },
        content: { source: "example-content.md" },
        position: "after",
      }],
    }));
    files.set(
      "patches/example/example-content.md",
      "<!-- 这是受限 insert 示例。发布前请替换为真实、最小且可审计的内容。 -->\n",
    );
    files.set("patches/bundles/default.json", stableJson({
      schemaVersion: 1,
      id: "default",
      aliases: [],
      installMode: "full-or-selected",
      patches: ["example/example-guidance"],
    }));
  }
  return files;
}

/**
 * 在临时目录预演现有安全文件树与计划变更，计算最终 canonical tree digest。
 *
 * @param {string} packageRoot 现有包根
 * @param {Map<string,string>} files 包文件
 * @param {string[]} removals 需要删除的包内相对路径
 * @returns {string} SHA-256 摘要
 */
function digestPlannedPackage(packageRoot, files, removals) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "flower-author-digest-"));
  try {
    if (fs.existsSync(packageRoot)) {
      for (const entry of listCanonicalTreeFiles(packageRoot)) {
        const target = path.join(root, ...entry.path.split("/"));
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(entry.absolutePath, target);
      }
    }
    for (const relative of removals) fs.rmSync(path.join(root, ...relative.split("/")), { force: true });
    for (const [relative, content] of files) {
      const target = path.join(root, ...relative.split("/"));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
    }
    return hashCanonicalTree(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/**
 * 渲染可提交到 Marketplace 的单条草稿。
 *
 * @param {ReturnType<typeof normalizeOptions>} options 规范化参数
 * @param {string} digest Plugin canonical tree digest
 * @returns {string} Marketplace entry JSON
 */
function renderMarketplaceEntry(options, digest) {
  const entry = {
    id: options.pluginId,
    description: options.name,
    source: { type: "gitlab", project: options.project, subdir: options.subdir },
    trust: { maxProfile: options.profile },
    versions: [{
      version: options.version,
      ref: options.ref,
      commit: options.commit,
      integrity: digest,
    }],
  };
  validateMarketplaceManifest({
    schemaVersion: 1,
    id: options.sourceId,
    name: `${options.sourceId} Marketplace`,
    plugins: [entry],
  });
  return stableJson(entry);
}

/**
 * 读取并校验 scaffold ownership 摘要账本。
 *
 * @param {string} root 项目根
 * @returns {{schemaVersion:1,files:Record<string,string>}|null} 账本
 */
function readScaffoldState(root) {
  const statePath = path.join(root, AUTHOR_SCAFFOLD_STATE_FILE);
  if (!fs.existsSync(statePath)) return null;
  try {
    const raw = fs.readFileSync(statePath, "utf8");
    const state = JSON.parse(raw);
    const valid = state?.schemaVersion === 1 &&
      state.files &&
      typeof state.files === "object" &&
      !Array.isArray(state.files) &&
      Object.entries(state.files).every(([relative, digest]) => (
        relative &&
        !relative.includes("\\") &&
        !path.posix.isAbsolute(relative) &&
        !path.win32.isAbsolute(relative) &&
        !relative.split("/").some((segment) => !segment || segment === "." || segment === "..") &&
        /^sha256:[a-f0-9]{64}$/.test(digest)
      ));
    if (!valid || raw !== stableJson(state)) throw new Error("invalid scaffold state");
    return state;
  } catch (error) {
    throw new PluginRuntimeError(`scaffold ownership 账本无效:${AUTHOR_SCAFFOLD_STATE_FILE}`, {
      code: PLUGIN_RUNTIME_ERROR_CODES.CONTENT_CONFLICT,
      path: AUTHOR_SCAFFOLD_STATE_FILE,
      cause: error,
    });
  }
}

/**
 * 预检覆盖与删除，保证任何写入前都能通过摘要账本证明 ownership。
 *
 * @param {string} root 项目根
 * @param {Map<string,string>} nextFiles 新受管文件
 * @param {{schemaVersion:1,files:Record<string,string>}|null} state 旧账本
 * @param {boolean} force 是否允许覆盖未修改的旧 scaffold 文件
 * @returns {string[]} 可安全删除的旧路径
 */
function preflightScaffold(root, nextFiles, state, force) {
  const removals = [];
  for (const [relative, content] of nextFiles) {
    const target = path.join(root, ...relative.split("/"));
    if (!fs.existsSync(target)) continue;
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new PluginRuntimeError(`scaffold 目标必须是普通文件:${relative}`, {
        code: PLUGIN_RUNTIME_ERROR_CODES.CONTENT_CONFLICT,
        path: relative,
      });
    }
    const current = fs.readFileSync(target, "utf8");
    if (current === content) continue;
    if (!force || state?.files?.[relative] !== contentDigest(current)) {
      throw new PluginRuntimeError(`已存在或已修改的文件拒绝覆盖:${relative}`, {
        code: PLUGIN_RUNTIME_ERROR_CODES.CONTENT_CONFLICT,
        path: relative,
      });
    }
  }
  for (const [relative, previousDigest] of Object.entries(state?.files || {})) {
    if (nextFiles.has(relative)) continue;
    const target = path.join(root, ...relative.split("/"));
    if (!fs.existsSync(target)) continue;
    if (
      !force ||
      !fs.lstatSync(target).isFile() ||
      contentDigest(fs.readFileSync(target, "utf8")) !== previousDigest
    ) {
      throw new PluginRuntimeError(`已修改的旧 scaffold 文件拒绝删除:${relative}`, {
        code: PLUGIN_RUNTIME_ERROR_CODES.CONTENT_CONFLICT,
        path: relative,
      });
    }
    removals.push(relative);
  }
  return removals.sort(compareUtf8);
}

/**
 * 在目标项目生成确定性的 Flower Plugin scaffold。
 *
 * @param {string} projectRoot 目标项目根
 * @param {{id:string,name:string,version?:string,profile?:string,includePatches?:boolean,includeMarketplace?:boolean,project?:string,subdir?:string,ref?:string,commit?:string,force?:boolean}} options scaffold 参数
 * @returns {{ok:true,subject:"plugin",root:string,digest:string,files:string[],marketplaceEntry:string|null}} 生成结果
 */
export function scaffoldFlowerPlugin(projectRoot, options) {
  const normalized = normalizeOptions(options);
  const root = path.resolve(projectRoot);
  const packageRoot = path.join(root, AUTHOR_PLUGIN_DIRECTORY);
  const packageFiles = renderPackageFiles(normalized);
  const state = readScaffoldState(root);
  const desiredPackagePaths = new Set([...packageFiles.keys()].map((relative) => (
    `${AUTHOR_PLUGIN_DIRECTORY}/${relative}`
  )));
  const packageRemovals = Object.keys(state?.files || {})
    .filter((relative) => relative.startsWith(`${AUTHOR_PLUGIN_DIRECTORY}/`) && !desiredPackagePaths.has(relative))
    .map((relative) => relative.slice(AUTHOR_PLUGIN_DIRECTORY.length + 1));
  const digest = digestPlannedPackage(packageRoot, packageFiles, packageRemovals);
  const entryContent = normalized.includeMarketplace
    ? renderMarketplaceEntry(normalized, digest)
    : null;
  const managedFiles = new Map([...packageFiles].map(([relative, content]) => [
    `${AUTHOR_PLUGIN_DIRECTORY}/${relative}`,
    content,
  ]));
  if (entryContent !== null) managedFiles.set("marketplace-entry.json", entryContent);
  const removals = preflightScaffold(root, managedFiles, state, normalized.force);
  fs.mkdirSync(packageRoot, { recursive: true });
  for (const [relative, content] of [...managedFiles].sort(([left], [right]) => compareUtf8(left, right))) {
    const target = path.join(root, ...relative.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (!fs.existsSync(target) || fs.readFileSync(target, "utf8") !== content) fs.writeFileSync(target, content);
  }
  for (const relative of removals) fs.rmSync(path.join(root, ...relative.split("/")));
  const nextState = {
    schemaVersion: 1,
    files: Object.fromEntries([...managedFiles]
      .sort(([left], [right]) => compareUtf8(left, right))
      .map(([relative, content]) => [relative, contentDigest(content)])),
  };
  const statePath = path.join(root, AUTHOR_SCAFFOLD_STATE_FILE);
  const stateContent = stableJson(nextState);
  if (!fs.existsSync(statePath) || fs.readFileSync(statePath, "utf8") !== stateContent) {
    fs.writeFileSync(statePath, stateContent);
  }
  const actualDigest = hashCanonicalTree(packageRoot);
  if (actualDigest !== digest) throw new Error("scaffold 写后 digest 与预览不一致");
  return {
    ok: true,
    subject: "plugin",
    root: AUTHOR_PLUGIN_DIRECTORY,
    digest,
    files: [...packageFiles.keys()].sort(compareUtf8),
    marketplaceEntry: entryContent === null ? null : "marketplace-entry.json",
  };
}
