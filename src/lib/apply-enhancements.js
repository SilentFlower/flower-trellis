import fs from "node:fs";
import path from "node:path";
import { copySkills } from "./copy-skills.js";
import { copyScriptAssets } from "./copy-scripts.js";
import { injectWorkflow } from "./workflow-inject.js";
import { applyCodexTweaks } from "./codex-tweaks.js";
import { applyClaudeTweaks } from "./claude-tweaks.js";
import { copyFlowerAssets } from "./flower-assets.js";
import { readManifest, writeManifest } from "./manifest.js";
import { flowerVersion } from "./versions.js";
import { rmrf } from "./fs-utils.js";
import { resolveEnhancementSnapshot } from "./enhancement-catalog.js";
import { syncInstalledCommonSkills } from "./skill-catalog.js";
import { PKG_ROOT } from "./paths.js";
import { applyPatchPlan, preparePatchPlan } from "./patch-engine.js";
import { flowerPatchAdapters } from "./platform-patch-adapters.js";
import {
  assertNoPatchConflictErrors,
  buildPatchConflictReport,
  evaluatePatchCompatibility,
  formatPatchDiagnostic,
  loadPatchPolicy,
} from "./patch-conflicts.js";

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
 * 流程:校验是 Trellis 项目 → 选变体 → 0.6 Patch 全量预检 → policy 检查 → 应用
 * → 铺 skill/脚本/Flower 资产 → 升级清理 → legacy 后处理 → 写成功 manifest。
 *
 * 升级清理:用 flower manifest 记录上次全装铺过的精确路径,本次全装时删除
 * 「上次有、这次变体不含」的过期项(覆盖 0.5/old → 0.6 升级)。仅全装(无 --skills)
 * 时维护 manifest 与清理;带 --skills 为精细操作,不动 manifest、不清理。
 *
 * @param {string} target 目标项目根
 * @param {object} [opts] { variant?, skills?[] }
 * @returns {{variant: string, installed: string[], patchReport?: object}}
 */
export function applyEnhancements(target, opts = {}) {
  const { variant, version, variantDir } = resolveEnhancementSnapshot(
    target,
    opts.variant,
  );
  const skills = opts.skills || [];
  console.log(
    `\n强化包变体:${variant}${version ? `(项目 Trellis ${version})` : ""}`,
  );

  // 0.6 的 Skill-Garden 与 Flower 自有修改统一进入一个 Patch 计划。required
  // 失败必须发生在任何资产复制、stale 清理和成功 manifest 写入之前。
  let patchPlan = null;
  let patchResult = null;
  let patchReport = null;
  if (variant === "0.6") {
    const skillGardenOverrides = path.join(variantDir, "overrides");
    const flowerPatches = path.join(PKG_ROOT, "src", "patches");
    const policy = loadPatchPolicy(skillGardenOverrides);
    const compatibility = evaluatePatchCompatibility(version, policy.compatibility);
    const compatibilityReport = {
      version: compatibility.version,
      diagnostics: compatibility.diagnostics,
      summary: {
        errors: compatibility.diagnostics.filter((item) => item.severity === "error").length,
        warnings: compatibility.diagnostics.filter((item) => item.severity === "warning").length,
        info: compatibility.diagnostics.filter((item) => item.severity === "info").length,
      },
    };
    // 未支持版本必须先返回可执行指引，不能被旧 catalog 的 selector 漂移错误掩盖。
    assertNoPatchConflictErrors(compatibilityReport);
    patchPlan = preparePatchPlan(
      target,
      [
        {
          name: "skill-garden",
          patchesDir: path.join(skillGardenOverrides, "patches"),
          bundlesDir: path.join(skillGardenOverrides, "bundles"),
        },
        {
          name: "flower",
          patchesDir: path.join(flowerPatches, "platforms"),
          bundlesDir: path.join(flowerPatches, "bundles"),
        },
      ],
      { skills, adapters: flowerPatchAdapters() },
    );
    patchReport = buildPatchConflictReport({ version, plan: patchPlan, policy });
    for (const diagnostic of patchReport.diagnostics.filter(
      (item) => item.severity === "warning",
    )) {
      console.log(`  · ${formatPatchDiagnostic(diagnostic)}`);
    }
    // 冲突检查必须先于 Patch、资产和 manifest 写入，保证不支持版本与互斥协议零写入。
    assertNoPatchConflictErrors(patchReport);
    patchResult = applyPatchPlan(target, patchPlan);
  }

  if (patchPlan && patchPlan.bundles.length > 0) {
    const notes = patchResult.backupNotes.join("");
    console.log(
      `  ✓ Patch:修改 ${patchResult.changed}、` +
        `已是最新 ${patchResult.unchanged}、未安装入口 ${patchResult.missingTargets}、` +
        `可选失败 ${patchResult.optionalSkipped}${notes}`,
    );
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
      ...(patchResult ? { patches: patchResult.provenance } : {}),
    };
  }

  // intent routing 的精细安装别名必须同时刷新 Patch Bundle、helper 与 workflow hub。
  const wantWorkflow = skills.length === 0 || [
    "workflow-enhancement",
    "task-intent",
    "intent-routing",
  ].some((name) => skills.includes(name));
  if (variant !== "0.6" && wantWorkflow) {
    const r = injectWorkflow(target, variantDir, variant);
    if (r.skipped) {
      console.log(`  · workflow 注入跳过(${r.reason})`);
    } else if (r.changed === false) {
      console.log(`  ✓ workflow.md 强化块已是最新${r.backupNote}`);
    } else {
      console.log(`  ✓ workflow.md 已注入强化块(${r.action})${r.backupNote}`);
    }
  }

  if (variant !== "0.6") {
    // legacy 变体仍沿用旧平台后处理；0.6 已由 Flower Patch catalog 接管。
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
  }

  if (nextManifest) {
    // 写 manifest 时同时戳入 flower-trellis 自身版本(flowerVersion),与 version(项目 Trellis
    // 版本)区分开。放在最后，确保中途失败不会留下错误的成功清单。
    writeManifest(target, nextManifest);
  }

  return {
    variant,
    installed,
    ...(patchReport ? { patchReport } : {}),
  };
}
