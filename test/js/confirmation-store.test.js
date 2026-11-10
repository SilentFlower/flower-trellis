/** @module codex-confirmation-test 后台演练的状态、竞争与入口验证。 */
import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readdirSync, existsSync, symlinkSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { ConfirmationStore, validateConfirmation, prepareConfirmation, runConfirmationWorker, claimConfirmation, cancelConfirmation, confirmationStatus } from "../../src/lib/codex-confirmation.js";

const ROOT = path.resolve(".");

/** 生成隔离存储及原生客户端替身。
 * @param {object} t 测试生命周期
 * @param {object} options 初始回合状态
 * @returns {object} 夹具
 */
function fixture(t, { active = false } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "flower-confirmation-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = new ConfirmationStore(root, randomUUID());
  const client = new EventEmitter();
  client.humanId = "human-baseline";
  client.turn = { id: "origin", status: active ? "inProgress" : "completed" };
  client.snapshot = async () => ({ humanId: client.humanId, turn: client.turn });
  client.added = [];
  client.removed = [];
  client.add = async id => { client.added.push(id); return { id: `queue-${id}` }; };
  client.remove = async id => { client.removed.push(id); return "deleted"; };
  client.reply = id => { client.humanId = id; client.emit("human", { id, turnId: "reply" }); };
  const prepare = async (seconds = 0.1, message = "只输出一次的演练文本") => prepareConfirmation(store, { seconds, message, snapshot: await client.snapshot() }).request;
  return { root, store, client, prepare };
}

/** 有界等待测试中的异步状态。
 * @param {Function} condition 目标条件
 * @returns {Promise<void>}
 */
async function until(condition) {
  const end = Date.now() + 4000;
  while (!condition()) { if (Date.now() > end) throw new Error("测试状态等待超时"); await sleep(10); }
}

test("时间、正文和标识必须有效；空查询不创建目录", t => {
  const { root, store } = fixture(t);
  assert.equal(confirmationStatus(store).state, "absent");
  assert.deepEqual(readdirSync(root), []);
  for (const value of [0, -1, NaN, Infinity, 86401]) assert.throws(() => validateConfirmation(value, "文本"), /等待时间/);
  for (const value of [null, "", " ", "字".repeat(3000)]) assert.throws(() => validateConfirmation(1, value), /演练文本/);
  assert.throws(() => new ConfirmationStore(root, "../../other"), /UUID/);
  for (const status of ["interrupted", "failed"]) {
    assert.throws(() => prepareConfirmation(store, { seconds: 1, message: "文本", snapshot: { humanId: "baseline", turn: { status } } }), /原回合/);
  }
});

test("两个自定义时间均从原回合完成后开始，重复 worker 不重复投递", async t => {
  for (const seconds of [0.1, 0.25]) {
    const { store, client, prepare } = fixture(t, { active: true });
    const request = await prepare(seconds);
    const work = runConfirmationWorker({ store, client, requestId: request.id });
    await sleep(80);
    assert.equal(store.read().request.state, "prepared");
    assert.equal(store.read().request.deadline, null);
    assert.equal((await runConfirmationWorker({ store, client, requestId: request.id })).state, "duplicate_worker");
    const ended = Date.now();
    client.turn.status = "completed";
    client.emit("notification", { method: "turn/completed", params: { turn: client.turn } });
    await until(() => store.read().request.state === "queued");
    assert.ok(store.read().request.deadline >= ended + seconds * 1000);
    assert.equal(client.added.length, 1);
    const claims = await Promise.all(Array.from({ length: 5 }, () => claimConfirmation({ store, client, requestId: request.id })));
    assert.equal(claims.filter(value => value.claimed).length, 1);
    assert.equal(claims.filter(value => "message" in value).length, 1);
    assert.equal((await work).state, "consumed");
    assert.equal((await claimConfirmation({ store, client, requestId: request.id })).claimed, false);
    assert.equal("message" in confirmationStatus(store), false);
  }
});

test("系统墙钟前跳不能让已开始的倒计时提前投递", async t => {
  const { store, client, prepare } = fixture(t);
  client.deliveryOnExit = true;
  const request = await prepare(0.25);
  const work = runConfirmationWorker({ store, client, requestId: request.id });
  await until(() => store.read().request.state === "waiting");
  const now = Date.now.bind(Date);
  const clock = t.mock.method(Date, "now", () => now() + 600000);
  try {
    await sleep(70);
    assert.equal(client.added.length, 0);
    assert.equal(store.read().request.state, "waiting");
    assert.equal((await work).state, "queued");
  } finally { clock.mock.restore(); }
});

