import assert from "node:assert/strict";
import test from "node:test";
import { createConfirmationState } from "../../src/lib/confirmation-state.js";

/** 创建可精确控制截止顺序的状态机夹具。 */
function fixture(options = {}) {
  const timers = new Map();
  const events = [];
  let sequence = 0;
  let current = { enabled: true, seconds: 100, revision: "v1", display: "完整方案", kind: "brief",
    action: "implement", contextKey: "codex_main" };
  const state = createConfirmationState({ snapshot: async () => ({ ...current }), display: async () => {},
    setTimer: (callback, ms) => { const id = ++sequence; timers.set(id, { callback, ms }); return id; },
    clearTimer: id => timers.delete(id), audit: event => events.push(event), ...options });
  state.bind("codex_main");
  return { state, timers, events, update: patch => { current = { ...current, ...patch }; },
    fire: () => { for (const [id, timer] of timers) { timers.delete(id); timer.callback(); } } };
}

const drain = () => new Promise(resolve => setImmediate(resolve));

test("准备的异步复核期间人工介入，不能随后新建旧方案的许可", async () => {
  let release;
  const f = fixture({ snapshot: () => new Promise(resolve => { release = () => resolve({ enabled: true,
    seconds: 100, revision: "v1", display: "完整方案", kind: "brief", action: "implement", contextKey: "codex_main" }); }) });
  const preparation = f.state.prepare({}, "codex_main");
  f.state.cancelAll("human_input");
  release();
  await assert.rejects(preparation, /人工介入/);
  assert.equal(f.events.filter(event => event.event === "prepared").length, 0);
});

test("准备不计时；完整展示排空后等待，超时返回与领取严格分开", async () => {
  let release;
  const displayed = new Promise(resolve => { release = resolve; });
  const f = fixture({ display: () => displayed });
  const prepared = await f.state.prepare({ file: "brief.md" }, "codex_main");
  assert.equal(f.timers.size, 0);
  const waiting = f.state.wait(prepared.request_id);
  await drain();
  assert.equal(f.timers.size, 0);
  release();
  await drain();
  assert.equal([...f.timers.values()][0].ms, 100000);
  f.fire();
  assert.equal((await waiting).source, "policy_timeout");
  assert.equal(f.events.at(-1).event, "timeout_ready");
  const permit = await f.state.claim(prepared.request_id, "codex_main");
  assert.equal(permit.action, "implement");
  await assert.rejects(f.state.claim(prepared.request_id, "codex_main"), /已领取/);
  assert.deepEqual(f.state.finish(prepared.request_id, "codex_main", "completed"),
    { request_id: prepared.request_id, outcome: "completed" });
});

test("展示期间介入后，展示完成不能重新激活旧决定", async () => {
  let release;
  const f = fixture({ display: () => new Promise(resolve => { release = resolve; }) });
  const prepared = await f.state.prepare({}, "codex_main");
  const waiting = f.state.wait(prepared.request_id);
  await drain();
  f.state.cancelAll("human_input");
  release();
  assert.equal((await waiting).source, "cancelled");
  await drain();
  assert.equal(f.timers.size, 0);
});

test("工具已返回而尚未领取时，用户输入仍撤销默认执行", async () => {
  const f = fixture();
  const prepared = await f.state.prepare({}, "codex_main");
  const waiting = f.state.wait(prepared.request_id);
  await drain();
  f.fire();
  await waiting;
  f.state.cancelAll("human_input");
  await assert.rejects(f.state.claim(prepared.request_id, "codex_main"), /已撤销/);
  assert.equal(f.events.filter(event => event.event === "claimed").length, 0);
});

test("领取异步复核期间到达的输入优先，不能产生许可", async () => {
  let blocking = false;
  let release;
  const f = fixture({ snapshot: async () => {
    if (blocking) await new Promise(resolve => { release = resolve; });
    return { enabled: true, seconds: 100, revision: "v1", display: "方案", kind: "brief", action: "implement", contextKey: "codex_main" };
  } });
  const prepared = await f.state.prepare({}, "codex_main");
  const waiting = f.state.wait(prepared.request_id);
  await drain(); f.fire(); await waiting;
  blocking = true;
  const claim = f.state.claim(prepared.request_id, "codex_main");
  f.state.cancelAll();
  release();
  await assert.rejects(claim, /许可已变化/);
});

test("重复wait只展示与启动一次，材料变化阻止领取", async () => {
  let displays = 0;
  const f = fixture({ display: async () => { displays++; } });
  const prepared = await f.state.prepare({}, "codex_main");
  const first = f.state.wait(prepared.request_id);
  const retry = f.state.wait(prepared.request_id);
  await drain();
  assert.equal(displays, 1);
  assert.equal(f.timers.size, 1);
  f.fire();
  assert.deepEqual(await first, await retry);
  f.update({ revision: "v2" });
  await assert.rejects(f.state.claim(prepared.request_id, "codex_main"), /材料或许可已变化/);
});

