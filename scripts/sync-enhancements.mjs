// scripts/sync-enhancements.mjs
//
// 开发期脚本:把 skill-garden 的 .trellis 强化包同步成本仓库内的快照(enhancements/),
// 随 npm 发布,使最终用户安装时零网络即可叠加强化包。最终用户不会运行此脚本。
//
// 用法:
//   node scripts/sync-enhancements.mjs
//   SKILL_GARDEN_DIR=/path/to/skill-garden node scripts/sync-enhancements.mjs

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { listDirs, listFiles } from "../src/lib/fs-utils.js";

const here = path.dirname(fileURLToPath(import.meta.url)); // scripts/
const PKG_ROOT = path.resolve(here, "..");

// 源:skill-garden 的 .trellis 目录。路径三级解析(优先级从高到低):
//   1. SKILL_GARDEN_DIR 环境变量 —— 显式覆盖,保留逃生通道(如独立 clone 的旧布局)
//   2. 仓库内 submodule vendor/skill-garden —— 默认源,跟随仓库走,换机/CI 稳定
//   3. 两者都无 .trellis 源 —— 视快照是否已存在,决定「幂等跳过」或「报错中止」
const GARDEN_ROOT = process.env.SKILL_GARDEN_DIR
  ? path.resolve(process.env.SKILL_GARDEN_DIR)
  : path.join(PKG_ROOT, "vendor", "skill-garden");
const SRC = path.join(GARDEN_ROOT, ".trellis");
const DST = path.join(PKG_ROOT, "enhancements");
const MANIFEST_PATH = path.join(DST, "MANIFEST.json");
const VARIANTS = ["old", "0.5", "0.6"];

if (!fs.existsSync(SRC)) {
  // CI 幂等:源不可用(如 CI 未拉 submodule)但快照已提交 → 沿用快照、跳过重建。
  // 这让 prepublishOnly 在「快照已提交、发布不拉 submodule」的 CI 场景下不致失败。
  if (fs.existsSync(MANIFEST_PATH)) {
    console.log(`⚠ 跳过 sync:未找到强化包源(${SRC}),沿用已提交的 enhancements/ 快照`);
    process.exit(0);
  }
  // 既无源又无快照 —— 真正的异常,明确报错并给出可执行修复指引。
  console.error(`❌ 找不到强化包源目录:${SRC}`);
  console.error("   请执行 git submodule update --init --recursive 拉取 vendor/skill-garden,");
  console.error("   或设置 SKILL_GARDEN_DIR 指向 skill-garden 根。");
  process.exit(1);
}

// 先整体清旧快照,避免上游删除了某 skill 后包内仍残留
fs.rmSync(DST, { recursive: true, force: true });
fs.mkdirSync(DST, { recursive: true });

// 源 commit(若 skill-garden 是 git 仓库),用于 MANIFEST 溯源
let sourceCommit = null;
try {
  sourceCommit = execFileSync("git", ["-C", GARDEN_ROOT, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
} catch {
  // 非 git 仓库或无 git,忽略
}

const manifest = {
  syncedAt: new Date().toISOString(),
  // 记录相对仓库根的 POSIX 路径,避免把维护者机器的绝对路径写进随包发布的快照
  // (换机/CI sync 后 MANIFEST 的路径部分保持一致;真正的溯源锚点是 sourceCommit)。
  syncedFrom: path.relative(PKG_ROOT, SRC).split(path.sep).join("/"),
  sourceCommit,
  variants: {},
};

for (const v of VARIANTS) {
  const vSrc = path.join(SRC, v);
  if (!fs.existsSync(vSrc)) {
    console.warn(`⚠ 源缺少变体 ${v}/,跳过`);
    continue;
  }
  // 全量递归拷贝 .agents / .claude / overrides(old 无 overrides 则自然跳过)
  for (const sub of [".agents", ".claude", "overrides"]) {
    const s = path.join(vSrc, sub);
    if (fs.existsSync(s)) {
      fs.cpSync(s, path.join(DST, v, sub), { recursive: true });
    }
  }

  // 统计(供人工核对:old=11 命令 / 0.5=13 skill / 0.6=9 skill + hub + 4 state)
  const claudeSkills = listDirs(path.join(DST, v, ".claude", "skills"));
  const agentsSkills = listDirs(path.join(DST, v, ".agents", "skills"));
  const commands = listFiles(
    path.join(DST, v, ".claude", "commands", "trellis"),
    ".md",
  );
  const overrides = listFiles(path.join(DST, v, "overrides"), ".md");
  const states = listFiles(
    path.join(DST, v, "overrides", "workflow-states"),
    ".md",
  );
  manifest.variants[v] = {
    claudeSkills,
    agentsSkills,
    commands,
    overrides,
    workflowStates: states,
  };

  console.log(
    `✓ ${v}: claude/skills=${claudeSkills.length} agents/skills=${agentsSkills.length} ` +
      `commands=${commands.length} overrides=${overrides.length} states=${states.length}`,
  );
}

fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n");

console.log(`\n强化包快照已生成 → ${DST}`);
if (sourceCommit) console.log(`源 commit: ${sourceCommit}`);
