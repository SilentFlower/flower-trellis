import { buildSelfCheck } from "../lib/self-check.js";
import { reportTelemetry } from "../lib/telemetry.js";
import { hasHelpFlag } from "../lib/cli-args.js";

/** 打印 self-check 命令帮助。 */
function printSelfCheckHelp() {
  console.log(`flower-trellis self-check — 输出稳定的启动更新检查 JSON

用法:
  flower-trellis self-check [--manual] [--force-remote] [--target <dir>]

选项:
  --manual         绕过提示节流，但不强制绕过远端缓存
  --force-remote   强制检查远端版本
  --target <dir>   要检查的项目目录

该命令供 SessionStart hook 和自动化读取，成功时始终输出 JSON。`);
}

/**
 * flower-trellis self-check:输出结构化启动更新检查结果。
 *
 * 供 Codex / Claude Code SessionStart hook 和 AI 自动化读取。无论是否发现更新,
 * 都稳定输出 JSON,避免 hook 侧靠空 stdout 猜状态。
 *
 * @param {object} ctx 见 cli-args.js 的 parseCliArgs()
 * @returns {Promise<void>}
 */
export async function selfCheck(ctx) {
  if (hasHelpFlag(ctx.passthrough)) {
    printSelfCheckHelp();
    return;
  }
  const forceRemote = ctx.passthrough.includes("--force-remote");
  const manual = ctx.passthrough.includes("--manual") ||
    ctx.passthrough.includes("--ignore-prompt-suppression");
  if (ctx.updateCheck === false) {
    process.env.FLOWER_NO_UPDATE_CHECK = "1";
  }
  const result = await buildSelfCheck(ctx.target, {
    forceRemote,
    ignorePromptSuppression: manual,
    recordPrompt: !manual,
    onRemoteCheck: () => reportTelemetry(ctx.target, "version_check"),
  });
  console.log(JSON.stringify(result, null, 2));
}
