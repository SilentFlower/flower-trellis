import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveEnhancementSnapshot } from "../../lib/enhancement-catalog.js";
import { flowerVersion } from "../../lib/versions.js";
import { ENHANCEMENTS_ROOT, PKG_ROOT } from "../../lib/paths.js";
import { listCanonicalTreeFiles } from "../../plugin/integrity/canonical-tree.js";
import { validatePluginManifest } from "../../plugin/schemas/plugin-manifest.js";
import { markRuntimeBuiltinProvider } from "../../plugin/runtime-extensions.js";
import { BuiltinSourceProvider } from "../../plugin/sources/builtin-provider.js";
import { flowerPatchAdapters } from "../../lib/platform-patch-adapters.js";
import { resolveTrellisPythonCommand } from "../../lib/trellis-python-command.js";
import { projectSkillGardenContent } from "./content-adapter.js";

/** 内置 skill-garden canonical Plugin ID。 */
export const SKILL_GARDEN_PLUGIN_ID = "flower/skill-garden";

/**
 * 计算不依赖绝对路径和同步时间的内置 payload 摘要。
 *
 * @param {Array<{label:string,root:string}>} roots 摘要目录
 * @param {object} metadata 稳定元数据
 * @returns {string} SHA-256 摘要
 */
function stablePayloadDigest(roots, metadata) {
  const hash = crypto.createHash("sha256");
  hash.update(JSON.stringify(metadata));
  for (const { label, root } of roots) {
    for (const file of listCanonicalTreeFiles(root, { ignoreVolatile: true })) {
      const content = fs.readFileSync(file.absolutePath);
      hash.update(label);
      hash.update("\0");
      hash.update(file.path);
      hash.update("\0");
      hash.update(content);
    }
  }
  return `sha256:${hash.digest("hex")}`;
}

/**
 * 读取不含同步时间的 enhancement 快照清单。
 *
 * @returns {object} 稳定快照元数据
 */
function stableSnapshotManifest() {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(ENHANCEMENTS_ROOT, "MANIFEST.json"), "utf8"),
  );
  const { syncedAt: _syncedAt, ...stable } = manifest;
  return stable;
}

/**
 * 从既有 lock 节点恢复冻结解析所需的 manifest 约束。
 *
 * @param {import("../../plugin/contracts.js").PluginManifest} current 当前随包 manifest
 * @param {import("../../plugin/contracts.js").ResolvedPlugin} lockedPlugin 既有 lock 节点
 * @returns {import("../../plugin/contracts.js").PluginManifest} 仅表达既有锁定身份的 manifest
 */
function lockedRuntimeManifest(current, lockedPlugin) {
  return validatePluginManifest({
    ...structuredClone(current),
    version: lockedPlugin.version,
    dependencies: { ...lockedPlugin.dependencies },
    compatibility: { ...lockedPlugin.compatibility },
    capabilities: {
      profile: lockedPlugin.capabilities.profile,
      required: [...lockedPlugin.capabilities.granted],
      optional: [],
    },
  });
}

/**
 * 从随包 manifest 构造当前 variant 的运行时 manifest。
 *
 * @param {string} variant 强化变体
 * @returns {import("../../plugin/contracts.js").PluginManifest} 已校验 manifest
 */
