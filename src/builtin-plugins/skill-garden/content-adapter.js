import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ENHANCEMENT_SKILL_ALIASES,
  ENHANCEMENT_SKILL_TARGETS,
} from "../../constants.js";
import { readLegacyManifestStatus } from "../../lib/manifest.js";
import { shouldInstallName } from "../../lib/skill-filter.js";
import { listCanonicalTreeFiles, isVolatileTreeArtifact } from "../../plugin/integrity/canonical-tree.js";
import {
  PluginIntegrityError,
  PluginIoError,
  PluginPathError,
} from "../../plugin/errors.js";
import { assertSafePosixRelativePath } from "../../plugin/schemas/shared.js";
import { compareUtf8 } from "../../plugin/stable-order.js";
import {
  contentMutationKey,
} from "../../plugin/install/content-projector.js";
import {
  hashContent,
  hashDirectoryIfExists,
  hashFileIfExists,
} from "../../plugin/install/content-hash.js";
import { FLOWER_UPDATE_HOOK, FLOWER_UPDATE_HOOK_REL, FLOWER_SESSION_HOOK, FLOWER_SESSION_HOOK_REL, FLOWER_TELEMETRY_HOOK, FLOWER_TELEMETRY_HOOK_REL } from "../../lib/flower-assets.js";
import { PKG_ROOT } from "../../lib/paths.js";
import { injectWorkflow } from "../../lib/workflow-inject.js";
import { applyCodexTweaks } from "../../lib/codex-tweaks.js";
import { applyClaudeTweaks } from "../../lib/claude-tweaks.js";
import { materializeTrellisPythonText } from "../../lib/trellis-python-command.js";
import { describeInstalledCommonSkillSync } from "../../lib/skill-catalog.js";
import {
  PLUGIN_RUNTIME_ERROR_CODES,
  PluginRuntimeError,
} from "../../plugin/runtime-errors.js";

const SCRIPT_ALIASES = Object.freeze({
  auto_loop: ["auto-loop", "auto-loop-runner", "trellis-auto-loop"],
  decision_log: [
    "decision-log", "auto-loop", "auto-loop-runner", "trellis-auto-loop",
    "finish-work", "finish-work-enhancement", "trellis-finish-work",
  ],
  task_progress: [
    "task-progress", "trellis-continue", "continue", "progress-recovery",
    "trellis-push", "push", "progress", "push-snapshot", "snapshot",
  ],
  spec_router: [
    "spec-router", "project-knowledge", "knowledge-router", "workflow-enhancement",
    "task-intent", "intent-routing",
  ],
  task_intent: ["task-intent", "intent-routing", "workflow-enhancement"],
  git_evidence: [
    "git-evidence", "workflow-enhancement", "task-intent", "intent-routing",
    "auto-loop", "auto-loop-runner", "trellis-auto-loop",
  ],
  untracked_flow: [
    "untracked-flow", "workflow-enhancement", "task-intent", "intent-routing",
    "trellis-route", "route", "trellis-check-all", "check-all",
    "trellis-update-spec", "update-spec", "trellis-push", "push",
  ],
  pre_check_state: [
    "pre-check", "pre-check-state", "workflow-enhancement", "task-intent",
    "intent-routing", "auto-loop", "auto-loop-runner", "trellis-auto-loop",
    "trellis-check-all", "check-all",
  ],
  maven_verify: [
    "maven-verify", "java-maven", "trellis-maven-verify",
    "trellis-check-all", "check-all",
  ],
});
const TRELLIS_TEXT_EXTENSIONS = new Set([".json", ".md", ".toml", ".txt", ".yaml", ".yml"]);
const COMMON_SKILL_RUNTIME_EXCLUDES = Object.freeze({
  "craft-rpa": Object.freeze([
    "recorder/node_modules",
    "recorder/profile",
    "recorder/session.jsonl",
  ]),
});
const LEGACY_PI_SKILL_PREFIX = ".pi/skills/";
const SHARED_AGENT_SKILL_PREFIX = ".agents/skills/";
const DISPATCH_CATALOG_REL = ".agents/skills/trellis-route/references/platform-dispatch.json";
const CHECK_ALL_AGENT_BODY_REL = ".agents/skills/trellis-route/references/check-all-agent-body.md";
const CHECK_ALL_AGENT_FORMATS = new Set([
  "codex-toml",
  "kiro-json",
  "markdown-claude",
  "markdown-kimi",
  "markdown-lower",
  "markdown-opencode",
  "markdown-plain",
  "markdown-reasonix",
  "markdown-snow",
]);
const CHECK_ALL_VERIFICATIONS = new Set([
  "built-in-read-only-agent",
  "inline-only",
  "native-agent-discovery",
  "read-only-sandbox",
  "read-only-tool-list",
]);

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isSafeCatalogPath(value) {
  if (!isNonEmptyString(value)) return false;
  try {
    assertSafePosixRelativePath(value, "dispatch catalog 路径");
    return true;
  } catch {
    return false;
  }
}

