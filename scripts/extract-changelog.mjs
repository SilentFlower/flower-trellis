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
import { extractChangelogSection } from "./lib/changelog-section.mjs";

const here = path.dirname(fileURLToPath(import.meta.url)); // scripts/
const PKG_ROOT = path.resolve(here, "..");
const CHANGELOG_PATH = path.join(PKG_ROOT, "CHANGELOG.md");

const [rawVersion, outFile] = process.argv.slice(2);
if (!rawVersion || !outFile) {
  console.error("❌ 用法:node scripts/extract-changelog.mjs <version|tag> <outFile>");
  process.exit(1);
}

if (!fs.existsSync(CHANGELOG_PATH)) {
  console.error(`❌ 未找到 ${path.relative(PKG_ROOT, CHANGELOG_PATH)}`);
  process.exit(1);
}

let section;
try {
  section = extractChangelogSection(CHANGELOG_PATH, rawVersion);
} catch (err) {
  console.error(`❌ ${err.message}`);
  process.exit(1);
}

fs.writeFileSync(outFile, section.notes + "\n");
console.log(`✓ 已抽取 ${section.version} 的变更段落 → ${outFile}(${section.lineCount} 行)`);
