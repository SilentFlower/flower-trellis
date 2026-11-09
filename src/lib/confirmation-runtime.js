/**
 * 正式确认编排：只消费已展示且未变化的项目策略；业务执行仍属于原流程。
 * @module confirmation-runtime
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { resolveTrellisPythonCommand, trellisPythonInvocation } from "./trellis-python-command.js";
import { ConfirmationStore, prepareConfirmation, runConfirmationWorker, claimConfirmation, cancelConfirmation } from "./codex-confirmation.js";
import { CodexQueueClient, confirmationId } from "./codex-queue-client.js";
import { ClaudeConfirmationClient } from "./claude-confirmation-client.js";

const ACTION_NAMES = { implement: "按当前完整 Brief 开工", repair_all_and_recheck: "修复当前全部待处置问题并重检", execute_git_plan: "执行当前已展示的精确 Git 计划" };

/** 读取唯一的 Python 策略与材料快照实现，不在两端复制算法。
 * @param {object} options 项目、输入路径、平台、会话及可选秒数
 * @returns {object} 已校验快照
 */
export function inspectConfirmation({ project, input, platform, sessionId, seconds }) {
  const invocation = trellisPythonInvocation(resolveTrellisPythonCommand(project).command);
  const args = [...invocation.args, "-X", "utf8", path.join(project, ".trellis/scripts/confirmation_policy.py"),
    "--project", project, "--input", input, "--platform", platform, "--session", sessionId];
  if (seconds !== undefined) args.push("--seconds", String(seconds));
  const process = spawnSync(invocation.executable, args, { cwd: project, encoding: "utf8", timeout: 15000, maxBuffer: 2 * 1024 * 1024, windowsHide: true });
  if (process.error) throw new Error(`确认材料无法核验：${process.error.message}`);
  let value;
  try { value = JSON.parse(process.stdout); } catch { throw new Error("确认策略 helper 不可用或输出无效，保持人工确认"); }
  if (process.status !== 0) throw new Error(value.error || "确认材料校验失败");
  if (value.version !== 1 || !ACTION_NAMES[value.action] || typeof value.body !== "string" || !Number.isSafeInteger(value.seconds) || value.seconds < 1) throw new Error("确认策略契约不匹配");
  return value;
}

/** 生成需要完整展示的正文与本次默认行为，计时提示不参与 Brief 字数。
 * @param {object} frozen 策略与材料快照
 * @returns {string} 完整展示文本
 */
export function renderConfirmation(frozen) {
  return `${frozen.body}\n\n后台确认：本次等待 ${frozen.seconds} 秒。若期间未提交新消息，将${ACTION_NAMES[frozen.action]}。你可直接输入确认、修改意见、暂停或取消；单次改时会替换旧等待。`;
}

/** 创建精确平台客户端；平台支持范围由适配器核验。
 * @param {object} options 项目、精确会话和平台
 * @returns {CodexQueueClient|ClaudeConfirmationClient} 原生适配
 */
export function confirmationClient({ project, sessionId, platform }) {
  if (platform === "codex") return new CodexQueueClient({ project, sessionId, formal: true });
  if (platform === "claude") return new ClaudeConfirmationClient({ project, sessionId });
  throw new Error("未支持的确认平台，保持人工确认");
}

/** 准备正式请求；展示回合必须仍活动，否则不能补造展示完成证据。
 * @param {object} options 存储、客户端、材料路径、平台和可选秒数
 * @returns {Promise<object>} 准备结果及精确展示文本
 */
export async function prepareFormalConfirmation({ store, client, input, platform, seconds }) {
  const frozen = inspectConfirmation({ project: store.project, sessionId: store.sessionId, input, platform, seconds });
  if (!frozen.enabled) return { prepared: false, mode: "manual", reason: frozen.reason };
  const snapshot = await client.snapshot();
  if (snapshot.turn?.status !== "inProgress") throw new Error("正式确认必须由当前活动回合准备");
  const contract = { version: 1, platform, input, secondsOverride: seconds ?? null, frozen };
  const { request, previous } = prepareConfirmation(store, { seconds: frozen.seconds, message: frozen.action, snapshot, contract });
  if (previous?.queueId) {
    try { await client.remove(previous.queueId); }
    catch { /* 旧请求已失效；已启动的通知只能在领取时拒绝。 */ }
  }
  return { prepared: true, requestId: request.id, seconds: request.seconds, action: frozen.action, display: renderConfirmation(frozen) };
}

