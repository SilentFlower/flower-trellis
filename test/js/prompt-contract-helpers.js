import fs from "node:fs";
import path from "node:path";

/**
 * 读取 Check-All 各 owner 的完整能力合同，用于守护搬移后的既有断言。
 * @param {string} root 作者源、快照或项目根目录。
 * @param {string} platform 实际平台目录。
 * @returns {string} 全部报告与处置正文；不代表默认路径会全部加载。
 */
export function readCheckAllContract(root, platform = ".agents") {
  const base = path.join(root, platform, "skills/trellis-check-all/references");
  return ["reporting-and-disposition.md", "findings-and-reporting.md", "auto-loop-return.md"]
    .map(file => fs.readFileSync(path.join(base, file), "utf8")).join("\n");
}

/**
 * 读取 Push 主入口与实际存在的特殊流程，保留跨场景的能力断言。
 * @param {string} root 作者源、快照或项目根目录。
 * @param {string} platform 实际平台目录。
 * @returns {string} 主入口和条件流程的完整正文。
 */
export function readPushContract(root, platform = ".agents") {
  const base = path.join(root, platform, "skills/trellis-push");
  return ["SKILL.md", "references/git-special-cases.md", "references/task-progress.md", "references/auto-loop-commit.md"]
    .map(file => fs.readFileSync(path.join(base, file), "utf8")).join("\n");
}
