import path from "node:path";
import { assertSafePosixRelativePath, isPluginId } from "../schemas/shared.js";
import {
  PLUGIN_RUNTIME_ERROR_CODES,
  PluginRuntimeError,
} from "../runtime-errors.js";
import { compareUtf8 } from "../stable-order.js";
import {
  assertPackageWithinSource,
  assertSourceRoot,
  discoverPluginPackages,
  readPluginCandidate,
  relativePosixPath,
  verifyPluginPackage,
} from "./package-reader.js";

/**
 * 从项目内显式相对路径读取 Plugin 的本地开发来源。
 */
export class LocalSourceProvider {
  /**
   * 创建本地来源。
   *
   * @param {{id:string,projectRoot:string,references:string[]}} options 来源配置
   */
  constructor(options) {
    if (!isPluginId(options.id)) throw new TypeError(`非法 local source ID:${options.id}`);
    this.id = options.id;
    this.type = "local";
    this.projectRoot = assertSourceRoot(options.projectRoot, "local project 根");
    this.references = [...new Set(options.references || [])]
      .map((reference) => assertSafePosixRelativePath(reference, "local source reference"))
      .sort(compareUtf8);
    if (this.references.length === 0) throw new TypeError("local source 至少需要一个 reference");
    this.packageRoots = new Map();
  }

  /**
   * 查询指定 canonical ID 的本地候选。
   *
   * @param {string} canonicalId canonical Plugin ID
   * @returns {import("../contracts.js").PluginCandidate[]} 稳定候选列表
   */
  listCandidates(canonicalId) {
    const candidates = [];
    const seenPackages = new Set();
    for (const reference of this.references) {
      const sourceRoot = assertPackageWithinSource(
        this.projectRoot,
        path.join(this.projectRoot, ...reference.split("/")),
      );
      for (const discovered of discoverPluginPackages(sourceRoot)) {
        const packageRoot = assertPackageWithinSource(sourceRoot, discovered);
        if (seenPackages.has(packageRoot)) continue;
        seenPackages.add(packageRoot);
        const packageReference = relativePosixPath(
          this.projectRoot,
          packageRoot,
          "local Plugin reference",
        );
        const candidate = readPluginCandidate({
          sourceId: this.id,
          type: this.type,
          packageRoot,
          reference: packageReference,
        });
        if (candidate.id !== canonicalId) continue;
        this.packageRoots.set(this.#key(candidate), packageRoot);
        candidates.push(candidate);
      }
    }
    const identities = new Set();
    for (const candidate of candidates) {
      const identity = `${candidate.id}\u0000${candidate.version}`;
      if (identities.has(identity)) {
        throw new PluginRuntimeError(`本地来源存在重复 Plugin 版本:${candidate.id}@${candidate.version}`, {
          code: PLUGIN_RUNTIME_ERROR_CODES.SOURCE_AMBIGUOUS,
          path: candidate.source.reference,
        });
      }
      identities.add(identity);
    }
    return candidates;
  }

  /**
   * 读取并复核本地固定包。
   *
   * @param {import("../contracts.js").PluginCandidate|import("../contracts.js").ResolvedPlugin} plugin Plugin 身份
   * @returns {{root:string,manifest:import("../contracts.js").PluginManifest,integrity:string}} 固定包
   */
  readPackage(plugin) {
    if (!this.packageRoots.has(this.#key(plugin))) this.listCandidates(plugin.id);
    const root = this.packageRoots.get(this.#key(plugin));
    if (!root) {
      throw new PluginRuntimeError(`本地 Plugin 包不存在:${plugin.id}@${plugin.version}`, {
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
