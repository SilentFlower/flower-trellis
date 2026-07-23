import fs from "node:fs";
import path from "node:path";
import { ENHANCEMENT_SKILL_TARGETS } from "../constants.js";
import { copyPath, listDirs, listFiles, ensureDir } from "./fs-utils.js";
import { shouldInstallName } from "./skill-filter.js";

/**
 * 把指定变体的强化 skill / command 铺到目标项目,**跟随平台**。
 *
 * 目标目录由 `ENHANCEMENT_SKILL_TARGETS` 统一维护。只向已经存在的原生
 * skill root 复制；完全没有识别到平台时才回退 Claude。Claude 使用自己的快照，
 * 其余平台使用 `.agents` canonical source。
 *
 * @param {string} target 目标项目根目录
 * @param {string} variantDir 强化包变体目录
 * @param {string} variant 变体名称，保留用于调用契约兼容
 * @param {string[]} skills 用户选择的 skill/alias 清单，空数组表示全量
 * @returns {{ installed: string[], paths: string[] }}
 */
export function copySkills(target, variantDir, variant, skills) {
  const installed = new Set();
  const paths = [];

  const agentsSrc = path.join(variantDir, ".agents", "skills");
  const claudeSrc = path.join(variantDir, ".claude", "skills");
  const cmdSrc = path.join(variantDir, ".claude", "commands", "trellis");

  let targets = ENHANCEMENT_SKILL_TARGETS.filter(({ root }) =>
    fs.existsSync(path.join(target, ...root.split("/")))
  );
  if (targets.length === 0) {
    const fallback = ENHANCEMENT_SKILL_TARGETS.find(({ platform }) => platform === "claude");
    if (!fallback) throw new Error("强化 Skill 平台映射缺少 Claude fallback");
    targets = [fallback];
  }

  for (const targetConfig of targets) {
    const targetRoot = path.join(target, ...targetConfig.root.split("/"));
    ensureDir(targetRoot);
    const preferredSource = targetConfig.source === "claude" ? claudeSrc : agentsSrc;
    const source = listDirs(preferredSource).length > 0 ? preferredSource : agentsSrc;
    for (const name of listDirs(source)) {
      if (!shouldInstallName(name, skills)) continue;
      copyPath(
        path.join(source, name),
        path.join(targetRoot, name),
      );
      installed.add(name);
      paths.push(`${targetConfig.root}/${name}`);
    }
  }

  if (targets.some(({ platform }) => platform === "claude")) {
    // command 仅 Claude old 变体使用；0.6 原生 command 由 Patch Engine 维护。
    const cmds = listFiles(cmdSrc, ".md");
    if (cmds.length > 0) {
      ensureDir(path.join(target, ".claude", "commands", "trellis"));
      for (const file of cmds) {
        const name = file.replace(/\.md$/, "");
        if (!shouldInstallName(name, skills)) continue;
        copyPath(
          path.join(cmdSrc, file),
          path.join(target, ".claude", "commands", "trellis", file),
        );
        installed.add(name);
        paths.push(`.claude/commands/trellis/${file}`);
      }
    }
  }

  return { installed: [...installed], paths };
}
