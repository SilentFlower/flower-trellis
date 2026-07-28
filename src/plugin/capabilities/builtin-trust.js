import { registerBuiltinTrustMarker } from "../runtime-extensions.js";

const trustedBuiltinProviders = new WeakSet();
const trustedSourceProfiles = new WeakMap();

function assertProvider(provider, label) {
  if ((typeof provider !== "object" || provider === null) && typeof provider !== "function") {
    throw new TypeError(`${label}只接受对象实例`);
  }
}

/**
 * 把 Flower 内部 Provider 实例登记为 builtin 信任根。
 *
 * 标记只存在于当前进程的 WeakSet，JSON descriptor、lock 和结构化克隆均无法携带。
 *
 * @param {object|Function} provider Flower 内部 Provider 实例
 * @returns {object|Function} 原 Provider 实例
 */
export function markBuiltinProviderTrusted(provider) {
  assertProvider(provider, "builtin Provider 信任标记");
  trustedBuiltinProviders.add(provider);
  return provider;
}

/**
 * 判断 Provider 是否持有当前进程的 builtin 信任标记。
 *
 * @param {unknown} provider Provider 候选
 * @returns {boolean} 是否为可信 builtin Provider
 */
export function isBuiltinProviderTrusted(provider) {
  return (
    (typeof provider === "object" && provider !== null) || typeof provider === "function"
  ) && trustedBuiltinProviders.has(provider);
}

/**
 * 为宿主显式认可的外部来源登记进程内 capability 上限。
 *
 * 该标记不写入 source descriptor、lock 或用户配置，避免外部 Plugin 通过 JSON 字段自提权。
 *
 * @param {object|Function} provider 宿主创建的 Source Provider 实例
 * @param {"standard"|"integration"} maxProfile 允许的最高外部档位
 * @returns {object|Function} 原 Provider 实例
 */
export function markSourceProviderTrusted(provider, maxProfile) {
  assertProvider(provider, "Source Provider 信任标记");
  if (!new Set(["standard", "integration"]).has(maxProfile)) {
    throw new TypeError(`外部 Source Provider 上限非法:${String(maxProfile)}`);
  }
  trustedSourceProfiles.set(provider, maxProfile);
  return provider;
}

/**
 * 读取宿主为当前 Provider 实例登记的外部 capability 上限。
 *
 * @param {unknown} provider Provider 候选
 * @returns {"standard"|"integration"|null} 进程内可信上限
 */
export function trustedSourceProviderProfile(provider) {
  if ((typeof provider !== "object" || provider === null) && typeof provider !== "function") {
    return null;
  }
  return trustedSourceProfiles.get(provider) || null;
}

registerBuiltinTrustMarker(markBuiltinProviderTrusted);