/**
 * 校验 route dispatch catalog 的完整 schema 与唯一性约束。
 *
 * @param {object} catalog 待校验的 catalog
 * @param {string} [catalogPath] 诊断使用的来源路径
 * @returns {object} 已通过校验的原 catalog
 */
export function validateDispatchCatalog(catalog, catalogPath = DISPATCH_CATALOG_REL) {
  if (catalog?.schemaVersion !== 1 || !Array.isArray(catalog.platforms) || catalog.platforms.length === 0) {
    throw new PluginIntegrityError("dispatch catalog schema 无效", { path: catalogPath });
  }

  const ids = new Set();
  const runtimePlatforms = new Set();
  const implementTargets = new Set();
  const checkAllTargets = new Set();
  for (const entry of catalog.platforms) {
    const invalid = (reason) => {
      throw new PluginIntegrityError(`dispatch catalog schema 无效:${entry?.id || "<unknown>"}:${reason}`, {
        path: catalogPath,
      });
    };
    if (!isNonEmptyString(entry?.id) || ids.has(entry.id)) invalid("平台 ID 缺失或重复");
    ids.add(entry.id);
    if (!isSafeCatalogPath(entry.detectPath)) invalid("detectPath 不合法");

    const aliases = entry.runtimePlatforms === undefined ? [entry.id] : entry.runtimePlatforms;
    if (
      !Array.isArray(aliases) ||
      aliases.length === 0 ||
      aliases.some((platform) => !isNonEmptyString(platform)) ||
      new Set(aliases).size !== aliases.length
    ) {
      invalid("runtimePlatforms 不合法");
    }
    for (const platform of aliases) {
      if (runtimePlatforms.has(platform)) invalid(`runtime platform 重复:${platform}`);
      runtimePlatforms.add(platform);
    }

    const implement = entry.implement;
    if (typeof implement?.eligible !== "boolean") invalid("implement.eligible 不合法");
    if (implement.eligible) {
      if (!isNonEmptyString(implement.launch)) invalid("implement.launch 缺失");
      if (implement.target !== null) {
        if (!isSafeCatalogPath(implement.target)) invalid("implement.target 不合法");
        if (implementTargets.has(implement.target)) invalid(`implement.target 重复:${implement.target}`);
        implementTargets.add(implement.target);
      }
    } else if (implement.target !== null || implement.launch !== null) {
      invalid("inline-only implement 必须使用 null target/launch");
    }

    const checkAll = entry.checkAll;
    if (
      typeof checkAll?.eligible !== "boolean" ||
      !isSafeCatalogPath(checkAll?.skillPath) ||
      !CHECK_ALL_VERIFICATIONS.has(checkAll?.verification)
    ) {
      invalid("checkAll 基础字段不合法");
    }
    if (checkAll.eligible) {
      if (
        !isSafeCatalogPath(checkAll.target) ||
        !CHECK_ALL_AGENT_FORMATS.has(checkAll.format) ||
        !isNonEmptyString(checkAll.launch) ||
        checkAll.verification === "inline-only" ||
        entry.inlineOnlyReason !== null
      ) {
        invalid("eligible checkAll 字段不合法");
      }
      if (checkAllTargets.has(checkAll.target)) invalid(`checkAll.target 重复:${checkAll.target}`);
      checkAllTargets.add(checkAll.target);
    } else if (
      checkAll.target !== null ||
      checkAll.format !== null ||
      checkAll.launch !== null ||
      checkAll.verification !== "inline-only" ||
      !isNonEmptyString(entry.inlineOnlyReason)
    ) {
      invalid("inline-only checkAll 必须声明 reason 并清空 target/format/launch");
    }
  }
  return catalog;
}

/**
 * 列出目标目录中的普通文件。
 *
 * 只有 builtin common skill 明确登记的旧运行时路径可以跳过；遍历在读取条目
 * 类型前先匹配排除项，确保不会跟随旧软链。其它路径继续使用 canonical 规则。
 * 运行时字节码缓存与安装态目录摘要同口径忽略：它们不是受管内容，不能被当作
 * 待清理的 stale 目标，也不能挡住合法的父目录清理。
 *
 * @param {string} directory 目标目录
 * @param {string[]} [excludedPaths] 允许跳过的精确相对路径及其子树
 * @returns {Array<{path:string,absolutePath:string,size:number}>} 稳定文件列表
 */
