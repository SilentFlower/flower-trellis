import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { queueTelemetryEvent, flushTelemetryQueue, telemetryQueueStatus } from "../../src/lib/telemetry-queue.js";
import { readTelemetryState, setTelemetryEnabled, reportTelemetry } from "../../src/lib/telemetry.js";
import { telemetryQueueDirectory } from "../../src/lib/telemetry-files.js";
import { observeTelemetryOperation, beginTelemetryOperation, noteTelemetryError, completeTelemetryOperation } from "../../src/lib/telemetry-operation.js";
import { plugin } from "../../src/commands/plugin.js";

/** 创建永不访问公网的隔离遥测配置。
 * @param {object} t 测试
 * @returns {object} 配置
 */
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "flower-events-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { target: root, env: { ...process.env, FLOWER_NO_TELEMETRY: "", XDG_CONFIG_HOME: path.join(root, "config"), GIT_CONFIG_GLOBAL: path.join(root, "no-git"), GIT_CONFIG_NOSYSTEM: "1" },
    launch: () => {}, now: new Date("2026-09-06T10:00:00Z") };
}

/** 读取真实落盘的有限载荷。
 * @param {object} options 配置
 * @returns {object[]} 事件
 */
function pending(options) {
  const directory = telemetryQueueDirectory(options.env);
  return fs.existsSync(directory) ? fs.readdirSync(directory).filter(name => name.startsWith("event-")).map(name => JSON.parse(fs.readFileSync(path.join(directory, name))).payload) : [];
}

test("缺名可采集，同日每平台一次，UTC 跨日重新记录，白名单不含输入内容", t => {
  const options = fixture(t);
  const activity = { event: "activity_daily", ai_platform: "claude", prompt: "不应进入队列" };
  assert.equal(queueTelemetryEvent(options.target, activity, options).status, "queued");
  assert.equal(queueTelemetryEvent(options.target, activity, options).status, "duplicate");
  queueTelemetryEvent(options.target, { ...activity, ai_platform: "codex" }, options);
  queueTelemetryEvent(options.target, activity, { ...options, now: new Date("2026-09-07") });
  assert.equal(pending(options).length, 3);
  assert.equal(pending(options)[0].developer_name, null);
  assert.equal(pending(options)[0].installed_skill_garden_version, null);
  assert.ok(pending(options).every(event => !Object.hasOwn(event, "prompt")));
  const contract = JSON.parse(fs.readFileSync(new URL("../../tests/fixtures/telemetry-v2.json", import.meta.url)));
  assert.deepEqual(Object.keys(pending(options)[0]).sort(), Object.keys(contract.events[0]).sort());
});

test("并发进程共享一个身份和一次日活动", async t => {
  const options = fixture(t);
  const modulePath = new URL("../../src/lib/telemetry-queue.js", import.meta.url).href;
  const script = `import { queueTelemetryEvent } from ${JSON.stringify(modulePath)}; process.stdout.write(JSON.stringify(queueTelemetryEvent(process.cwd(), {event:'activity_daily',ai_platform:'codex'}, {launch:()=>{}})));`;
  const results = await Promise.all(Array.from({ length: 8 }, () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", script], { cwd: options.target, env: options.env, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", chunk => { output += chunk; });
    child.on("error", reject);
    child.on("exit", code => code ? reject(new Error(`子进程 ${code}`)) : resolve(JSON.parse(output)));
  })));
  assert.equal(results.filter(result => result.status === "queued").length, 1);
  assert.ok(results.every(result => ["queued", "duplicate"].includes(result.status)), JSON.stringify(results));
  assert.equal(pending(options).length, 1);
  assert.equal(readTelemetryState(options).status, "valid");
});

