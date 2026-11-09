/** @module codex-queue-client-test 原生传输、订阅与失败边界验证。 */
import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";
import { CodexQueueClient } from "../../src/lib/codex-queue-client.js";
import { confirmationWakeId, formalConfirmationWake } from "../../src/lib/confirmation-protocol.js";

/** 启动没有模型和真实 daemon 的隔离 WebSocket 协议替身。
 * @param {object} t 测试生命周期
 * @returns {Promise<object>} 连接及可控制的服务端
 */
async function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), "fcq-"));
  const home = path.join(root, "home");
  mkdirSync(path.join(home, "app-server-control"), { recursive: true });
  const server = createServer();
  const wss = new WebSocketServer({ server });
  const sessionId = randomUUID();
  mkdirSync(path.join(home, "sessions"));
  const file = path.join(home, "sessions", `rollout-test-${sessionId}.jsonl`);
  const baseline = randomUUID();
  const rows = [{ type: "session_meta", payload: { id: sessionId } },
    { type: "event_msg", payload: { type: "task_started", turn_id: "origin" } },
    { type: "event_msg", payload: { type: "item_completed", thread_id: sessionId, turn_id: "origin", item: { type: "UserMessage", id: baseline, content: [] } } },
    { type: "event_msg", payload: { type: "task_complete", turn_id: "origin" } }];
  writeFileSync(file, rows.map(row => JSON.stringify(row)).join("\n") + "\n");
  const append = payload => appendFileSync(file, JSON.stringify({ type: "event_msg", payload }) + "\n");
  const thread = { id: sessionId, cwd: root, path: file, status: { type: "idle" } };
  const calls = [];
  const clients = [];
  const handler = { override: null };
  wss.on("connection", socket => {
    clients.push(socket);
    socket.on("message", data => {
      const packet = JSON.parse(data.toString());
      if (!packet.id) return;
      calls.push(packet);
      if (handler.override?.(packet, socket)) return;
      const results = {
        initialize: {}, "thread/resume": { thread }, "thread/read": { thread },
        "thread/turns/list": { data: [{ id: "origin", status: "completed" }], nextCursor: null },
        "thread/items/list": { data: [{ item: { type: "userMessage", id: "baseline", content: [] }, turnId: "origin" }], nextCursor: null },
        "thread/queue/add": { queuedSubmission: { id: "exact-queue", clientUserMessageId: packet.params?.clientUserMessageId } },
        "thread/queue/delete": {},
      };
      socket.send(JSON.stringify({ id: packet.id, result: results[packet.method] }));
    });
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(path.join(home, "app-server-control", "app-server-control.sock"), resolve); });
  const client = new CodexQueueClient({ project: root, sessionId, env: { CODEX_HOME: home }, timeoutMs: 100 });
  t.after(async () => {
    client.close();
    for (const socket of wss.clients) socket.terminate();
    await new Promise(resolve => wss.close(resolve));
    await new Promise(resolve => server.close(resolve));
    rmSync(root, { recursive: true, force: true });
  });
  await client.connect();
  return { root, client, sessionId, thread, calls, handler, socket: clients[0], baseline, append, file };
}

test("完整内部唤醒才能识别，不接受任意前缀或其它 clientId", () => {
  const id = randomUUID();
  const item = { type: "userMessage", content: [{ type: "text", text: formalConfirmationWake(id) }], clientId: id };
  assert.equal(confirmationWakeId(item), id);
  assert.equal(confirmationWakeId({ ...item, clientId: randomUUID() }), null);
  assert.equal(confirmationWakeId({ ...item, content: [{ type: "text", text: `${formalConfirmationWake(id)}\n用户新回复` }] }), null);
  assert.equal(confirmationWakeId({ ...item, content: [...item.content, { type: "text", text: "额外输入" }] }), null);
  const formal = { ...item, content: [{ type: "text", text: formalConfirmationWake(id) }] };
  assert.equal(confirmationWakeId(formal), id);
  assert.equal(confirmationWakeId({ ...formal, clientId: undefined }), null);
});

test("不支持平台明确拒绝，未连接时不会假称投递成功", async t => {
  for (const platform of ["win32", "darwin"]) assert.throws(() => new CodexQueueClient({ project: ".", sessionId: randomUUID(), platform }), /Linux\/WSL/);
  if (process.platform !== "linux") return;
  const project = mkdtempSync(path.join(tmpdir(), "fcq-offline-"));
  t.after(() => rmSync(project, { recursive: true, force: true }));
  const home = path.join(project, "codex-home");
  mkdirSync(home);
  const client = new CodexQueueClient({ project, sessionId: randomUUID(), env: { CODEX_HOME: home } });
  await assert.rejects(client.add(randomUUID()), /尚未连接/);
  client.close();
});

