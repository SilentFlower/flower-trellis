import fs from "node:fs";
import { spawn } from "node:child_process";
import { resolveConfirmationHarness, confirmationManualReason, supportsConfirmationHarness } from "../lib/confirmation-harnesses.js";
import { CONFIRMATION_SESSION_ENV } from "../constants.js";

/**
 * 启动统一前台会话；不可安全接入的模式保留原命令与人工确认。
 * @param {object} ctx CLI解析上下文，--之后的参数不再由Flower解析。
 * @returns {Promise<number>} 原程序退出码。
 */
export async function session(ctx) {
  if (!ctx.forwarded.length && ctx.passthrough.some(arg => ["-h", "--help"].includes(arg))) {
    process.stdout.write(`用法：ftl session [--target <项目目录>] -- codex|claude [原参数]\n\n`
      + `通过统一入口运行时，已验证的Brief、检查处置、提交确认可按项目策略超时继续。\n`
      + `配置位于 .trellis/config.yaml 的 confirmation_timeout；输入会撤销未开始的默认决定。\n`
      + `退出入口即取消本次许可；重开不会补跑。原生命令、非交互及不兼容模式保持人工确认。\n`);
    return 0;
  }
  const [command, ...args] = ctx.forwarded;
  if (!command) throw new Error("请使用 ftl session [--target <目录>] -- codex|claude [原参数]");
  const resolved = resolveConfirmationHarness(command);
  const root = fs.realpathSync.native(ctx.target);
  const env = { ...process.env };
  delete env[CONFIRMATION_SESSION_ENV];
  const help = args.some(arg => ["-h", "--help", "-V", "--version"].includes(arg));
  let reason = !process.stdin.isTTY || !process.stdout.isTTY ? "当前不是交互式终端" : null;
  reason ||= !["linux", "win32"].includes(process.platform) ? "当前系统的会话退出能力尚未验证" : null;
  reason ||= !fs.existsSync(`${root}/.trellis/scripts/confirmation.py`) ? "当前项目尚未安装确认协议" : null;
  reason ||= confirmationManualReason(resolved.platform, args);
  if (!reason && !help && !supportsConfirmationHarness(resolved, { env })) reason = "当前Harness版本未达到已验证接口基线";
  if (help || reason) {
    if (!help) process.stdout.write(`· ${reason}；使用原参数启动，保持人工确认。\n`);
    return new Promise((resolve, reject) => {
      const child = spawn(resolved.executable, [...resolved.args, ...args], { cwd: root, env, stdio: "inherit" });
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve(signal ? 130 : code ?? 1));
    });
  }
  const { runConfirmationSession } = await import("../lib/confirmation-session.js");
  process.stdout.write("· 统一会话入口已启动；能力与配置校验通过的确认点将启用计时。\n");
  return runConfirmationSession({ root, resolved, args, env });
}
