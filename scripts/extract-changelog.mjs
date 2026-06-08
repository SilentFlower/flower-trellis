// scripts/extract-changelog.mjs
//
// 从 CHANGELOG.md 抽取指定版本的变更段落,写入输出文件,供 GitHub Release 的
// `gh release create --notes-file` 使用 —— 保证 Release notes 与 CHANGELOG 同源。
// 由发布工作流(.github/workflows/release.yml)在创建 Release 前调用。
//
// 用法:
//   node scripts/extract-changelog.mjs <version|tag> <outFile>
//     <version|tag>:形如 0.3.0 或 v0.3.0(自动剥掉前缀 v)
//     <outFile>:抽出的段落写入该文件
//
// 适配 commit-and-tag-version 的标题格式:minor/major 版本为 `## [x.y.z](...) (date)`,
// patch 版本为 `### [x.y.z](...) (date)`,故版本标题匹配兼容 h2/h3。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url)); // scripts/
const PKG_ROOT = path.resolve(here, "..");
const CHANGELOG_PATH = path.join(PKG_ROOT, "CHANGELOG.md");

const [rawVersion, outFile] = process.argv.slice(2);
if (!rawVersion || !outFile) {
  console.error("❌ 用法:node scripts/extract-changelog.mjs <version|tag> <outFile>");
  process.exit(1);
}

// 剥掉可能的 v 前缀(CI 传入的是 tag 名,如 v0.3.0)
const version = rawVersion.replace(/^v/, "");

if (!fs.existsSync(CHANGELOG_PATH)) {
  console.error(`❌ 未找到 ${path.relative(PKG_ROOT, CHANGELOG_PATH)}`);
  process.exit(1);
}

const lines = fs.readFileSync(CHANGELOG_PATH, "utf8").split("\n");

// 目标版本标题:h2/h3 + 可选 [ ] 包裹的精确版本号,后接空白/]/(/行尾(避免误匹配 0.3.00)。
const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const titleRe = new RegExp(`^#{2,3}\\s+\\[?${escaped}\\]?(\\s|\\]|\\(|$)`);
// 任意版本标题(用于界定段落结束):h2/h3 + [x.y.z] 或裸 x.y.z
const anyVersionRe = /^#{2,3}\s+\[?\d+\.\d+\.\d+/;

let start = -1;
for (let i = 0; i < lines.length; i++) {
  if (titleRe.test(lines[i])) {
    start = i;
    break;
  }
}

if (start === -1) {
  console.error(`❌ 在 CHANGELOG.md 中未找到版本 ${version} 的段落`);
  process.exit(1);
}

// 从标题的下一行收集,直到遇到下一个版本标题(或文件结束)
const body = [];
for (let i = start + 1; i < lines.length; i++) {
  if (anyVersionRe.test(lines[i])) break;
  body.push(lines[i]);
}

const notes = body.join("\n").trim();
if (!notes) {
  console.error(`❌ 版本 ${version} 的段落为空`);
  process.exit(1);
}

fs.writeFileSync(outFile, notes + "\n");
console.log(`✓ 已抽取 ${version} 的变更段落 → ${outFile}(${notes.split("\n").length} 行)`);
