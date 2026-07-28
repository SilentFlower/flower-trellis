/**
 * 按 UTF-8 字节比较字符串，避免 locale 影响持久化顺序。
 *
 * @param {string} left 左值
 * @param {string} right 右值
 * @returns {number} 排序结果
 */
export function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}
