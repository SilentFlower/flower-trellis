/**
 * 旁观独立前台入口与真实 Harness 的 MCP 等待行为；全部模型响应只来自本机 mock。
 * @module mcp-wait-probe
 */
import fs from "node:fs";
import path from "node:path";
import { createServer } from "node:http";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { gunzipSync, inflateSync, brotliDecompressSync } from "node:zlib";
import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
import { handleCodexRequest, encodeCodexSse, CODEX_PROBE_DUMMY } from "./codex-mcp-adapter.mjs";
import { createClaudeToolCall, sendClaudeMessage } from "./claude-mcp-adapter.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../../..");
const args = process.argv.slice(2);
const option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const harness = option("--harness", "codex");
const scenario = option("--scenario", "timeout");
const waitMs = Number(option("--wait-ms", "3000"));
if (!args.includes("--run")) {
  process.stdout.write("隔离实验用法：--run --harness codex|claude --scenario timeout|human-input|close-window|kill-controller|kill-harness [--wait-ms 3000] [--setup-input]\n");
  process.exit(0);
}
if (process.platform !== "linux" || !["codex", "claude"].includes(harness)
  || !["timeout", "human-input", "close-window", "kill-controller", "kill-harness"].includes(scenario)
  || !Number.isInteger(waitMs) || waitMs < 1500 || waitMs > 200000) throw new Error("实验参数无效");
const scratchBase = path.join(root, ".trellis-tmp");
fs.mkdirSync(scratchBase, { recursive: true });
const reuse = option("--reuse-scratch", null);
const sandbox = reuse ? fs.realpathSync(reuse) : fs.mkdtempSync(path.join(scratchBase, `confirmation-timeout-mcp-${harness}-`));
if (path.dirname(sandbox) !== scratchBase || !path.basename(sandbox).startsWith(`confirmation-timeout-mcp-${harness}-`)) throw new Error("只能复用对应Harness的实验目录");
execFileSync("git", ["init", "--quiet", sandbox]);
const attempt = randomUUID();
const eventsPath = path.join(sandbox, `events-${attempt}.jsonl`);
const began = performance.now();
const state = { mainRequests: 0, auxiliaryRequests: 0, decisions: [], markers: [], waitStarted: false,
  waitStartedAt: null, controllerExited: false, harnessPid: null, requestedAfterExit: 0, toolSummary: null,
  violation: false, context: [], setupInputs: 0 };
const codexState = {};
const owned = new Map();
const sockets = new Set();
const scheduled = new Set();
let controller;
let controllerBuffer = "";
let finished = false;
let stop;
let claudeCall;
let setupHandler;
let monitor;
let deadline;
const done = new Promise((resolve) => { stop = resolve; });

/**
 * 保存不含提示正文、header、环境和 nonce 的摘要。
 * @param {string} event 事件名。
 * @param {object} details 白名单详情。
 * @returns {void}
 */
function record(event, details = {}) {
  const item = { time_ms: Math.round(performance.now() - began), event, ...details };
  fs.appendFileSync(eventsPath, `${JSON.stringify(item)}\n`);
  process.stdout.write(`${JSON.stringify(item)}\n`);
}

/**
 * 读取 Linux 自有进程身份，避免 PID 重用造成误清理。
 * @param {number} pid 自有进程标识。
 * @returns {object|null} 进程启动身份。
 */
function identity(pid) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    const fields = stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/);
    return { pid, birth: fields[19], state: fields[0] };
  } catch { return null; }
}

/**
 * 只枚举已知自有进程的后代，不查看其他会话命令或环境。
 * @returns {void}
 */
