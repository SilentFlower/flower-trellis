import fs from "node:fs";
import path from "node:path";
import { selectVariant } from "./variant.js";
import { ENHANCEMENTS_ROOT } from "./paths.js";
import { VARIANTS } from "../constants.js";
import { copySkills } from "./copy-skills.js";
import { injectWorkflow } from "./workflow-inject.js";

/**
 * 叠加强化包 —— init / update 共享。
 *
 * 流程:校验是 Trellis 项目 → 选变体 → 铺 skill → 注入 workflow override。
 *
 * @param {string} target 目标项目根
 * @param {object} [opts]
 * @param {string} [opts.variant] 强制变体(覆盖按版本自动选择)
 * @param {string[]} [opts.skills] 技能名过滤;空=全装
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
  const installed = copySkills(target, variantDir, variant, skills);
  console.log(
    `  ✓ 铺设 ${installed.length} 个强化技能 → .claude/skills + .agents/skills`,
  );

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

  return { variant, installed };
}