/** 重验材料、策略及原生展示；仅供共享 worker/claim 的锁外阶段调用。 */
async function validateFormal(store, client, platform, request, stage, snapshot) {
  const contract = request?.contract;
  if (contract?.version !== 1 || contract.platform !== platform || store.version !== 2) throw new Error("演练请求或未知契约不能获得正式动作许可");
  const current = inspectConfirmation({ project: store.project, sessionId: store.sessionId, input: contract.input,
    platform, seconds: contract.secondsOverride ?? undefined });
  const frozen = contract.frozen;
  if (!current.enabled || JSON.stringify(current) !== JSON.stringify(frozen) || current.materialHash !== frozen.materialHash || current.policyHash !== frozen.policyHash
    || current.seconds !== request.seconds || current.action !== request.message || frozen.action !== request.message) throw new Error("确认材料、策略或当前任务已变化");
  if (stage === "display") {
    const text = (await client.assistantText(request.originTurnId)).replace(/\r\n?/g, "\n");
    if (!text.includes(renderConfirmation(frozen))) throw new Error("原回合未完整展示冻结材料、时长及默认动作");
  }
  if (stage === "claim" && platform === "claude" && (snapshot.notification?.requestId !== request.id
    || snapshot.notification.taskId !== request.queueId)) throw new Error("Claude 领取未关联到本次原生任务通知");
}

/** 启动共享后台 worker；到期不执行任何业务副作用。
 * @param {object} options 存储、原生客户端、平台、请求、信号与事件输出
 * @returns {Promise<object>} 真实终态
 */
export async function waitFormalConfirmation({ store, client, platform, requestId, signal, notify }) {
  if (!store.read()?.request?.contract) throw new Error("正式请求不存在，保持人工确认");
  return runConfirmationWorker({ store, client, requestId, signal, notify,
    validate: (request, stage, snapshot) => validateFormal(store, client, platform, request, stage, snapshot) });
}

/** 原子领取一次，返回固定原流程动作与冻结上下文；拒绝时不返回旧材料。
 * @param {object} options 存储、客户端、平台与请求
 * @returns {Promise<object>} 单次领取结果
 */
export async function claimFormalConfirmation({ store, client, platform, requestId }) {
  const frozen = store.read()?.request?.contract?.frozen;
  const result = await claimConfirmation({ store, client, requestId,
    validate: (request, stage, snapshot) => validateFormal(store, client, platform, request, stage, snapshot) });
  if (!result.claimed) return result;
  return { claimed: true, requestId, source: "policy_timeout", action: frozen.action, receipt: result.receipt,
    context: { ...frozen.plan, body: frozen.body, facts: frozen.facts, materialHash: frozen.materialHash, policyHash: frozen.policyHash } };
}

/** 据实记账已领取动作；started 也是再次核验入口，不能重复授予执行许可。
 * @param {object} options 存储、客户端、平台、请求、回执及执行结果
 * @returns {Promise<object>} 记账结果
 */
export async function recordConfirmationResult({ store, client, platform, requestId, receipt, state: outcome }) {
  if (!["started", "completed", "interrupted", "needs-verification"].includes(outcome)) throw new Error("未知执行结果");
  const current = store.read()?.request;
  if (current?.id !== requestId || current.state !== "consumed" || current.receipt?.id !== receipt) throw new Error("执行记账缺少本次已消费回执");
  if (outcome === "started") {
    await validateFormal(store, client, platform, current, "start");
    if ((await client.snapshot()).humanId !== current.baselineMessageId) throw new Error("人工输入已变化，不能开始旧默认动作");
  }
  let recorded = false;
  store.change(requestId, (request, state) => {
    if (request.receipt?.id !== receipt || request.state !== "consumed") return;
    // 原生快照和写锁之间仍可能收到 Hook；以锁内最新代次裁决，不能沿用已过期的读取结果。
    if (outcome === "started" && (state.generation !== request.generation || state.lastHumanMessageId !== request.baselineMessageId)) return;
    if (outcome === "started" ? request.execution : request.execution?.state !== "started") return;
    request.execution = { state: outcome, at: Date.now(), source: "policy_timeout" };
    recorded = true;
  });
  return { recorded, requestId, execution: store.read().request.execution };
}

/** 返回有界状态摘要，状态查询不返回完整报告或 Git 材料。
 * @param {ConfirmationStore} store 精确会话存储
 * @returns {object} 查询结果
 */
export function formalConfirmationStatus(store) {
  const request = store.read()?.request;
  if (!request) return { sessionId: store.sessionId, state: "absent" };
  return { sessionId: store.sessionId, requestId: request.id, state: request.state, seconds: request.seconds,
    deadline: request.deadline, action: request.contract?.frozen.action, receipt: request.receipt,
    execution: request.execution, error: request.error, revocation: request.revocation };
}

export { ConfirmationStore, confirmationId, cancelConfirmation };
