import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import { createConnection } from "node:net";
import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib";
import { setTimeout as sleep } from "node:timers/promises";
import { spawn as spawnPty } from "node-pty";
import { WebSocket } from "ws";
import { buildCodexResponseEvents, encodeCodexSse } from "./confirmation-mock.mjs";
import { createNativeWorkflow } from "./confirmation-native-workflow.mjs";

const [mode = "open", gate = "check", secondsText = "3", cli = "codex"] = process.argv.slice(2);
const solo = mode === "solo-close";
const seconds = Number(secondsText);
const repo = fileURLToPath(new URL("../..", import.meta.url));
const root = fs.mkdtempSync(path.join(os.tmpdir(), "flower-confirm-codex-"));
const project = path.join(root, "project");
const home = path.join(root, "home");
const codexHome = path.join(home, ".codex");
const socket = path.join(codexHome, "app-server-control", "app-server-control.sock");
const upstream = path.join(root, "daemon.sock");
const bin = path.join(root, "bin");
const tmp = path.join(root, "tmp");
const runtime = path.join(project, ".trellis/.runtime/confirmations");
const start = "FLOWER_CONFIRM_STOCK_CODEX_START";
const marker = "TrellisStockCodexReviewEnd";
const done = "FLOWER_CONFIRM_STOCK_CODEX_DONE";
const human = "FLOWER_CONFIRM_STOCK_CODEX_HUMAN";
const firstAt = Date.now();
const note = (event, data = {}) => console.log(JSON.stringify({ event, ms: Date.now() - firstAt, ...data }));
for (const dir of [project, bin, tmp, path.dirname(socket)]) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
fs.symlinkSync(path.join(repo, "bin/flower-trellis.js"), path.join(bin, "ftl"));

function audit() {
  try {
    return fs.readdirSync(runtime).filter(f => f.endsWith(".jsonl"))
      .flatMap(f => fs.readFileSync(path.join(runtime, f), "utf8").trim().split("\n").map(JSON.parse));
  } catch { return []; }
}

async function until(fn, message, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await fn();
    if (value) return value;
    await sleep(30);
  }
  throw new Error(message);
}

/** 从唯一的隔离转录读取线程 ID，单窗口用例因此不需要第二条连接。 */
function readSoloThread() {
  const sessions = path.join(codexHome, "sessions");
  try {
    const rollouts = fs.readdirSync(sessions, { recursive: true })
      .filter(file => path.basename(file).startsWith("rollout-") && file.endsWith(".jsonl"));
    if (rollouts.length !== 1) return null;
    const first = JSON.parse(fs.readFileSync(path.join(sessions, rollouts[0]), "utf8").split("\n", 1)[0]);
    if (first.type === "session_meta" && typeof first.payload?.id === "string") return first.payload.id;
  } catch (error) {
    if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
  }
  return null;
}

function unpack(value) {
  if (typeof value === "string") {
    for (const line of value.split("\n")) {
      try { const result = unpack(JSON.parse(line)); if (result) return result; } catch { /* 普通工具文本不含结果。 */ }
    }
  } else if (value && typeof value === "object") {
    if (value.protocol === 1 || value.request_id || value.manual) return value;
    for (const entry of Object.values(value)) { const result = unpack(entry); if (result) return result; }
  }
  return null;
}

