// scripts/sync-enhancements.mjs
//
// 开发期脚本:把 skill-garden 的 .trellis 强化包与 .common 通用技能同步成本仓库内的
// 快照(enhancements/),随 npm 发布,使最终用户安装时零网络即可叠加强化包与 common skill。
// 最终用户不会运行此脚本。
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

// 源:skill-garden 仓库。路径三级解析(优先级从高到低):
//   1. SKILL_GARDEN_DIR 环境变量 —— 显式覆盖,保留逃生通道(如独立 clone 的旧布局)
//   2. 仓库内 submodule vendor/skill-garden —— 默认源,跟随仓库走,换机/CI 稳定
//   3. 两者都无 .trellis 源 —— 视快照是否已存在,决定「幂等跳过」或「报错中止」
const GARDEN_ROOT = process.env.SKILL_GARDEN_DIR
  ? path.resolve(process.env.SKILL_GARDEN_DIR)
  : path.join(PKG_ROOT, "vendor", "skill-garden");
const SRC = path.join(GARDEN_ROOT, ".trellis");
const COMMON_SRC = path.join(GARDEN_ROOT, ".common");
const DST = path.join(PKG_ROOT, "enhancements");
const MANIFEST_PATH = path.join(DST, "MANIFEST.json");
const VARIANTS = ["old", "0.5", "0.6"];
const COMMON_REMOVED_SKILL_SEEDS = ["sub2api-account-json-fix"];

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

/** 容错读取上一次已提交快照的 common 元数据。 */
function readPreviousCommonManifest() {
  try {
    const common = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"))?.common;
    return common && typeof common === "object" ? common : {};
  } catch {
    return {};
  }
}

const previousCommon = readPreviousCommonManifest();

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
  syncedFrom: path.relative(PKG_ROOT, GARDEN_ROOT).split(path.sep).join("/"),
  sourceCommit,
  common: {},
  variants: {},
};
const commonSkillNames = new Set();

/** 递归列出目录下文件,返回 POSIX 相对路径;目录不存在返回空数组。 */
function listRelativeFilesRecursive(rootDir) {
  const result = [];
  function walk(dir, prefix = "") {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs, rel);
      } else if (entry.isFile()) {
        result.push(rel);
      }
    }
  }
  walk(rootDir);
  return result.sort();
}

if (fs.existsSync(COMMON_SRC)) {
  fs.cpSync(COMMON_SRC, path.join(DST, "common", ".common"), {
    recursive: true,
  });
  const codexSkills = listDirs(
    path.join(DST, "common", ".common", ".codex", "skills"),
  );
  const claudeSkills = listDirs(
    path.join(DST, "common", ".common", ".claude", "skills"),
  );
  for (const name of [...codexSkills, ...claudeSkills]) {
    commonSkillNames.add(name);
  }
  const removedSkills = new Set([
    ...COMMON_REMOVED_SKILL_SEEDS,
    ...(Array.isArray(previousCommon.codexSkills) ? previousCommon.codexSkills : []),
    ...(Array.isArray(previousCommon.claudeSkills) ? previousCommon.claudeSkills : []),
    ...(Array.isArray(previousCommon.removedSkills) ? previousCommon.removedSkills : []),
  ]);
  for (const name of commonSkillNames) removedSkills.delete(name);
  manifest.common = {
    codexSkills,
    claudeSkills,
    removedSkills: [...removedSkills].sort((a, b) => a.localeCompare(b)),
  };
  console.log(
    `✓ common: codex/skills=${codexSkills.length} claude/skills=${claudeSkills.length}`,
  );
} else {
  manifest.common = {
    codexSkills: [],
    claudeSkills: [],
    removedSkills: [
      ...new Set([
        ...COMMON_REMOVED_SKILL_SEEDS,
        ...(Array.isArray(previousCommon.removedSkills)
          ? previousCommon.removedSkills
          : []),
      ]),
    ].sort((a, b) => a.localeCompare(b)),
  };
  console.warn(`⚠ 源缺少 .common/,跳过 common skill 快照`);
}

for (const v of VARIANTS) {
  const vSrc = path.join(SRC, v);
  if (!fs.existsSync(vSrc)) {
    console.warn(`⚠ 源缺少变体 ${v}/,跳过`);
    continue;
  }
  // 全量递归拷贝 .agents / .claude / overrides / scripts(old 无对应目录则自然跳过)
  for (const sub of [".agents", ".claude", "overrides", "scripts"]) {
    const s = path.join(vSrc, sub);
    if (fs.existsSync(s)) {
      fs.cpSync(s, path.join(DST, v, sub), { recursive: true });
    }
  }

  // common skill 不属于 Trellis 工作流强化包。即使源目录里临时残留,发布快照也过滤掉,
  // 避免 `flower-trellis skill` 与全量强化安装出现双来源。
  for (const name of commonSkillNames) {
    for (const rel of [".agents/skills", ".claude/skills"]) {
      fs.rmSync(path.join(DST, v, rel, name), { recursive: true, force: true });
    }
  }

  // 统计(供人工核对:old=11 命令 / 0.5=13 skill / 0.6=12 skill + hub + 5 state + 1 skill override)
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
  const skillOverrides = listFiles(
    path.join(DST, v, "overrides", "skills"),
    ".md",
  );
  const hookOverrides = listRelativeFilesRecursive(
    path.join(DST, v, "overrides", "hooks"),
  );
  const transformFiles = listRelativeFilesRecursive(
    path.join(DST, v, "overrides", "transforms"),
  );
  const scripts = listFiles(path.join(DST, v, "scripts"));
  manifest.variants[v] = {
    claudeSkills,
    agentsSkills,
    commands,
    overrides,
    workflowStates: states,
    skillOverrides,
    hookOverrides,
    transformFiles,
    scripts,
  };

  console.log(
    `✓ ${v}: claude/skills=${claudeSkills.length} agents/skills=${agentsSkills.length} ` +
      `commands=${commands.length} overrides=${overrides.length} states=${states.length} ` +
      `skillOverrides=${skillOverrides.length} hookOverrides=${hookOverrides.length} ` +
      `transformFiles=${transformFiles.length} scripts=${scripts.length}`,
  );
}

fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n");

console.log(`\n强化包快照已生成 → ${DST}`);
if (sourceCommit) console.log(`源 commit: ${sourceCommit}`);
