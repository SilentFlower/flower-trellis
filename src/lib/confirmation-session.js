import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { StringDecoder } from "node:string_decoder";
import { spawn as spawnPty } from "node-pty";
import { createConfirmationSnapshot, resolveConfirmationPython } from "./confirmation-snapshot.js";
import { startConfirmationServer } from "./confirmation-server.js";
import { createConfirmationHarnessLaunch } from "./confirmation-harnesses.js";
import { disableWindowsTerminalWin32InputMode } from "./terminal-state.js";
import { ENHANCEMENTS_ROOT } from "./paths.js";

/**
 * 识别终端设备应答，不把设备协议帧当成人工同意或取消。
 * @param {string} input 一次输入帧。
 * @returns {boolean} 是否只含设备应答。
 */
export function isConfirmationTerminalReply(input) {
  return /^(?:\x1b\[\d+;\d+R|\x1b\[\?[\d;]*[cu]|\x1b\](?:10|11);[^\x07]*(?:\x07|\x1b\\))+$/.test(input);
}

/**
 * 在当前真实终端中管理一个Harness，方案由入口完整展示后才开始计时。
 * @param {object} options 项目、已解析程序与原参数。
 * @param {object} dependencies 可替换的终端、进程、材料检查器和启动工厂。
 * @returns {Promise<number>} Harness的实际退出码。
 */
export async function runConfirmationSession({ root, resolved, args = [], env = process.env }, dependencies = {}) {
  const input = dependencies.stdin || process.stdin;
  const output = dependencies.stdout || process.stdout;
  const platform = dependencies.platform || process.platform;
  const python = dependencies.python || resolveConfirmationPython(root, { env });
  const helper = dependencies.helper || path.join(ENHANCEMENTS_ROOT, "0.6/scripts/confirmation.py");
  const snapshot = dependencies.snapshot || createConfirmationSnapshot(root, { python, env, helper });
  const spawn = dependencies.ptySpawn || spawnPty;
  const launchFactory = dependencies.launchFactory || createConfirmationHarnessLaunch;
  const guard = fileURLToPath(new URL("../assets/confirmation_process.py", import.meta.url));
  let child;
  let runtime;
  let closing = false;
  let review = false;
  let buffered = "";
  let alternate = false;
  let modeTail = "";
  let restoreAlternate = false;
  let exitCode = null;
  let settle;
  let hardStop;
  const done = new Promise(resolve => { settle = resolve; });
  const originalRaw = Boolean(input.isRaw);
  const originalFlowing = input.readableFlowing;
  const decoder = new StringDecoder("utf8");
  let dataSubscription;
  let exitSubscription;
  const auditDirectory = path.join(root, ".trellis/.runtime/confirmations");
  let auditFile;

  /** 同步追加最小事件；审计失败不会交付可用的领取许可。 */
  function audit(event) {
    if (!auditFile) {
      fs.mkdirSync(auditDirectory, { recursive: true });
      const real = fs.realpathSync.native(auditDirectory);
      const relative = path.relative(fs.realpathSync.native(root), real);
      if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("确认审计目录超出当前项目");
      auditFile = path.join(real, `${event.instance_id}.jsonl`);
    }
    fs.appendFileSync(auditFile, `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`, { mode: 0o600 });
  }

  /** 完整正文由入口直接写出并排空，避免把模型结束标记误当展示证据。 */
  async function display(material) {
    if (closing || output.destroyed || !output.writable) throw new Error("当前前台终端已关闭");
    review = true;
    restoreAlternate = alternate;
    if (restoreAlternate) output.write("\x1b[?1049l");
    const actions = { implement: "按当前方案开始实现", repair_all_and_recheck: "修复当前全部待处置问题并重新检查",
      execute_git_plan: "按当前精确计划提交" };
    const body = `\x1b[0m\r\n${material.display.replace(/\n/g, "\r\n")}\r\n\r\n`
      + `· ${material.seconds} 秒后默认：${actions[material.action]}。输入任意按键取消自动默认。\r\n`;
    await new Promise((resolve, reject) => output.write(body, error => error ? reject(error) : resolve()));
  }

  /** 恢复原生界面，迟到输出不能覆盖仍在展示的确认正文。 */
  function endReview() {
    if (!review) return;
    review = false;
    if (closing || output.destroyed) { buffered = ""; return; }
    if (restoreAlternate) output.write("\x1b[?1049h");
    output.write(buffered);
    buffered = "";
    if (child) {
      const cols = output.columns || 80;
      const rows = output.rows || 30;
      try { child.resize(cols + 1, rows); child.resize(cols, rows); } catch { /* CLI可能已退出。 */ }
    }
  }

  /** 先撤销并切断守护连接，再等待自有CLI退出。 */
  function shutdown(code = 130) {
    if (closing) return;
    closing = true;
    exitCode ??= code;
    if (runtime) void runtime.close().catch(() => {});
    if (!child) settle(exitCode);
    else hardStop = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* 守护器可能已完成整组清理。 */ }
      settle(exitCode);
    }, 2000);
  }

  const onInput = (chunk) => {
    const text = Buffer.isBuffer(chunk) ? decoder.write(chunk) : String(chunk);
    if (!text || closing) return;
    if (!isConfirmationTerminalReply(text)) runtime.state.cancelAll("human_input");
    child.write(text);
  };
  const onResize = () => { if (!review && child) try { child.resize(output.columns || 80, output.rows || 30); } catch { /* 退出竞争。 */ } };
  const onEnd = () => shutdown(130);
  const onSignal = () => shutdown(130);
  try {
    runtime = await startConfirmationServer({ root, platform: resolved.platform, snapshot, display, audit,
      onAuditError: () => { if (!output.destroyed) output.write("\r\n· 确认审计不可用，本次会话改为人工确认。\r\n"); },
      onReviewEnd: endReview, onExitCode: code => { exitCode = code; } });
    const launch = launchFactory({ resolved, args, descriptor: runtime.descriptor, env });
    child = spawn(python, ["-X", "utf8", guard, helper, launch.executable, ...launch.args], {
      cwd: root, env: launch.env, name: "xterm-256color", cols: output.columns || 80, rows: output.rows || 30,
    });
    dataSubscription = child.onData((data) => {
      if (closing) return;
      const modes = modeTail + data;
      for (const match of modes.matchAll(/\x1b\[\?(?:1049|1047|47)([hl])/g)) alternate = match[1] === "h";
      modeTail = modes.slice(-16);
      if (review) {
        // 展示期间不转发宿主重绘，设备位置查询由入口应答，恢复时强制重绘。
        if (data.includes("\x1b[6n")) child.write("\x1b[1;1R");
        buffered = (buffered + data.replaceAll("\x1b[6n", "")).slice(-262144);
      } else output.write(data);
    });
    exitSubscription = child.onExit(({ exitCode: observed }) => {
      exitCode ??= observed;
      closing = true;
      clearTimeout(hardStop);
      void runtime.close().then(() => settle(exitCode), () => settle(exitCode ?? 2));
    });
    input.on("data", onInput);
    input.once("end", onEnd);
    input.once("close", onEnd);
    output.once("error", onEnd);
    output.on("resize", onResize);
    input.setRawMode?.(true);
    input.resume();
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, onSignal);
    return await done;
  } finally {
    closing = true;
    clearTimeout(hardStop);
    dataSubscription?.dispose();
    exitSubscription?.dispose();
    input.off("data", onInput);
    input.off("end", onEnd);
    input.off("close", onEnd);
    output.off("error", onEnd);
    output.off("resize", onResize);
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.off(signal, onSignal);
    input.setRawMode?.(originalRaw);
    if (originalFlowing === false || originalFlowing === null) input.pause();
    if (runtime) await runtime.close();
    if ((alternate || restoreAlternate) && !output.destroyed) output.write("\x1b[?1049l");
    disableWindowsTerminalWin32InputMode({ platform, output });
  }
}
