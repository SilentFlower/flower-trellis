import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { execFile } from "node:child_process";
import { createConnection } from "node:net";
import { fileURLToPath } from "node:url";
import { startConfirmationServer } from "../../src/lib/confirmation-server.js";
import { createConfirmationSnapshot } from "../../src/lib/confirmation-snapshot.js";
import { callConfirmation } from "../../src/lib/confirmation-ipc.js";
import { runConfirmationMcp } from "../../src/lib/confirmation-mcp.js";
import { CONFIRMATION_SESSION_ENV } from "../../src/constants.js";
import { resolvePythonExecutable } from "../../scripts/python-runtime.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const HELPER = path.join(ROOT, "vendor/skill-garden/.trellis/0.6/scripts/confirmation.py");
const PYTHON = resolvePythonExecutable();

/** 真实Python客户端与真实TCP服务之间的端到端夹具。 */
async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "flower-confirmation-中文 "));
  const scripts = path.join(root, ".trellis/scripts/common");
  fs.cpSync(path.join(ROOT, ".trellis/scripts/common"), scripts, { recursive: true,
    filter: file => !file.includes("__pycache__") });
  fs.writeFileSync(path.join(root, ".trellis/config.yaml"), "confirmation_timeout:\n  check:\n    base_seconds: 1\n");
  fs.writeFileSync(path.join(root, "报告.md"), "CHK-1 修复当前问题；中文 & % ! ^\n");
  const shown = [];
  const events = [];
  const runtime = await startConfirmationServer({ root, platform: "codex",
    snapshot: createConfirmationSnapshot(root, { python: PYTHON, helper: HELPER }),
    display: async material => shown.push(material.display), audit: event => events.push(event) });
  const environment = { ...process.env, [CONFIRMATION_SESSION_ENV]: JSON.stringify(runtime.descriptor), CODEX_THREAD_ID: "fixture" };
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const pending = new Map();
  let buffer = "";
  stdout.setEncoding("utf8");
  stdout.on("data", chunk => {
    buffer += chunk;
    while (buffer.includes("\n")) {
      const end = buffer.indexOf("\n");
      const message = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      pending.get(message.id)?.(message);
      pending.delete(message.id);
    }
  });
  const mcp = runConfirmationMcp({ descriptor: runtime.descriptor, stdin, stdout });
  t.after(async () => { mcp.close(); await runtime.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const command = (args, input = "", commandRoot = root) => new Promise((resolve, reject) => {
    const child = execFile(PYTHON, ["-X", "utf8", HELPER, ...args, "--root", commandRoot],
      { env: environment, encoding: "utf8" }, (error, output) => {
        try { resolve({ code: error?.code || 0, value: JSON.parse(output) }); } catch { reject(error || new Error(output)); }
      });
    child.stdin.end(input);
  });
  let sequence = 0;
  const request = (method, params) => {
    const id = ++sequence;
    const result = new Promise(resolve => pending.set(id, resolve));
    stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    return result;
  };
  await request("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } });
  const catalog = await request("tools/list");
  const binding = await command(["bind"], JSON.stringify({ session_id: "fixture", source: "startup" }));
  assert.equal(binding.code, 0, JSON.stringify(binding.value));
  assert.equal(binding.value.bound, true);
  return { root, runtime, shown, events, command, request, catalog, stdin };
}

test("Python准备→单工具MCP等待→Python单次领取完整贯通，正文不进入工具定义", async t => {
  const f = await fixture(t);
  assert.equal(f.catalog.result.tools.length, 1);
  assert.ok(Buffer.byteLength(JSON.stringify(f.catalog.result.tools[0])) < 1024);
  const prepared = await f.command(["prepare", "--kind", "check", "--file", "报告.md", "--problem-id", "CHK-1"]);
  assert.equal(prepared.value.seconds, 1);
  assert.equal(f.shown.length, 0);
  const waited = await f.request("tools/call", { name: "wait", arguments: { request_id: prepared.value.request_id } });
  const result = JSON.parse(waited.result.content[0].text);
  assert.equal(result.source, "policy_timeout");
  assert.equal(f.shown.length, 1);
  assert.match(f.shown[0], /中文 & % ! \^/);
  assert.ok(!waited.result.content[0].text.includes("修复当前问题"));
  const claimed = await f.command(["claim", "--request-id", prepared.value.request_id]);
  assert.equal(claimed.code, 0);
  assert.equal(claimed.value.action, "repair_all_and_recheck");
  assert.equal((await f.command(["claim", "--request-id", prepared.value.request_id])).code, 2);
  assert.equal(f.events.filter(event => event.event === "claimed").length, 1);
});

test("真实材料变更使已返回超时结果的领取失效", async t => {
  const f = await fixture(t);
  const prepared = await f.command(["prepare", "--kind", "check", "--file", "报告.md", "--problem-id", "CHK-1"]);
  await f.request("tools/call", { name: "wait", arguments: { request_id: prepared.value.request_id } });
  fs.appendFileSync(path.join(f.root, "报告.md"), "新增业务取舍\n");
  const claim = await f.command(["claim", "--request-id", prepared.value.request_id]);
  assert.equal(claim.code, 2);
  assert.equal(claim.value.manual, true);
  assert.equal(f.events.filter(event => event.event === "claimed").length, 0);
});

test("当前入口拒绝跨会话、旧请求、畸形JSON与凭据且继续存活", async t => {
  const f = await fixture(t);
  await assert.rejects(callConfirmation(f.runtime.descriptor, { method: "prepare", owner: "codex_other", spec: {} }), /当前主会话/);
  await assert.rejects(callConfirmation(f.runtime.descriptor, { method: "wait", request_id: "00000000-0000-0000-0000-000000000000" }), /当前入口/);
  await assert.rejects(callConfirmation({ ...f.runtime.descriptor, token: "中".repeat(64) }, { method: "status" }));
  await new Promise((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port: f.runtime.descriptor.port });
    socket.on("connect", () => socket.write("null\n"));
    socket.on("error", reject);
    socket.on("close", resolve);
  });
  const status = await callConfirmation(f.runtime.descriptor, { method: "status" });
  assert.equal(status.bound, true);
  assert.equal(status.ready, true);
  assert.ok(!JSON.stringify(status).includes(f.runtime.descriptor.token));
  const otherRoot = path.join(f.root, "another-project");
  fs.mkdirSync(otherRoot);
  const mismatched = await f.command(["status"], "", otherRoot);
  assert.equal(mismatched.code, 2);
  assert.match(mismatched.value.error, /入口项目不匹配/);
});