test("重试保留 ID、遵守 Retry-After，同日提示仍能唤醒到期队列", async t => {
  const options = fixture(t);
  const activity = { event: "activity_daily", ai_platform: "claude" };
  queueTelemetryEvent(options.target, activity, options);
  const id = pending(options)[0].event_id;
  await flushTelemetryQueue({ ...options, fetch: async () => ({ ok: false, status: 429, headers: new Headers({ "Retry-After": "600" }) }) });
  assert.equal(pending(options)[0].event_id, id);
  assert.ok(Date.parse(telemetryQueueStatus(options).nextRetryAt) >= options.now.getTime() + 600000);
  let wakes = 0;
  queueTelemetryEvent(options.target, activity, { ...options, launch: () => { wakes++; } });
  assert.equal(wakes, 0);
  const later = { ...options, now: new Date(options.now.getTime() + 601000), launch: () => { wakes++; } };
  queueTelemetryEvent(options.target, activity, later);
  assert.equal(wakes, 1);
  const result = await flushTelemetryQueue({ ...later, fetch: async (_url, request) => {
    assert.equal(JSON.parse(request.body).events[0].event_id, id);
    return { ok: true, json: async () => ({ results: [{ event_id: id, status: "duplicate" }] }) };
  } });
  assert.equal(result.status, "reported");
  assert.equal(telemetryQueueStatus(options).pending, 0);
});

test("200 条上限、72h 过期及淘汰日提示不会永久压制活动", t => {
  const options = fixture(t);
  const activity = { event: "activity_daily", ai_platform: "claude" };
  queueTelemetryEvent(options.target, activity, options);
  const operation = { event: "operation_completed", operation: "init", outcome: "success", error_category: null, failure_stage: null, duration_kind: "elapsed", duration_ms: 10 };
  for (let i = 0; i < 201; i++) queueTelemetryEvent(options.target, { ...operation, event_id: randomUUID() }, { ...options, now: new Date(options.now.getTime() + i + 1) });
  assert.equal(pending(options).length, 200);
  assert.equal(queueTelemetryEvent(options.target, activity, { ...options, now: new Date(options.now.getTime() + 1000) }).status, "queued");
  queueTelemetryEvent(options.target, activity, { ...options, now: new Date("2026-09-10") });
  assert.equal(pending(options).length, 1);
  assert.ok(telemetryQueueStatus(options).dropped >= 202);
});

test("停用清空队列，网络回执不能复活状态；环境变量入口零写入", async t => {
  const options = fixture(t);
  queueTelemetryEvent(options.target, { event: "activity_daily", ai_platform: "codex" }, options);
  const id = readTelemetryState(options).state.deviceId;
  await flushTelemetryQueue({ ...options, fetch: async () => {
    setTelemetryEnabled(false, options);
    return { ok: true, json: async () => ({ results: [] }) };
  } });
  assert.equal(readTelemetryState(options).state.enabled, false);
  assert.equal(telemetryQueueStatus(options).pending, 0);
  assert.equal(readTelemetryState(options).state.deviceId, id);
  const disabled = { ...options, env: { ...options.env, XDG_CONFIG_HOME: path.join(options.target, "fresh"), FLOWER_NO_TELEMETRY: "1" } };
  assert.equal(queueTelemetryEvent(options.target, { event: "activity_daily", ai_platform: "codex" }, disabled).status, "disabled_by_env");
  await flushTelemetryQueue(disabled);
  telemetryQueueStatus(disabled);
  assert.equal(fs.existsSync(disabled.env.XDG_CONFIG_HOME), false);
});

test("损坏提示和软链接不能触发身份重建或越界覆盖", t => {
  const options = fixture(t);
  queueTelemetryEvent(options.target, { event: "activity_daily", ai_platform: "codex" }, options);
  const id = readTelemetryState(options).state.deviceId;
  const meta = path.join(telemetryQueueDirectory(options.env), "meta.json");
  fs.writeFileSync(meta, "{broken");
  assert.equal(queueTelemetryEvent(options.target, { event: "activity_daily", ai_platform: "claude" }, options).status, "failed");
  assert.equal(readTelemetryState(options).state.deviceId, id);
  assert.equal(fs.readFileSync(meta, "utf8"), "{broken");
  if (process.platform !== "win32") {
    fs.unlinkSync(meta);
    const outside = path.join(options.target, "outside");
    fs.writeFileSync(outside, "untouched"); fs.symlinkSync(outside, meta);
    queueTelemetryEvent(options.target, { event: "activity_daily", ai_platform: "claude" }, options);
    assert.equal(fs.readFileSync(outside, "utf8"), "untouched");
  }
});

