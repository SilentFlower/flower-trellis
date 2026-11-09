/** @module codex-confirmation-client-test 原生输入、内部来源与冻结窗口失效边界。 */
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { recordCodexConfirmationEvent, CodexConfirmationClient } from "../../src/lib/codex-confirmation-client.js";
import { ConfirmationStore, prepareConfirmation } from "../../src/lib/codex-confirmation.js";
import { formalConfirmationWake, confirmationWakeId } from "../../src/lib/confirmation-protocol.js";

/** 建立只有当前测试拥有的精确会话。
 * @param {object} t 测试生命周期
 * @returns {object} 存储与事件工厂
 */
function fixture(t) {
  const project = mkdtempSync(path.join(tmpdir(), "flower-codex-input-"));
  t.after(() => rmSync(project, { recursive: true, force: true }));
  mkdirSync(path.join(project, ".trellis/scripts"), { recursive: true });
  writeFileSync(path.join(project, ".trellis/scripts/confirmation_policy.py"), "");
  const sessionId = randomUUID();
  const store = new ConfirmationStore(project, sessionId, { platform: "codex" });
  const event = (extra = {}) => recordCodexConfirmationEvent({ cwd: project, session_id: sessionId,
    turn_id: randomUUID(), hook_event_name: "UserPromptSubmit", prompt: "人工输入", ...extra });
  event();
  const request = prepareConfirmation(store, { seconds: 2, message: "implement",
    snapshot: { humanId: "baseline", turn: { id: "origin", status: "inProgress" } } }).request;
  return { project, sessionId, store, event, request };
}

test("共享模式不需要启动凭据；新输入与 Interrupt 同步作废旧代次", t => {
  for (const hook_event_name of ["UserPromptSubmit", "Interrupt"]) {
    const f = fixture(t);
    const before = f.store.read().generation;
    f.event({ hook_event_name });
    assert.equal(f.store.read().request.state, "cancelled");
    assert.equal(f.store.read().generation, before + 1);
  }
});

test("精确内部正文只暂缓 Hook 取消，人工粘贴仍不能通过原生来源核验", t => {
  const f = fixture(t);
  f.store.change(f.request.id, request => { request.state = "queued"; });
  const prompt = formalConfirmationWake(f.request.id);
  f.event({ prompt });
  assert.equal(f.store.read().request.state, "queued");
  const item = { type: "userMessage", id: randomUUID(), content: [{ type: "text", text: prompt }] };
  assert.equal(confirmationWakeId(item), null);
  assert.equal(confirmationWakeId({ ...item, clientId: f.request.id }), f.request.id);
  f.event({ prompt: `${prompt}\n修改意见` });
  assert.equal(f.store.read().request.state, "cancelled");
});

test("子代理事件不取消根会话；领取后新输入仍禁止 started", t => {
  const f = fixture(t);
  f.event({ agent_id: "child" });
  assert.equal(f.store.read().request.state, "prepared");
  f.store.change(f.request.id, request => { request.state = "consumed"; });
  f.event();
  assert.notEqual(f.store.read().generation, f.store.read().request.generation);
});

test("捕获窗口要求当前会话实际收到输入 Hook，旧版状态不能自动升级", async t => {
  const f = fixture(t);
  f.store.update(state => { state.native.version = 1; return state; });
  const home = path.join(f.project, "codex-home");
  mkdirSync(home);
  const client = new CodexConfirmationClient({ project: f.project, sessionId: f.sessionId, platform: "linux", env: { CODEX_HOME: home } });
  await assert.rejects(client.captureWindow(), /输入 Hook/);
  client.close();
});