let step = 0;
let sequence = 0;
let prepared;
let workflow;
let received;
let thread;
let serverError;
let lastToolId;
let offered = false;
let delivered = false;
let replayChecked = false;
const server = createServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== "/v1/responses") return res.writeHead(403).end();
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    let body = Buffer.concat(chunks);
    const encoding = req.headers["content-encoding"];
    if (encoding === "gzip") body = gunzipSync(body);
    if (encoding === "deflate") body = inflateSync(body);
    if (encoding === "br") body = brotliDecompressSync(body);
    const request = JSON.parse(body);
    const tools = [...(request.tools || []), ...request.input.filter(item => item.type === "additional_tools")
      .flatMap(item => item.tools || [])].flatMap(item => item.type === "namespace"
      ? item.tools.map(tool => ({ ...tool, namespace: item.name })) : [item]);
    const shell = tools.find(tool => tool.type === "function" && tool.name === "exec_command");
    const code = tools.find(tool => tool.type === "custom" && tool.namespace === "functions" && tool.name === "exec");
    const send = reply => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(encodeCodexSse(buildCodexResponseEvents({ sequence: ++sequence, ...reply })));
    };
    const input = JSON.stringify(request.input);
    if (input.includes(human)) {
      note("human_received");
      return send({ text: "已收到人工回复" });
    }
    if (!input.includes(start) || (!shell && !code)) return send({ text: "夹具就绪" });
    assert.ok(!tools.some(tool => /flower.*confirm|trellis_confirmation/.test(tool.name || "")));
    const results = request.input.filter(item => item.call_id === lastToolId && item.type?.endsWith("output"));
    const result = results.map(item => unpack(item.output)).find(Boolean);
    if (step > 0 && !results.length) return send({ text: "夹具就绪" });
    const pending = JSON.stringify(results.at(-1)?.output || "").match(/Script running with cell ID ([A-Za-z0-9_.-]+)/);
    if (pending) {
      const wait = tools.find(tool => tool.type === "function" && tool.name === "wait" && tool.namespace === "functions");
      assert.ok(wait, "Code Mode 没有等待同一单元的工具");
      return send({ toolCall: { type: "function", name: wait.name, namespace: wait.namespace,
        callId: lastToolId = `call_flower_poll_${sequence}`, arguments: { cell_id: pending[1], yield_time_ms: 30000 } } });
    }
    const session = JSON.stringify(results.at(-1)?.output || "").match(/Process running with session ID (\d+)/);
    if (session) {
      const poll = tools.find(tool => tool.type === "function" && tool.name === "write_stdin");
      assert.ok(poll, "Codex 没有等待同一命令进程的工具");
      return send({ toolCall: { type: "function", name: poll.name, namespace: poll.namespace,
        callId: lastToolId = `call_flower_poll_${sequence}`,
        arguments: { session_id: Number(session[1]), chars: "", yield_time_ms: 10000, max_output_tokens: 8000 } } });
    }
    const run = (cmd, planText) => {
      const callId = lastToolId = `call_flower_confirm_${step}`;
      const args = { cmd, workdir: project, login: false, tty: false, yield_time_ms: 10000, max_output_tokens: 8000 };
      const toolCall = shell ? { type: "function", name: shell.name, namespace: shell.namespace, arguments: args, callId }
        : { type: "custom", name: code.name, namespace: code.namespace, callId,
          input: `// @exec: {"yield_time_ms": ${(seconds + 25) * 1000}}
const shell = ALL_TOOLS.find(t => /(^|[_.])exec_command$/.test(t.name));
const poll = ALL_TOOLS.find(t => /(^|[_.])write_stdin$/.test(t.name));
let result = await tools[shell.name](${JSON.stringify(args)});
while (result.session_id) result = await tools[poll.name]({session_id: result.session_id, chars: "", yield_time_ms: 10000, max_output_tokens: 8000});
text(result);` };
      send({ planText, toolCall });
    };
    if (step === 0) {
      offered = true;
      step++;
      return run("ftl confirm status");
    }
    if (step === 1 && result?.ready) {
      assert.equal(result.platform, "codex");
      assert.ok(result.enabled);
      await until(() => thread, "缺少真实共享线程");
      const spec = workflow.prepare(`codex_${thread}`);
      step++;
      return run(`ftl confirm prepare <<'FTL_CONFIRM_SPEC'\n${JSON.stringify(spec)}\nFTL_CONFIRM_SPEC`);
    }
    if (step === 2 && result?.review) {
      prepared = result;
      assert.equal(prepared.seconds, seconds);
      step++;
      const review = mode === "partial" ? prepared.review.split("\n").slice(-3).join("\n") : prepared.review;
      return run(`ftl confirm ${prepared.request_id}`, review);
    }
    if (step === 3 && result?.source === "policy_timeout") {
      assert.equal(result.request_id, prepared.request_id);
      if (mode === "late") {
        delivered = true;
        await sleep(1250);
        if (!res.destroyed) return run("touch unintended-action");
        return;
      }
      assert.equal(mode, "open");
      workflow.apply(result);
      received = result;
      step++;
      return run(`ftl confirm finish ${prepared.request_id} completed`);
    }
    if (step === 4) {
      assert.equal(result?.outcome, "completed");
      if (gate === "check") {
        step++;
        return run(`ftl confirm ${prepared.request_id}`, prepared.review);
      }
    } else if (step === 5) {
      assert.equal(result?.manual, true);
      assert.match(result.error, /已等待/);
      replayChecked = true;
    } else if (mode === "partial") assert.equal(result?.manual, true);
    else if (mode === "open") note("unexpected", { step, result,
      output: results.at(-1)?.output?.slice?.(-850) });
    return send({ text: done });
  } catch (error) {
    serverError = error;
    note("error", { message: error.message });
    res.writeHead(500).end();
  }
});
server.on("connect", (_req, socket) => socket.destroy());