function listExistingFiles(directory, excludedPaths = []) {
  if (!fs.existsSync(directory)) return [];
  if (excludedPaths.length === 0) return listCanonicalTreeFiles(directory, { ignoreVolatile: true });

  const excluded = new Set(excludedPaths);
  const absoluteRoot = path.resolve(directory);
  let rootStat;
  try {
    rootStat = fs.lstatSync(absoluteRoot);
  } catch (error) {
    throw new PluginIoError(`无法读取 Plugin 根目录:${absoluteRoot}`, { path: absoluteRoot, cause: error });
  }
  if (rootStat.isSymbolicLink()) {
    throw new PluginPathError(`Plugin 根目录不能是软链:${absoluteRoot}`, { path: absoluteRoot });
  }
  if (!rootStat.isDirectory()) {
    throw new PluginIntegrityError(`Plugin 根目录必须是目录:${absoluteRoot}`, { path: absoluteRoot });
  }

  const files = [];

  /**
   * 判断路径是否属于已登记运行时边界。
   *
   * @param {string} relativePath POSIX 相对路径
   * @returns {boolean} 是否跳过该路径
   */
  function isExcluded(relativePath) {
    for (const candidate of excluded) {
      if (relativePath === candidate || relativePath.startsWith(`${candidate}/`)) return true;
    }
    return false;
  }

  /**
   * 遍历已安装目标树，但不读取已登记运行时条目的类型或目标。
   *
   * @param {string} current 当前绝对目录
   * @param {string} relativeDirectory 当前 POSIX 相对目录
   * @returns {void}
   */
  function visit(current, relativeDirectory) {
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (error) {
      throw new PluginIoError(`无法读取 Plugin 目录:${current}`, { path: current, cause: error });
    }
    for (const entry of entries) {
      const relativePath = relativeDirectory
        ? `${relativeDirectory}/${entry.name}`
        : entry.name;
      assertSafePosixRelativePath(relativePath, "Plugin tree 路径");
      if (isExcluded(relativePath) || isVolatileTreeArtifact(relativePath)) continue;

      const absolutePath = path.join(current, entry.name);
      let stat;
      try {
        stat = fs.lstatSync(absolutePath);
      } catch (error) {
        throw new PluginIoError(`无法读取 Plugin 条目:${relativePath}`, { path: relativePath, cause: error });
      }
      if (stat.isSymbolicLink()) {
        throw new PluginPathError(`Plugin tree 不允许软链:${relativePath}`, { path: relativePath });
      }
      if (stat.isDirectory()) visit(absolutePath, relativePath);
      else if (stat.isFile()) files.push({ path: relativePath, absolutePath, size: stat.size });
      else throw new PluginIntegrityError(`Plugin tree 不允许特殊文件:${relativePath}`, { path: relativePath });
    }
  }

  visit(absoluteRoot, "");
  return files.sort((left, right) => compareUtf8(left.path, right.path));
}

/**
 * 构造 skill-garden 自定义内容投影。
 *
 * @param {{projectRoot:string,resolved:import("../../plugin/contracts.js").ResolvedPlugin,pluginPackage:object,platformSelection:{platforms:string[]},previousState?:import("../../plugin/contracts.js").PluginState|null}} options 投影输入
 * @returns {{mutations:import("../../plugin/contracts.js").ContentMutation[],payloads:Map<string,Buffer>,directoryClaims:object[],directoryRemovals:object[],stateEntry:import("../../plugin/contracts.js").PluginStateEntry,migration?:object,installed:string[]}} 内容投影
 */
