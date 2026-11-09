/** @module claude-confirmation-client-test 原生事件载荷夹具与真实来源字段的跨平台回归。 */
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ConfirmationStore, prepareConfirmation, runConfirmationWorker, claimConfirmation } from "../../src/lib/codex-confirmation.js";
import { ClaudeConfirmationClient, recordClaudeConfirmationEvent } from "../../src/lib/claude-confirmation-client.js";

/** 创建基于实际 2.1.293 载荷形态的隔离会话；不调用原生 Claude。 */
function fixture(t) {
  const project = mkdtempSync(path.join(tmpdir(), "flower-claude-events-"));
  t.after(() => rmSync(project, { recursive: true, force: true }));
  mkdirSync(path.join(project, ".trellis/scripts"), { recursive: true });
  writeFileSync(path.join(project, ".trellis/scripts/confirmation_policy.py"), "");
  const sessionId = randomUUID();
  const human = randomUUID();
  const transcript = path.join(project, `${sessionId}.jsonl`);
  const entry = (promptId, text, origin = "human") => ({ type: "user", sessionId, promptId, uuid: randomUUID(),
    origin: { kind: origin }, turnOrigin: origin === "human" ? "human" : "task_notification", message: { role: "user", content: text } });
  writeFileSync(transcript, JSON.stringify(entry(human, "最初的需求")) + "\n");
  const hook = (event, values = {}) => recordClaudeConfirmationEvent({ hook_event_name: event, cwd: project,
    session_id: sessionId, transcript_path: transcript, prompt_id: human, ...values });
  hook("UserPromptSubmit", { prompt: "最初的需求" });
  const store = new ConfirmationStore(project, sessionId, { platform: "claude" });
  // 这里验证纯事件和磁盘逻辑；platform 覆盖不构成 Windows 原生唤醒证据。
  const client = new ClaudeConfirmationClient({ project, sessionId, platform: "linux" });
  t.after(() => client.close());
  const append = (promptId, text, origin) => appendFileSync(transcript, JSON.stringify(entry(promptId, text, origin)) + "\n");
  const notice = taskId => `<task-notification>\n<task-id>${taskId}</task-id>\n<status>completed</status>\n</task-notification>`;
  const prepare = async () => {
    await client.connect(); await client.subscribe();
    const request = prepareConfirmation(store, { seconds: 0.1, message: "只验证事件，不执行业务", snapshot: await client.snapshot() }).request;
    const worker = runConfirmationWorker({ store, client, requestId: request.id });
    hook("Stop", { last_assistant_message: "完整展示", background_tasks: [{ id: "task-original", type: "shell", status: "running", command: `'flower-trellis' 'confirm' 'wait' '--platform' 'claude' '--request' '${request.id}'` }] });
    return { request, worker };
  };
  return { project, sessionId, transcript, human, store, client, hook, append, notice, prepare };
}

test("原生 Stop 绑定后台任务；完成通知可领取一次且不取消自己", async t => {
  const f = fixture(t);
  const { request, worker } = await f.prepare();
  assert.equal((await worker).state, "queued");
  assert.equal(f.store.read().request.nativeTaskId, "task-original");
  const promptId = randomUUID();
  const notice = f.notice("task-original");
  f.append(promptId, notice, "task-notification");
  const context = f.hook("UserPromptSubmit", { prompt_id: promptId, prompt: notice });
  assert.match(context.hookSpecificOutput.additionalContext, /confirm claim --platform claude/);
  assert.equal((await f.client.snapshot()).humanId, f.human);
  const options = { store: f.store, client: f.client, requestId: request.id };
  assert.equal((await claimConfirmation(options)).claimed, true);
  assert.equal((await claimConfirmation(options)).claimed, false);
});

test("中途人工输入由 Hook 同步取消，无需模型调用 cancel；重复事件不重复改变代次", async t => {
  const f = fixture(t);
  const { worker } = await f.prepare();
  const next = randomUUID();
  f.append(next, "修改意见", "human");
  f.hook("UserPromptSubmit", { prompt_id: next, prompt: "修改意见" });
  const generation = f.store.read().generation;
  f.hook("UserPromptSubmit", { prompt_id: next, prompt: "修改意见" });
  assert.equal(f.store.read().generation, generation);
  assert.equal((await worker).state, "cancelled");
});

test("人工粘贴同形任务通知也被 transcript human 来源识别，不能领取旧动作", async t => {
  const f = fixture(t);
  const { request, worker } = await f.prepare();
  await worker;
  const next = randomUUID();
  const notice = f.notice("task-original");
  f.append(next, notice, "human");
  f.hook("UserPromptSubmit", { prompt_id: next, prompt: notice });
  assert.equal((await claimConfirmation({ store: f.store, client: f.client, requestId: request.id })).claimed, false);
  assert.equal(f.store.read().request.error, "user_replied");
});

test("退出事件撤销等待，未验证平台和关闭 transcript 均明确拒绝", async t => {
  const f = fixture(t);
  for (const platform of ["win32", "darwin"]) assert.throws(() => new ClaudeConfirmationClient({ project: f.project, sessionId: f.sessionId, platform }), /Linux\/WSL/);
  const { worker } = await f.prepare();
  f.hook("SessionEnd");
  assert.equal((await worker).state, "cancelled");
  await assert.rejects(f.client.connect(), /退出/);
  const empty = fixture(t);
  writeFileSync(empty.transcript, "");
  await assert.rejects(empty.client.connect(), /人工输入基线/);
});
