/**
 * 判断强化条目是否命中 --skills 过滤名单。
 *
 * @param {string} name 强化条目名,如 trellis-push
 * @param {string[]} skills 用户通过 --skills 指定的过滤名
 * @param {string[]} aliases 该条目的额外别名
 * @returns {boolean} 是否应该处理该条目
 */
export function shouldInstallName(name, skills, aliases = []) {
  if (!skills || skills.length === 0) return true;
  const stripped = name.replace(/^trellis-/, "");
  return skills.some(
    (f) => f === name || f === stripped || aliases.includes(f),
  );
}
