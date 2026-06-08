import fs from "node:fs";
import path from "node:path";
import { selectVariant } from "./variant.js";
import { ENHANCEMENTS_ROOT } from "./paths.js";
import { VARIANTS } from "../constants.js";
import { copySkills } from "./copy-skills.js";
import { injectWorkflow } from "./workflow-inject.js";
import { applyCodexTweaks } from "./codex-tweaks.js";
import { readManifest, writeManifest } from "./manifest.js";
import { rmrf } from "./fs-utils.js";

/** 清理升级后可能变空的强化目录(深 → 浅)。 */
function pruneEmptyDirs(target) {
  for (const d of [
    ".agents/skills",
    ".agents",
    ".claude/commands/trellis",
    ".claude/commands",
  ]) {
    const abs = path.join(target, ...d.split("/"));
    try {
      if (fs.readdirSync(abs).length === 0) fs.rmdirSync(abs);
    } catch {
      // 不存在或非空,忽略
    }
  }
}

/**
 * 叠加强化包 —— init / update 共享。
 *
 * 流程:校验是 Trellis 项目 → 选变体 → 铺 skill → 升级清理(删过期)→ 注入 workflow。
 *
 * 升级清理:用 flower manifest 记录上次全装铺过的精确路径,本次全装时删除
 * 「上次有、这次变体不含」的过期项(覆盖 0.5/old → 0.6 升级)。仅全装(无 --skills)
 * 时维护 manifest 与清理;带 --skills 为精细操作,不动 manifest、不清理。
 *
 * @param {string} target 目标项目根
 * @param {object} [opts] { variant?, skills?[] }
 * @returns {{variant: string, installed: string[]}}
 */
export function applyEnhancements(target, opts = {}) {
  const trellisDir = path.join(target, ".trellis");
  if (!fs.existsSync(trellisDir)) {
    throw new Error(`目标不是 Trellis 项目(缺 .trellis/):${target}`);
  }

  // 选变体:--variant 优先,否则读 .trellis/.version
  let variant = opts.variant;
  let version = "";
  if (variant) {
    if (!VARIANTS.includes(variant)) {
      throw new Error(`非法 --variant:${variant}(可选 ${VARIANTS.join(" / ")})`);
    }
  } else {
    ({ variant, version } = selectVariant(target));
  }

  const variantDir = path.join(ENHANCEMENTS_ROOT, variant);
  if (!fs.existsSync(variantDir)) {
    throw new Error(`强化包快照缺变体 ${variant}/(请先在 flower-trellis 包内运行 npm run sync)`);
  }

  console.log(
    `\n强化包变体:${variant}${version ? `(项目 Trellis ${version})` : ""}`,
  );

  const skills = opts.skills || [];
  const { installed, paths: newPaths } = copySkills(
    target,
    variantDir,
    variant,
    skills,
  );
  const where = [];
  if (newPaths.some((p) => p.startsWith(".claude/skills"))) where.push(".claude/skills");
  if (newPaths.some((p) => p.startsWith(".agents/skills"))) where.push(".agents/skills");
  if (newPaths.some((p) => p.startsWith(".claude/commands"))) where.push(".claude/commands/trellis");
  console.log(
    `  ✓ 铺设 ${installed.length} 个强化技能 → ${where.join(" + ") || "(无平台目录)"}`,
  );

  // 升级清理 + manifest(仅全装时维护)
  if (skills.length === 0) {
    const old = readManifest(target);
    if (old && Array.isArray(old.paths)) {
      const keep = new Set(newPaths);
      const stale = old.paths.filter((p) => !keep.has(p));
      let removed = 0;
      for (const rel of stale) {
        const abs = path.join(target, ...rel.split("/"));
        if (fs.existsSync(abs)) {
          rmrf(abs);
          removed++;
        }
      }
      if (removed > 0) {
        console.log(
          `  ✓ 清理 ${removed} 个过期强化项(${old.variant || "?"} → ${variant})`,
        );
        pruneEmptyDirs(target);
      }
    }
    writeManifest(target, { variant, version, skills: installed, paths: newPaths });
  }

  // workflow 注入:无过滤名(全装)或显式指定 workflow-enhancement/finish-work-enhancement 时执行
  const wantWorkflow =
    skills.length === 0 ||
    skills.includes("workflow-enhancement") ||
    skills.includes("finish-work-enhancement");
  if (wantWorkflow) {
    const r = injectWorkflow(target, variantDir, variant);
    if (r.skipped) {
      console.log(`  · workflow 注入跳过(${r.reason})`);
    } else if (r.changed === false) {
      console.log(`  ✓ workflow.md 强化块已是最新${r.backupNote}`);
    } else {
      console.log(`  ✓ workflow.md 已注入强化块(${r.action})${r.backupNote}`);
    }
  }

  // codex 平台后处理:注释 config.toml 的 multi_agent_v2 + 挂上 SessionStart hook(仅当 .codex/ 存在)
  const codex = applyCodexTweaks(target);
  if (codex.applied) {
    const seg = codex.tomlChanged
      ? "config.toml 已注释 multi_agent_v2"
      : "config.toml(multi_agent_v2 已是注释态)";
    console.log(`  ✓ codex 调整:${seg};hooks.json = SessionStart + UserPromptSubmit`);
  }

  return { variant, installed };
}
