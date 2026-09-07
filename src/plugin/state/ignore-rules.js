/** Flower 本机状态的标准局部忽略规则，兼容 worktree 准备入口。 */
export const REQUIRED_IGNORE_RULES = [
  "state.json",
  "cache/",
  "transactions/",
  "trellis-control.json",
  "trellis-detached/",
  "*.tmp",
  "settings.json",
];

const SHARED_FILES = [".gitignore", "plugins.json", "plugin-lock.json"];
const BEGIN = "# BEGIN Flower shared records";
const END = "# END Flower shared records";

/**
 * 更新末尾的 Flower 忽略块，保留块外字节并覆盖在后追加的冲突规则。
 *
 * @param {string} current 原忽略文件内容
 * @param {{root?:boolean}} [options] 是否生成项目根规则
 * @returns {string} 幂等合并后的内容
 */
export function mergeFlowerIgnoreRules(current, options = {}) {
  const eol = current.match(/\r?\n/)?.[0] || "\n";
  const starts = [...current.matchAll(/^# BEGIN Flower shared records\r?$/gm)];
  const ends = [...current.matchAll(/^# END Flower shared records\r?$/gm)];
  if (starts.length !== ends.length || starts.length > 1 || (starts.length && starts[0].index > ends[0].index)) {
    throw new Error("Flower gitignore 标记不完整或重复，请先修复标记块");
  }
  let outside = current;
  if (starts.length) {
    const end = ends[0].index + ends[0][0].length;
    outside = current.slice(0, starts[0].index) + current.slice(end + (current[end] === "\n" ? 1 : 0));
  }
  const rules = options.root
    ? ["!/.flower/", "/.flower/*", ...SHARED_FILES.map((name) => `!/.flower/${name}`)]
    : [...REQUIRED_IGNORE_RULES, "*", ...SHARED_FILES.map((name) => `!${name}`)];
  const prefix = outside && !outside.endsWith("\n") ? outside + eol : outside;
  return prefix + [BEGIN, ...rules, END, ""].join(eol);
}
