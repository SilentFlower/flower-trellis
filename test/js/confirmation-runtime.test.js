import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { createConnection } from "node:net";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import { confirmationDigest } from "../../src/lib/confirmation-files.js";
import { codexConfirmationOrigin, startConfirmationWitness } from "../../src/lib/confirmation-witness.js";
import { createConfirmationSnapshot, materializeConfirmation, readConfirmationPolicy } from "../../src/lib/confirmation-snapshot.js";
import { resolvePythonExecutable } from "../../scripts/python-runtime.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const PYTHON = { executable: resolvePythonExecutable(), args: [] };
const OWNER = "codex_fixture";
const SPEC = { kind: "check", file: "报告.md", problem_ids: ["CHK-1"] };

function project(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "flower-confirm-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scripts = path.join(root, ".trellis/scripts");
  fs.cpSync(path.join(ROOT, ".trellis/scripts/common"), path.join(scripts, "common"), {
    recursive: true, filter: file => !file.includes("__pycache__"),
  });
  fs.copyFileSync(path.join(ROOT, "enhancements/0.6/scripts/confirmation.py"), path.join(scripts, "confirmation.py"));
  const config = path.join(root, ".trellis/config.yaml");
  fs.writeFileSync(config, "confirmation_timeout:\n  check:\n    base_seconds: 1\n");
  fs.writeFileSync(path.join(root, SPEC.file), "CHK-1 修复当前问题；中文 & % ! ^\n");
  return { root, config };
}

test("真实项目策略、快照与冻结正文按同一份材料复核", async t => {
  const { root, config } = project(t);
  const inspect = createConfirmationSnapshot(root, { python: PYTHON });
  const original = await inspect(SPEC, OWNER);
  assert.equal(original.seconds, 1);
  assert.match(original.display, /中文 & % ! \^/);
  const frozen = await materializeConfirmation(root, PYTHON, original.display);
  assert.deepEqual(await materializeConfirmation(root, PYTHON, original.display), frozen);
  fs.appendFileSync(path.join(root, SPEC.file), "待确认范围变化\n");
  assert.notEqual((await inspect(SPEC, OWNER)).revision, original.revision);
  fs.writeFileSync(config, "confirmation_timeout:\n  check:\n    enabled: false\n");
  assert.deepEqual((await readConfirmationPolicy(root, PYTHON)).kinds, { brief: true, check: false, push: true });
  assert.equal((await inspect(SPEC, OWNER)).enabled, false);
  fs.writeFileSync(config, "confirmation_timeout:\n  enabled: false\n");
  assert.equal((await readConfirmationPolicy(root, PYTHON)).enabled, false);
  fs.writeFileSync(config, "confirmation_timeout:\n  enabled: invalid\n");
  await assert.rejects(readConfirmationPolicy(root, PYTHON), /true 或 false/);
});

test("普通 shell 或伪造的线程环境不会开启计时", t => {
  const { root } = project(t);
  const bin = path.join(ROOT, "bin/flower-trellis.js");
  const env = { ...process.env, HOME: root, FLOWER_TEST_PYTHON: PYTHON.executable };
  delete env.CLAUDE_CODE_SESSION_ID;
  for (const extras of [{ CODEX_THREAD_ID: "", CODEX_TOOL_CALL_ID: "" }, { CODEX_THREAD_ID: "fictional", CODEX_TOOL_CALL_ID: "exec-fictional" }]) {
    const result = JSON.parse(execFileSync(process.execPath, [bin, "confirm", "status"],
      { cwd: root, env: { ...env, ...extras }, encoding: "utf8" }));
    assert.equal(result.enabled, true);
    assert.equal(result.bound, false);
    assert.equal(result.manual, true);
  }
  assert.ok(!fs.existsSync(path.join(root, ".trellis/.runtime/confirmations/requests")));
});

