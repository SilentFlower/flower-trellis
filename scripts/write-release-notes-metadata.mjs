// scripts/write-release-notes-metadata.mjs
//
// 在 commit-and-tag-version 的 postchangelog 阶段运行:CHANGELOG 已生成、package.json
// version 已更新,此脚本把当前版本段落写入 package.json.flowerReleaseNotes。字段是
// flower-trellis 内部 npm metadata,用于旧版本客户端从 npm registry 根文档聚合更新摘要。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractChangelogSection } from "./lib/changelog-section.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(here, "..");
const PACKAGE_PATH = path.join(PKG_ROOT, "package.json");
const CHANGELOG_PATH = path.join(PKG_ROOT, "CHANGELOG.md");
const MAX_METADATA_BODY_CHARS = 8000;

const dryRun = process.argv.includes("--dry-run");

/**
 * 截断 package metadata 中保存的原始版本段落。
 *
 * 注入给 AI 的摘要还有更严格上限;这里的上限用于防止异常 CHANGELOG 段把
 * package.json 和 npm registry metadata 撑大,同时尽量保留发布说明本体。
 *
 * @param {string} body 原始版本段落
 * @returns {{body:string,truncated:boolean}} 可写入 metadata 的版本段落
 */
function limitMetadataBody(body) {
  if (body.length <= MAX_METADATA_BODY_CHARS) {
    return { body, truncated: false };
  }
  return {
    body: body.slice(0, MAX_METADATA_BODY_CHARS).trimEnd(),
    truncated: true,
  };
}

/**
 * 读取并解析 package.json。
 *
 * @returns {object} package.json 对象
 */
function readPackageJson() {
  try {
    return JSON.parse(fs.readFileSync(PACKAGE_PATH, "utf8"));
  } catch (err) {
    throw new Error(`无法读取 package.json:${err.message}`);
  }
}

const pkg = readPackageJson();
const version = typeof pkg.version === "string" ? pkg.version : "";
if (!version) {
  console.error("❌ package.json 缺少 version");
  process.exit(1);
}

let section;
try {
  section = extractChangelogSection(CHANGELOG_PATH, version);
} catch (err) {
  console.error(`❌ ${err.message}`);
  process.exit(1);
}

const limited = limitMetadataBody(section.notes);
const metadata = {
  version,
  source: "CHANGELOG.md",
  body: limited.body,
  truncated: limited.truncated,
};

if (dryRun) {
  console.log(
    `✓ dry-run: 将写入 package.json.flowerReleaseNotes(version=${version}, chars=${metadata.body.length}, truncated=${metadata.truncated})`,
  );
  process.exit(0);
}

pkg.flowerReleaseNotes = metadata;
fs.writeFileSync(PACKAGE_PATH, JSON.stringify(pkg, null, 2) + "\n");
console.log(
  `✓ 已写入 flowerReleaseNotes(version=${version}, chars=${metadata.body.length}, truncated=${metadata.truncated})`,
);