test("MCP调用期间人工撤销返回cancelled并阻止默认动作", async t => {
  const f = await fixture(t);
  const prepared = await f.command(["prepare", "--kind", "check", "--file", "报告.md", "--problem-id", "CHK-1"]);
  const waiting = f.request("tools/call", { name: "wait", arguments: { request_id: prepared.value.request_id } });
  const deadline = Date.now() + 5000;
  while (!f.events.some(event => event.event === "waiting") && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
  assert.ok(f.events.some(event => event.event === "waiting"), "等待必须进入受控状态");
  f.runtime.state.cancelAll("human_input");
  const result = JSON.parse((await waiting).result.content[0].text);
  assert.equal(result.source, "cancelled");
  assert.equal((await f.command(["claim", "--request-id", prepared.value.request_id])).code, 2);
});

for (const failedEvent of ["tool_ready", "cancelled"]) {
  test(`${failedEvent}审计异常后保持人工并完整关闭监听，重复close等待清理完成`, async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "flower-confirmation-audit-"));
    const runtime = await startConfirmationServer({ root, platform: "codex",
      snapshot: async () => ({ enabled: true, seconds: 100, revision: "v1", display: "方案", contextKey: "codex_fixture" }),
      display: async () => {}, audit: event => { if (event.event === failedEvent) throw new Error("磁盘已满"); } });
    t.after(async () => { await runtime.close(); fs.rmSync(root, { recursive: true, force: true }); });
    runtime.state.bind("codex_fixture");
    const ready = await callConfirmation(runtime.descriptor, { method: "ready" });
    if (failedEvent === "tool_ready") {
      assert.equal(ready.ready, false);
      const status = await callConfirmation(runtime.descriptor, { method: "status" });
      assert.equal(status.manual, true);
      await assert.rejects(runtime.state.prepare({}, "codex_fixture"), /审计不可用/);
    } else await runtime.state.prepare({}, "codex_fixture");
    await Promise.all([runtime.close(), runtime.close()]);
    await runtime.close();
    assert.equal(runtime.state.describe().bound, false);
    assert.equal(runtime.state.describe().audit_ok, false);
    await assert.rejects(callConfirmation(runtime.descriptor, { method: "status" }), /不可用|关闭/);
  });
}