const windows = [];
const packets = [];
let daemon, witness, observer;
let diagnostic = "";
try {
  await new Promise((ok, no) => { server.once("error", no); server.listen(0, "127.0.0.1", ok); });
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  const env = { PATH: [bin, path.dirname(process.execPath), process.env.PATH].join(":"), HOME: home, CODEX_HOME: codexHome,
    TERM: "xterm-256color", TMPDIR: tmp, FLOWER_NO_TELEMETRY: "1", FLOWER_NATIVE_PROBE_KEY: "local-mock-only",
    NO_PROXY: "127.0.0.1,localhost,::1", no_proxy: "127.0.0.1,localhost,::1" };
  if (process.env.FLOWER_TEST_PYTHON) env.FLOWER_TEST_PYTHON = process.env.FLOWER_TEST_PYTHON;
  for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]) env[key] = endpoint;
  const options = { cwd: project, env, stdio: ["ignore", "ignore", "pipe"] };
  assert.equal(execFileSync(cli, ["--version"], { cwd: project, env, encoding: "utf8" }).trim(), "codex-cli 0.167.0");
  workflow = createNativeWorkflow({ project, repo, env, platform: "codex", gate, seconds, marker, defaultPolicy: seconds >= 100 });
  fs.writeFileSync(path.join(codexHome, "config.toml"), `model = "gpt-6.1-sol"
model_provider = "probe"
approval_policy = "on-request"
sandbox_mode = "workspace-write"
check_for_update_on_startup = false
web_search = "disabled"
[model_providers.probe]
name = "隔离模型"
base_url = "${endpoint}/v1"
wire_api = "responses"
env_key = "FLOWER_NATIVE_PROBE_KEY"
requires_openai_auth = false
supports_websockets = false
[projects.${JSON.stringify(project)}]
trust_level = "trusted"
[features]
hooks = false
apps = false
plugins = false
memories = false
code_mode = false
api_key_model_discovery = false
shell_snapshot = false
`);
  const err = child => child.stderr.on("data", chunk => { diagnostic = (diagnostic + chunk).slice(-1600); });
  daemon = spawn(cli, ["app-server", "--managed-daemon", "--listen", `unix://${upstream}`], options);
  err(daemon);
  await until(() => fs.statSync(upstream, { throwIfNoEntry: false })?.isSocket(), "原版共享 App Server 未启动");
  witness = spawn(process.execPath, [path.join(repo, "bin/flower-trellis.js"), "confirm", "witness",
    "--upstream", upstream, "--listen", socket], { ...options, stdio: ["ignore", "pipe", "pipe"] });
  err(witness);
  witness.stdout.on("data", chunk => { diagnostic = (diagnostic + chunk).slice(-1600); });
  await until(() => fs.statSync(socket, { throwIfNoEntry: false })?.isSocket(), "正式见证未启动");

  let rpcId = 0;
  async function rpc(method, params) {
    const id = ++rpcId;
    observer.send(JSON.stringify({ id, method, params }));
    const reply = await until(() => packets.find(item => item.id === id && !item.method), `共享服务没有响应 ${method}`);
    assert.ok(!reply.error, JSON.stringify(reply.error));
    return reply.result;
  }
  if (!solo) {
    observer = new WebSocket("ws://localhost/", { createConnection: () => createConnection({ path: upstream }) });
    await new Promise((ok, no) => { observer.once("open", ok); observer.once("error", no); });
    observer.on("message", data => packets.push(JSON.parse(data)));
    await rpc("initialize", { clientInfo: { name: "flower_confirmation_observer", version: "1" }, capabilities: { experimentalApi: true } });
    observer.send(JSON.stringify({ method: "initialized" }));
  }

  function open(args) {
    const win = { screen: "", reviewAt: null, exited: false };
    win.pty = spawnPty(cli, args, { cwd: project, env, cols: 115, rows: 48, name: "xterm-256color" });
    windows.push(win);
    win.pty.onExit(() => { win.exited = true; });
    win.pty.onData(data => {
      if (data.includes("\x1b[6n")) win.pty.write("\x1b[1;1R");
      if (data.includes("\x1b[c")) win.pty.write("\x1b[?1;2c");
      win.screen = (win.screen + data.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")).slice(-14000);
      if (!win.reviewAt && win.screen.includes(marker)) win.reviewAt = Date.now();
    });
    return win;
  }
  const win = open([start]);
  await until(() => offered, "原版 Codex 未收到内置 Shell 工具");
  thread = await until(solo ? readSoloThread : async () => (await rpc("thread/loaded/list", {})).data[0], "原版 App Server 未加载线程");
  if (!solo) await rpc("thread/resume", { threadId: thread });
  if (mode === "partial") {
    await until(() => win.screen.includes(done), "未收到正文裁剪的人工回退");
    assert.ok(!audit().some(event => event.event === "waiting"));
  } else {
    const waiting = await until(() => audit().find(event => event.event === "waiting"), "正式命令未开始等待");
    assert.ok(win.reviewAt && win.reviewAt <= Date.parse(waiting.at), "真实终端先显示正文再开始等待");
    note("waiting", { seconds, gate });
    if (mode === "open") {
      await until(() => audit().some(event => event.event === "finished") && (gate !== "check" || replayChecked),
        "未收到真实领取、完成或拒绝重复的记录", (seconds + 18) * 1000);
      assert.ok(Date.parse(audit().find(event => event.event === "claimed").at) >= Date.parse(waiting.at) + seconds * 1000);
    }
    else if (mode === "late") {
      await until(() => delivered, "本次试验未跨过领取点");
      win.pty.kill("SIGKILL");
      await until(() => packets.some(item => item.method === "turn/completed" && item.params.threadId === thread
        && item.params.turn?.status === "interrupted"), "共享服务未中断已断开的原回合");
      await sleep(1500);
      assert.ok(!fs.existsSync(path.join(project, "unintended-action")));
    } else {
      if (mode === "edge") await sleep(Math.max(0, Date.parse(waiting.at) + seconds * 1000 - 220 - Date.now()));
      if (solo || ["kill", "resume"].includes(mode)) {
        win.pty.kill(solo ? "SIGHUP" : "SIGKILL");
        await until(() => win.exited, "原 Codex 窗口未关闭");
        if (mode === "resume") {
          const other = open(["resume", thread]);
          await until(() => other.screen.includes(start), "新窗口未恢复原历史");
        }
      } else if (["escape", "edge"].includes(mode)) win.pty.write("\x1b");
      else if (mode === "reply") {
        win.pty.write(human);
        await sleep(120);
        win.pty.write("\r");
      } else if (mode === "changed") fs.appendFileSync(path.join(project, ".trellis/config.yaml"), "\nconfirmation_timeout: false\n");
      await sleep(Math.max(0, Date.parse(waiting.at) + seconds * 1000 + 1000 - Date.now()));
    }
  }
  if (serverError) throw serverError;
  assert.equal(Boolean(received), mode === "open");
  assert.equal(audit().filter(event => event.event === "claimed").length, ["open", "late"].includes(mode) ? 1 : 0);
  assert.ok(workflow.verify(mode === "open"));
  if (solo) {
    assert.equal(observer, undefined);
    assert.ok(daemon.exitCode === null && daemon.signalCode === null && fs.statSync(upstream).isSocket(),
      "唯一窗口关掉后共享后台必须仍在线");
  } else {
    assert.ok((await rpc("thread/loaded/list", {})).data.includes(thread), "原共享服务和旁观订阅仍在线");
  }
  note("passed", { mode, gate, seconds, audit: audit().map(event => event.event),
    sharedStillLive: true, observerAttached: Boolean(observer) });
} catch (error) {
  note("failed", { error: error.message, root, step, terminal: windows.map(win => win.screen.slice(-950)), audit: audit(), diagnostic });
  process.exitCode = 2;
} finally {
  for (const win of windows) if (!win.exited) win.pty.kill("SIGKILL");
  observer?.terminate();
  if (witness?.exitCode === null) witness.kill("SIGTERM");
  if (daemon?.exitCode === null) daemon.kill("SIGKILL");
  server.closeAllConnections();
  await new Promise(ok => server.close(ok));
  if (!process.exitCode) fs.rmSync(root, { recursive: true, force: true });
}
