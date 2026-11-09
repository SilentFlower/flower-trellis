/**
 * 核对真实 managed daemon 的队列、撤回和唤醒；模型端仅使用本地替身。
 * @module managed-queue-probe
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createConnection } from "node:net";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, cpSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import { setTimeout as sleep } from "node:timers/promises";
import { gunzipSync, inflateSync, brotliDecompressSync } from "node:zlib";
import { WebSocket } from "ws";
import { buildCodexResponseEvents, encodeCodexSse } from "./codex-response-events.mjs";

const evidence = path.join(path.dirname(fileURLToPath(import.meta.url)), "native-background-result.json");
const root = mkdtempSync(path.join(tmpdir(), "flower-native-background-"));
const project = path.join(root, "project");
const probeHome = path.join(root, "codex-home");
const socket = path.join(probeHome, "app-server-control", "app-server-control.sock");
for (const directory of [project, probeHome]) mkdirSync(directory, { recursive: true });
const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
for (const file of ["scripts/codex-confirmation.mjs", "src/lib/codex-confirmation.js", "src/lib/codex-queue-client.js", "AGENTS.md", "package.json"]) {
  mkdirSync(path.dirname(path.join(project, file)), { recursive: true });
  cpSync(path.join(sourceRoot, file), path.join(project, file));
}
symlinkSync(path.join(sourceRoot, "node_modules"), path.join(project, "node_modules"), "dir");
const began = performance.now();
const events = [];
const packets = [];
let client;
let observer;
const observed = [];
let env;
let sequence = 0;
let rpcId = 0;
let threadId;
let holdRelease;
let toolsNoted = false;
const runs = [];
const claims = [];
let tools;
let holdNextWake = false;
let heldWake = null;
let heldRequest = false;
let error;
const ownedManagers = [];

/**
 * 保存当前测试事件，不记录凭据或完整模型请求。
 * @param {string} event 事件名。
 * @param {object} details 可公开的演练数据。
 * @returns {void}
 */
function note(event, details = {}) {
  const entry = { ms: Math.round(performance.now() - began), event, ...details };
  events.push(entry);
  process.stdout.write(`${JSON.stringify(entry)}\n`);
}

/**
 * 等待本地观测条件。
 * @param {() => boolean} condition 目标条件。
 * @param {string} message 超时提示。
 * @param {number} budget 最长等待毫秒。
 * @returns {Promise<void>}
 */
async function until(condition, message, budget = 10000) {
  const deadline = performance.now() + budget;
  while (!condition()) {
    if (error) throw error;
    if (performance.now() > deadline) throw new Error(message);
    await sleep(30);
  }
}

/**
 * 执行仅针对隔离配置的原生 CLI。
 * @param {string[]} args 已验证的命令参数。
 * @returns {Promise<object>} 退出状态和有界输出。
 */
async function cli(args) {
  return await new Promise((resolve, reject) => {
    const child = spawn("codex", args, { cwd: project, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => { child.kill("SIGTERM"); reject(new Error("原生 CLI 超时")); }, 10000);
    child.stdout.on("data", data => { stdout = (stdout + data).slice(-4000); });
    child.stderr.on("data", data => { stderr = (stderr + data).slice(-4000); });
    child.once("error", cause => { clearTimeout(timer); reject(cause); });
    child.once("close", code => { clearTimeout(timer); resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }); });
  });
}

/**
 * 调用当前唯一的隔离 App Server。
 * @param {string} method 已读取 schema 的方法。
 * @param {object} params 方法参数。
 * @param {object} connection 当前测试连接。
 * @param {object[]} inbox 该连接的响应集合。
 * @returns {Promise<object>} 正常响应；错误响应抛出。
 */
async function rpc(method, params, connection = client, inbox = packets) {
  const id = ++rpcId;
  connection.send(JSON.stringify({ id, method, params }));
  await until(() => inbox.some(item => item.id === id && !item.method), `接口未响应：${method}`);
  const reply = inbox.find(item => item.id === id && !item.method);
  if (reply.error) throw new Error(`${method}: ${JSON.stringify(reply.error)}`);
  return reply.result;
}

/**
 * 等待指定的真实回合完成。
 * @param {string} turnId 当前测试回合。
 * @returns {Promise<void>}
 */
async function completed(turnId) {
  await until(() => packets.some(item => item.method === "turn/completed" && item.params?.turn?.id === turnId), "回合没有完成");
}