function discover() {
  const queue = [...owned.keys()];
  const visited = new Set();
  while (queue.length && visited.size < 256) {
    const pid = queue.shift();
    if (visited.has(pid)) continue;
    visited.add(pid);
    if (identity(pid)?.birth !== owned.get(pid)?.birth) continue;
    try {
      for (const tid of fs.readdirSync(`/proc/${pid}/task`)) {
        const children = fs.readFileSync(`/proc/${pid}/task/${tid}/children`, "utf8").trim();
        for (const number of children ? children.split(/\s+/).map(Number) : []) {
          const child = identity(number);
          if (child) { owned.set(number, child); queue.push(number); }
        }
      }
    } catch { /* 自有进程退出可与旁观枚举竞争。 */ }
  }
}

/**
 * 计划一个有界观察动作，最终统一清理计时器。
 * @param {Function} callback 实验动作。
 * @param {number} ms 等待时间。
 * @returns {void}
 */
function later(callback, ms) {
  const timer = setTimeout(callback, ms);
  scheduled.add(timer);
}

/**
 * 向自有前台入口发送人工输入或关闭命令。
 * @param {object} command 研究控制消息。
 * @returns {void}
 */
function send(command) {
  if (controller?.stdin.writable) controller.stdin.write(`${JSON.stringify(command)}\n`);
}

/**
 * 只从结构化工具结果递归提取本探针决定。
 * @param {unknown} value 工具结果。
 * @param {number} depth 避免无界嵌套。
 * @returns {object|null} 已验证的决定片段。
 */
function outcome(value, depth = 0) {
  if (depth > 12) return null;
  if (typeof value === "string") {
    try { return outcome(JSON.parse(value), depth + 1); } catch { return null; }
  }
  if (!value || typeof value !== "object") return null;
  if (value.request_id === "probe" && ["policy_timeout", "cancelled"].includes(value.source)) return value;
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    const found = outcome(child, depth + 1);
    if (found) return found;
  }
  return null;
}

/**
 * 处理控制器白名单事件，并在真正进入等待后触发场景。
 * @param {object} event 控制器日志。
 * @returns {void}
 */
function controlEvent(event) {
  record(`controller:${event.event}`, { detail: event });
  if (event.event === "harness_started") {
    state.harnessPid = event.pid;
    const proc = identity(event.pid);
    if (proc) owned.set(proc.pid, proc);
  }
  if (event.event === "decision") state.decisions.push(event);
  if (event.event === "visible_marker") {
    state.markers.push(event.marker);
    if (["FLOWER_MCP_CONTINUED", "FLOWER_MCP_CANCELLED", "FLOWER_MCP_UNVERIFIED"].includes(event.marker) && scenario === "timeout") {
      later(() => stop("结果标记已出现"), 500);
    }
  }
  if (event.event === "wait_started" && !state.waitStarted) {
    state.waitStarted = true;
    state.waitStartedAt = performance.now() - began;
    if (scenario !== "timeout") {
      later(() => {
        discover();
        if (scenario === "human-input") send({ type: "input", text: "FLOWER_HUMAN_CANCEL 取消本次默认决定\r" });
        else if (scenario === "close-window") send({ type: "close" });
        else {
          const pid = scenario === "kill-controller" ? controller.pid : state.harnessPid;
          if (identity(pid)?.birth === owned.get(pid)?.birth) process.kill(pid, "SIGKILL");
        }
        record("scenario_triggered", { scenario });
      }, 500);
      later(() => stop("原截止时间及退出观察窗口已结束"), waitMs + 4000);
    }
  }
}

