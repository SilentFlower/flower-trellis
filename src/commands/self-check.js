import { buildSelfCheck } from "../lib/self-check.js";
import { reportTelemetry } from "../lib/telemetry.js";

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
