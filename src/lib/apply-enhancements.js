import fs from "node:fs";
import path from "node:path";
import { copySkills } from "./copy-skills.js";
import { copyScriptAssets } from "./copy-scripts.js";
import { injectWorkflow } from "./workflow-inject.js";
import { injectSkillOverrides } from "./skill-override-inject.js";
import { injectHookOverrides } from "./hook-override-inject.js";
import { applyCodexTweaks } from "./codex-tweaks.js";
import { applyClaudeTweaks } from "./claude-tweaks.js";
import { copyFlowerAssets } from "./flower-assets.js";
import { readManifest, writeManifest } from "./manifest.js";
import { flowerVersion } from "./versions.js";
import { rmrf } from "./fs-utils.js";
import { resolveEnhancementSnapshot } from "./enhancement-catalog.js";
import { syncInstalledCommonSkills } from "./skill-catalog.js";
import {
  applyPreparedTransforms,
  prepareEnhancementTransforms,
} from "./enhancement-transform.js";

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
 * 流程:校验是 Trellis 项目 → 选变体 → 铺 skill → 升级清理(删过期)
 * → 注入 workflow → 注入 skill override → 注入 hook override。
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
  const { variant, version, variantDir } = resolveEnhancementSnapshot(
    target,
    opts.variant,
  );
  const skills = opts.skills || [];

  // required 变换必须在任何强化写入前完成全量 preflight，避免锚点漂移时
  // 已经复制资产、清理旧路径或写入成功 manifest。
  const transformPlan = prepareEnhancementTransforms(
    target,
    variantDir,
    skills,
  );
  const transformResult = applyPreparedTransforms(target, transformPlan);

  console.log(
    `\n强化包变体:${variant}${version ? `(项目 Trellis ${version})` : ""}`,
  );
  if (transformPlan.declarations.length > 0) {
    const notes = transformResult.backupNotes.join("");
    console.log(
      `  ✓ 声明式变换:修改 ${transformResult.changed}、` +
        `已是最新 ${transformResult.unchanged}、跳过 ${transformResult.skipped}${notes}`,
    );
    for (const result of transformResult.results) {
      if (result.status === "optional-skip") {
        console.log(`  · optional transform 跳过:${result.id}@${result.target}(${result.reason})`);
      }
    }
  }

  const { installed: skillInstalled, paths: skillPaths } = copySkills(
    target,
    variantDir,
    variant,
    skills,
  );
  const { installed: scriptInstalled, paths: scriptPaths } = copyScriptAssets(
    target,
    variantDir,
    skills,
  );
  const { installed: flowerInstalled, paths: flowerPaths } = skills.length === 0
    ? copyFlowerAssets(target)
    : { installed: [], paths: [] };
  const installed = [...skillInstalled, ...scriptInstalled, ...flowerInstalled];
  const newPaths = [...skillPaths, ...scriptPaths, ...flowerPaths];
  const where = [];
  if (newPaths.some((p) => p.startsWith(".claude/skills"))) where.push(".claude/skills");
  if (newPaths.some((p) => p.startsWith(".agents/skills"))) where.push(".agents/skills");
  if (newPaths.some((p) => p.startsWith(".claude/commands"))) where.push(".claude/commands/trellis");
  if (newPaths.some((p) => p.startsWith(".trellis/scripts"))) where.push(".trellis/scripts");
  console.log(
    `  ✓ 铺设 ${installed.length} 个强化项 → ${where.join(" + ") || "(无平台目录)"}`,
  );

  let commonPaths = [];
  if (skills.length === 0) {
    const common = syncInstalledCommonSkills(target);
    commonPaths = common.refreshedPaths;
    if (common.refreshed.length > 0 || common.removed.length > 0) {
      console.log(
        `  ✓ common skill 已同步:刷新 ${common.refreshed.length} 个,` +
          `清理 ${common.removed.length} 个`,
      );
    } else {
      console.log("  · 未发现已启用或待清理的 common skill");
    }
  }

  // 升级清理(仅全装时维护)。manifest 必须等全部 required 强化步骤成功后再写。
  let nextManifest = null;
  if (skills.length === 0) {
    const old = readManifest(target);
    if (old && Array.isArray(old.paths)) {
      // 历史版本可能把后来迁入 common 的 skill 记在 paths 中。本轮已确认仍启用的
      // common 路径只用于阻止旧 manifest 误删；新 manifest 仍不接管这些可选技能。
      const keep = new Set([...newPaths, ...commonPaths]);
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
    nextManifest = {
      flowerVersion: flowerVersion(),
      variant,
      version,
      skills: installed,
      paths: newPaths,
    };
  }

  // intent routing 的精细安装别名必须同时刷新 transform、helper 与 workflow hub。
  const wantWorkflow = skills.length === 0 || [
    "workflow-enhancement",
    "task-intent",
    "intent-routing",
  ].some((name) => skills.includes(name));
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

  const wantSkillOverrides =
    skills.length === 0 ||
    skills.includes("finish-work-enhancement") ||
    skills.includes("trellis-finish-work") ||
    skills.includes("finish-work") ||
    skills.includes("update-spec-enhancement") ||
    skills.includes("trellis-update-spec") ||
    skills.includes("update-spec");
  if (wantSkillOverrides) {
    const r = injectSkillOverrides(target, variantDir, skills);
    if (r.skipped) {
      console.log(`  · skill override 注入跳过(${r.reason})`);
    } else if (r.changed === 0 && r.unchanged === 0) {
      console.log(`  · skill override 注入跳过(目标缺少可注入的上游入口)`);
    } else if (r.changed === 0) {
      const note = r.backupNotes.length ? r.backupNotes.join("") : "";
      console.log(`  ✓ skill override 已是最新(${r.unchanged} 个入口)${note}`);
    } else {
      const note = r.backupNotes.length ? r.backupNotes.join("") : "";
      console.log(`  ✓ skill override 已注入 ${r.changed} 个入口${note}`);
    }
  }

  if (skills.length === 0) {
    const r = injectHookOverrides(target, variantDir);
    if (r.skipped) {
      console.log(`  · hook override 注入跳过(${r.reason})`);
    } else if (r.changed === 0 && r.unchanged === 0) {
      console.log(`  · hook override 注入跳过(目标缺少可覆盖的 hook)`);
    } else if (r.changed === 0) {
      const note = r.backupNotes.length ? r.backupNotes.join("") : "";
      console.log(`  ✓ hook override 已是最新(${r.unchanged} 个入口)${note}`);
    } else {
      const note = r.backupNotes.length ? r.backupNotes.join("") : "";
      console.log(`  ✓ hook override 已注入 ${r.changed} 个入口${note}`);
    }
  }

  // codex 平台后处理:旧 multi_agent_v2 兼容清理 + 合并 SessionStart hook + 强制 sub-agent 调度
  const codex = applyCodexTweaks(target);
  if (codex.applied) {
    const seg = codex.tomlChanged
      ? "config.toml 已清理旧 multi_agent_v2"
      : "config.toml 无需清理 multi_agent_v2";
    const dispatch = codex.dispatchModeChanged
      ? "dispatch_mode 已强制为 sub-agent"
      : "dispatch_mode 已是 sub-agent";
    console.log(`  ✓ codex 调整:${seg};hooks.json 已合并 SessionStart;${dispatch}`);
  }

  const claude = applyClaudeTweaks(target);
  if (claude.applied) {
    console.log("  ✓ claude 调整:settings.json 已合并 startup 更新检查 hook");
  }

  if (nextManifest) {
    // 写 manifest 时同时戳入 flower-trellis 自身版本(flowerVersion),与 version(项目 Trellis
    // 版本)区分开。放在最后，确保中途失败不会留下错误的成功清单。
    writeManifest(target, nextManifest);
  }

  return { variant, installed };
}