test("新人工消息立即取消，started/completed 去重后不重复改变代次", async t => {
  const { store, client, prepare } = fixture(t);
  const request = await prepare(5);
  const work = runConfirmationWorker({ store, client, requestId: request.id });
  await until(() => store.read().request.state === "waiting");
  client.reply("new-human");
  const generation = store.read().generation;
  client.reply("new-human");
  assert.equal(store.read().generation, generation);
  assert.equal((await work).state, "cancelled");
  assert.equal(client.added.length, 0);
  assert.equal((await claimConfirmation({ store, client, requestId: request.id })).claimed, false);
});

test("投递与回复竞争：回执到达后撤回精确队列，不输出旧文本", async t => {
  const { store, client, prepare } = fixture(t);
  const request = await prepare();
  client.add = async id => {
    client.added.push(id);
    client.reply("concurrent-human");
    await sleep(10);
    return { id: "exact-racing-queue" };
  };
  assert.equal((await runConfirmationWorker({ store, client, requestId: request.id })).state, "cancelled");
  assert.ok(client.removed.length >= 1);
  assert.ok(client.removed.every(id => id === "exact-racing-queue"));
  assert.equal((await claimConfirmation({ store, client, requestId: request.id })).claimed, false);
});

test("队列已接收后用户回复，旧唤醒和重复提醒均无法领取", async t => {
  const { store, client, prepare } = fixture(t);
  const request = await prepare();
  const work = runConfirmationWorker({ store, client, requestId: request.id });
  await until(() => store.read().request.state === "queued");
  client.emit("wake", { requestId: request.id, turnId: "wake-turn" });
  assert.equal(store.read().request.state, "queued");
  client.reply("cancel-after-queue");
  assert.equal((await work).state, "cancelled");
  assert.deepEqual(client.removed, [`queue-${request.id}`]);
  assert.equal((await claimConfirmation({ store, client, requestId: request.id })).claimed, false);
});

test("没有 worker 通知时，领取仍重新核对最新人工消息", async t => {
  const { store, client, prepare } = fixture(t);
  const request = await prepare();
  store.change(request.id, value => { value.state = "queued"; value.queueId = "queued"; value.claimDeadline = Date.now() + 5000; });
  client.humanId = "offline-human";
  const result = await claimConfirmation({ store, client, requestId: request.id });
  assert.equal(result.claimed, false);
  assert.equal(store.read().request.state, "cancelled");
});

test("同会话新请求替换旧等待，旧 worker 不覆盖新状态；跨会话隔离", async t => {
  const { root, store, client, prepare } = fixture(t);
  const old = await prepare(5);
  const work = runConfirmationWorker({ store, client, requestId: old.id });
  await until(() => store.read().request.state === "waiting");
  const next = await prepare(10, "新的文本");
  assert.equal((await work).state, "replaced");
  assert.equal(store.read().request.id, next.id);
  assert.equal((await claimConfirmation({ store, client, requestId: old.id })).reason, "not_current");
  const other = new ConfirmationStore(root, randomUUID());
  assert.equal(other.read(), null);
  await cancelConfirmation({ store: other });
  assert.equal(store.read().request.state, "prepared");
  await cancelConfirmation({ store, requestId: old.id });
  assert.equal(store.read().request.state, "prepared");
});

test("等待中的断连、原回合中断和 SIGTERM 均不成为默认批准", async t => {
  for (const kind of ["disconnect", "origin-interrupt", "signal"]) {
    const { store, client, prepare } = fixture(t, { active: true });
    const request = await prepare(5);
    const controller = new AbortController();
    const work = runConfirmationWorker({ store, client, requestId: request.id, signal: controller.signal });
    await sleep(20);
    if (kind === "disconnect") { client.failure = new Error("连接丢失"); client.emit("disconnect", client.failure); }
    if (kind === "origin-interrupt") client.emit("notification", { method: "turn/completed", params: { turn: { id: "origin", status: "interrupted" } } });
    if (kind === "signal") controller.abort();
    assert.ok(["failed", "cancelled"].includes((await work).state));
    assert.equal(client.added.length, 0);
  }
});

test("回执未知只投递一次，已接收的内部唤醒也不能领取", async t => {
  const { store, client, prepare } = fixture(t);
  const request = await prepare();
  client.add = async id => { client.added.push(id); client.emit("wake", { requestId: id, turnId: "ambiguous" }); throw new Error("回执未知"); };
  assert.equal((await runConfirmationWorker({ store, client, requestId: request.id })).state, "delivery_unknown");
  assert.equal(client.added.length, 1);
  assert.equal((await runConfirmationWorker({ store, client, requestId: request.id })).state, "duplicate_worker");
  assert.equal((await claimConfirmation({ store, client, requestId: request.id })).claimed, false);
});

