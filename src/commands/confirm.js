import fs from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { createConfirmationAudit } from "../lib/confirmation-audit.js";
import { claudeConfirmationOrigin, recordClaudeConfirmationHook } from "../lib/confirmation-claude.js";
import { CONFIRMATION_ID, confirmationDigest, confirmationDirectory, confirmationRoot,
  readConfirmationFile, writeConfirmationFile } from "../lib/confirmation-files.js";
import { createConfirmationSnapshot, materializeConfirmation, readConfirmationPolicy,
  resolveConfirmationPython } from "../lib/confirmation-snapshot.js";
import { createConfirmationState } from "../lib/confirmation-state.js";
import { codexConfirmationOrigin, startConfirmationWitness } from "../lib/confirmation-witness.js";

const ACTIONS = {
  implement: "按这份 Brief 开工",
  repair_all_and_recheck: "修复当前全部待处置问题并重检",
  execute_git_plan: "按上面展示的模式与精确范围执行 Git 计划",
};
const OUTCOMES = new Set(["completed", "interrupted", "needs_verification"]);
const DRAFT_LIMIT = 512 * 1024;

async function readInput(limit) {
  if (process.stdin.isTTY) throw new Error("请通过标准输入提供确认材料");
  let size = 0;
  const chunks = [];
  for await (const chunk of process.stdin) {
    if ((size += chunk.length) > limit) throw new Error("确认输入过大");
    chunks.push(chunk);
  }
  const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("确认输入必须是 JSON 对象");
  return value;
}

function reviewText(snapshot) {
  return `${snapshot.display.trimEnd()}\n\n本次确认：等待 ${snapshot.seconds} 秒。超时默认${ACTIONS[snapshot.action]}。回复或取消可停止自动确认。`;
}

async function initialBinding(origin, signal) {
  // 原生工具已创建但事件/转录尚在排队时，短暂等候，不用会话历史猜测调用者。
  const end = performance.now() + 850;
  for (;;) {
    try { return await origin.verify(null, signal); }
    catch (error) {
      if (signal.aborted || performance.now() >= end) throw error;
      await sleep(40, undefined, { signal });
    }
  }
}

async function runWait({ root, id, origin, binding, snapshot, signal, draft, directory }) {
  const maxWaitSeconds = origin.maxWaitSeconds ?? 570;
  const audit = createConfirmationAudit(root);
  const current = await snapshot(draft.spec, origin.owner, signal);
  if (current.revision !== draft.revision || !current.enabled || current.seconds > maxWaitSeconds) {
    throw new Error("确认材料或宿主等待预算已变化，保持人工确认");
  }
  const review = confirmationDigest(reviewText(current));
  const guard = async () => {
    if (signal.aborted || await origin.verify(review, signal) !== binding || signal.aborted) {
      throw new Error("本次确认的原窗口或回合已中断");
    }
  };
  // 不消耗未展示正文的草案；一旦进入等待，即使进程被 SIGKILL，同一份草案也不能重新计时。
  await guard();
  writeConfirmationFile(path.join(directory, `${id}.waited`), {}, true);
  const state = createConfirmationState({
    maxWaitSeconds,
    snapshot: async (spec, owner) => {
      const data = await snapshot(spec, owner, signal);
      await guard();
      return data;
    },
    display: guard,
    audit: event => audit({ ...event, request_id: id }),
  });
  let finished = false;
  let monitor;
  let errorReason;
  const stop = () => state.cancelAll("foreground_interrupted");
  signal.addEventListener("abort", stop, { once: true });
  function watch() {
    monitor = setTimeout(async () => {
      try {
        await guard();
        if (!finished) watch();
      } catch (error) {
        errorReason = error.message;
        state.cancelAll("origin_or_display_lost");
      }
    }, 400);
  }
  try {
    state.bind(origin.owner);
    const prepared = await state.prepare(draft.spec, origin.owner);
    watch();
    const result = await state.wait(prepared.request_id);
    if (result.source !== "policy_timeout") return { ...result, request_id: id, manual: true, ...(errorReason ? { error: errorReason } : {}) };
    const claim = await state.claim(prepared.request_id, origin.owner);
    writeConfirmationFile(path.join(directory, `${id}.claimed`), { instance: claim.instance_id, kind: claim.kind }, true);
    return { ...claim, request_id: id, decision: "continue" };
  } finally {
    finished = true;
    clearTimeout(monitor);
    signal.removeEventListener("abort", stop);
  }
}