function runtimeManifest(variant) {
  const manifestPath = path.join(PKG_ROOT, "src", "builtin-plugins", "skill-garden", "plugin.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.version = flowerVersion();
  if (variant !== "0.6") {
    manifest.capabilities.required = ["content.skills", "content.scripts"];
    delete manifest.patches;
  }
  return validatePluginManifest(manifest);
}

/**
 * 按需初始化依赖目标 Trellis 的 skill-garden 状态。
 *
 * @param {SkillGardenBuiltinProvider} provider Flower builtin Provider
 * @returns {void}
 */
function ensureSkillGardenReady(provider) {
  if (provider.snapshot) return;
  provider.pythonCommand = resolveTrellisPythonCommand(provider.projectRoot);
  provider.snapshot = resolveEnhancementSnapshot(provider.projectRoot, provider.variantOverride);
  provider.manifest = runtimeManifest(provider.snapshot.variant);
  provider.integrity = stablePayloadDigest([
    { label: `enhancements/${provider.snapshot.variant}`, root: provider.snapshot.variantDir },
    { label: "enhancements/common", root: path.join(ENHANCEMENTS_ROOT, "common") },
    { label: "src/assets", root: path.join(PKG_ROOT, "src", "assets") },
    { label: "src/lib", root: path.join(PKG_ROOT, "src", "lib") },
    { label: "src/patches", root: path.join(PKG_ROOT, "src", "patches") },
    { label: "builtin", root: provider.packageRoot },
  ], {
    flowerVersion: flowerVersion(),
    variant: provider.snapshot.variant,
    manifest: provider.manifest,
    snapshotManifest: stableSnapshotManifest(),
  });
  provider.resolutionManifest = provider.preserve && provider.lockedPlugin
    ? lockedRuntimeManifest(provider.manifest, provider.lockedPlugin)
    : provider.manifest;
}

/**
 * 内置 `flower/skill-garden` Source Provider。
 */
export class SkillGardenBuiltinProvider {
  /**
   * 创建绑定目标项目的内置 Provider。
   *
   * @param {{projectRoot:string,variant?:string|null,skills?:string[],previousState?:import("../../plugin/contracts.js").PluginState|null,preserve?:boolean,lockedPlugin?:import("../../plugin/contracts.js").ResolvedPlugin|null}} options 目标与兼容参数
   */
  constructor(options) {
    this.id = "flower";
    this.type = "builtin";
    this.projectRoot = path.resolve(options.projectRoot);
    this.variantOverride = options.variant || null;
    this.skills = [...(options.skills || [])];
    this.previousState = options.previousState || null;
    this.preserve = options.preserve === true;
    this.lockedPlugin = options.lockedPlugin || null;
    this.packageRoot = path.join(PKG_ROOT, "src", "builtin-plugins", "skill-garden");
    this.genericProvider = new BuiltinSourceProvider({
      id: "flower",
      root: path.join(PKG_ROOT, "src", "builtin-plugins"),
      referencePrefix: "package",
    });
    this.snapshot = null;
    this.manifest = null;
    this.integrity = null;
    this.resolutionManifest = null;
    this.pythonCommand = null;
    if (fs.existsSync(path.join(this.projectRoot, ".trellis", ".version"))) ensureSkillGardenReady(this);
    markRuntimeBuiltinProvider(this);
  }

  /**
   * 查询内置 skill-garden 候选。
   *
   * @param {string} canonicalId canonical Plugin ID
   * @returns {import("../../plugin/contracts.js").PluginCandidate[]} 唯一候选
   */
  listCandidates(canonicalId) {
    if (canonicalId !== SKILL_GARDEN_PLUGIN_ID) {
      return this.genericProvider.listCandidates(canonicalId);
    }
    ensureSkillGardenReady(this);
    if (this.preserve && this.lockedPlugin) {
      return [{
        id: this.lockedPlugin.id,
        version: this.lockedPlugin.version,
        source: { ...this.lockedPlugin.source },
        commit: this.lockedPlugin.commit,
        integrity: this.lockedPlugin.integrity,
        manifest: this.resolutionManifest,
      }];
    }
    return [{
      id: SKILL_GARDEN_PLUGIN_ID,
      version: this.manifest.version,
      source: {
        id: this.id,
        type: this.type,
        reference: `package:skill-garden:${this.snapshot.variant}`,
      },
      commit: null,
      integrity: this.integrity,
      manifest: this.resolutionManifest,
    }];
  }

  /**
   * 读取内置固定包与 system 扩展。
   *
   * @param {import("../../plugin/contracts.js").PluginCandidate|import("../../plugin/contracts.js").ResolvedPlugin} plugin Plugin 身份
   * @returns {object} 固定包与适配器
   */
  readPackage(plugin) {
    if (plugin.id !== SKILL_GARDEN_PLUGIN_ID) return this.genericProvider.readPackage(plugin);
    ensureSkillGardenReady(this);
    const acceptedIntegrity = this.preserve && this.lockedPlugin
      ? this.lockedPlugin.integrity
      : this.integrity;
    if (plugin.id !== SKILL_GARDEN_PLUGIN_ID || plugin.integrity !== acceptedIntegrity) {
      throw new Error(`内置 skill-garden 固定包不匹配:${plugin.id}`);
    }
    const catalogs = this.snapshot.variant === "0.6" ? [
      {
        id: "skill-garden",
        patchesDir: path.join(this.snapshot.variantDir, "overrides", "patches"),
        bundlesDir: path.join(this.snapshot.variantDir, "overrides", "bundles"),
        policy: {
          compatibilityFile: path.join(this.snapshot.variantDir, "overrides", "compatibility.json"),
          conflictsFile: path.join(this.snapshot.variantDir, "overrides", "conflicts.json"),
        },
        textMaterialization: { trellisPythonCommand: this.pythonCommand.command },
      },
      {
        id: "flower",
        patchesDir: path.join(PKG_ROOT, "src", "patches", "platforms"),
        bundlesDir: path.join(PKG_ROOT, "src", "patches", "bundles"),
        policy: {
          conflictsFile: path.join(PKG_ROOT, "src", "patches", "conflicts.json"),
        },
        textMaterialization: { trellisPythonCommand: this.pythonCommand.command },
      },
    ] : [];
    return {
      root: this.packageRoot,
      manifest: this.resolutionManifest,
      integrity: acceptedIntegrity,
      catalogs,
      systemAdapters: this.snapshot.variant === "0.6"
        ? flowerPatchAdapters(this.pythonCommand.command)
        : {},
      patchOptions: { skills: this.skills },
      allowContentPatchOverlap: true,
      skillGarden: {
        ...this.snapshot,
        skills: this.skills,
        pythonCommand: this.pythonCommand.command,
      },
    };
  }

  /**
   * 把旧 enhancement payload 投影成统一 Runtime mutation。
   *
   * @param {object} options Runtime 投影输入
   * @returns {ReturnType<typeof projectSkillGardenContent>|null} 自定义内容投影；普通 builtin 返回 null
   */
  projectContent(options) {
    if (options.resolved.id !== SKILL_GARDEN_PLUGIN_ID) return null;
    ensureSkillGardenReady(this);
    if (this.preserve) {
      const previous = this.previousState?.plugins.find(({ id }) => id === SKILL_GARDEN_PLUGIN_ID);
      if (!previous) throw new Error("冻结 skill-garden 缺少既有 state");
      const result = {
        mutations: [],
        payloads: new Map(),
        directoryClaims: [],
        stateEntry: structuredClone(previous),
        ...(this.previousState?.migration ? { migration: structuredClone(this.previousState.migration) } : {}),
        installed: [],
      };
      this.lastProjection = result;
      return result;
    }
    const result = projectSkillGardenContent({
      ...options,
      previousState: this.previousState,
    });
    this.lastProjection = result;
    return result;
  }
}

/**
 * 读取所有随包强化快照根，用于打包检查。
 *
 * @returns {string} 强化快照根目录
 */
export function skillGardenSnapshotRoot() {
  return ENHANCEMENTS_ROOT;
}
