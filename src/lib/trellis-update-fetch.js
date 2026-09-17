/**
 * 为 Flower 管理的更新隔离上游独立版本提示，保留所有实际资源请求。
 *
 * 上游 0.6.14 的 getLatestNpmVersion 只把该响应用于提示，且已有失败降级。
 * 返回失败而非虚构版本，避免让远程事实与捆绑版本混淆。
 * @param {Function} originalFetch 原 fetch
 * @returns {Function} 只跳过精确 GET 提示请求的 fetch
 */
export function withoutTrellisUpdateNotice(originalFetch) {
  return function fetchWithoutNotice(input, options) {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input?.url;
    const method = String(options?.method || input?.method || "GET").toUpperCase();
    if (method === "GET" && url === "https://registry.npmjs.org/@mindfoldhq/trellis/latest") {
      return Promise.reject(new Error("Trellis 版本由 Flower 管理，跳过独立版本查询"));
    }
    return originalFetch(input, options);
  };
}