/** 执行确认命令；只有原窗口内的前台等待能产生一次许可。@param {string[]} args 命令参数；@returns {Promise<void>} 输出 JSON 或帮助。 */
export async function confirm(args) {
  const [command, first, second] = args;
  if (!command || command === "--help" || command === "-h") {
    console.log(`ftl confirm status                     检查当前原生窗口与项目策略
ftl confirm prepare                    从 stdin 冻结本次确认材料（JSON）
ftl confirm <request-id>                前台等待、复核并单次领取
ftl confirm finish <request-id> <outcome>  记录实际动作结果
ftl confirm witness --upstream <socket> --listen <socket>
                                      显式运行 Codex 本机连接见证`);
    return;
  }
  if (command === "hook" && args.length === 1) {
    try {
      const result = recordClaudeConfirmationHook(await readInput(512 * 1024), process.env);
      if (result) console.log(JSON.stringify(result));
    }
    catch { /* Claude 项目钩子缺失或失效只停用自动确认，不能阻断用户输入或 Bash。 */ }
    return;
  }
  if (command === "witness" && args.length === 5 && first === "--upstream" && args[3] === "--listen") {
    const witness = await startConfirmationWitness({ upstream: second, listen: args[4] });
    console.log(`Codex 本机连接见证正在监听：${args[4]}`);
    const stop = () => { void witness.close(); };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    process.once("SIGHUP", stop);
    return;
  }

  const status = command === "status" && args.length === 1;
  const prepare = command === "prepare" && args.length === 1;
  const wait = CONFIRMATION_ID.test(command) && args.length === 1;
  const finish = command === "finish" && args.length === 3 && CONFIRMATION_ID.test(first) && OUTCOMES.has(second);
  if (!status && !prepare && !wait && !finish) throw new Error("确认命令参数无效，请看 ftl confirm --help");
  const signal = new AbortController();
  const stop = () => signal.abort();
  for (const name of ["SIGINT", "SIGTERM", "SIGHUP"]) process.once(name, stop);
  let policy;
  try {
    const root = confirmationRoot(process.cwd());
    const python = resolveConfirmationPython(root);
    if (status) policy = await readConfirmationPolicy(root, python, signal.signal);
    const operation = args.join(" ");
    const platform = process.env.CODEX_THREAD_ID ? "codex" : process.env.CLAUDE_CODE_SESSION_ID ? "claude" : null;
    if (!platform) throw new Error("当前命令不在可核验的 Codex 或 Claude Code 原生工具中");
    const origin = platform === "codex" ? codexConfirmationOrigin(root, operation, process.env)
      : claudeConfirmationOrigin(root, operation, process.env);
    const binding = await initialBinding(origin, signal.signal);
    const maxWaitSeconds = origin.maxWaitSeconds ?? 570;
    if (status) {
      confirmationDirectory(root, "requests");
      console.log(JSON.stringify({ protocol: 1, bound: true, ready: true, platform, ...policy, max_wait_seconds: maxWaitSeconds,
        ...(!policy.enabled ? { manual: true, reason: "项目已关闭超时确认" } : {}) }));
      return;
    }
    const directory = confirmationDirectory(root, "requests");
    const snapshot = createConfirmationSnapshot(root, { python });
    if (prepare) {
      const { body, ...spec } = await readInput(DRAFT_LIMIT / 2);
      if (body !== undefined) {
        if (typeof body !== "string" || spec.file !== undefined || !["check", "push"].includes(spec.kind)) {
          throw new Error("仅检查或 Git 计划可用 body 提供完整正文，不能同时指定 file");
        }
        confirmationDirectory(root, "materials");
        spec.file = (await materializeConfirmation(root, python, body, signal.signal)).file;
      }
      const current = await snapshot(spec, origin.owner, signal.signal);
      if (!current.enabled || current.seconds > maxWaitSeconds || !ACTIONS[current.action]) {
        throw new Error("本次确认已关闭、没有待处理事项或超过宿主等待预算");
      }
      if (await origin.verify(null, signal.signal) !== binding || signal.signal.aborted) throw new Error("准备期间原回合已中断");
      const id = confirmationDigest(`${binding}\n${current.revision}`);
      const draft = { binding, owner: origin.owner, revision: current.revision, spec };
      if (fs.existsSync(path.join(directory, `${id}.waited`))) throw new Error("本次确认已等待过，不能重新计时");
      try { writeConfirmationFile(path.join(directory, `${id}.json`), draft, true); }
      catch (error) { if (error.code !== "EEXIST") throw error; }
      console.log(JSON.stringify({ request_id: id, review: reviewText(current), seconds: current.seconds,
        kind: current.kind, action: current.action }));
      return;
    }
    const id = finish ? first : command;
    const draft = JSON.parse(readConfirmationFile(path.join(directory, `${id}.json`), DRAFT_LIMIT));
    if (draft.binding !== binding || draft.owner !== origin.owner || confirmationDigest(`${binding}\n${draft.revision}`) !== id) {
      throw new Error("确认不属于当前原窗口和回合");
    }
    if (finish) {
      const claim = JSON.parse(readConfirmationFile(path.join(directory, `${id}.claimed`), 4096));
      writeConfirmationFile(path.join(directory, `${id}.finished`), { outcome: second }, true);
      let auditOk = true;
      try {
        createConfirmationAudit(root)({ instance_id: claim.instance, request_id: id, kind: claim.kind, event: "finished", outcome: second });
      } catch { auditOk = false; }
      console.log(JSON.stringify({ request_id: id, outcome: second, ...(!auditOk ? { audit_ok: false } : {}) }));
      return;
    }
    const result = await runWait({ root, id, origin, binding, snapshot, signal: signal.signal, draft, directory });
    console.log(JSON.stringify(result));
    if (result.manual) process.exitCode = 2;
  } catch (error) {
    const message = error.code === "EEXIST" ? "同一份确认已等待或记录过，保持人工确认"
      : error.code === "ENOENT" ? "未找到当前原生工具的确认记录，保持人工确认"
      : signal.signal.aborted ? "前台确认已中断，保持人工确认" : error.message;
    console.log(JSON.stringify({ ...(status ? { protocol: 1, ...policy, bound: false, ready: false } : {}),
      source: "cancelled", decision: "stop", manual: true, error: message }));
    if (!status) process.exitCode = 2;
  } finally {
    for (const name of ["SIGINT", "SIGTERM", "SIGHUP"]) process.removeListener(name, stop);
  }
}
