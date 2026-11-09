/** @module confirm 正式后台确认的命令编排；帮助不连接宿主或创建状态。 */
import { hasHelpFlag } from "../lib/cli-args.js";
import { realpathSync, existsSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { formalConfirmationWake } from "../lib/confirmation-protocol.js";

const HELP = `flower-trellis confirm — 原生后台超时确认（Linux/WSL，Codex / Claude）

  ftl confirm prepare --input <项目内 JSON 路径> [--seconds <正整数秒>]
  ftl confirm wait --request <UUID>
  ftl confirm claim --request <UUID>
  ftl confirm result --request <UUID> --receipt <UUID> --state <started|completed|interrupted|needs-verification>
  ftl confirm status
  ftl confirm cancel [--request <UUID>]

公共参数：--platform codex|claude、--session <精确 UUID>、--target <项目根>。
平台和会话可从当前原生环境取得；歧义或能力不可用时保持人工确认。
prepare 返回完整 display，必须原样完整展示。wait 用原生后台工具启动，结束当前回合后计时。
到期只唤醒；claim 成功后才能进入返回的原流程，result 据实记录执行状态。
任意人工输入、取消、材料或策略变化均使旧等待失效；关闭或坏配置不自动放行。
项目策略位于 .trellis/config.yaml 的 confirmation_timeout，支持分类配置和关闭。
Codex 沿用普通启动与共享服务，wait 由原生后台终端承接，窗口退出使旧等待失效。
hook 为安装器使用的两平台原生事件入口，stdin 接收原生 JSON，不用于批准业务动作。`;

/** 读取有界 stdin，避免 Hook 或材料无限占用内存。 */
async function inputJson() {
  const chunks = [];
  let size = 0;
  for await (const bytes of process.stdin) {
    chunks.push(bytes);
    size += bytes.length;
    if (size > 1024 * 1024) throw new Error("确认输入超过大小限制");
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/**
 * 执行正式确认命令；业务动作由调用方的既有 workflow 所有。
 * @param {object} ctx CLI 参数上下文
 * @returns {Promise<number>} 命令退出码
 */
export async function confirm(ctx) {
  const args = ctx.passthrough || [];
  if (!args.length || hasHelpFlag(args)) { process.stdout.write(`${HELP}\n`); return 0; }
  const output = value => process.stdout.write(`${JSON.stringify(value)}\n`);
  const [command, ...flags] = args;
  const allowed = {
    prepare: ["--input", "--seconds"], wait: ["--request"], claim: ["--request"], status: [], cancel: ["--request"],
    result: ["--request", "--receipt", "--state"], hook: [],
  };
  if (!allowed[command]) throw new Error("未知确认命令，使用 confirm --help 查看用法");
  const values = {};
  for (let index = 0; index < flags.length; index += 2) {
    const flag = flags[index];
    if (![...allowed[command], "--platform", "--session"].includes(flag) || values[flag] !== undefined || flags[index + 1] === undefined) throw new Error("确认参数未知、重复或缺少值");
    values[flag] = flags[index + 1];
  }
  if (command === "hook") {
    if (process.platform !== "linux") { output({}); return 0; }
    const payload = await inputJson();
    const hookPlatform = values["--platform"] || (process.env.CODEX_THREAD_ID ? "codex" : "claude");
    const record = hookPlatform === "codex"
      ? (await import("../lib/codex-confirmation-client.js")).recordCodexConfirmationEvent
      : hookPlatform === "claude" ? (await import("../lib/claude-confirmation-client.js")).recordClaudeConfirmationEvent : null;
    if (!record) throw new Error("未知确认 Hook 平台");
    for (let attempt = 0; ; attempt += 1) {
      try { output(record(payload)); return 0; }
      catch (error) {
        // 只重试确定未写入的锁竞争；保留共享锁每次 1000ms 的预算，不重放未知结果。
        if (error.message !== "确认状态锁繁忙" || attempt >= 2) throw error;
        await sleep(25);
      }
    }
  }
  const runtime = await import("../lib/confirmation-runtime.js");
  const environments = { codex: process.env.CODEX_THREAD_ID, claude: process.env.CLAUDE_CODE_SESSION_ID };
  const detected = Object.keys(environments).filter(key => environments[key]);
  const platform = values["--platform"] || (detected.length === 1 ? detected[0] : null);
  if (!["codex", "claude"].includes(platform)) throw new Error("缺少唯一的原生平台，保持人工确认");
  const sessionId = runtime.confirmationId(values["--session"] || environments[platform]);
  if (environments[platform] && environments[platform] !== sessionId) throw new Error("显式会话与当前原生会话不符");
  const project = realpathSync(ctx.target);
  if (!existsSync(`${project}/.trellis`)) throw new Error("目标不是 Trellis 项目");
  const store = new runtime.ConfirmationStore(project, sessionId, { platform });
  const requestId = values["--request"];
  if (requestId) runtime.confirmationId(requestId);
  if (["wait", "claim", "result"].includes(command) && !requestId) throw new Error("必须指定精确 --request");
  if (command === "status") { output(runtime.formalConfirmationStatus(store)); return 0; }
  if (command === "cancel") {
    await runtime.cancelConfirmation({ store, requestId });
    output(runtime.formalConfirmationStatus(store));
    return 0;
  }
  if (command === "result" && values["--state"] !== "started") {
    output(await runtime.recordConfirmationResult({ store, platform, requestId,
      receipt: runtime.confirmationId(values["--receipt"]), state: values["--state"] }));
    return 0;
  }
  if (command === "prepare" && !values["--input"]) throw new Error("prepare 必须提供项目内 --input 材料");
  let client;
  let ownedRequestId = requestId;
  const controller = new AbortController();
  const stop = () => { controller.abort(); process.exitCode = 130; };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    client = runtime.confirmationClient({ project, sessionId, platform });
    await client.connect();
    await client.subscribe();
    const options = { store, client, platform, requestId };
    if (command === "prepare") {
      const prepared = await runtime.prepareFormalConfirmation({ ...options, input: values["--input"], seconds: values["--seconds"] });
      ownedRequestId = prepared.requestId;
      if (controller.signal.aborted) throw new Error("确认准备已中断");
      output(prepared);
    }
    else if (command === "claim") output(await runtime.claimFormalConfirmation(options));
    else if (command === "result") output(await runtime.recordConfirmationResult({ ...options, receipt: runtime.confirmationId(values["--receipt"]), state: values["--state"] }));
    else {
      const result = await runtime.waitFormalConfirmation({ ...options, signal: controller.signal, notify: output });
      output({ event: "finished", ...runtime.formalConfirmationStatus(store), workerResult: result.state,
        ...(result.state === "queued" ? { notification: formalConfirmationWake(requestId, platform) } : {}) });
      return controller.signal.aborted ? 130 : ["failed", "delivery_unknown"].includes(result.state) ? 1 : 0;
    }
    return 0;
  } catch (error) {
    output({ prepared: false, claimed: false, mode: "manual", reason: error.message });
    return controller.signal.aborted ? 130 : 1;
  } finally {
    try {
      // SIGSTOP 期间积压的信号可能晚于 worker 的终态回调；先让原生事件完成派发再卸载监听。
      await new Promise(resolve => setImmediate(resolve));
      if (controller.signal.aborted && ownedRequestId) {
        // 即使信号到达时队列已经接受，也先同步失效，不能只依靠工具进程退出码。
        await runtime.cancelConfirmation({ store, client, requestId: ownedRequestId });
        process.exitCode = 130;
      }
    } finally {
      client?.close();
      process.removeListener("SIGINT", stop);
      process.removeListener("SIGTERM", stop);
    }
  }
}
