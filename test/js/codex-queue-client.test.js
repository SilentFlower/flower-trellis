/** @module codex-queue-client-test 原生传输、订阅与失败边界验证。 */
import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";
import { CodexQueueClient, confirmationWake, confirmationWakeId } from "../../src/lib/codex-queue-client.js";

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
  const thread = { id: sessionId, cwd: root, status: { type: "idle" } };
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
  return { root, client, sessionId, thread, calls, handler, socket: clients[0] };
}

test("完整内部唤醒才能识别，不接受任意前缀或其它 clientId", () => {
  const id = randomUUID();
  const item = { type: "userMessage", content: [{ type: "text", text: confirmationWake(id) }], clientId: id };
  assert.equal(confirmationWakeId(item), id);
  assert.equal(confirmationWakeId({ ...item, clientId: randomUUID() }), null);
  assert.equal(confirmationWakeId({ ...item, content: [{ type: "text", text: `${confirmationWake(id)}\n用户新回复` }] }), null);
  assert.equal(confirmationWakeId({ ...item, content: [...item.content, { type: "text", text: "额外输入" }] }), null);
});

test("不支持平台明确拒绝，未连接时不会假称投递成功", async () => {
  for (const platform of ["win32", "darwin"]) assert.throws(() => new CodexQueueClient({ project: ".", sessionId: randomUUID(), platform }), /Linux\/WSL/);
  if (process.platform !== "linux") return;
  const client = new CodexQueueClient({ project: ".", sessionId: randomUUID() });
  await assert.rejects(client.add(randomUUID()), /尚未连接/);
  client.close();
});

test("精确订阅，用户通知去重，内部唤醒及其它线程不取消等待", { skip: process.platform !== "linux" }, async t => {
  const { client, socket, sessionId, calls } = await fixture(t);
  assert.equal((await client.subscribe()).humanId, "baseline");
  const requestId = randomUUID();
  const humans = [];
  const wakes = [];
  client.on("human", value => humans.push(value));
  client.on("wake", value => wakes.push(value));
  const item = { type: "userMessage", id: "new", content: [{ type: "text", text: "用户修改意见" }] };
  for (const method of ["item/started", "item/completed"]) socket.send(JSON.stringify({ method, params: { threadId: sessionId, turnId: "reply", item } }));
  socket.send(JSON.stringify({ method: "item/started", params: { threadId: randomUUID(), turnId: "other", item: { ...item, id: "other" } } }));
  socket.send(JSON.stringify({ method: "item/started", params: { threadId: sessionId, turnId: "wake", item: { ...item, id: "internal", clientId: requestId, content: [{ type: "text", text: confirmationWake(requestId) }] } } }));
  await new Promise(resolve => { const listener = () => { client.off("wake", listener); resolve(); }; client.on("wake", listener); });
  assert.equal(humans.length, 1);
  assert.equal(wakes.length, 1);
  assert.equal(client.humanRevision, 1);
  await client.add(requestId);
  await client.remove("exact-queue");
  const subscribe = calls.find(call => call.method === "thread/resume");
  assert.equal(subscribe.params.threadId, sessionId);
  assert.equal("model" in subscribe.params, false);
  const added = calls.find(call => call.method === "thread/queue/add");
  assert.equal(added.params.threadId, sessionId);
  assert.equal(added.params.clientUserMessageId, requestId);
  assert.equal(added.params.input[0].text, confirmationWake(requestId));
  assert.equal(calls.at(-1).params.queuedSubmissionId, "exact-queue");
});

test("快照分页跳过旧内部提醒，期间的新人工输入覆盖旧快照", { skip: process.platform !== "linux" }, async t => {
  const { client, handler, sessionId } = await fixture(t);
  const id = randomUUID();
  handler.override = (packet, socket) => {
    if (packet.method !== "thread/items/list") return false;
    const data = packet.params.cursor ? [{ item: { type: "userMessage", id: "human-paged", content: [] }, turnId: "old" }]
      : [{ item: { type: "userMessage", id: "old-wake", clientId: id, content: [{ type: "text", text: confirmationWake(id) }] }, turnId: "old-wake" }];
    socket.send(JSON.stringify({ id: packet.id, result: { data, nextCursor: packet.params.cursor ? null : "page-2" } }));
    return true;
  };
  assert.equal((await client.subscribe()).humanId, "human-paged");
  handler.override = (packet, socket) => {
    if (packet.method !== "thread/items/list") return false;
    socket.send(JSON.stringify({ method: "item/started", params: { threadId: sessionId, turnId: "new", item: { type: "userMessage", id: "arrived-during-snapshot", content: [] } } }));
    socket.send(JSON.stringify({ id: packet.id, result: { data: [{ item: { type: "userMessage", id: "old", content: [] } }], nextCursor: null } }));
    return true;
  };
  assert.equal((await client.snapshot()).humanId, "arrived-during-snapshot");
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
