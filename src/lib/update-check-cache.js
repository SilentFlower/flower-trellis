/**
 * 判断远程探测缓存是否仍在配置的 interval 内。
 * @param {object} updateCheck 归一化缓存
 * @param {Date} [now] 当前时间
 * @returns {boolean} 是否可复用远端版本证据
 */
export function isRemoteCacheFresh(updateCheck, now = new Date()) {
  if (updateCheck.lastStatus === "offline" || updateCheck.lastErrorCode) return false;
  if (!updateCheck.lastRemote) return false;
  if (!updateCheck.lastCheckedAt) return false;
  const checkedAt = new Date(updateCheck.lastCheckedAt).getTime();
  if (!Number.isFinite(checkedAt)) return false;
  return now.getTime() - checkedAt < updateCheck.intervalHours * 60 * 60 * 1000;
}

/**
 * 判断缓存的 release notes 是否匹配本次检查范围。
 *
 * @param {object} updateCheck 归一化 updateCheck 配置
 * @param {{from:string|null,to:string|null,channel:string,reason:string}|null} range 本次期望范围
 * @returns {object|null} 可复用的缓存摘要
 */
export function cachedReleaseNotes(updateCheck, range) {
  const cached = updateCheck.lastReleaseNotes;
  if (!cached || !range || cached.unavailable) return null;
  const cachedRange = cached.range || {};
  if (
    cachedRange.from !== range.from ||
    cachedRange.to !== range.to ||
    cachedRange.channel !== range.channel
  ) {
    return null;
  }
  if (!Array.isArray(cached.versions) || !cached.versions.length) return null;
  // 同一版本范围的内容相同;reason 只是触发路径,不能让项目追平场景丢失摘要。
  return {
    ...cached,
    range: {
      ...cachedRange,
      from: range.from,
      to: range.to,
      channel: range.channel,
      reason: range.reason,
    },
  };
}