const server = createServer(async (req, res) => {
  if (req.method !== "POST" || req.url?.split("?")[0] !== "/v1/responses") return res.writeHead(403).end();
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    let bytes = Buffer.concat(chunks);
    if (req.headers["content-encoding"] === "gzip") bytes = gunzipSync(bytes);
    if (req.headers["content-encoding"] === "deflate") bytes = inflateSync(bytes);
    if (req.headers["content-encoding"] === "br") bytes = brotliDecompressSync(bytes);
    const body = JSON.parse(bytes.toString("utf8"));
    if (!toolsNoted) {
      tools = body.tools;
      assert.ok(tools.some(item => item.name === "exec_command"), "原生客户端未提供后台命令工具");
      note("tools", { names: tools.map(item => item.name) });
      toolsNoted = true;
    }
    const messages = body.input.map((item, index) => ({ item, index })).filter(value => value.item.role === "user");
    const latest = messages.at(-1);
    const input = JSON.stringify(latest.item);
    const outputs = body.input.slice(latest.index + 1).filter(item => ["function_call_output", "custom_tool_call_output"].includes(item.type));
    const wakeId = input.match(/flower-confirmation:v1:([0-9a-f-]{36})/)?.[1];
    const start = input.match(/NATIVE_BG_START:([0-9.]+):([A-Z_0-9]+)/);
    let result;
    const quote = value => "'" + value.replace(/'/g, "'\\''") + "'";
    const command = args => [process.execPath, "scripts/codex-confirmation.mjs", ...args].map(quote).join(" ");
    const call = cmd => ({ name: "exec_command", arguments: { cmd, workdir: project, yield_time_ms: 1000, max_output_tokens: 3000, login: false } });
    if (start && !outputs.length) {
      note("wait_tool_requested", { seconds: Number(start[1]), message: start[2] });
      result = { toolCall: call(command(["wait", "--seconds", start[1], "--message", start[2]])) };
    } else if (start) {
      const output = outputs.at(-1).output;
      note("background_terminal_returned", { output });
      assert.match(output, /session ID|session_id/i, "工具没有返回后台 session");
      const state = JSON.parse(readFileSync(path.join(project, ".trellis/.runtime/codex-confirmation", `${threadId}.json`), "utf8"));
      assert.equal(state.request.state, "prepared");
      assert.equal(state.request.deadline, null);
      await sleep(300);
      runs.push({ id: state.request.id, seconds: Number(start[1]), message: start[2] });
      result = { text: "原生后台 session 已返回，现在结束主回合" };
    } else if (wakeId && !outputs.length) {
      note("wake_model_started", { requestId: wakeId });
      if (holdNextWake) {
        holdNextWake = false;
        await new Promise(resolve => { heldWake = { requestId: wakeId, release: resolve }; });
      }
      result = { toolCall: call(command(["claim", "--request", wakeId])) };
    } else if (wakeId) {
      const output = outputs.at(-1).output;
      const line = output.split("\n").find(value => value.startsWith('{"claimed":'));
      assert.ok(line, `领取结果不是 JSON：${output}`);
      const claim = JSON.parse(line);
      claims.push(claim);
      note("claim_result", claim);
      result = { text: claim.claimed ? claim.message : "过期提醒已丢弃" };
    } else result = { text: "人工消息已正常处理" };
    res.writeHead(200, { "content-type": "text/event-stream", connection: "close" });
    res.end(encodeCodexSse(buildCodexResponseEvents({ sequence: ++sequence, ...result })));
  } catch (cause) {
    error = cause;
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
});
server.on("connect", (_req, connection) => connection.destroy());

try {
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  env = {};
  for (const key of ["PATH", "HOME", "LANG", "LC_ALL", "SHELL", "USER", "LOGNAME"]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  Object.assign(env, { CODEX_HOME: probeHome, CODEX_SQLITE_HOME: probeHome, NATIVE_QUEUE_PROBE_KEY: "local-test-only",
    NO_PROXY: "127.0.0.1,localhost,::1", no_proxy: "127.0.0.1,localhost,::1", RUST_LOG: "warn" });
  for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]) env[key] = endpoint;
  writeFileSync(path.join(probeHome, "config.toml"), `model = "gpt-5.4"
model_provider = "probe"
approval_policy = "never"
sandbox_mode = "danger-full-access"
check_for_update_on_startup = false
web_search = "disabled"
[analytics]
enabled = false
[model_providers.probe]
name = "本地后台队列演练"
base_url = "${endpoint}/v1"
wire_api = "responses"
env_key = "NATIVE_QUEUE_PROBE_KEY"
requires_openai_auth = false
supports_websockets = false
[projects.${JSON.stringify(project)}]
trust_level = "trusted"
[features]
steer = true
hooks = false
apps = false
plugins = false
memories = false
api_key_model_discovery = false
shell_snapshot = false
unified_exec = true
`);
  const started = await cli(["app-server", "daemon", "start"]);
  note("daemon_start", started);
  assert.equal(started.code, 0);
  for (const line of started.stderr.split("\n")) {
    let item;
    try { item = JSON.parse(line); } catch { continue; }
    if (item.event !== "process_spawned") continue;
    const pid = item.details?.pid;
    try {
      const args = readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0");
      const fields = readFileSync(`/proc/${pid}/stat`, "utf8").split(") ").at(-1).split(" ");
      if (args[0].startsWith(`${root}/`)) ownedManagers.push({ pid, birth: fields[19] });
    } catch { /* 原生管理进程允许在采样前退出。 */ }
  }
  await until(() => existsSync(socket), "隔离 managed daemon 没有控制 socket");
  client = new WebSocket("ws://localhost/", { createConnection: () => createConnection({ path: socket }) });
  await new Promise((resolve, reject) => { client.once("open", resolve); client.once("error", reject); });
  client.on("message", data => packets.push(JSON.parse(data)));
  await rpc("initialize", { clientInfo: { name: "flower_background_research", version: "0" }, capabilities: { experimentalApi: true } });
  client.send(JSON.stringify({ method: "initialized" }));
  threadId = (await rpc("thread/start", { cwd: project, model: "gpt-5.4", modelProvider: "probe", approvalPolicy: "never", sandbox: "danger-full-access" })).thread.id;
  note("thread_created", { threadId });
  const initial = await rpc("turn/start", { threadId, input: [{ type: "text", text: "WAKE_PROBE_INITIAL" }] });
  await completed(initial.turn.id);
  note("initial_idle");
  const stateFile = path.join(project, ".trellis/.runtime/codex-confirmation", `${threadId}.json`);
  const state = () => existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : null;
  for (const seconds of [1, 2]) {
    const started = await rpc("turn/start", { threadId, input: [{ type: "text", text: `NATIVE_BG_START:${seconds}:NATIVE_DONE_${seconds}` }] });
    await completed(started.turn.id);
    const run = runs.at(-1);
    await until(() => claims.some(claim => claim.requestId === run.id && claim.claimed), "到期没有唤醒并领取", 15000);
    const request = state().request;
    assert.ok(request.deadline >= started.turn.startedAt * 1000 + seconds * 1000);
    assert.equal(request.state, "consumed");
    note("custom_timeout_passed", { seconds, requestId: run.id, deadline: request.deadline, receipt: request.receipt });
    await until(() => packets.some(packet => packet.method === "turn/completed" && packet.params.turn.id === request.wakeTurnId), "唤醒回合没有结束");
  }
  const latest = runs.at(-1);
  const { confirmationWake } = await import("../../../../src/lib/codex-queue-client.js");
  await rpc("thread/queue/add", { threadId, clientUserMessageId: latest.id, input: [{ type: "text", text: confirmationWake(latest.id) }] });
  await until(() => claims.filter(claim => claim.requestId === latest.id).length === 2, "重复提醒没有执行领取检查");
  assert.equal(claims.filter(claim => claim.requestId === latest.id && claim.claimed).length, 1);
  await sleep(200);
  note("duplicate_wake_rejected", { requestId: latest.id });
  const cancelStart = await rpc("turn/start", { threadId, input: [{ type: "text", text: "NATIVE_BG_START:2:NATIVE_CANCELLED" }] });
  await completed(cancelStart.turn.id);
  await until(() => state()?.request.state === "waiting", "取消场景没有进入后台等待");
  const cancelledId = state().request.id;
  const reply = await rpc("turn/start", { threadId, input: [{ type: "text", text: "NATIVE_BG_REPLY:修改意见，取消旧演练" }] });
  await completed(reply.turn.id);
  await until(() => state()?.request.state === "cancelled", "人工回复未取消旧等待");
  await sleep(2300);
  assert.equal(claims.some(claim => claim.requestId === cancelledId), false);
  note("human_reply_cancelled", { requestId: cancelledId });

  holdNextWake = true;
  const racingStart = await rpc("turn/start", { threadId, input: [{ type: "text", text: "NATIVE_BG_START:0.3:NATIVE_RACING" }] });
  await completed(racingStart.turn.id);
  await until(() => heldWake && state()?.request.wakeTurnId, "到期竞争场景未启动唤醒");
  const racingRequest = state().request;
  const steerResult = await rpc("turn/steer", { threadId, expectedTurnId: racingRequest.wakeTurnId, input: [{ type: "text", text: "NATIVE_BG_REPLY:领取前修改意见" }] });
  note("steer_submitted", { result: steerResult });
  note("steer_notification_methods", { methods: packets.slice(-8).map(packet => packet.method).filter(Boolean) });
  const inspected = await rpc("thread/items/list", { threadId, limit: 20, sortDirection: "desc" });
  note("steer_items_before_dispatch", { users: inspected.data.filter(entry => entry.item.type === "userMessage").map(entry => entry.item.id) });
  heldWake.release();
  await until(() => state()?.request.state === "cancelled", "唤醒后的人工回复未取消");
  await until(() => packets.some(packet => packet.method === "turn/completed" && packet.params.turn.id === racingRequest.wakeTurnId), "竞态回合没有结束");
  assert.equal(claims.some(claim => claim.requestId === racingRequest.id && claim.claimed), false);
  note("reply_before_claim_rejected", { requestId: racingRequest.id, revocation: state().request.revocation });

  const { CodexQueueClient } = await import("../../../../src/lib/codex-queue-client.js");
  const { ConfirmationStore, prepareConfirmation, runConfirmationWorker } = await import("../../../../src/lib/codex-confirmation.js");
  const production = new CodexQueueClient({ project, sessionId: threadId, env });
  try {
    await production.connect();
    let snapshot = await production.subscribe();
    const store = new ConfirmationStore(project, threadId);
    const duplicate = prepareConfirmation(store, { seconds: 0.3, message: "NATIVE_SINGLE_WORKER", snapshot }).request;
    const firstWorker = runConfirmationWorker({ store, client: production, requestId: duplicate.id });
    assert.equal((await runConfirmationWorker({ store, client: production, requestId: duplicate.id })).state, "duplicate_worker");
    assert.equal((await firstWorker).state, "consumed");
    await until(() => packets.some(packet => packet.method === "turn/completed" && packet.params.turn.id === state().request.wakeTurnId), "去重回合没有结束");
    note("native_duplicate_worker_rejected", { requestId: duplicate.id });

    snapshot = await production.snapshot();
    const unknown = prepareConfirmation(store, { seconds: 0.3, message: "MUST_NOT_OUTPUT", snapshot }).request;
    const originalAdd = production.add.bind(production);
    let attempts = 0;
    production.add = async id => { attempts += 1; await originalAdd(id); throw new Error("测试注入：daemon 已接收，但观察端丢失回执"); };
    assert.equal((await runConfirmationWorker({ store, client: production, requestId: unknown.id })).state, "delivery_unknown");
    await until(() => claims.some(claim => claim.requestId === unknown.id), "未知回执没有验证迟到领取");
    assert.equal(claims.some(claim => claim.requestId === unknown.id && claim.claimed), false);
    assert.equal(attempts, 1);
    await until(() => {
      const turnId = packets.find(packet => packet.params?.item?.clientId === unknown.id)?.params.turnId;
      return turnId && packets.some(packet => packet.method === "turn/completed" && packet.params.turn.id === turnId);
    }, "未知回执回合没有结束");
    note("native_accepted_ack_loss_injected", { requestId: unknown.id, attempts });
    production.add = originalAdd;

    snapshot = await production.snapshot();
    const disconnected = prepareConfirmation(store, { seconds: 10, message: "MUST_NOT_OUTPUT", snapshot }).request;
    const disconnectedWorker = runConfirmationWorker({ store, client: production, requestId: disconnected.id });
    await until(() => state()?.request.state === "waiting", "断连场景没有进入等待");
    production.socket.terminate();
    assert.equal((await disconnectedWorker).state, "failed");
    assert.equal(state().request.queueId, null);
    note("native_transport_disconnected", { requestId: disconnected.id, state: state().request.state });
  } finally { production.close(); }
} catch (cause) {
  error = cause;
  note("failed", { message: cause.message });
  process.exitCode = 2;
} finally {
  holdRelease?.();
  heldWake?.release();
  client?.terminate();
  observer?.terminate();
  if (env) {
    try { note("daemon_stop", await cli(["app-server", "daemon", "stop"])); }
    catch (cause) { note("cleanup_failed", { message: cause.message }); }
  }
  // pid 后端的更新循环不会随 daemon stop 立即退出，仅清理本探针的精确进程身份。
  for (const identity of ownedManagers) {
    try {
      const fields = readFileSync(`/proc/${identity.pid}/stat`, "utf8").split(") ").at(-1).split(" ");
      const args = readFileSync(`/proc/${identity.pid}/cmdline`, "utf8").split("\0");
      if (fields[19] === identity.birth && args[0].startsWith(`${root}/`)) process.kill(identity.pid, "SIGTERM");
    } catch { /* 已退出或身份变化不再发送信号。 */ }
  }
  await sleep(200);
  note("test_managers_cleaned", { sampled: ownedManagers.length });
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  writeFileSync(evidence, `${JSON.stringify({ root, threadId, modelFixture: "gpt-5.4（本地模型替身，无外部模型调用）", failed: error?.message, runs, claims, events }, null, 2)}\n`);
  process.stdout.write(`证据：${evidence}\n`);
}