test("prepare重试复用同一请求，领取或撤销后不能靠重试重新执行旧事项", async () => {
  const f = fixture();
  const first = await f.state.prepare({ file: "report.md" }, "codex_main");
  assert.deepEqual(await f.state.prepare({ file: "report.md" }, "codex_main"), first);
  const waiting = f.state.wait(first.request_id);
  await drain(); f.fire(); await waiting;
  assert.deepEqual(await f.state.prepare({ file: "report.md" }, "codex_main"), first);
  await f.state.claim(first.request_id, "codex_main");
  await assert.rejects(f.state.prepare({ file: "report.md" }, "codex_main"), /不能重复准备/);
  f.update({ revision: "v2", display: "新报告" });
  const next = await f.state.prepare({ file: "report.md" }, "codex_main");
  assert.notEqual(next.request_id, first.request_id);
  f.state.cancelAll();
  await assert.rejects(f.state.prepare({ file: "report.md" }, "codex_main"), /不能重复准备/);
});

test("关闭、跨会话和重新启动都不能重放旧许可", async () => {
  const f = fixture();
  await assert.rejects(f.state.prepare({}, "codex_child"), /当前主会话/);
  const prepared = await f.state.prepare({}, "codex_main");
  const waiting = f.state.wait(prepared.request_id);
  await drain();
  f.state.close();
  assert.equal((await waiting).source, "cancelled");
  assert.equal(f.timers.size, 0);
  await assert.rejects(f.state.claim(prepared.request_id, "codex_main"), /当前主会话/);
  await assert.rejects(fixture().state.wait(prepared.request_id), /不属于当前入口/);
});

test("禁用、无效预算和展示失败保持人工，已开始退出记录待核验", async () => {
  const f = fixture();
  f.update({ enabled: false });
  await assert.rejects(f.state.prepare({}, "codex_main"), /策略/);
  f.update({ enabled: true, seconds: 86401 });
  await assert.rejects(f.state.prepare({}, "codex_main"), /预算/);
  const failed = fixture({ display: async () => { throw new Error("输出已关闭"); } });
  const p = await failed.state.prepare({}, "codex_main");
  assert.equal((await failed.state.wait(p.request_id)).source, "cancelled");
  const started = fixture();
  const q = await started.state.prepare({}, "codex_main");
  const wait = started.state.wait(q.request_id);
  await drain(); started.fire(); await wait;
  await started.state.claim(q.request_id, "codex_main");
  started.state.close();
  assert.equal(started.events.at(-1).outcome, "needs_verification");
});

for (const failedEvent of ["prepared", "waiting", "timeout_ready", "claimed"]) {
  test(`${failedEvent}审计失败撤销未领取决定，禁止产生或重试自动许可`, async () => {
    let diagnostics = 0;
    const f = fixture({ audit: event => { if (event.event === failedEvent) throw new Error("磁盘不可写"); },
      onAuditError: () => { diagnostics++; throw new Error("诊断也不可写"); } });
    if (failedEvent === "prepared") await assert.rejects(f.state.prepare({}, "codex_main"), /审计不可用/);
    else {
      const p = await f.state.prepare({}, "codex_main");
      const waiting = f.state.wait(p.request_id);
      await drain();
      f.fire();
      const result = await waiting;
      if (failedEvent === "claimed") assert.equal(result.source, "policy_timeout");
      else assert.equal(result.source, "cancelled");
      await assert.rejects(f.state.claim(p.request_id, "codex_main"), /审计不可用/);
    }
    assert.equal(diagnostics, 1);
    assert.equal(f.state.describe().audit_ok, false);
    await assert.rejects(f.state.prepare({}, "codex_main"), /审计不可用/);
    assert.doesNotThrow(() => { f.state.cancelAll(); f.state.close(); f.state.close(); });
    assert.equal(f.timers.size, 0);
    assert.equal(f.state.describe().bound, false);
  });
}

test("取消和已开始动作完成时审计失败，不阻断人工路径或抹去真实结果", async () => {
  let fail = false;
  const cancelled = fixture({ audit: () => { if (fail) throw new Error("磁盘已满"); } });
  const p = await cancelled.state.prepare({}, "codex_main");
  const waiting = cancelled.state.wait(p.request_id);
  await drain();
  fail = true;
  assert.doesNotThrow(() => cancelled.state.cancelAll("human_input"));
  assert.equal((await waiting).source, "cancelled");
  assert.equal(cancelled.state.describe().audit_ok, false);
  cancelled.state.close();
  assert.equal(cancelled.state.describe().closed, true);

  for (const outcome of ["completed", "interrupted", "needs_verification"]) {
    const f = fixture({ audit: event => { if (event.event === "finished") throw new Error("磁盘已满"); } });
    const q = await f.state.prepare({}, "codex_main");
    const wait = f.state.wait(q.request_id);
    await drain(); f.fire(); await wait;
    await f.state.claim(q.request_id, "codex_main");
    assert.deepEqual(f.state.finish(q.request_id, "codex_main", outcome), { request_id: q.request_id, outcome, audit_ok: false });
    assert.doesNotThrow(() => f.state.close());
    assert.equal(f.state.describe().bound, false);
  }
});
