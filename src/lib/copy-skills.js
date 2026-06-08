import path from "node:path";
import { copyPath, listDirs, listFiles, ensureDir } from "./fs-utils.js";

/**
 * 技能名过滤(移植 install.sh 的 should_install)。
 * 空清单 → 全装;否则精确匹配,或「去掉 trellis- 前缀后」匹配
 * (例:传 analyze-task 也命中 trellis-analyze-task)。
 */
function shouldInstall(name, skills) {
  if (!skills || skills.length === 0) return true;
  const stripped = name.replace(/^trellis-/, "");
  return skills.some((f) => f === name || f === stripped);
}

/**
 * 把指定变体的强化 skill / command 铺到目标项目。
 *
 * 决策2「Claude + agents」:skill 同时铺到 .claude/skills 与 .agents/skills。
 * - 0.5 / 0.6:源两边镜像,各拷一份。
 * - old:源 .claude/skills 为空 → 用其 .agents/skills 镜像补到目标 .claude/skills,
 *   并铺 .claude/commands/trellis/*.md。
 *
 * 目标三个目录一律先 mkdir -p(不假设 trellis init 已建)。
 *
 * @returns {string[]} 实际铺设的条目名(去重)
 */
export function copySkills(target, variantDir, variant, skills) {
  const installed = new Set();

  const agentsSrc = path.join(variantDir, ".agents", "skills");
  const claudeSrc = path.join(variantDir, ".claude", "skills");
  const cmdSrc = path.join(variantDir, ".claude", "commands", "trellis");

  ensureDir(path.join(target, ".agents", "skills"));
  ensureDir(path.join(target, ".claude", "skills"));

  // .agents/skills/<name>/
  for (const name of listDirs(agentsSrc)) {
    if (!shouldInstall(name, skills)) continue;
    copyPath(
      path.join(agentsSrc, name),
      path.join(target, ".agents", "skills", name),
    );
    installed.add(name);
  }

  // .claude/skills/<name>/ —— 0.5/0.6 源自带;old 用 .agents 镜像
  const claudeNames = listDirs(claudeSrc);
  const claudeSource = claudeNames.length > 0 ? claudeSrc : agentsSrc;
  for (const name of listDirs(claudeSource)) {
    if (!shouldInstall(name, skills)) continue;
    copyPath(
      path.join(claudeSource, name),
      path.join(target, ".claude", "skills", name),
    );
    installed.add(name);
  }

  // .claude/commands/trellis/*.md(old 变体)
  const cmds = listFiles(cmdSrc, ".md");
  if (cmds.length > 0) {
    ensureDir(path.join(target, ".claude", "commands", "trellis"));
    for (const file of cmds) {
      const name = file.replace(/\.md$/, "");
      if (!shouldInstall(name, skills)) continue;
      copyPath(
        path.join(cmdSrc, file),
        path.join(target, ".claude", "commands", "trellis", file),
      );
      installed.add(name);
    }
  }

  return [...installed];
}
