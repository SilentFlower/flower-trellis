let patchPlanner = null;
let builtinTrustMarker = null;
let builtinTrustInspector = null;
const pendingBuiltinProviders = new Set();

/**
 * 注册可选的 Plugin Patch Planner。
 *
 * P2 Runtime 只依赖这个进程内扩展点；P4 模块加载后再登记真实 Planner，
 * 避免基础生命周期代码静态依赖尚未安装的 capability 实现。
 *
 * @param {Function} planner Patch 规划函数
 * @returns {Function} 已登记的规划函数
 */
export function registerPluginPatchPlanner(planner) {
  if (typeof planner !== "function") throw new TypeError("Plugin Patch Planner 必须是函数");
  patchPlanner = planner;
  return planner;
}

/**
 * 读取当前进程已登记的 Plugin Patch Planner。
 *
 * @returns {Function|null} Patch 规划函数；P4 未加载时为空
 */
export function getPluginPatchPlanner() {
  return patchPlanner;
}

/**
 * 注册 builtin Provider 的进程内信任标记函数。
 *
 * @param {Function} marker 信任标记函数
 * @returns {Function} 已登记的标记函数
 */
export function registerBuiltinTrustMarker(marker) {
  if (typeof marker !== "function") throw new TypeError("builtin Provider 信任标记必须是函数");
  if (builtinTrustMarker && builtinTrustMarker !== marker) {
    throw new Error("builtin Provider 信任标记已由其他模块登记");
  }
  builtinTrustMarker = marker;
  // capability 可能晚于 Runtime 加载，因此要补登记此前已经构造的 builtin Provider。
  for (const provider of pendingBuiltinProviders) marker(provider);
  pendingBuiltinProviders.clear();
  return marker;
}

/**
 * 注册 builtin Provider 的进程内信任检查函数。
 *
 * @param {Function} inspector 信任检查函数
 * @returns {Function} 已登记的检查函数
 */
export function registerBuiltinTrustInspector(inspector) {
  if (typeof inspector !== "function") throw new TypeError("builtin Provider 信任检查必须是函数");
  if (builtinTrustInspector && builtinTrustInspector !== inspector) {
    throw new Error("builtin Provider 信任检查已由其他模块登记");
  }
  builtinTrustInspector = inspector;
  return inspector;
}

/**
 * 在 capability 模块可用时标记 builtin Provider。
 *
 * @param {object|Function} provider builtin Provider 实例
 * @returns {object|Function} 原 Provider 实例
 */
export function markRuntimeBuiltinProvider(provider) {
  if (builtinTrustMarker) return builtinTrustMarker(provider);
  pendingBuiltinProviders.add(provider);
  return provider;
}

/**
 * 判断 Provider 是否持有 capability 模块登记的进程内 builtin 信任。
 *
 * @param {unknown} provider Provider 候选
 * @returns {boolean} 是否为可信 builtin Provider
 */
export function isRuntimeBuiltinProviderTrusted(provider) {
  return builtinTrustInspector ? builtinTrustInspector(provider) : false;
}
