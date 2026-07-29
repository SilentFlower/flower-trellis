import path from "node:path";
import { markRuntimeBuiltinProvider } from "../runtime-extensions.js";
import {
  PLUGIN_RUNTIME_ERROR_CODES,
  PluginRuntimeError,
} from "../runtime-errors.js";
import { isPluginId } from "../schemas/shared.js";
import {
  assertPackageWithinSource,
  assertSourceRoot,
  discoverPluginPackages,
  readPluginCandidate,
  verifyPluginPackage,
} from "./package-reader.js";

/**
 * 从 npm 包内固定目录读取 Plugin 的内置来源。
 */
export class BuiltinSourceProvider {
  /**
   * 创建内置来源。
   *
   * @param {{id:string,root:string,referencePrefix?:string}} options 来源配置
   */
  constructor(options) {
    if (!isPluginId(options.id)) throw new TypeError(`非法 builtin source ID:${options.id}`);
    this.id = options.id;
    this.type = "builtin";
    this.root = assertSourceRoot(options.root, "builtin source 根");
    this.referencePrefix = options.referencePrefix || "package";
    this.packageRoots = new Map();
    markRuntimeBuiltinProvider(this);
  }

  /**
   * 查询指定 canonical ID 的内置候选。
   *
   * @param {string} canonicalId canonical Plugin ID
   * @returns {import("../contracts.js").PluginCandidate[]} 稳定候选列表
   */
  listCandidates(canonicalId) {
    const candidates = [];
    for (const discovered of discoverPluginPackages(this.root)) {
      const packageRoot = assertPackageWithinSource(this.root, discovered);
      const relative = path.relative(this.root, packageRoot).split(path.sep).join("/") || "root";
      const candidate = readPluginCandidate({
        sourceId: this.id,
        type: this.type,
        packageRoot,
        reference: `${this.referencePrefix}:${relative}`,
      });
      if (candidate.id !== canonicalId) continue;
      this.packageRoots.set(this.#key(candidate), packageRoot);
      candidates.push(candidate);
    }
    return candidates;
  }

  /**
   * 读取并复核内置固定包。
   *
   * @param {import("../contracts.js").PluginCandidate|import("../contracts.js").ResolvedPlugin} plugin Plugin 身份
   * @returns {{root:string,manifest:import("../contracts.js").PluginManifest,integrity:string}} 固定包
   */
  readPackage(plugin) {
    if (!this.packageRoots.has(this.#key(plugin))) this.listCandidates(plugin.id);
    const root = this.packageRoots.get(this.#key(plugin));
    if (!root) {
      throw new PluginRuntimeError(`内置 Plugin 包不存在:${plugin.id}@${plugin.version}`, {
        code: PLUGIN_RUNTIME_ERROR_CODES.SOURCE_NOT_FOUND,
        path: plugin.id,
      });
    }
    return verifyPluginPackage(plugin, root);
  }

  /**
   * 生成候选缓存键。
   *
   * @param {{id:string,version:string,integrity:string}} plugin Plugin 身份
   * @returns {string} 缓存键
   */
  #key(plugin) {
    return `${plugin.id}\u0000${plugin.version}\u0000${plugin.integrity}`;
  }
}
