/**
 * 核对真实 managed daemon 的队列、撤回和唤醒；模型端仅使用本地替身。
 * @module managed-queue-probe
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createConnection } from "node:net";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import { setTimeout as sleep } from "node:timers/promises";
import { gunzipSync, inflateSync, brotliDecompressSync } from "node:zlib";
import { WebSocket } from "ws";
import { buildCodexResponseEvents, encodeCodexSse } from "./codex-response-events.mjs";

const evidence = path.join(path.dirname(fileURLToPath(import.meta.url)), "managed-queue-result.json");
const root = mkdtempSync(path.join(tmpdir(), "flower-managed-queue-"));
const project = path.join(root, "project");
const probeHome = path.join(root, "codex-home");
const socket = path.join(probeHome, "app-server-control", "app-server-control.sock");
for (const directory of [project, probeHome]) mkdirSync(directory, { recursive: true });
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
    const messages = (Array.isArray(body.input) ? body.input : []).filter(item => item.role === "user");
    const input = JSON.stringify(messages.at(-1) ?? "");
    const kind = input.includes("WAKE_PROBE_TIMEOUT") ? "timeout"
      : input.includes("WAKE_PROBE_HOLD") ? "hold" : input.includes("WAKE_PROBE_INITIAL") ? "initial" : "auxiliary";
    note("model_request", { kind });
    if (kind === "hold") {
      heldRequest = true;
      await new Promise(resolve => { holdRelease = resolve; });
    }
    res.writeHead(200, { "content-type": "text/event-stream", connection: "close" });
    res.end(encodeCodexSse(buildCodexResponseEvents({ sequence: ++sequence, text: `WAKE_PROBE_${kind.toUpperCase()}_DONE` })));
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
  writeFileSync(path.join(probeHome, "config.toml"), `model = "gpt-6.1-sol"
model_provider = "probe"
approval_policy = "never"
sandbox_mode = "read-only"
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
  threadId = (await rpc("thread/start", { cwd: project, model: "gpt-6.1-sol", modelProvider: "probe", approvalPolicy: "never", sandbox: "read-only" })).thread.id;
  note("thread_created", { threadId });
  const initial = await rpc("turn/start", { threadId, input: [{ type: "text", text: "WAKE_PROBE_INITIAL" }] });
  await completed(initial.turn.id);
  note("initial_idle");
  observer = new WebSocket("ws://localhost/", { createConnection: () => createConnection({ path: socket }) });
  await new Promise((resolve, reject) => { observer.once("open", resolve); observer.once("error", reject); });
  observer.on("message", data => observed.push(JSON.parse(data)));
  await rpc("initialize", { clientInfo: { name: "flower_background_observer", version: "0" }, capabilities: { experimentalApi: true } }, observer, observed);
  observer.send(JSON.stringify({ method: "initialized" }));
  const resumed = await rpc("thread/resume", { threadId }, observer, observed);
  note("observer_attached", { threadId: resumed.thread.id, status: resumed.thread.status });


  const hold = await rpc("turn/start", { threadId, input: [{ type: "text", text: "WAKE_PROBE_HOLD" }] });
  await until(() => heldRequest, "模拟当前回合没有进入活动状态");
  note("observer_user_events", { packets: observed.filter(item => item.params?.item?.type === "userMessage") });
  assert.ok(observed.some(item => item.params?.item?.type === "userMessage"), "订阅连接没有用户消息事件");
  const queued = { threadId, clientUserMessageId: "same-probe-client-id", input: [{ type: "text", text: "WAKE_PROBE_CANCELLED" }] };
  const first = await rpc("thread/queue/add", queued);
  let second;
  try { second = await rpc("thread/queue/add", queued); }
  catch (cause) { second = { rejected: cause.message }; }
  const list = await rpc("thread/queue/list", { threadId });
  note("duplicate_client_id", { first, second, queue: list });
  for (const item of list.data) {
    await rpc("thread/queue/delete", { threadId, queuedSubmissionId: item.id });
  }
  const afterDelete = await rpc("thread/queue/list", { threadId });
  assert.equal(afterDelete.data.length, 0);
  note("queue_deleted", { count: list.data.length });
  holdRelease();
  await completed(hold.turn.id);

  await sleep(500);
  const beforeWake = events.filter(item => item.event === "model_request" && item.kind === "timeout").length;
  const queuedCli = await cli(["queue", "--thread", threadId, "--message", "WAKE_PROBE_TIMEOUT", "--resume"]);
  note("queue_cli_returned", queuedCli);
  assert.equal(queuedCli.code, 0);
  await until(() => events.filter(item => item.event === "model_request" && item.kind === "timeout").length > beforeWake,
    "入队后没有观察到目标会话发起新模型请求");
  await sleep(500);
  note("wake_observed", { count: events.filter(item => item.event === "model_request" && item.kind === "timeout").length });
  const beforeDirect = events.filter(item => item.event === "model_request" && item.kind === "timeout").length;
  const direct = await rpc("thread/queue/add", { threadId, clientUserMessageId: "direct-probe-client-id",
    input: [{ type: "text", text: "WAKE_PROBE_TIMEOUT_DIRECT" }] });
  await sleep(200);
  const autoStarted = events.filter(item => item.event === "model_request" && item.kind === "timeout").length > beforeDirect;
  note("direct_queue_added", { id: direct.queuedSubmission.id, autoStarted });
  if (!autoStarted) {
    const activated = await rpc("thread/queue/start", { threadId, queuedSubmissionId: direct.queuedSubmission.id });
    note("direct_queue_started", { turnId: activated.turn.id });
    await completed(activated.turn.id);
  }
  await until(() => events.filter(item => item.event === "model_request" && item.kind === "timeout").length > beforeDirect,
    "指定队列项没有启动新回合");
  try {
    const again = await rpc("thread/queue/start", { threadId, queuedSubmissionId: direct.queuedSubmission.id });
    note("consumed_queue_start_again", { accepted: true, turnId: again.turn?.id });
  } catch (cause) {
    note("consumed_queue_start_again", { accepted: false, message: cause.message });
  }
  await sleep(300);
  assert.equal(events.filter(item => item.event === "model_request" && item.kind === "timeout").length, beforeDirect + 1);
} catch (cause) {
  error = cause;
  note("failed", { message: cause.message });
  process.exitCode = 2;
} finally {
  holdRelease?.();
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
  writeFileSync(evidence, `${JSON.stringify({ root, threadId, failed: error?.message, events }, null, 2)}\n`);
  process.stdout.write(`证据：${evidence}\n`);
}
