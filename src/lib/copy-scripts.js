import path from "node:path";
import { copyPath, listFiles } from "./fs-utils.js";
import { shouldInstallName } from "./skill-filter.js";

/**
 * 把强化包携带的 `.trellis/scripts/` 辅助脚本铺到目标项目。
 *
 * 只复制变体快照 `scripts/` 下的直接文件，避免覆盖目标项目已有的 Trellis 原生
 * `.trellis/scripts/` 目录。脚本文件作为 manifest 精确路径记录，后续升级只会清理
 * flower 自己铺过的具体文件。
 *
 * @param {string} target 目标项目根目录
 * @param {string} variantDir 强化包变体目录
 * @param {string[]} skills 用户通过 --skills 指定的过滤名
 * @returns {{installed: string[], paths: string[]}} 已安装脚本名与 manifest 路径
 */
export function copyScriptAssets(target, variantDir, skills = []) {
  const installed = [];
  const paths = [];
  const scriptsSrc = path.join(variantDir, "scripts");

  for (const file of listFiles(scriptsSrc)) {
    const name = file.replace(/\.[^.]+$/, "");
    let aliases = [];
    if (name === "auto_loop") {
      aliases = ["auto-loop", "auto-loop-runner", "trellis-auto-loop"];
    } else if (name === "task_progress") {
      aliases = [
        "task-progress",
        "trellis-push",
        "push",
        "progress",
        "push-snapshot",
        "snapshot",
      ];
    } else if (name === "spec_router") {
      aliases = [
        "spec-router",
        "project-knowledge",
        "knowledge-router",
        "workflow-enhancement",
        "task-intent",
        "intent-routing",
      ];
    } else if (name === "task_intent") {
      aliases = [
        "task-intent",
        "intent-routing",
        "workflow-enhancement",
      ];
    }
    if (!shouldInstallName(name, skills, aliases)) continue;

    copyPath(
      path.join(scriptsSrc, file),
      path.join(target, ".trellis", "scripts", file),
    );
    installed.push(`script:${file}`);
    paths.push(`.trellis/scripts/${file}`);
  }

  return { installed, paths };
}