export function projectSkillGardenContent(options) {
  const { projectRoot, resolved, pluginPackage } = options;
  const { variantDir, skills, pythonCommand } = pluginPackage.skillGarden;
  const payloads = new Map();
  const mutations = [];
  const directoryRemovals = [];
  const paths = new Map();
  const installed = new Set();
  const partial = skills.length > 0;
  const previous = options.previousState?.plugins.find(({ id }) => id === resolved.id);

  if (partial && previous) {
    for (const entry of previous.paths) paths.set(entry.path, { ...entry });
  }

  /**
   * 登记一个最终文件。
   *
   * @param {string} target 项目内目标
   * @param {Buffer} content 最终字节
   * @param {string} source 来源说明
   * @param {"exclusive"|"shared"} ownership 所有权
   * @param {boolean} materializePython 是否按目标项目命令物化明确文本载荷
   */
  function addFile(target, content, source, ownership = "exclusive", materializePython = false) {
    assertSafePosixRelativePath(target, "skill-garden 投影目标");
    const absoluteTarget = path.join(projectRoot, ...target.split("/"));
    const payload = materializePython && TRELLIS_TEXT_EXTENSIONS.has(path.extname(target))
      ? Buffer.from(materializeTrellisPythonText(content.toString("utf8"), pythonCommand))
      : content;
    const mutation = {
      owner: resolved.id,
      target,
      operation: "write",
      beforeHash: hashFileIfExists(absoluteTarget),
      afterHash: hashContent(payload),
      source,
      allowUnownedWrite: true,
    };
    const previousMutationIndex = mutations.findIndex((entry) => (
      entry.owner === mutation.owner &&
      entry.target === mutation.target &&
      entry.operation === "write"
    ));
    if (previousMutationIndex >= 0) {
      // Agent-as-skill 平台先复制完整引用树，再用只读 frontmatter 覆盖同一个 SKILL.md。
      payloads.delete(contentMutationKey(mutations[previousMutationIndex]));
      mutations.splice(previousMutationIndex, 1);
    }
    payloads.set(contentMutationKey(mutation), payload);
    mutations.push(mutation);
    paths.set(target, {
      path: target,
      kind: "file",
      hash: mutation.afterHash,
      ownership,
    });
  }

  /**
   * 只有目录当前全部文件都会在本轮删除时，才登记父目录清理。
   *
   * 旧版本可能只登记 check-all agent 文件，没登记 `.gemini` / `.zcode` 父目录。
   * 这里用当前目录完整文件集合做 fail-closed 判断，避免删除包含用户内容的平台目录。
   *
   * @param {string} directory 项目内目录
   * @param {Set<string>} staleTargets 本轮确认淘汰的旧受管文件
   */
  function addDirectoryRemovalIfOnlyStaleFiles(directory, staleTargets) {
    assertSafePosixRelativePath(directory, "skill-garden 待删目录");
    const absoluteDirectory = path.join(projectRoot, ...directory.split("/"));
    const existingTargets = listExistingFiles(absoluteDirectory)
      .map((file) => `${directory}/${file.path}`);
    if (existingTargets.length === 0) return;
    if (!existingTargets.every((target) => staleTargets.has(target))) return;
    const beforeHash = hashDirectoryIfExists(absoluteDirectory);
    if (beforeHash === null) return;
    if (directoryRemovals.some(({ path: targetPath }) => targetPath === directory)) return;
    directoryRemovals.push({ owner: resolved.id, path: directory, beforeHash });
  }

  /**
   * 为旧平台 check-all agent 规划安全父目录清理。
   *
   * @param {Set<string>} staleTargets 本轮确认淘汰的旧受管 check-all agent
   */
  function addStaleCheckAllDirectoryRemovals(staleTargets) {
    for (const target of [...staleTargets].sort(compareUtf8)) {
      const parent = path.posix.dirname(target);
      if (parent !== "." && parent !== target) {
        addDirectoryRemovalIfOnlyStaleFiles(parent, staleTargets);
      }
      const [root] = target.split("/");
      if (root && root !== parent) {
        addDirectoryRemovalIfOnlyStaleFiles(root, staleTargets);
      }
    }
  }

  /**
   * 把一个来源目录按 copyPath 语义投影到目标目录。
   *
   * @param {string} sourceRoot 来源目录
   * @param {string} targetRoot 目标目录
   * @param {string} sourceLabel 来源标签
   * @param {"exclusive"|"shared"} ownership 所有权
   * @param {boolean} materializePython 是否按目标项目命令物化明确文本载荷
   * @param {string[]} runtimeExcludes 已登记的目标运行时路径
   */
  function addTree(
    sourceRoot,
    targetRoot,
    sourceLabel,
    ownership = "exclusive",
    materializePython = false,
    runtimeExcludes = [],
  ) {
    const desired = new Set();
    // 源码树跑过 Python 后会留下 `__pycache__`;它不属于 skill-garden 内容，
    // 一旦投影出去就会被装进目标项目并登记进 state，污染只有发布包才干净的安装态。
    for (const file of listCanonicalTreeFiles(sourceRoot, { ignoreVolatile: true })) {
      const target = `${targetRoot}/${file.path}`;
      desired.add(file.path);
      addFile(
        target,
        fs.readFileSync(file.absolutePath),
        `${sourceLabel}:${file.path}`,
        ownership,
        materializePython,
      );
    }
    for (const file of listExistingFiles(
      path.join(projectRoot, ...targetRoot.split("/")),
      runtimeExcludes,
    )) {
      if (desired.has(file.path)) continue;
      const target = `${targetRoot}/${file.path}`;
      mutations.push({
        owner: resolved.id,
        target,
        operation: "remove",
        beforeHash: hashFileIfExists(file.absolutePath),
        afterHash: null,
        source: `${sourceLabel}:stale:${file.path}`,
        allowUnownedRemove: true,
      });
      paths.delete(target);
    }
  }

  /**
   * 将 common skill tombstone 表达为同一事务中的文件与目录删除。
   *
   * @param {string} targetRoot 项目内待删目录
   * @param {string} sourceLabel 来源标签
   */
  function removeTree(targetRoot, sourceLabel) {
    const absoluteRoot = path.join(projectRoot, ...targetRoot.split("/"));
    const directories = new Set([targetRoot]);
    for (const file of listExistingFiles(absoluteRoot)) {
      const target = `${targetRoot}/${file.path}`;
      mutations.push({
        owner: resolved.id,
        target,
        operation: "remove",
        beforeHash: hashFileIfExists(file.absolutePath),
        afterHash: null,
        source: `${sourceLabel}:${file.path}`,
        allowUnownedRemove: true,
      });
      paths.delete(target);
      let parent = path.posix.dirname(file.path);
      while (parent !== ".") {
        directories.add(`${targetRoot}/${parent}`);
        parent = path.posix.dirname(parent);
      }
    }
    for (const target of [...directories].sort((left, right) => compareUtf8(left, right))) {
      const beforeHash = hashDirectoryIfExists(path.join(projectRoot, ...target.split("/")));
      if (beforeHash === null) continue;
      directoryRemovals.push({ owner: resolved.id, path: target, beforeHash });
    }
  }

  function readDispatchCatalog() {
    const catalogPath = path.join(variantDir, DISPATCH_CATALOG_REL);
    let catalog;
    try {
      catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
    } catch (error) {
      throw new PluginIntegrityError(`无法读取 dispatch catalog:${catalogPath}`, {
        path: catalogPath,
        cause: error,
      });
    }
    return validateDispatchCatalog(catalog, catalogPath);
  }

  function renderMarkdownAgent(body, format) {
    const headers = {
      "markdown-claude": [
        "---",
        "name: trellis-check-all",
        "description: Audit-only Trellis Check-All agent. Collects findings without workspace writes.",
        "tools: Read, Bash, Glob, Grep",
        "---",
      ],
      "markdown-plain": [
        "---",
        "name: trellis-check-all",
        "description: Audit-only Trellis Check-All agent. Collects findings without workspace writes.",
        "---",
      ],
      "markdown-lower": [
        "---",
        "name: trellis-check-all",
        "description: Audit-only Trellis Check-All agent. Collects findings without workspace writes.",
        "tools: read, bash, find, grep",
        "---",
      ],
      "markdown-opencode": [
        "---",
        "description: Audit-only Trellis Check-All agent. Collects findings without workspace writes.",
        "mode: subagent",
        "permission:",
        "  read: allow",
        "  write: deny",
        "  edit: deny",
        "  bash: allow",
        "  glob: allow",
        "  grep: allow",
        "---",
      ],
      "markdown-snow": [
        "---",
        "name: trellis-check-all",
        "id: trellis-check-all",
        "description: Audit-only Trellis Check-All agent. Collects findings without workspace writes.",
        "tools:",
        "  - filesystem-read",
        "  - terminal-execute",
        "  - ace-search",
        "  - codebase-search",
        "  - ide-get_diagnostics",
        "---",
      ],
    };
    const header = headers[format];
    if (!header) throw new PluginIntegrityError(`未知 Check-All agent 格式:${format}`);
    return `${header.join("\n")}\n\n${body}`;
  }

  function renderCheckAllAgent(entry, body, checkAllSkillRoot) {
    const renderedBody = body
      .replaceAll("{{PLATFORM_ID}}", entry.id)
      .replaceAll("{{SKILL_PATH}}", entry.checkAll.skillPath);
    if (entry.checkAll.format.startsWith("markdown-") && ![
      "markdown-reasonix",
      "markdown-kimi",
    ].includes(entry.checkAll.format)) {
      return Buffer.from(renderMarkdownAgent(renderedBody, entry.checkAll.format));
    }
    if (entry.checkAll.format === "codex-toml") {
      return Buffer.from([
        'name = "trellis-check-all"',
        'description = "Read-only Trellis Check-All auditor that collects CHK-* and DOC-* findings."',
        'sandbox_mode = "read-only"',
        "",
        'developer_instructions = """',
        renderedBody.trimEnd(),
        '"""',
        "",
      ].join("\n"));
    }
    if (entry.checkAll.format === "kiro-json") {
      return Buffer.from(`${JSON.stringify({
        name: "trellis-check-all",
        description: "Read-only Trellis Check-All auditor that collects findings without workspace writes.",
        prompt: renderedBody,
        tools: ["read", "shell", "glob", "grep"],
        allowedTools: ["read", "shell", "glob", "grep"],
        hooks: {
          agentSpawn: [{ command: "{{PYTHON_CMD}} .kiro/hooks/inject-subagent-context.py" }],
        },
      }, null, 2)}\n`);
    }
    if (["markdown-reasonix", "markdown-kimi"].includes(entry.checkAll.format)) {
      const skill = fs.readFileSync(path.join(checkAllSkillRoot, "SKILL.md"), "utf8");
      const additions = entry.checkAll.format === "markdown-reasonix"
        ? "runAs: subagent\nallowed-tools: read_file,search_content,search_files,glob,run_command,list_directory,directory_tree\n"
        : "agent: explore\nreadonly: true\n";
      return Buffer.from(skill.replace(/^---\n/, `---\n${additions}`));
    }
    throw new PluginIntegrityError(`未知 Check-All agent 格式:${entry.checkAll.format}`);
  }

  let targets = ENHANCEMENT_SKILL_TARGETS.filter(({ root }) => (
    fs.existsSync(path.join(projectRoot, ...root.split("/")))
  ));
  if (targets.length === 0) {
    targets = ENHANCEMENT_SKILL_TARGETS.filter(({ platform }) => platform === "claude");
  }
  for (const target of targets) {
    const preferred = path.join(variantDir, target.source === "claude" ? ".claude" : ".agents", "skills");
    const fallback = path.join(variantDir, ".agents", "skills");
    const sourceRoot = fs.existsSync(preferred) ? preferred : fallback;
    for (const entry of fs.readdirSync(sourceRoot, { withFileTypes: true })
      .filter((item) => item.isDirectory())
      .sort((left, right) => compareUtf8(left.name, right.name))) {
      if (!shouldInstallName(
        entry.name,
        skills,
        ENHANCEMENT_SKILL_ALIASES[entry.name] || [],
      )) continue;
      const entrySourceRoot = entry.name === "trellis-route"
        ? path.join(fallback, entry.name)
        : path.join(sourceRoot, entry.name);
      addTree(
        entrySourceRoot,
        `${target.root}/${entry.name}`,
        `skill-garden:${pluginPackage.skillGarden.variant}:${target.source}:${entry.name}`,
        "exclusive",
        pluginPackage.skillGarden.variant === "0.6",
      );
      installed.add(entry.name);
    }
  }

  if (previous && pluginPackage.skillGarden.variant === "0.6") {
    for (const entry of previous.paths) {
      if (!entry.path.startsWith(LEGACY_PI_SKILL_PREFIX)) continue;
      const suffix = entry.path.slice(LEGACY_PI_SKILL_PREFIX.length);
      const separator = suffix.indexOf("/");
      if (separator <= 0) continue;
      const skillName = suffix.slice(0, separator);
      if (!shouldInstallName(skillName, skills)) continue;
      const migratedPath = `${SHARED_AGENT_SKILL_PREFIX}${suffix}`;
      if (paths.has(migratedPath)) {
        // 只撤销已有 Plugin state 中且本轮已有等价新目标的旧路径。
        // 最终删除仍由 ApplicationService 校验 previous hash 后执行。
        paths.delete(entry.path);
      }
    }
  }

  if (
    pluginPackage.skillGarden.variant === "0.6" &&
    shouldInstallName("trellis-check-all", skills)
  ) {
    const catalog = readDispatchCatalog();
    const selectedPlatforms = new Set(options.platformSelection?.platforms || []);
    const body = fs.readFileSync(path.join(variantDir, CHECK_ALL_AGENT_BODY_REL), "utf8");
    const checkAllSkillRoot = path.join(variantDir, ".agents", "skills", "trellis-check-all");
    const checkAllTargets = new Set(
      catalog.platforms
        .filter(({ checkAll }) => checkAll.eligible)
        .map(({ checkAll }) => checkAll.target),
    );
    const desiredCheckAllTargets = new Set();
    for (const entry of catalog.platforms.filter(({ checkAll }) => checkAll.eligible)) {
      const runtimePlatforms = entry.runtimePlatforms || [entry.id];
      const enabled = selectedPlatforms.size > 0
        ? runtimePlatforms.some((platform) => selectedPlatforms.has(platform))
        : fs.existsSync(path.join(projectRoot, ...entry.detectPath.split("/")));
      if (!enabled) continue;
      if (entry.checkAll.format === "markdown-kimi") {
        addTree(
          checkAllSkillRoot,
          path.posix.dirname(entry.checkAll.target),
          `skill-garden:${pluginPackage.skillGarden.variant}:check-all-agent:${entry.id}:references`,
          "exclusive",
          pluginPackage.skillGarden.variant === "0.6",
        );
      }
      addFile(
        entry.checkAll.target,
        renderCheckAllAgent(entry, body, checkAllSkillRoot),
        `skill-garden:${pluginPackage.skillGarden.variant}:check-all-agent:${entry.id}`,
        "exclusive",
        pluginPackage.skillGarden.variant === "0.6",
      );
      desiredCheckAllTargets.add(entry.checkAll.target);
      installed.add(`agent:trellis-check-all:${entry.id}`);
    }
    const staleCheckAllTargets = new Set();
    for (const entry of previous?.paths || []) {
      if (!checkAllTargets.has(entry.path) || desiredCheckAllTargets.has(entry.path)) continue;
      paths.delete(entry.path);
      staleCheckAllTargets.add(entry.path);
    }
    addStaleCheckAllDirectoryRemovals(staleCheckAllTargets);
    addFile(
      ".trellis/agents/check-all.md",
      Buffer.from([
        "---",
        "name: check-all",
        "description: Audit-only Trellis Check-All role for the channel runtime.",
        "provider: claude",
        "labels: [trellis, check-all, audit-only]",
        "---",
        "",
        body
          .replaceAll("{{PLATFORM_ID}}", "trellis-channel")
          .replaceAll("{{SKILL_PATH}}", ".agents/skills/trellis-check-all/SKILL.md")
          .trimEnd(),
        "",
      ].join("\n")),
      `skill-garden:${pluginPackage.skillGarden.variant}:check-all-agent:channel`,
    );
    installed.add("agent:check-all");
  }

  const commandRoot = path.join(variantDir, ".claude", "commands", "trellis");
  if (targets.some(({ platform }) => platform === "claude") && fs.existsSync(commandRoot)) {
    for (const file of fs.readdirSync(commandRoot, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .sort((left, right) => compareUtf8(left.name, right.name))) {
      const name = file.name.replace(/\.md$/, "");
      if (!shouldInstallName(name, skills)) continue;
      addFile(
        `.claude/commands/trellis/${file.name}`,
        fs.readFileSync(path.join(commandRoot, file.name)),
        `skill-garden:${pluginPackage.skillGarden.variant}:command:${file.name}`,
        "exclusive",
        pluginPackage.skillGarden.variant === "0.6",
      );
      installed.add(name);
    }
  }

  const scriptsRoot = path.join(variantDir, "scripts");
  if (fs.existsSync(scriptsRoot)) {
    for (const file of fs.readdirSync(scriptsRoot, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .sort((left, right) => compareUtf8(left.name, right.name))) {
      const name = file.name.replace(/\.[^.]+$/, "");
      if (!shouldInstallName(name, skills, SCRIPT_ALIASES[name] || [])) continue;
      addFile(
        `.trellis/scripts/${file.name}`,
        fs.readFileSync(path.join(scriptsRoot, file.name)),
        `skill-garden:${pluginPackage.skillGarden.variant}:script:${file.name}`,
      );
      installed.add(`script:${file.name}`);
    }
  }

  if (!partial) {
    addFile(
      FLOWER_UPDATE_HOOK_REL,
      fs.readFileSync(path.join(PKG_ROOT, "src", "assets", FLOWER_UPDATE_HOOK)),
      `flower:asset:${FLOWER_UPDATE_HOOK}`,
    );
    installed.add(`script:${FLOWER_UPDATE_HOOK}`);
    if (pluginPackage.skillGarden.variant === "0.6") {
      addFile(
        FLOWER_SESSION_HOOK_REL,
        fs.readFileSync(path.join(PKG_ROOT, "src", "assets", FLOWER_SESSION_HOOK)),
        `flower:asset:${FLOWER_SESSION_HOOK}`,
      );
      installed.add(`script:${FLOWER_SESSION_HOOK}`);
      addFile(
        FLOWER_TELEMETRY_HOOK_REL,
        fs.readFileSync(path.join(PKG_ROOT, "src", "assets", FLOWER_TELEMETRY_HOOK)),
        `flower:asset:${FLOWER_TELEMETRY_HOOK}`,
      );
      installed.add(`script:${FLOWER_TELEMETRY_HOOK}`);
    }
    const commonSync = describeInstalledCommonSkillSync(projectRoot);
    for (const common of commonSync.refreshes) {
      addTree(
        common.source,
        common.target,
        `skill-garden:common:${common.name}`,
        "shared",
        false,
        COMMON_SKILL_RUNTIME_EXCLUDES[common.name] || [],
      );
    }
    for (const removedTarget of commonSync.removedTargets) {
      removeTree(removedTarget, `skill-garden:common:tombstone:${removedTarget}`);
    }
  }

  if (pluginPackage.skillGarden.variant !== "0.6") {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "flower-skill-garden-plan-"));
    const simulatedTargets = [
      ".trellis/workflow.md",
      ".trellis/workflow.md.bak",
      ".trellis/config.yaml",
      ".trellis/.backup-flower",
      ".codex/config.toml",
      ".codex/hooks.json",
      ".claude/settings.json",
    ];
    try {
      for (const relative of simulatedTargets) {
        const source = path.join(projectRoot, ...relative.split("/"));
        if (!fs.existsSync(source)) continue;
        const destination = path.join(temporary, ...relative.split("/"));
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.cpSync(source, destination, { recursive: true });
      }
      if (fs.existsSync(path.join(projectRoot, ".codex"))) {
        fs.mkdirSync(path.join(temporary, ".codex"), { recursive: true });
      }
      if (fs.existsSync(path.join(projectRoot, ".claude"))) {
        fs.mkdirSync(path.join(temporary, ".claude"), { recursive: true });
      }
      const wantWorkflow = !partial || [
        "workflow-enhancement",
        "task-intent",
        "intent-routing",
      ].some((name) => skills.includes(name));
      if (wantWorkflow) {
        injectWorkflow(
          temporary,
          variantDir,
          pluginPackage.skillGarden.variant,
        );
      }
      applyCodexTweaks(temporary);
      applyClaudeTweaks(temporary);

      for (const relative of simulatedTargets) {
        const simulated = path.join(temporary, ...relative.split("/"));
        if (!fs.existsSync(simulated)) {
          const original = path.join(projectRoot, ...relative.split("/"));
          if (!fs.existsSync(original) || fs.statSync(original).isDirectory()) continue;
          mutations.push({
            owner: resolved.id,
            target: relative,
            operation: "remove",
            beforeHash: hashFileIfExists(original),
            afterHash: null,
            source: `skill-garden:${pluginPackage.skillGarden.variant}:legacy-cleanup`,
            allowUnownedRemove: true,
          });
          paths.delete(relative);
          continue;
        }
        if (fs.statSync(simulated).isFile()) {
          addFile(
            relative,
            fs.readFileSync(simulated),
            `skill-garden:${pluginPackage.skillGarden.variant}:legacy-tweak`,
          );
          continue;
        }
        for (const file of listCanonicalTreeFiles(simulated, { ignoreVolatile: true })) {
          addFile(
            `${relative}/${file.path}`,
            fs.readFileSync(file.absolutePath),
            `skill-garden:${pluginPackage.skillGarden.variant}:legacy-backup:${file.path}`,
          );
        }
      }
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  }

  const legacyStatus = readLegacyManifestStatus(projectRoot);
  if (!options.previousState && legacyStatus.status === "corrupt") {
    throw new PluginRuntimeError("旧 flower manifest 损坏，拒绝猜测 Plugin ownership", {
      code: PLUGIN_RUNTIME_ERROR_CODES.TARGET_DRIFT,
      path: ".trellis/.flower-manifest.json",
      cause: legacyStatus.error,
    });
  }
  if (!options.previousState && legacyStatus.status === "valid") {
    const legacyPaths = legacyStatus.manifest.paths;
    if (!Array.isArray(legacyPaths) || legacyPaths.some((entry) => typeof entry !== "string")) {
      throw new PluginRuntimeError("旧 flower manifest paths 无效", {
        code: PLUGIN_RUNTIME_ERROR_CODES.TARGET_DRIFT,
        path: ".trellis/.flower-manifest.json",
      });
    }
    for (const relative of legacyPaths) {
      assertSafePosixRelativePath(relative, "旧 flower manifest path");
      const absolute = path.join(projectRoot, ...relative.split("/"));
      if (!fs.existsSync(absolute)) {
        throw new PluginRuntimeError(`旧 flower manifest 目标缺失:${relative}`, {
          code: PLUGIN_RUNTIME_ERROR_CODES.TARGET_DRIFT,
          path: relative,
        });
      }
      const desired = paths.get(relative);
      if (
        desired?.kind === "file" &&
        legacyStatus.manifest.flowerVersion === pluginPackage.manifest.version &&
        legacyStatus.manifest.variant === pluginPackage.skillGarden.variant &&
        hashFileIfExists(absolute) !== desired.hash
      ) {
        throw new PluginRuntimeError(`旧 flower manifest 目标已漂移:${relative}`, {
          code: PLUGIN_RUNTIME_ERROR_CODES.TARGET_DRIFT,
          path: relative,
        });
      }
    }
  }
  return {
    mutations: mutations.sort((left, right) => compareUtf8(left.target, right.target)),
    payloads,
    directoryClaims: [],
    directoryRemovals,
    stateEntry: {
      id: resolved.id,
      version: resolved.version,
      platforms: [...options.platformSelection.platforms],
      paths: [...paths.values()].sort((left, right) => compareUtf8(left.path, right.path)),
      patches: partial && previous ? previous.patches.map((entry) => ({ ...entry })) : [],
    },
    ...(legacyStatus.status === "valid"
      ? { migration: { source: "legacy-flower-manifest", schemaVersion: 1 } }
      : options.previousState?.migration
        ? { migration: structuredClone(options.previousState.migration) }
        : {}),
    installed: [...installed],
  };
}