test("被动读取且不 resume，用户通知去重，内部唤醒及其它线程不取消等待", { skip: process.platform !== "linux" }, async t => {
  const { client, socket, sessionId, calls, baseline } = await fixture(t);
  assert.equal((await client.subscribe()).humanId, baseline);
  const requestId = randomUUID();
  const humans = [];
  const wakes = [];
  client.on("human", value => humans.push(value));
  client.on("wake", value => wakes.push(value));
  const item = { type: "userMessage", id: "new", content: [{ type: "text", text: "用户修改意见" }] };
  for (const method of ["item/started", "item/completed"]) socket.send(JSON.stringify({ method, params: { threadId: sessionId, turnId: "reply", item } }));
  socket.send(JSON.stringify({ method: "item/started", params: { threadId: randomUUID(), turnId: "other", item: { ...item, id: "other" } } }));
  socket.send(JSON.stringify({ method: "item/started", params: { threadId: sessionId, turnId: "wake", item: { ...item, id: "internal", clientId: requestId, content: [{ type: "text", text: formalConfirmationWake(requestId) }] } } }));
  await new Promise(resolve => { const listener = () => { client.off("wake", listener); resolve(); }; client.on("wake", listener); });
  assert.equal(humans.length, 1);
  assert.equal(wakes.length, 1);
  assert.equal(client.humanRevision, 1);
  await client.add(requestId);
  await client.remove("exact-queue");
  assert.equal(calls.some(call => call.method === "thread/resume"), false);
  assert.equal(calls.find(call => call.method === "thread/read").params.threadId, sessionId);
  const added = calls.find(call => call.method === "thread/queue/add");
  assert.equal(added.params.threadId, sessionId);
  assert.equal(added.params.clientUserMessageId, requestId);
  assert.equal(added.params.input[0].text, formalConfirmationWake(requestId));
  assert.equal(calls.at(-1).params.queuedSubmissionId, "exact-queue");
});

test("被动读取增量记录并核对消息来源，未完成行不进入许可", { skip: process.platform !== "linux" }, async t => {
  const { client, append, sessionId, file, baseline, calls } = await fixture(t);
  assert.equal((await client.snapshot()).humanId, baseline);
  const requestId = randomUUID();
  append({ type: "task_started", turn_id: "wake" });
  append({ type: "item_completed", thread_id: sessionId, turn_id: "wake", item: {
    type: "UserMessage", id: randomUUID(), client_id: requestId, content: [{ type: "text", text: formalConfirmationWake(requestId) }],
  } });
  const internal = await client.snapshot();
  assert.equal(internal.humanId, baseline);
  assert.deepEqual(internal.wake, { requestId, turnId: "wake" });
  const pasted = randomUUID();
  append({ type: "item_completed", thread_id: sessionId, turn_id: "wake", item: {
    type: "UserMessage", id: pasted, content: [{ type: "text", text: formalConfirmationWake(requestId) }],
  } });
  assert.equal((await client.snapshot()).humanId, pasted);
  appendFileSync(file, '{"type":"event_msg"');
  assert.equal((await client.snapshot()).humanId, pasted);
  assert.equal(calls.some(call => call.method === "thread/resume"), false);
});

test("精确记录之外的路径、错会话和回滚后的无基线均拒绝", { skip: process.platform !== "linux" }, async t => {
  const { client, thread, file, append } = await fixture(t);
  append({ type: "thread_rolled_back" });
  await assert.rejects(client.snapshot(), /人工消息基线/);
  writeFileSync(file, JSON.stringify({ type: "session_meta", payload: { id: randomUUID() } }) + "\n");
  await assert.rejects(client.snapshot(), /标识不符/);
  thread.path = path.join(path.dirname(file), "wrong.jsonl");
  await assert.rejects(client.snapshot(), /精确会话记录路径/);
});

test("目标目录不匹配拒绝，投递回执超时不自动重试，断连拒绝挂起 RPC", { skip: process.platform !== "linux" }, async t => {
  const { client, handler, calls, socket, thread } = await fixture(t);
  thread.cwd = path.dirname(thread.cwd);
  await assert.rejects(client.subscribe(), /不匹配/);
  handler.override = packet => packet.method === "thread/queue/add";
  await assert.rejects(client.add(randomUUID()), /回执超时/);
  assert.equal(calls.filter(call => call.method === "thread/queue/add").length, 1);
  handler.override = () => { socket.terminate(); return true; };
  await assert.rejects(client.rpc("thread/read", {}), /连接断开/);
});

test("只把精确的队列不存在错误视为已经启动，其它撤回错误保留", { skip: process.platform !== "linux" }, async t => {
  const { client, handler } = await fixture(t);
  handler.override = (packet, socket) => {
    socket.send(JSON.stringify({ id: packet.id, error: { code: -32600, message: "queued submission not found" } }));
    return true;
  };
  assert.equal(await client.remove("owned"), "not_pending");
  handler.override = (packet, socket) => {
    socket.send(JSON.stringify({ id: packet.id, error: { code: -32600, message: "permission denied" } }));
    return true;
  };
  await assert.rejects(client.remove("owned"), /permission denied/);
});
