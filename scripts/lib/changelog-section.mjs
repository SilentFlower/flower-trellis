import fs from "node:fs";

/**
 * 转义字符串以便安全放入正则表达式。
 *
 * @param {string} value 原始字符串
 * @returns {string} 已转义字符串
 */
function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 归一化版本输入,兼容 CI 传入的 tag 名。
 *
 * @param {string} rawVersion 版本号或 tag
 * @returns {string} 去掉 v 前缀后的版本号
 */
export function normalizeChangelogVersion(rawVersion) {
  return String(rawVersion || "").trim().replace(/^v/, "");
}

/**
 * 从 CHANGELOG 文本抽取指定版本段落。
 *
 * @param {string} changelogText CHANGELOG 完整文本
 * @param {string} rawVersion 版本号或 tag
 * @returns {{version:string,notes:string,lineCount:number}} 抽取到的版本段落
 */
export function extractChangelogSectionFromText(changelogText, rawVersion) {
  const version = normalizeChangelogVersion(rawVersion);
  if (!version) {
    throw new Error("缺少版本号");
  }

  const lines = String(changelogText || "").split("\n");
  // 目标版本标题:h2/h3 + 可选 [ ] 包裹的精确版本号,后接空白/]/(/行尾(避免误匹配 0.3.00)。
  const titleRe = new RegExp(`^#{2,3}\\s+\\[?${escapeRegExp(version)}\\]?(\\s|\\]|\\(|$)`);
  // 任意版本标题(用于界定段落结束):h2/h3 + [x.y.z] 或裸 x.y.z。
  const anyVersionRe = /^#{2,3}\s+\[?\d+\.\d+\.\d+/;

  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (titleRe.test(lines[i])) {
      start = i;
      break;
    }
  }
  if (start === -1) {
    throw new Error(`在 CHANGELOG.md 中未找到版本 ${version} 的段落`);
  }

  const body = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (anyVersionRe.test(lines[i])) break;
    body.push(lines[i]);
  }

  const notes = body.join("\n").trim();
  if (!notes) {
    throw new Error(`版本 ${version} 的段落为空`);
  }
  return {
    version,
    notes,
    lineCount: notes.split("\n").length,
  };
}

/**
 * 从 CHANGELOG 文件抽取指定版本段落。
 *
 * @param {string} changelogPath CHANGELOG 文件路径
 * @param {string} rawVersion 版本号或 tag
 * @returns {{version:string,notes:string,lineCount:number}} 抽取到的版本段落
 */
export function extractChangelogSection(changelogPath, rawVersion) {
  if (!fs.existsSync(changelogPath)) {
    throw new Error(`未找到 ${changelogPath}`);
  }
  return extractChangelogSectionFromText(fs.readFileSync(changelogPath, "utf8"), rawVersion);
}
