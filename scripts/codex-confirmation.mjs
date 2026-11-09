#!/usr/bin/env node
/**
 * 项目内后台确认演练入口；由 Codex 原生后台终端承载，不自行常驻或启动客户端。
 * @module codex-confirmation-cli
 */
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const args = process.argv.slice(2);
const help = `本项目 Codex 后台确认演练（Linux/WSL，Codex 0.167.0 managed daemon）

  node scripts/codex-confirmation.mjs wait --seconds <秒数> --message <演练文本>
  node scripts/codex-confirmation.mjs claim --request <请求 UUID>
  node scripts/codex-confirmation.mjs status
  node scripts/codex-confirmation.mjs cancel [--request <请求 UUID>]

公共参数：--session <线程 UUID>，缺省取 CODEX_THREAD_ID；同时提供时必须一致。
时间范围：0.1～86400 秒；文本最多 8192 字节。状态限定于当前项目和精确会话。
wait 在当前回合完成后计时；Codex 用短 yield 启动后应结束回合，不同步轮询。
新人工消息取消旧等待；到期由原生队列唤醒，必须先 claim 才能输出演练文本。
status 可离线查询；cancel 即使无法联网也先本地取消。失败或重复领取不执行默认动作。
本入口只演练文本，不授权开工、修复、提交或推送。`;

/** 输出单行 JSON，避免把诊断混入协议正文。
 * @param {object} value 结构化结果
 * @returns {void}
 */
function output(value) { process.stdout.write(`${JSON.stringify(value)}\n`); }

// 帮助必须先于动态依赖加载、参数校验、联网和状态写入。
if (!args.length || args.includes("--help") || args.includes("-h")) {
  process.stdout.write(`${help}\n`);
} else {
  let client;
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  try {
    const [command, ...flags] = args;
    const allowed = { wait: new Set(["--seconds", "--message", "--session"]), claim: new Set(["--request", "--session"]),
      cancel: new Set(["--request", "--session"]), status: new Set(["--session"]) };
    if (!allowed[command]) throw new Error("未知命令，使用 --help 查看演练入口");
    const values = {};
    for (let index = 0; index < flags.length; index += 2) {
      const flag = flags[index];
      if (!allowed[command].has(flag) || values[flag] !== undefined || flags[index + 1] === undefined) throw new Error("参数未知、重复或缺少值");
      values[flag] = flags[index + 1];
    }
    const { CodexQueueClient, confirmationId } = await import("../src/lib/codex-queue-client.js");
    const { ConfirmationStore, validateConfirmation, prepareConfirmation, runConfirmationWorker, claimConfirmation, cancelConfirmation, confirmationStatus }
      = await import("../src/lib/codex-confirmation.js");
    const sessionId = confirmationId(values["--session"] || process.env.CODEX_THREAD_ID);
    if (process.env.CODEX_THREAD_ID && sessionId !== process.env.CODEX_THREAD_ID) throw new Error("显式会话与当前 CODEX_THREAD_ID 不一致");
    if (values["--request"]) confirmationId(values["--request"]);
    if (command === "claim" && !values["--request"]) throw new Error("claim 必须指定 --request");
    const seconds = Number(values["--seconds"]);
    if (command === "wait") validateConfirmation(seconds, values["--message"]);
    const project = realpathSync(path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));
    if (realpathSync(process.cwd()) !== project) throw new Error("请在本项目根目录调用后台确认演练");
    const store = new ConfirmationStore(project, sessionId);
    if (command === "status") output(confirmationStatus(store));
    else if (command === "cancel") {
      // 先本地取消，即使 daemon 已退出也能阻止迟到提醒领取。
      await cancelConfirmation({ store, requestId: values["--request"] });
      const state = store.read();
      if (state?.request.queueId && (!values["--request"] || values["--request"] === state.request.id)) {
        try {
          client = new CodexQueueClient({ project, sessionId });
          await client.connect();
          await client.subscribe();
          await cancelConfirmation({ store, client, requestId: values["--request"] });
        } catch (error) { process.stderr.write(`本地取消已生效；原生队列撤回未确认：${error.message}\n`); }
      }
      output(confirmationStatus(store));
    } else {
      client = new CodexQueueClient({ project, sessionId });
      await client.connect();
      const snapshot = await client.subscribe();
      if (command === "claim") output(await claimConfirmation({ store, client, requestId: values["--request"] }));
      else {
        if (controller.signal.aborted) throw new Error("演练启动已中断");
        const { request, previous } = prepareConfirmation(store, { seconds, message: values["--message"], snapshot });
        if (previous?.queueId) {
          try { await client.remove(previous.queueId); }
          catch (error) { process.stderr.write(`旧请求已失效；原生队列撤回未确认：${error.message}\n`); }
        }
        const result = await runConfirmationWorker({ store, client, requestId: request.id, signal: controller.signal, notify: output });
        output({ event: "finished", ...confirmationStatus(store), workerResult: result.state });
        if (["failed", "delivery_unknown"].includes(result.state)) process.exitCode = 1;
      }
    }
  } catch (error) {
    process.stderr.write(`后台确认演练失败：${error.message}\n`);
    process.exitCode = 1;
  } finally {
    client?.close();
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
    if (controller.signal.aborted) process.exitCode = 130;
  }
}