test("缺失待发文件使日提示失效；损坏 v1 磁盘快照不发送额外字段", async t => {
  const options = fixture(t);
  const activity = { event: "activity_daily", ai_platform: "codex" };
  queueTelemetryEvent(options.target, activity, options);
  const directory = telemetryQueueDirectory(options.env);
  const file = fs.readdirSync(directory).find(name => name.startsWith("event-"));
  fs.unlinkSync(path.join(directory, file));
  assert.equal(queueTelemetryEvent(options.target, activity, options).status, "queued");
  setTelemetryEnabled(false, options);
  setTelemetryEnabled(true, options);
  fs.mkdirSync(path.join(options.target, ".trellis"));
  fs.writeFileSync(path.join(options.target, ".trellis/.developer"), "name=fixture");
  await reportTelemetry(options.target, "version_check", options);
  const legacyFile = path.join(directory, "legacy.json");
  const legacy = JSON.parse(fs.readFileSync(legacyFile));
  legacy.payload.prompt = "不允许的字段";
  fs.writeFileSync(legacyFile, JSON.stringify(legacy));
  assert.equal((await flushTelemetryQueue({ ...options, fetch: async () => assert.fail("损坏快照不能联网") })).status, "failed");
  assert.equal(JSON.parse(fs.readFileSync(legacyFile)).payload.prompt, "不允许的字段");
});

test("独立发送启动 stdio 脱离，旧上报调用仅入队且不等待网络", async t => {
  const options = fixture(t);
  fs.mkdirSync(path.join(options.target, ".trellis"));
  fs.writeFileSync(path.join(options.target, ".trellis/.developer"), "name=test");
  let launched = 0;
  const result = await reportTelemetry(options.target, "version_check", { ...options, launch: () => { launched++; } });
  assert.equal(result.status, "queued");
  assert.equal(launched, 1);
  // 子进程真实父终端 pipe 立即关闭；空配置无待发载荷，确保脱离检查不会访问生产服务。
  const script = `import { launchTelemetrySender } from ${JSON.stringify(new URL("../../src/lib/telemetry-queue.js", import.meta.url).href)}; launchTelemetrySender();`;
  const started = Date.now();
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", script], { env: { ...options.env, XDG_CONFIG_HOME: path.join(options.target, "empty-config") } });
    child.on("error", reject); child.on("close", resolve);
  });
  assert.ok(Date.now() - started < 3000);
});

test("嵌套操作一次终态、前置退出零事件、结构化失败在返回码前保留", async t => {
  const options = fixture(t);
  const ctx = { target: options.target, passthrough: [] };
  await observeTelemetryOperation(ctx, "init", async outer => {
    beginTelemetryOperation(outer);
    await observeTelemetryOperation(outer, "plugin_add", async nested => { beginTelemetryOperation(nested); return 0; }, options);
    completeTelemetryOperation(outer, "init");
  }, options);
  await observeTelemetryOperation(ctx, "update", async () => {}, options);
  for (const excluded of [{ ...ctx, passthrough: ["--dry-run"] }, { ...ctx, trellisControlMode: "restoring" }]) {
    await observeTelemetryOperation(excluded, "update", async outer => {
      beginTelemetryOperation(outer);
      await observeTelemetryOperation(outer, "plugin_add", async nested => beginTelemetryOperation(nested), options);
    }, options);
  }
  assert.equal(pending(options).length, 1);
  const code = await plugin({ ...ctx, passthrough: ["add", "local/missing", "--source", "missing", "--json"] }, {
    output: { log() {}, error() {} }, telemetry: options,
  });
  assert.notEqual(code, 0);
  const failure = pending(options).find(event => event.operation === "plugin_add");
  assert.equal(failure.outcome, "failure");
  assert.equal(failure.error_category, "precondition");
  await observeTelemetryOperation(ctx, "self_update", async outer => {
    beginTelemetryOperation(outer); noteTelemetryError(outer, { code: "FLOWER_OPERATION_CANCELLED" }); return 130;
  }, options);
  assert.equal(pending(options).find(event => event.operation === "self_update").outcome, "cancelled");
});
