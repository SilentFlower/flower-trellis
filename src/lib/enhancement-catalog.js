import fs from "node:fs";
import path from "node:path";
import { VARIANTS } from "../constants.js";
import { listDirs } from "./fs-utils.js";
import { ENHANCEMENTS_ROOT } from "./paths.js";
import { selectVariant } from "./variant.js";

/**
 * 解析目标项目可用的强化包快照目录。
 *
 * @param {string} target 目标项目根目录
 * @param {string|null|undefined} variantOverride 用户通过 --variant 指定的变体
 * @returns {{variant: string, version: string, variantDir: string}} 变体、项目 Trellis 版本与快照目录
 */
export function resolveEnhancementSnapshot(target, variantOverride) {
  const trellisDir = path.join(target, ".trellis");
  if (!fs.existsSync(trellisDir)) {
    throw new Error(`目标不是 Trellis 项目(缺 .trellis/):${target}`);
  }

  const detected = selectVariant(target);
  let variant = variantOverride || detected.variant;
  const version = detected.version;
  if (variantOverride) {
    if (!VARIANTS.includes(variant)) {
      throw new Error(`非法 --variant:${variant}(可选 ${VARIANTS.join(" / ")})`);
    }
  }

  const variantDir = path.join(ENHANCEMENTS_ROOT, variant);
  if (!fs.existsSync(variantDir)) {
    throw new Error(`强化包快照缺变体 ${variant}/(请先在 flower-trellis 包内运行 npm run sync)`);
  }

  return { variant, version, variantDir };
}

/**
 * 列出某个强化包变体里可安装的 skill 名称。
 *
 * @param {string} variantDir 强化包变体目录
 * @returns {string[]} 按名称排序后的 skill 名称
 */
export function listEnhancementSkillNames(variantDir) {
  const names = new Set([
    ...listDirs(path.join(variantDir, ".agents", "skills")),
    ...listDirs(path.join(variantDir, ".claude", "skills")),
  ]);
  return [...names].sort((a, b) => a.localeCompare(b));
}

/**
 * 判断目标项目是否已安装指定强化 skill。
 *
 * @param {string} target 目标项目根目录
 * @param {string} name skill 名称
 * @returns {boolean} 任一平台目录存在即视为已安装
 */
export function isEnhancementSkillInstalled(target, name) {
  return [".agents/skills", ".claude/skills"].some((base) =>
    fs.existsSync(path.join(target, ...base.split("/"), name)),
  );
}

/**
 * 列出目标项目当前变体下的强化 skill 清单。
 *
 * @param {string} target 目标项目根目录
 * @param {string|null|undefined} variantOverride 用户通过 --variant 指定的变体
 * @returns {{variant: string, version: string, skills: {name: string, installed: boolean}[]}} skill 清单
 */
export function listEnhancementSkills(target, variantOverride) {
  const { variant, version, variantDir } = resolveEnhancementSnapshot(
    target,
    variantOverride,
  );
  return {
    variant,
    version,
    skills: listEnhancementSkillNames(variantDir).map((name) => ({
      name,
      installed: isEnhancementSkillInstalled(target, name),
    })),
  };
}
