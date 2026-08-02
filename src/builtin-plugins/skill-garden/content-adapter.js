import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ENHANCEMENT_SKILL_TARGETS } from "../../constants.js";
import { readLegacyManifestStatus } from "../../lib/manifest.js";
import { shouldInstallName } from "../../lib/skill-filter.js";
import { listCanonicalTreeFiles } from "../../plugin/integrity/canonical-tree.js";
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
import { FLOWER_UPDATE_HOOK, FLOWER_UPDATE_HOOK_REL } from "../../lib/flower-assets.js";
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
    "auto-loop", "auto-loop-runner", "trellis-auto-loop", "trellis-route", "route",
    "trellis-check-all", "check-all", "trellis-update-spec", "update-spec",
    "trellis-push", "push",
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

/**
 * 列出目标目录中的普通文件。
 *
 * 只有 builtin common skill 明确登记的旧运行时路径可以跳过；遍历在读取条目
 * 类型前先匹配排除项，确保不会跟随旧软链。其它路径继续使用 canonical 规则。
 *
 * @param {string} directory 目标目录
 * @param {string[]} [excludedPaths] 允许跳过的精确相对路径及其子树
 * @returns {Array<{path:string,absolutePath:string,size:number}>} 稳定文件列表
 */
function listExistingFiles(directory, excludedPaths = []) {
  if (!fs.existsSync(directory)) return [];
  if (excludedPaths.length === 0) return listCanonicalTreeFiles(directory);

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
      if (isExcluded(relativePath)) continue;

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
    for (const file of listCanonicalTreeFiles(sourceRoot)) {
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
      if (!shouldInstallName(entry.name, skills)) continue;
      addTree(
        path.join(sourceRoot, entry.name),
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
        for (const file of listCanonicalTreeFiles(simulated)) {
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