for (const ending of ["关闭连接", "只退订", "退订后关闭"]) test(`原连接${ending}后中断旧确认，旁观者不能重新领取`,
  { skip: process.platform !== "linux" }, async t => {
    const { root } = project(t);
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "flower-confirm-home-"));
    const previous = process.env.HOME;
    process.env.HOME = home;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flower-confirm-ws-"));
    const upstream = path.join(dir, "upstream.sock");
    const listen = path.join(dir, "front.sock");
    const http = createServer();
    const back = new WebSocketServer({ server: http });
    const clients = [];
    let witness;
    t.after(async () => {
      for (const client of clients) client.terminate();
      await witness?.close();
      for (const peer of back.clients) peer.terminate();
      back.close();
      await new Promise(resolve => http.close(resolve));
      if (previous === undefined) delete process.env.HOME;
      else process.env.HOME = previous;
      for (const place of [home, dir]) fs.rmSync(place, { recursive: true, force: true });
    });
    http.listen(upstream);
    await once(http, "listening");
    fs.chmodSync(upstream, 0o600);
    witness = await startConfirmationWitness({ upstream, listen });
    const interrupted = [];
    const acknowledged = [];
    back.on("connection", peer => {
      peer.on("message", raw => {
        const event = JSON.parse(raw);
        if (event.method === "turn/start") peer.send(JSON.stringify({ id: event.id, result: { turn: { id: "turn-one" } } }));
        if (event.method === "turn/interrupt") {
          interrupted.push(event.params);
          // 延迟回执，验证退订后立即断开时上游仍保留到中断处理完毕。
          setTimeout(() => {
            if (peer.readyState === WebSocket.OPEN) peer.send(JSON.stringify({ id: event.id, result: {} }), error => {
              if (!error) acknowledged.push(event.id);
            });
          }, 50);
        }
      });
    });
    async function connect() {
      const paired = once(back, "connection");
      const front = new WebSocket("ws://localhost/", { createConnection: () => createConnection({ path: listen }) });
      clients.push(front);
      await once(front, "open");
      const [peer] = await paired;
      front.send(JSON.stringify({ id: 1, method: "initialize", params: { clientInfo: { name: "codex-tui" } } }));
      return { front, peer };
    }
    async function emit({ front, peer }, method, item) {
      const ack = once(front, "message");
      peer.send(JSON.stringify({ method, params: { threadId: "thread-one", turnId: "turn-one", item } }));
      await ack;
    }
    const origin = await connect();
    const observer = await connect();
    const ack = once(origin.front, "message");
    origin.front.send(JSON.stringify({ id: 2, method: "turn/start", params: { threadId: "thread-one", turnTrigger: "user" } }));
    await ack;
    const operation = confirmationDigest("材料");
    const text = "完整冻结的确认正文";
    const command = { type: "commandExecution", id: "exec-wait", command: `ftl confirm ${operation}`, cwd: root };
    await emit(origin, "item/started", command);
    await emit(origin, "item/completed", { type: "agentMessage", id: "msg1", phase: "commentary", text });
    const env = { CODEX_THREAD_ID: "thread-one", CODEX_TOOL_CALL_ID: command.id };
    const tooEarly = codexConfirmationOrigin(root, operation, env);
    await assert.rejects(tooEarly.verify(confirmationDigest(text)), /未展示完整/);
    await emit(origin, "item/completed", { ...command, exitCode: 2 });
    await emit(origin, "item/started", command);
    const binding = await codexConfirmationOrigin(root, operation, env).verify(confirmationDigest(text));
    assert.match(binding, /^[a-f0-9-]{36}$/);
    const internalReplies = [];
    origin.front.on("message", raw => {
      const reply = JSON.parse(raw);
      if (typeof reply.id === "string" && reply.id.startsWith("flower-confirm-")) internalReplies.push(reply.id);
    });
    observer.front.send(JSON.stringify({ id: 3, method: "thread/unsubscribe", params: { threadId: "thread-one" } }));
    assert.equal(await codexConfirmationOrigin(root, operation, env).verify(confirmationDigest(text)), binding);
    if (ending !== "关闭连接") {
      origin.front.send(JSON.stringify({ id: 4, method: "thread/unsubscribe", params: { threadId: "thread-one" } }));
    }
    if (ending !== "只退订") origin.front.close();
    const deadline = Date.now() + 1500;
    while (!interrupted.length && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
    assert.deepEqual(interrupted, [{ threadId: "thread-one", turnId: "turn-one" }]);
    while (!acknowledged.length && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(acknowledged.length, 1, "上游连接必须保留到收到中断回执");
    if (ending === "只退订") assert.equal(origin.front.readyState, WebSocket.OPEN);
    await emit(observer, "item/started", command);
    await assert.rejects(codexConfirmationOrigin(root, operation, env).verify(confirmationDigest(text)), /已中断/);
    assert.equal(observer.front.readyState, WebSocket.OPEN);
    assert.deepEqual(internalReplies, [], "见证发起的中断回执不转发给客户端");
  });
