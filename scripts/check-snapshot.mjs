// scripts/check-snapshot.mjs
//
// 发布前置断言:确保随包发布的 enhancements/ 快照与 vendor/skill-garden 子模块当前
// pin 的 commit 一致,防止「改了 submodule pin 却忘了重新 sync」而发布出陈旧快照。
// 由 `npm run release` 在 commit-and-tag-version 之前调用(见 package.json 的 scripts.release)。
//
// 校验三件事(任一不满足即非零退出并给出修复指引,阻断发布):
//   1. enhancements/MANIFEST.json 的 sourceCommit === vendor/skill-garden 的 HEAD(pin)
//   2. 工作区 enhancements/ 无未提交改动(快照已落盘并提交)
//   3. vendor/skill-garden 子模块工作区无未提交改动(避免快照来自未提交源)

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url)); // scripts/
const PKG_ROOT = path.resolve(here, "..");
const MANIFEST_PATH = path.join(PKG_ROOT, "enhancements", "MANIFEST.json");
const SUBMODULE = path.join(PKG_ROOT, "vendor", "skill-garden");

/**
 * 打印错误并以退出码 1 中止发布。
 * @param {string} msg 中文错误原因
 */
function fail(msg) {
  console.error(`❌ 发布前检查未通过:${msg}`);
  process.exit(1);
}

/**
 * 读取 enhancements 快照的来源 commit。
 * @returns {string} MANIFEST.json 的 sourceCommit
 */
function readSnapshotCommit() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    fail(`未找到 ${path.relative(PKG_ROOT, MANIFEST_PATH)};请先 npm run sync 生成快照。`);
  }
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  if (typeof manifest.sourceCommit !== "string" || !manifest.sourceCommit) {
    fail("MANIFEST.json 缺少有效的 sourceCommit。");
  }
  return manifest.sourceCommit;
}

/**
 * 读取 vendor/skill-garden 子模块当前 pin 的 commit。
 * @returns {string} submodule HEAD 的完整 SHA
 */
function readSubmodulePin() {
  if (!fs.existsSync(path.join(SUBMODULE, ".git"))) {
    fail("未初始化 vendor/skill-garden 子模块;请执行 git submodule update --init --recursive。");
  }
  try {
    return execFileSync("git", ["-C", SUBMODULE, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
  } catch {
    fail("无法读取 vendor/skill-garden 的 HEAD(git rev-parse 失败)。");
  }
}

/**
 * 检查工作区 enhancements/ 是否存在未提交改动。
 * @returns {string} git status --porcelain 针对 enhancements/ 的输出(空串表示干净)
 */
function enhancementsDirty() {
  try {
    return execFileSync(
      "git",
      ["-C", PKG_ROOT, "status", "--porcelain", "--", "enhancements"],
      { encoding: "utf8" },
    ).trim();
  } catch {
    return ""; // 非 git 环境等异常按「干净」处理,不阻断
  }
}

/**
 * 检查 vendor/skill-garden 工作区是否存在未提交改动。
 * @returns {string} git status --porcelain 的输出(空串表示干净)
 */
function submoduleDirty() {
  try {
    return execFileSync("git", ["-C", SUBMODULE, "status", "--porcelain"], {
      encoding: "utf8",
    }).trim();
  } catch {
    fail("无法读取 vendor/skill-garden 的工作区状态(git status 失败)。");
  }
}

const snapshotCommit = readSnapshotCommit();
const pin = readSubmodulePin();

if (snapshotCommit !== pin) {
  fail(
    `enhancements 快照(sourceCommit=${snapshotCommit.slice(0, 10)})与 ` +
      `vendor/skill-garden pin(${pin.slice(0, 10)})不一致。\n` +
      "   请先 npm run sync 重建快照,并提交 enhancements/ 后再发布。",
  );
}

const sourceDirty = submoduleDirty();
if (sourceDirty) {
  const detail = sourceDirty
    .split("\n")
    .map((l) => "     " + l)
    .join("\n");
  fail(
    "vendor/skill-garden 存在未提交改动:\n" +
      detail +
      "\n   请先在 skill-garden 提交源改动并更新 submodule pin,再 npm run sync 重建快照。",
  );
}

const dirty = enhancementsDirty();
if (dirty) {
  const detail = dirty
    .split("\n")
    .map((l) => "     " + l)
    .join("\n");
  fail(
    "enhancements/ 存在未提交改动:\n" +
      detail +
      "\n   请先提交快照(git add enhancements && git commit)再发布。",
  );
}

console.log(
  `✓ 发布前检查通过:enhancements 快照与 submodule pin 一致(${pin.slice(0, 10)}),快照已提交`,
);