const server = createServer(async (request, response) => {
  const expected = harness === "codex" ? "/v1/responses" : "/v1/messages";
  if (request.method !== "POST" || request.url?.split("?")[0] !== expected) {
    response.writeHead(403).end();
    return;
  }
  try {
    if (harness === "codex" && request.headers.authorization !== `Bearer ${CODEX_PROBE_DUMMY}`) {
      state.violation = true; response.writeHead(403).end(); return stop("dummy认证不匹配");
    }
    let size = 0;
    const chunks = [];
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 16 * 1024 * 1024) throw new Error("请求超过上限");
      chunks.push(chunk);
    }
    let data = Buffer.concat(chunks);
    if (request.headers["content-encoding"] === "gzip") data = gunzipSync(data);
    else if (request.headers["content-encoding"] === "deflate") data = inflateSync(data);
    else if (request.headers["content-encoding"] === "br") data = brotliDecompressSync(data);
    const body = JSON.parse(data.toString("utf8"));
    if (harness === "codex") {
      const result = handleCodexRequest(body, codexState);
      if (result.auxiliary) state.auxiliaryRequests++;
      else {
        state.mainRequests++;
        if (state.controllerExited) state.requestedAfterExit++;
        state.toolSummary = result.toolSummary;
        record("model_request", { number: state.mainRequests, phase: result.phase, tool_summary: result.toolSummary, summary: result.summary });
      }
      response.writeHead(200, { "content-type": "text/event-stream", connection: "close" });
      response.end(encodeCodexSse(result.events));
    } else {
      const tools = Array.isArray(body.tools) ? body.tools : [];
      const main = tools.some((tool) => tool.name?.includes("flower_confirmation_probe"));
      if (!main) {
        state.auxiliaryRequests++;
        record("auxiliary_request", { tool_names: tools.map((tool) => tool.name) });
        return sendClaudeMessage(response, body, [{ type: "text", text: "FLOWER_AUXILIARY" }]);
      }
      state.mainRequests++;
      if (state.controllerExited) state.requestedAfterExit++;
      if (!claudeCall) {
        claudeCall = createClaudeToolCall(body, "probe");
        if (!claudeCall) throw new Error("实际工具未暴露或不匹配");
        const definition = tools.find((tool) => tool.name === claudeCall.name);
        state.toolSummary = { name: claudeCall.name, definitionBytes: Buffer.byteLength(JSON.stringify(definition)) };
        fs.writeFileSync(path.join(sandbox, "exposed-wait-tool.json"), `${JSON.stringify(definition)}\n`);
        record("model_request", { number: state.mainRequests, phase: "waiting", tool_summary: state.toolSummary });
        sendClaudeMessage(response, body, [{ type: "text", text: "FLOWER_MCP_PLAN" }, claudeCall]);
      } else {
        const blocks = (body.messages || []).flatMap((message) => Array.isArray(message.content) ? message.content : []);
        const result = blocks.find((block) => block.type === "tool_result" && block.tool_use_id === claudeCall.id);
        const decision = outcome(result?.content);
        const marker = decision?.source === "policy_timeout" ? "FLOWER_MCP_CONTINUED"
          : decision?.source === "cancelled" ? "FLOWER_MCP_CANCELLED" : "FLOWER_MCP_UNVERIFIED";
        record("model_request", { number: state.mainRequests, phase: decision?.source || "unverified", tool_error: Boolean(result?.is_error) });
        sendClaudeMessage(response, body, [{ type: "text", text: marker }]);
      }
    }
  } catch (error) {
    state.violation = true;
    record("mock_error", { category: error?.name || "未知" });
    if (!response.headersSent) response.writeHead(422);
    response.end();
    stop("mock协议或工具核验失败");
  }
});
server.on("connection", (socket) => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); socket.on("error", () => socket.destroy()); });
server.on("connect", (_request, socket) => socket.end("HTTP/1.1 403 Forbidden\r\n\r\n"));
server.on("clientError", (_error, socket) => socket.destroy());
const interrupted = () => stop("旁观器被中断");
process.once("SIGTERM", interrupted);
process.once("SIGINT", interrupted);
try {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const configPath = path.join(sandbox, "controller.json");
  fs.writeFileSync(configPath, JSON.stringify({ harness, sandbox, mockPort: server.address().port, waitMs }));
  controller = spawn(process.execPath, [path.join(here, "mcp-session-controller.mjs"), configPath], { cwd: root,
    env: process.env, stdio: ["pipe", "pipe", "pipe"] });
  const proc = identity(controller.pid);
  if (proc) owned.set(proc.pid, proc);
  controller.stdin.on("error", () => {});
  controller.stdout.on("data", (chunk) => {
    controllerBuffer += chunk.toString("utf8");
    while (controllerBuffer.includes("\n")) {
      const end = controllerBuffer.indexOf("\n");
      const line = controllerBuffer.slice(0, end);
      controllerBuffer = controllerBuffer.slice(end + 1);
      try { controlEvent(JSON.parse(line)); } catch { state.violation = true; }
    }
  });
  controller.stderr.on("data", (chunk) => record("controller_diagnostic", { text: chunk.toString("utf8")
    .replace(/\/root\/[^\s]+/g, "[本地路径]").replace(/sk-[\w-]+/g, "[已隐藏]").slice(0, 500) }));
  controller.on("exit", () => { state.controllerExited = true; record("controller_exited"); if (!state.waitStarted) stop("进入等待之前入口退出"); });
  monitor = setInterval(discover, 100);
  later(() => { if (!state.waitStarted) send({ type: "diagnostic" }); }, 12000);
  deadline = setTimeout(() => stop("实验总超时"), waitMs + 45000);
  if (args.includes("--setup-input") && process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    setupHandler = (data) => { if (!state.waitStarted) { state.setupInputs++; send({ type: "input", text: data.toString("utf8") }); } };
    process.stdin.on("data", setupHandler);
  }
  record("probe_started", { harness, scenario, wait_ms: waitMs, sandbox, events_path: eventsPath, controller_pid: controller.pid, model: "仅回环mock，无真实推理" });
  const reason = await done;
  finished = true;
  const continued = state.markers.includes("FLOWER_MCP_CONTINUED");
  const harnessNow = identity(state.harnessPid);
  const harnessAlive = Boolean(harnessNow && harnessNow.birth === owned.get(state.harnessPid)?.birth && harnessNow.state !== "Z");
  const timeoutPassed = state.waitStarted && !state.violation && continued
    && state.decisions.length === 1 && state.decisions[0].source === "policy_timeout";
  const cancelPassed = state.waitStarted && !state.violation && !continued && state.requestedAfterExit === 0
    && (scenario === "human-input" ? state.decisions.length === 1 && state.decisions[0].source === "cancelled"
      : state.controllerExited && !harnessAlive);
  const passed = scenario === "timeout" ? timeoutPassed : cancelPassed;
  const result = { passed, reason, harness, scenario, wait_ms: waitMs, harness_alive_at_result: harnessAlive, ...state };
  fs.writeFileSync(path.join(sandbox, `result-${attempt}.json`), `${JSON.stringify(result, null, 2)}\n`);
  record("probe_result", { passed, reason, main_requests: state.mainRequests, tool_summary: state.toolSummary });
  process.exitCode = passed ? 0 : 2;
} finally {
  clearInterval(monitor);
  clearTimeout(deadline);
  for (const timer of scheduled) clearTimeout(timer);
  if (setupHandler) { process.stdin.off("data", setupHandler); process.stdin.setRawMode(false); process.stdin.pause(); }
  discover();
  send({ type: "close" });
  await new Promise((resolve) => setTimeout(resolve, 800));
  for (const signal of ["SIGTERM", "SIGKILL"]) {
    for (const proc of [...owned.values()].reverse()) {
      if (identity(proc.pid)?.birth === proc.birth) try { process.kill(proc.pid, signal); } catch { /* 只清自有进程。 */ }
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  for (const socket of sockets) socket.destroy();
  await new Promise((resolve) => server.close(resolve));
  process.off("SIGTERM", interrupted);
  process.off("SIGINT", interrupted);
  record("probe_cleaned", { finished, live_processes: [...owned.values()].filter((proc) => identity(proc.pid)?.birth === proc.birth && identity(proc.pid)?.state !== "Z").length });
}
