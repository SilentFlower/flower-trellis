import fs from "node:fs";
import path from "node:path";
import { copyPath, listDirs, listFiles, ensureDir } from "./fs-utils.js";
import { shouldInstallName } from "./skill-filter.js";

/**
 * 把指定变体的强化 skill / command 铺到目标项目,**跟随平台**。
 *
 * 平台 → 目录映射(对齐 Trellis 各 configurator 实际写入位置):
 * - claude 平台          → .claude/skills(强化包 .claude/skills 源;old 用 .agents 镜像),
 *                          command 仅 claude → .claude/commands/trellis
 * - codex / gemini 等     → 共享层 .agents/skills(强化包 .agents/skills 源)
 *   (见 Trellis configureCodex:codex 的共享 skill 写在 .agents/skills,非 .codex/skills)
 *
 * 「跟随平台」靠检测目标项目已存在的 .claude/ 与 .agents/ 目录实现 —— 这两个目录由
 * Trellis init 按所选平台创建(claude 建 .claude;codex/gemini 建 .agents),
 * 因此 init / update / enhance-only 统一用此检测即可自动对齐用户实际选的平台。
 *
 * @returns {{ installed: string[], paths: string[] }}
 */
export function copySkills(target, variantDir, variant, skills) {
  const installed = new Set();
  const paths = [];

  const agentsSrc = path.join(variantDir, ".agents", "skills");
  const claudeSrc = path.join(variantDir, ".claude", "skills");
  const cmdSrc = path.join(variantDir, ".claude", "commands", "trellis");

  // 跟随平台:目标已有 .claude → claude 平台;已有 .agents → codex/gemini 等共享层
  let needClaude = fs.existsSync(path.join(target, ".claude"));
  let needAgents = fs.existsSync(path.join(target, ".agents"));
  if (!needClaude && !needAgents) needClaude = true; // 兜底:至少铺 claude

  // codex / gemini 等 → .agents/skills
  if (needAgents) {
    ensureDir(path.join(target, ".agents", "skills"));
    for (const name of listDirs(agentsSrc)) {
      if (!shouldInstallName(name, skills)) continue;
      copyPath(
        path.join(agentsSrc, name),
        path.join(target, ".agents", "skills", name),
      );
      installed.add(name);
      paths.push(`.agents/skills/${name}`);
    }
  }

  // claude → .claude/skills(0.5/0.6 源自带;old 源为空,用 .agents 镜像)
  if (needClaude) {
    ensureDir(path.join(target, ".claude", "skills"));
    const claudeNames = listDirs(claudeSrc);
    const claudeSource = claudeNames.length > 0 ? claudeSrc : agentsSrc;
    for (const name of listDirs(claudeSource)) {
      if (!shouldInstallName(name, skills)) continue;
      copyPath(
        path.join(claudeSource, name),
        path.join(target, ".claude", "skills", name),
      );
      installed.add(name);
      paths.push(`.claude/skills/${name}`);
    }

    // command 仅 claude(old 变体)→ .claude/commands/trellis
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