test("取消后的队列撤回失败保留明确结果；本地取消仍有效", async t => {
  const { store, client, prepare } = fixture(t);
  const request = await prepare();
  store.change(request.id, value => { value.state = "queued"; value.queueId = "owned-only"; });
  client.remove = async id => { assert.equal(id, "owned-only"); throw new Error("网络断开"); };
  const status = await cancelConfirmation({ store, client });
  assert.equal(status.state, "cancelled");
  assert.match(status.revocation, /failed/);
  assert.equal((await claimConfirmation({ store, client, requestId: request.id })).claimed, false);
});

test("损坏、过大或软链接状态不能成为有效请求", async t => {
  const { root, store } = fixture(t);
  mkdirSync(store.directory, { recursive: true });
  writeFileSync(store.file, "{broken");
  assert.throws(() => store.read());
  writeFileSync(store.file, " ".repeat(65537));
  assert.throws(() => store.read(), /有界/);
  rmSync(store.file);
  const target = path.join(root, "external.json");
  writeFileSync(target, "{}");
  try { symlinkSync(target, store.file); }
  catch (error) { if (process.platform === "win32" && error.code === "EPERM") return; throw error; }
  assert.throws(() => store.read(), /普通文件/);
});

/** 在同步调用期间模拟 Windows 文件系统失败，结束后恢复平台和 ESM 内置绑定。
 * @param {object} t 测试上下文
 * @param {Function} mkdir 模拟目录创建
 * @param {Function} action 同步验证
 * @returns {unknown} 验证结果
 */
function withWindowsMkdir(t, mkdir, action) {
  const platform = Object.getOwnPropertyDescriptor(process, "platform");
  const mocked = t.mock.method(fs, "mkdirSync", mkdir);
  Object.defineProperty(process, "platform", { ...platform, value: "win32" });
  syncBuiltinESMExports();
  try { return action(); }
  finally {
    mocked.mock.restore();
    syncBuiltinESMExports();
    Object.defineProperty(process, "platform", platform);
  }
}

test("Windows 锁目录短暂拒绝创建后只执行一次状态更新", async t => {
  for (const code of ["EPERM", "EACCES"]) {
    const { store, prepare } = fixture(t);
    await prepare();
    const original = fs.mkdirSync;
    let attempts = 0;
    let updates = 0;
    withWindowsMkdir(t, (file, options) => {
      if (file === `${store.file}.lock` && ++attempts <= 3) throw Object.assign(new Error("目录仍在删除"), { code });
      return original(file, options);
    }, () => store.update(state => { updates += 1; state.generation += 1; return state; }));
    assert.equal(attempts, 4);
    assert.equal(updates, 1);
    assert.equal(store.read().generation, 2);
    assert.equal(existsSync(`${store.file}.lock`), false);
  }
});

test("Windows 持续拒绝创建锁时保留权限错误且不执行状态回调", t => {
  const { store } = fixture(t);
  const original = fs.mkdirSync;
  const denied = Object.assign(new Error("访问被拒绝"), { code: "EPERM" });
  let attempts = 0;
  let updates = 0;
  let milliseconds = 0;
  const clock = t.mock.method(Date, "now", () => { milliseconds += 250; return milliseconds; });
  try {
    withWindowsMkdir(t, (file, options) => {
      if (file === `${store.file}.lock`) { attempts += 1; throw denied; }
      return original(file, options);
    }, () => assert.throws(() => store.update(state => { updates += 1; return state; }), error => error === denied));
  } finally { clock.mock.restore(); }
  assert.equal(attempts, 4);
  assert.equal(updates, 0);
  assert.equal(existsSync(store.file), false);
});

test("多进程竞争状态锁仍保持全部代次更新", async t => {
  const { root, store, prepare } = fixture(t);
  await prepare();
  const moduleUrl = pathToFileURL(path.join(ROOT, "src/lib/codex-confirmation.js")).href;
  // 全量套件负载下允许调用方重试明确的锁繁忙；不放宽产品的短临界区预算。
  const source = `import { ConfirmationStore } from ${JSON.stringify(moduleUrl)};
    const store=new ConfirmationStore(process.argv[1],process.argv[2]); const deadline=Date.now()+20000;
    for(let i=0;i<25;) {
      try { store.update(state=>{state.generation++;return state;}); i++; }
      catch(error) { if(error.message!=="确认状态锁繁忙" || Date.now()>deadline) throw error; }
    }`;
  await Promise.all(Array.from({ length: 4 }, () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", source, root, store.sessionId], { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", data => { stderr += data; });
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve() : reject(new Error(stderr)));
  })));
  assert.equal(store.read().generation, 101);
});
