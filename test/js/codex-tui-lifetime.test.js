import assert from "node:assert/strict";
import test from "node:test";
import { captureCodexTui, verifyCodexTui, verifyCodexTuiCoverage } from "../../src/lib/codex-tui-lifetime.js";

const origin = "http://127.0.0.1:12345";

test("按精确会话读取内置服务并核对准备期间的重绑", async () => {
  const calls = [];
  const client = { rpc: async (method, params) => {
    calls.push([method, params]);
    return { data: [{ name: "codex_tui", runtimeStatus: "connected", httpOrigin: origin }] };
  } };
  const binding = { origin, pid: 42 };
  assert.equal(await captureCodexTui({ client, sessionId: "exact-thread", project: "/project", inspect: async (command, value) => {
    assert.equal(command, "bind");
    assert.deepEqual(value, { origin });
    return { binding };
  } }), binding);
  assert.equal(calls.length, 2);
  assert(calls.every(([method, params]) => method === "mcpServerStatus/list" && params.threadId === "exact-thread" && params.serverName === "codex_tui"));
});

test("未知、远程、断开或非唯一服务保持人工且不探测进程", async () => {
  for (const data of [[], [{ name: "codex_tui", httpOrigin: origin, runtimeStatus: "failed" }],
    [{ name: "codex_tui", httpOrigin: "http://example.com:12345", runtimeStatus: "connected" }],
    [{ name: "codex_tui", httpOrigin: origin, runtimeStatus: "connected" }, { name: "codex_tui", httpOrigin: origin, runtimeStatus: "connected" }]]) {
    await assert.rejects(captureCodexTui({ client: { rpc: async () => ({ data }) }, sessionId: "exact", project: "/project", inspect: async () => { assert.fail("不得猜测窗口"); } }), /TUI 服务/);
  }
});

test("恢复后的新窗口不能领取冻结的旧窗口请求", async () => {
  const client = { rpc: async () => ({ data: [{ name: "codex_tui", runtimeStatus: "connected", httpOrigin: "http://127.0.0.1:23456" }] }) };
  await assert.rejects(verifyCodexTui({ client, sessionId: "exact", project: "/project", binding: { origin }, inspect: async () => { assert.fail("不能转绑新窗口"); } }), /绑定已改变/);
});

test("进程核验期间的窗口替换也不能通过", async () => {
  let count = 0;
  const client = { rpc: async () => ({ data: [{ name: "codex_tui", runtimeStatus: "connected", httpOrigin: ++count === 1 ? origin : "http://127.0.0.1:23456" }] }) };
  await assert.rejects(verifyCodexTui({ client, sessionId: "exact", project: "/project", binding: { origin }, inspect: async () => ({ valid: true }) }), /核验期间/);
});

test("全部已加载会话只读枚举，未知额外前台不授予许可", async () => {
  const calls = [];
  const client = { rpc: async (method, params) => {
    calls.push(method);
    return method === "thread/loaded/list" ? { data: ["root", "other"] }
      : { data: [{ name: "codex_tui", runtimeStatus: "connected", httpOrigin: params.threadId === "root" ? origin : "http://127.0.0.1:23456" }] };
  } };
  await verifyCodexTuiCoverage({ client, project: "/project", inspect: async (command, value) => {
    assert.equal(command, "coverage");
    assert.deepEqual(value.origins, [origin, "http://127.0.0.1:23456"]);
    return { valid: true };
  } });
  assert.equal(calls.includes("thread/resume"), false);
  await assert.rejects(verifyCodexTuiCoverage({ client, project: "/project", inspect: async () => ({ valid: false }) }), /归属/);
});
