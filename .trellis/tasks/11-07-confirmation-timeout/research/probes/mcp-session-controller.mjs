/**
 * 统一 MCP 等待的隔离前台控制器，不是产品启动入口。
 * @module mcp-session-controller
 */
import fs from "node:fs";
import path from "node:path";
import { createServer } from "node:net";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { spawn as spawnPty } from "node-pty";

const here = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (process.platform !== "linux" || !["codex", "claude"].includes(config.harness)
  || !Number.isInteger(config.waitMs) || config.waitMs < 1500 || config.waitMs > 200000) throw new Error("实验参数无效");
const began = performance.now();
const nonce = randomUUID();
const connections = new Set();
let child;
let timer;
let status = "prepared";
let closing = false;
let text = "";
let controls = "";
let planSeen = false;
let initialSent = false;
const seenMarkers = new Set();

/**
 * 输出实验白名单事件，不打印终端全文、提示或环境。
 * @param {string} event 事件名。
 * @param {object} details 可公开的字段。
 * @returns {void}
 */
function record(event, details = {}) {
  process.stdout.write(`${JSON.stringify({ event, time_ms: Math.round(performance.now() - began), ...details })}\n`);
}

/**
 * 同一事件循环内只决定一次，避免人工输入与截止事件重复返回。
 * @param {string} source 决定来源。
 * @param {string} reason 取消原因。
 * @returns {void}
 */
function decide(source, reason) {
  if (!["prepared", "waiting"].includes(status)) return;
  status = source;
  clearTimeout(timer);
  const result = { source, decision: source === "policy_timeout" ? "continue" : "stop", ...(reason ? { reason } : {}) };
  record("decision", result);
  for (const socket of connections) if (socket.waiting) socket.end(`${JSON.stringify(result)}\n`);
}

/**
 * 同时观察到方案展示与等待请求后才开始计时，避免 UI 渲染顺序造成提前计时。
 * @returns {void}
 */
function arm() {
  if (status !== "prepared" || !planSeen || ![...connections].some((socket) => socket.waiting)) return;
  status = "waiting";
  record("wait_started", { wait_ms: config.waitMs, plan_seen: planSeen });
  timer = setTimeout(() => decide("policy_timeout"), config.waitMs);
}

/**
 * 撤销并终止自己创建的 CLI；SIGKILL 场景由内核父进程绑定另行覆盖。
 * @param {string} reason 退出原因。
 * @returns {void}
 */
function shutdown(reason) {
  if (closing) return;
  closing = true;
  decide("cancelled", reason);
  record("controller_closing", { reason });
  clearTimeout(timer);
  for (const socket of connections) socket.destroy();
  server.close();
  if (child) {
    try { child.kill("SIGTERM"); } catch { /* 退出竞争无需覆盖原因。 */ }
    setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* 同一自有 PTY 可能已退出。 */ }
      process.exit(0);
    }, 700);
  } else process.exit(0);
}

