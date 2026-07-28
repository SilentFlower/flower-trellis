import { parseCanonicalPluginId } from "../schemas/shared.js";
import {
  PLUGIN_RUNTIME_ERROR_CODES,
  PluginRuntimeError,
} from "../runtime-errors.js";

/**
 * Plugin Source Provider 注册表。
 */
export class SourceRegistry {
  /**
   * 创建来源注册表。
   *
   * @param {Array<object>} [providers] 初始 Provider
   */
  constructor(providers = []) {
    this.providers = new Map();
    providers.forEach((provider) => this.register(provider));
  }

  /**
   * 注册唯一 source ID 的 Provider。
   *
   * @param {{id:string,type:string,listCandidates:(id:string)=>import("../contracts.js").PluginCandidate[],readPackage:(plugin:object)=>object}} provider Provider 实例
   * @returns {SourceRegistry} 当前注册表
   */
  register(provider) {
    if (
      !provider ||
      typeof provider.id !== "string" ||
      typeof provider.type !== "string" ||
      typeof provider.listCandidates !== "function" ||
      typeof provider.readPackage !== "function"
    ) {
      throw new TypeError("Source Provider 必须声明 id、type、listCandidates() 和 readPackage()");
    }
    if (this.providers.has(provider.id)) {
      throw new PluginRuntimeError(`Plugin source 重复注册:${provider.id}`, {
        code: PLUGIN_RUNTIME_ERROR_CODES.SOURCE_DUPLICATE,
        path: provider.id,
      });
    }
    this.providers.set(provider.id, provider);
    return this;
  }

  /**
   * 判断来源是否已注册。
   *
   * @param {string} sourceId 来源 ID
   * @returns {boolean} 是否存在
   */
  has(sourceId) {
    return this.providers.has(sourceId);
  }

  /**
   * 读取指定来源 Provider。
   *
   * @param {string} sourceId 来源 ID
   * @returns {object} Provider
   */
  get(sourceId) {
    const provider = this.providers.get(sourceId);
    if (!provider) {
      throw new PluginRuntimeError(`未注册 Plugin source:${sourceId}`, {
        code: PLUGIN_RUNTIME_ERROR_CODES.SOURCE_NOT_FOUND,
        path: sourceId,
      });
    }
    return provider;
  }

  /**
   * 查询 canonical Plugin ID 的全部候选。
   *
   * @param {string} canonicalId canonical Plugin ID
   * @returns {import("../contracts.js").PluginCandidate[]} 候选列表
   */
  listCandidates(canonicalId) {
    const { sourceId } = parseCanonicalPluginId(canonicalId);
    const candidates = this.get(sourceId).listCandidates(canonicalId);
    return candidates.filter((candidate) => candidate.id === canonicalId);
  }

  /**
   * 读取并复核已解析 Plugin 的固定包。
   *
   * @param {import("../contracts.js").PluginCandidate|import("../contracts.js").ResolvedPlugin} plugin 候选或锁定 Plugin
   * @returns {{root:string,manifest:import("../contracts.js").PluginManifest,integrity:string}} 固定包
   */
  readPackage(plugin) {
    return this.get(plugin.source.id).readPackage(plugin);
  }
}