const server = createServer((socket) => {
  connections.add(socket);
  let buffer = "";
  socket.on("error", () => socket.destroy());
  socket.on("close", () => connections.delete(socket));
  socket.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    if (buffer.length > 8192) return socket.destroy();
    if (!buffer.includes("\n")) return;
    let message;
    try { message = JSON.parse(buffer.split("\n")[0]); } catch { return socket.destroy(); }
    buffer = "";
    if (message.nonce !== nonce) return socket.destroy();
    if (message.type === "catalog") {
      record("catalog", { tool_count: message.tool_count, definition_bytes: message.definition_bytes });
      socket.end('{"ok":true}\n');
      if (config.harness === "claude" && !initialSent) {
        initialSent = true;
        // 普通交互式 CLI 的工具发现异步完成，先就绪再提交首条实验消息。
        setTimeout(() => {
          if (!closing && !planSeen) {
            child.write(`${prompt}\r`);
            record("initial_prompt_submitted_after_catalog");
          }
        }, 300);
      }
    } else if (message.type === "delivered") {
      record("tool_result_delivered", { source: message.source, result_bytes: message.result_bytes });
      socket.end('{"ok":true}\n');
    } else if (message.type === "wait" && message.request_id === "probe") {
      if (status !== "prepared" || [...connections].some((connection) => connection.waiting) || closing) {
        record("wait_rejected", { status, plan_seen: planSeen });
        return socket.end(`${JSON.stringify({ source: "cancelled", decision: "stop", reason: "invalid_state_or_display" })}\n`);
      }
      socket.waiting = true;
      record("wait_requested");
      arm();
    } else socket.destroy();
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const module = await import(`./${config.harness}-mcp-adapter.mjs`);
const factory = config.harness === "codex" ? module.prepareCodex : module.prepareClaude;
const launch = factory({ sandbox: config.sandbox, mockPort: config.mockPort, controlPort: server.address().port,
  nonce, mcpServerPath: path.join(here, "mcp-wait-server.mjs"), requestId: "probe" });
const prompt = "FLOWER_MCP_PROBE_START：这是隔离的限时确认实验，按本机 mock 指令执行。";
child = spawnPty("python3", ["-I", "-B", path.join(here, "linux-parent-death.py"), String(process.pid),
  launch.executable, ...launch.args], { cwd: config.sandbox, env: launch.env,
  cols: 140, rows: 45, name: "xterm-256color" });
record("harness_started", { pid: child.pid, version: launch.version, harness: config.harness });
child.onExit(({ exitCode }) => {
  record("harness_exited", { exit_code: exitCode });
  shutdown("harness_exited");
});
child.onData((chunk) => {
  controls += chunk;
  if (controls.includes("\x1b[6n")) { child.write("\x1b[1;1R"); controls = controls.replaceAll("\x1b[6n", ""); }
  if (controls.includes("\x1b[c") || controls.includes("\x1b[0c")) {
    child.write("\x1b[?1;2c"); controls = controls.replaceAll("\x1b[c", "").replaceAll("\x1b[0c", "");
  }
  controls = controls.slice(-1024);
  const plain = chunk.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "").replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
  text = (text + plain).slice(-24000);
  for (const marker of ["FLOWER_MCP_PLAN", "FLOWER_MCP_CONTINUED", "FLOWER_MCP_CANCELLED", "FLOWER_MCP_UNVERIFIED"]) {
    if (!text.includes(marker) || seenMarkers.has(marker)) continue;
    seenMarkers.add(marker);
    if (marker === "FLOWER_MCP_PLAN") planSeen = true;
    record("visible_marker", { marker });
    arm();
  }
  if (status === "prepared") {
    for (const line of plain.split(/[\r\n]/)) {
      if (!/trust|theme|API key|onboarding|Yes|No|error|failed/i.test(line)) continue;
      if (/codex_rollout::recorder|existing.*session/i.test(line)) continue;
      record("startup", { text: line.replace(/sk-[\w-]+/g, "[已隐藏]").replace(/\/root\/[^\s]+/g, "[本地路径]").slice(0, 220) });
    }
  }
});
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on("line", (line) => {
  let command;
  try { command = JSON.parse(line); } catch { return; }
  if (command.type === "input" && typeof command.text === "string") {
    if (status === "waiting") decide("cancelled", "human_input");
    record("input_forwarded", { during_wait: status === "cancelled", startup: !planSeen });
    child.write(command.text);
  } else if (command.type === "diagnostic") {
    record("terminal_diagnostic", { tail: text.replace(/^.*codex_rollout::recorder:.*$/gm, "[历史索引日志省略]")
      .replace(/\/root\/[^\s]+/g, "[本地路径]").replace(/sk-[\w-]+/g, "[已隐藏]")
      .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/g, "[实验代号]").slice(-2200) });
  } else if (command.type === "close") shutdown("front_terminal_closed");
});
input.on("close", () => shutdown("front_input_closed"));
process.once("SIGTERM", () => shutdown("signal"));
process.once("SIGINT", () => shutdown("signal"));
setTimeout(() => shutdown("controller_total_timeout"), config.waitMs + 60000).unref();
