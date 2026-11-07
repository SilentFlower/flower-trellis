#!/usr/bin/env node
/**
 * 用回环 Messages API mock 核查 Claude 普通后台 Bash 的空闲续接。
 * 本文件只在被显式运行时创建隔离目录和启动 CLI，不读取用户凭证或全局配置。
 * @module claude-background-probe
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync, spawn as spawnChild } from "node:child_process";
import { performance } from "node:perf_hooks";
import { spawn as spawnPty } from "node-pty";

const START = "FLOWER_BACKGROUND_PROBE_START";
const WAITING = "FLOWER_WAITING";
const RESUMED = "FLOWER_RESUMED";
const TIMER = "FLOWER_TIMER_DONE";
const TIMER_DESCRIPTION = "FLOWER_PROBE_TIMER";
const TOOL_ID = "toolu_flower_probe_timer";
const INITIAL_PROMPT = `${START}\n这是隔离后台通知探针。请按本地 mock 的工具调用与结果继续。`;
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");

/**
 * 解析本探针允许的少量选项；帮助模式不启动 CLI。
 * @param {string[]} args 命令行参数。
 * @returns {object} 校验后的探针配置。
 */
function parseOptions(args) {
  const options = { mode: "tui", bare: false, setupInput: false, timeoutMs: 40000, observeMs: 8000, claude: "claude" };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help") options.help = true;
    else if (argument === "--bare") options.bare = true;
    else if (argument === "--setup-input") options.setupInput = true;
    else if (["--mode", "--timeout-ms", "--observe-ms", "--claude", "--reuse-scratch", "--scenario"].includes(argument)) {
      const value = args[++index];
      if (!value) throw new Error("探针选项缺少取值");
      if (argument === "--mode") options.mode = value;
      if (argument === "--claude") options.claude = value;
      if (argument === "--reuse-scratch") options.reuseScratch = value;
      if (argument === "--scenario") options.scenario = value;
      if (argument === "--timeout-ms") options.timeoutMs = Number(value);
      if (argument === "--observe-ms") options.observeMs = Number(value);
    } else throw new Error("探针收到未知选项");
  }
  if (!["tui", "stream-json"].includes(options.mode)) throw new Error("模式仅支持 tui 或 stream-json");
  options.scenario ||= "idle";
  if (!["idle", "normal-exit", "kill-cli"].includes(options.scenario)) throw new Error("未支持的探针场景");
  if (options.mode !== "tui" && options.scenario !== "idle") throw new Error("退出场景只在真实 TUI 验证");
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 12000 || options.timeoutMs > 60000) {
    throw new Error("总超时必须在 12000 至 60000 毫秒之间");
  }
  if (!Number.isInteger(options.observeMs) || options.observeMs < 8000 || options.observeMs > 20000) {
    throw new Error("无人输入观察窗口必须在 8000 至 20000 毫秒之间");
  }
  return options;
}

/**
 * 把可执行文件名解析为本地绝对路径，不执行 shell 展开。
 * @param {string} executable 文件名或路径。
 * @returns {string} 已存在的绝对路径。
 */
function resolveExecutable(executable) {
  const candidates = executable.includes(path.sep)
    ? [path.resolve(executable)]
    : (process.env.PATH || "").split(path.delimiter).map((directory) => path.join(directory, executable));
  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return fs.realpathSync(candidate);
    } catch {
      // 只检查候选路径，不读取其他程序或凭证。
    }
  }
  throw new Error("找不到指定的本地可执行文件");
}

/**
 * 为精确 Bash 命令引用路径，不把 JSON 转义误当成 shell 转义。
 * @param {string} value 单个路径参数。
 * @returns {string} POSIX shell 单引号参数。
 */
function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/**
 * 从请求内容中仅收集文本块供内存内的标记判断，调用方不持久化原文。
 * @param {unknown} value Messages 内容。
 * @returns {string[]} 文本块。
 */
function textBlocks(value) {
  if (typeof value === "string") return [value];
  if (!Array.isArray(value)) return [];
  return value.flatMap((block) => {
    if (block?.type === "text") return [block.text || ""];
    if (block?.type === "tool_result") return textBlocks(block.content);
    return [];
  });
}

/**
 * 生成标准 Messages 响应，并按官方 SSE 事件顺序交付。
 * @param {http.ServerResponse} response 回环 HTTP 响应。
 * @param {object} request 已解析请求。
 * @param {object[]} content 受控响应块。
 * @returns {void}
 */
function sendMessage(response, request, content) {
  const message = {
    id: `msg_flower_${randomUUID().replaceAll("-", "")}`,
    type: "message", role: "assistant", model: request.model || "sonnet",
    content, stop_reason: content.some((block) => block.type === "tool_use") ? "tool_use" : "end_turn",
    stop_sequence: null, usage: { input_tokens: 20, output_tokens: 10 },
  };
  if (!request.stream) {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(message));
    return;
  }
  response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  const event = (type, data) => response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  event("message_start", { message: { ...message, content: [], stop_reason: null, usage: { input_tokens: 20, output_tokens: 0 } } });
  content.forEach((block, index) => {
    if (block.type === "tool_use") {
      event("content_block_start", { index, content_block: { ...block, input: {} } });
      event("content_block_delta", { index, delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input) } });
    } else {
      event("content_block_start", { index, content_block: { type: "text", text: "" } });
      event("content_block_delta", { index, delta: { type: "text_delta", text: block.text } });
    }
    event("content_block_stop", { index });
  });
  event("message_delta", { delta: { stop_reason: message.stop_reason, stop_sequence: null }, usage: { output_tokens: 10 } });
  event("message_stop", {});
  response.end();
}

/**
 * 读取 Linux 进程身份，后续清理以启动时刻防止 PID 重用误杀。
 * @param {number} pid 进程号。
 * @returns {object|null} 进程身份或不存在。
 */
function processIdentity(pid) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    return { pid, parent: Number(fields[1]), group: Number(fields[2]), birth: fields[19] };
  } catch {
    return null;
  }
}

/**
 * 主动发现本探针 CLI 的后代，不读取环境或命令行，供退出清理使用。
 * @param {Map<number, object>} owned 已知拥有的进程。
 * @returns {void}
 */
function discoverDescendants(owned) {
  const snapshot = fs.readdirSync("/proc").filter((name) => /^\d+$/.test(name))
    .map((name) => processIdentity(Number(name))).filter(Boolean);
  let changed;
  do {
    changed = false;
    for (const identity of snapshot) {
      if (owned.has(identity.pid) || !owned.has(identity.parent)) continue;
      const parent = snapshot.find((candidate) => candidate.pid === identity.parent);
      if (parent?.birth !== owned.get(identity.parent).birth) continue;
      owned.set(identity.pid, identity);
      changed = true;
    }
  } while (changed);
}

/**
 * 只给仍具有本探针记录身份的进程发送信号。
 * @param {Map<number, object>} owned 本探针进程集合。
 * @param {string} signal 要发送的信号。
 * @returns {void}
 */
function signalOwned(owned, signal) {
  for (const identity of [...owned.values()].reverse()) {
    if (identity.pid === process.pid || processIdentity(identity.pid)?.birth !== identity.birth) continue;
    try { process.kill(identity.pid, signal); } catch { /* 进程已退出时无需重试。 */ }
  }
}

/**
 * 运行隔离探针；仅本函数会启动 CLI 或创建运行产物。
 * @param {object} options 探针选项。
 * @returns {Promise<void>} 清理完成后结束。
 */
async function main(options) {
  if (process.platform !== "linux") throw new Error("当前探针的进程清理仅核对了 Linux，不在其他平台运行");
  for (const managedPath of ["/etc/claude-code/managed-settings.json", "/etc/claude-code/managed-settings.d"]) {
    if (fs.existsSync(managedPath)) throw new Error("检测到机器级 Claude 受管配置，需先审查其路由影响；探针未读取其内容");
  }
  const executable = resolveExecutable(options.claude);
  const python = resolveExecutable("python3");
  const version = execFileSync(executable, ["--version"], { encoding: "utf8", timeout: 5000 }).trim();
  if (version !== "2.1.293 (Claude Code)") throw new Error("CLI 版本不是本轮核对的 2.1.293，需重新审查参数");
  const scratchBase = path.join(PROJECT_ROOT, ".trellis-tmp");
  fs.mkdirSync(scratchBase, { recursive: true });
  const scratch = options.reuseScratch ? fs.realpathSync(options.reuseScratch)
    : fs.mkdtempSync(path.join(scratchBase, "confirmation-timeout-claude-"));
  if (path.dirname(scratch) !== scratchBase || !path.basename(scratch).startsWith("confirmation-timeout-claude-")) {
    throw new Error("只能复用本探针生成的隔离目录");
  }
  const configDirectory = path.join(scratch, "config");
  const workDirectory = path.join(scratch, "work");
  fs.mkdirSync(configDirectory, { mode: 0o700, recursive: true });
  fs.mkdirSync(workDirectory, { mode: 0o700, recursive: true });
  execFileSync("git", ["init", "--quiet", workDirectory], { stdio: "ignore" });
  const timerFile = path.join(scratch, "timer.py");
  fs.writeFileSync(timerFile, `"""只等待三秒并输出探针标记，不执行任何业务动作。"""\nimport time\ntime.sleep(3)\nprint("${TIMER}", flush=True)\n`, { mode: 0o600 });
  const command = `${shellQuote(python)} ${shellQuote(timerFile)}`;
  const settingsFile = path.join(scratch, "settings.json");
  fs.writeFileSync(settingsFile, JSON.stringify({
    permissions: { allow: [`Bash(${command})`], defaultMode: "dontAsk" },
    enabledPlugins: {}, hooks: {},
  }, null, 2), { mode: 0o600 });

  const began = performance.now();
  const eventsFile = path.join(scratch, `summary-${randomUUID()}.jsonl`);
  const owned = new Map();
  const state = { mainRequests: 0, auxiliaryRequests: 0, waitingVisibleAt: null, resumedVisible: false,
    third: null, cliExited: false, startupTail: [], inputWrites: 0, violation: false,
    exitStarted: false, exitPromptConfirmed: false };
  const seenNotifications = new Set();
  let outputWindow = "";
  let child;
  let poll;
  let deadline;
  let observation;
  let exitAction;
  let exitEnterAction;
  let finished = false;
  let stop;
  let setupInputHandler;
  let previousRawMode;
  const sockets = new Set();
  const stopped = new Promise((resolve) => { stop = resolve; });

  /** 仅写白名单摘要；严禁把请求体、响应头或完整终端内容传入。 */
  function record(event, details = {}) {
    const line = JSON.stringify({ time_ms: Math.round(performance.now() - began), event, ...details });
    fs.appendFileSync(eventsFile, `${line}\n`, { mode: 0o600 });
    process.stdout.write(`${line}\n`);
  }

  /** 从终端输出只取自有标记和启动提示摘要，不持久化完整屏幕。 */
  function observeOutput(data) {
    const plain = data.toString().replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
      .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/\r/g, "\n");
    outputWindow = (outputWindow + plain).slice(-32768);
    if (options.scenario === "normal-exit" && state.exitStarted && !state.exitPromptConfirmed
      && /❯\s*1\.\s*Exit\s*and\s*stop\s*tasks/.test(outputWindow)) {
      state.exitPromptConfirmed = true;
      child.write("\r");
      record("已确认退出并停止本次实验后台任务");
    }
    if (state.mainRequests === 0) {
      for (const line of plain.split("\n")) {
        if (!/trust|theme|API key|onboarding|login|log in|Press Enter|Choose|Yes|No/i.test(line)) continue;
        const safe = line.replace(/sk-[\w-]+/g, "[已隐藏]").replace(/https?:\/\/\S+/g, "[网址]")
          .replace(/\/[^\s]+/g, "[路径]").trim().slice(0, 180);
        if (safe && state.startupTail.at(-1) !== safe) {
          state.startupTail.push(safe);
          record("隔离启动提示", { text: safe });
        }
        state.startupTail = state.startupTail.slice(-8);
      }
    }
    if (state.mainRequests >= 2 && state.waitingVisibleAt === null && outputWindow.includes(WAITING)) {
      state.waitingVisibleAt = performance.now() - began;
      record("已观察到最终等待标记", { marker: WAITING, input_writes: state.inputWrites });
      observation = setTimeout(() => stop("观察窗口结束"), options.observeMs);
      if (options.scenario !== "idle") {
        exitAction = setTimeout(() => {
          if (options.scenario === "normal-exit") {
            state.exitStarted = true;
            state.inputWrites += 1;
            child.write("\x04");
            record("已发送第一次 Ctrl+D 退出按键");
            exitEnterAction = setTimeout(() => {
              child.write("\x04");
              record("已发送第二次 Ctrl+D 退出按键");
            }, 250);
          } else {
            const identity = owned.get(child.pid);
            if (identity && processIdentity(child.pid)?.birth === identity.birth) {
              process.kill(child.pid, "SIGKILL");
              record("已强杀专用实验 CLI");
            } else stop("无法核实专用 CLI 的退出身份");
          }
        }, 500);
      }
    }
    if (!state.resumedVisible && outputWindow.includes(RESUMED)) {
      state.resumedVisible = true;
      record("已观察到续接标记", { marker: RESUMED });
    }
  }

  /** 处理回环请求；所有分支都在本机结束，绝不代理上游。 */
  async function handleRequest(request, response) {
    if (request.url?.startsWith("http")) {
      record("已拒绝代理外连请求");
      response.writeHead(403).end();
      return;
    }
    const requestPath = new URL(request.url || "/", "http://127.0.0.1").pathname;
    if (request.method !== "POST" || requestPath !== "/v1/messages") {
      record("辅助回环请求", { method: request.method, path: requestPath.slice(0, 80) });
      if (requestPath === "/v1/messages/count_tokens") response.writeHead(200, { "content-type": "application/json" }).end('{"input_tokens":100}');
      else response.writeHead(404, { "content-type": "application/json" }).end('{"type":"error","error":{"type":"not_found_error","message":"本地探针不提供此路由"}}');
      return;
    }
    let raw = "";
    for await (const chunk of request) {
      raw += chunk;
      if (Buffer.byteLength(raw) > 4 * 1024 * 1024) {
        response.writeHead(413).end();
        stop("请求超过探针上限");
        return;
      }
    }
    let body;
    try { body = JSON.parse(raw); } catch { response.writeHead(400).end(); return; }
    const tools = (body.tools || []).map((tool) => tool.name).filter((name) => typeof name === "string");
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const texts = messages.flatMap((message) => textBlocks(message.content));
    const isMain = tools.includes("Bash") && texts.some((text) => text.includes(START));
    if (!isMain) {
      state.auxiliaryRequests += 1;
      record("辅助模型请求已由本地固定文本回答", { tools });
      sendMessage(response, body, [{ type: "text", text: "FLOWER_AUXILIARY" }]);
      return;
    }
    state.mainRequests += 1;
    const freshNotifications = texts.filter((text) => text.includes("<task-notification>")).filter((text) => {
      const digest = createHash("sha256").update(text).digest("hex");
      if (seenNotifications.has(digest)) return false;
      seenNotifications.add(digest);
      return true;
    });
    const completedEvent = freshNotifications.some((text) => /<status>\s*completed\s*<\/status>/.test(text));
    const probeTaskEvent = freshNotifications.some((text) => text.includes(TIMER_DESCRIPTION) || text.includes(TIMER));
    const toolResultPresent = messages.some((message) => Array.isArray(message.content)
      && message.content.some((block) => block.type === "tool_result" && block.tool_use_id === TOOL_ID));
    if (state.mainRequests === 2) {
      const result = messages.flatMap((message) => Array.isArray(message.content) ? message.content : [])
        .find((block) => block.type === "tool_result" && block.tool_use_id === TOOL_ID);
      record("计时工具结果摘要", { is_error: Boolean(result?.is_error),
        text: textBlocks(result?.content).join("\n").replace(/\/root\/[^\s]+/g, "[本地路径]").slice(0, 1000) });
    }
    record("主 Messages 请求", { sequence: state.mainRequests, tools, tool_result_present: toolResultPresent,
      fresh_task_notification: freshNotifications.length > 0, completed_event: completedEvent, probe_task_event: probeTaskEvent });
    if (state.mainRequests === 1) {
      sendMessage(response, body, [{ type: "tool_use", id: TOOL_ID, name: "Bash",
        input: { command, description: `等待三秒并输出探针标记 ${TIMER_DESCRIPTION}`, run_in_background: true } }]);
    } else if (state.mainRequests === 2) {
      if (!toolResultPresent) state.violation = true;
      sendMessage(response, body, [{ type: "text", text: WAITING }]);
    } else if (state.mainRequests === 3) {
      state.third = { afterWaiting: state.waitingVisibleAt !== null, completedEvent, probeTaskEvent,
        freshNotification: freshNotifications.length > 0, at: performance.now() - began };
      sendMessage(response, body, [{ type: "text", text: RESUMED }]);
    } else {
      state.violation = true;
      sendMessage(response, body, [{ type: "text", text: "FLOWER_UNEXPECTED_MAIN_REQUEST" }]);
    }
  }

  const server = http.createServer((request, response) => {
    handleRequest(request, response).catch(() => {
      state.violation = true;
      if (!response.headersSent) response.writeHead(500);
      response.end();
      stop("回环 mock 处理失败");
    });
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => socket.destroy());
  });
  server.on("clientError", (_error, socket) => socket.destroy());
  server.on("connect", (request, socket) => {
    const host = /^([a-z0-9.-]+):\d+$/i.exec(request.url || "")?.[1] || "未知目标";
    record("已拒绝代理隧道", { host });
    socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
  });
  const onSignal = () => stop("探针被人工中断");
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  try {
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const address = `http://127.0.0.1:${server.address().port}`;
    // 白名单继承只包含运行路径和原 HOME；不读取、复制或记录宿主的认证变量。
    const environment = {};
    for (const key of ["PATH", "HOME", "LANG", "LC_ALL", "TMPDIR"]) {
      if (process.env[key] !== undefined) environment[key] = process.env[key];
    }
    Object.assign(environment, {
      TERM: "xterm-256color", CLAUDE_CONFIG_DIR: configDirectory,
      ANTHROPIC_BASE_URL: address, ANTHROPIC_API_KEY: "dummy",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1", DISABLE_TELEMETRY: "1",
      DISABLE_ERROR_REPORTING: "1", DISABLE_AUTOUPDATER: "1", DISABLE_GROWTHBOOK: "1",
      CLAUDE_CODE_DISABLE_TERMINAL_TITLE: "1", CLAUDE_CODE_SKIP_PROMPT_HISTORY: "1",
      CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION: "false", CLAUDE_CODE_MAX_RETRIES: "0",
      API_TIMEOUT_MS: "5000", HTTP_PROXY: address, HTTPS_PROXY: address,
      NO_PROXY: "127.0.0.1,localhost,::1", no_proxy: "127.0.0.1,localhost,::1",
    });
    const args = ["--setting-sources", "", "--settings", settingsFile, "--strict-mcp-config",
      "--tools", "Bash", "--permission-mode", "dontAsk", "--no-chrome", "--disable-slash-commands",
      "--prompt-suggestions", "false", "--model", "sonnet"];
    if (options.bare) args.push("--bare");
    if (options.mode === "stream-json") {
      args.push("--print", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--no-session-persistence");
      child = spawnChild(executable, args, { cwd: workDirectory, env: environment, detached: true, stdio: ["pipe", "pipe", "pipe"] });
      child.stdout.on("data", observeOutput);
      child.stderr.on("data", observeOutput);
      child.on("error", () => stop("CLI 启动失败"));
      child.on("exit", () => { state.cliExited = true; record("CLI 已退出"); stop("CLI 提前退出"); });
      child.stdin.write(`${JSON.stringify({ type: "user", message: { role: "user", content: INITIAL_PROMPT } })}\n`);
      state.inputWrites += 1;
      // 不关闭 stdin：普通流式会话需保持输入通道打开，才能观察空闲通知。
    } else {
      child = spawnPty(executable, [...args, INITIAL_PROMPT], { name: "xterm-256color", cols: 120, rows: 40,
        cwd: workDirectory, env: environment });
      child.onData(observeOutput);
      child.onExit(() => {
        state.cliExited = true;
        record("CLI 已退出");
        if (options.scenario === "idle" || state.waitingVisibleAt === null) stop("CLI 提前退出");
      });
      // 仅显式调试时允许主会话处理本探针的启动提示，等待观察阶段完全停止输入。
      if (options.setupInput && process.stdin.isTTY) {
        previousRawMode = Boolean(process.stdin.isRaw);
        process.stdin.setRawMode(true);
        process.stdin.resume();
        setupInputHandler = (data) => {
          if (state.mainRequests >= 2) return;
          state.inputWrites += 1;
          child.write(data.toString("utf8"));
          record("已转发启动阶段输入", { input_writes: state.inputWrites });
        };
        process.stdin.on("data", setupInputHandler);
      }
    }
    const identity = processIdentity(child.pid);
    if (identity) owned.set(child.pid, identity);
    poll = setInterval(() => discoverDescendants(owned), 150);
    deadline = setTimeout(() => stop("达到总超时"), options.timeoutMs);
    record("探针已启动", { mode: options.mode, scenario: options.scenario, bare: options.bare, version, scratch, summary_file: eventsFile,
      evidence_level: options.mode === "tui" ? "真实 TUI，经 PTY 观察" : "stream-json，不能代替普通 TUI 证据",
      network: "仅回环 mock；非必要流量关闭；代理拒绝外连，但没有操作系统级网络隔离" });
    const reason = await stopped;
    finished = true;
    const third = state.third;
    const idlePassed = reason === "观察窗口结束" && !state.violation && !state.cliExited
      && state.mainRequests === 3 && state.resumedVisible && third?.afterWaiting
      && third.freshNotification && third.completedEvent && third.probeTaskEvent;
    const exitPassed = reason === "观察窗口结束" && !state.violation && state.cliExited
      && state.mainRequests === 2 && !state.resumedVisible && state.waitingVisibleAt !== null;
    const passed = options.scenario === "idle" ? idlePassed : exitPassed;
    record("探针结果", { result: passed ? "通过" : "未通过或证据不足", reason,
      main_requests: state.mainRequests, auxiliary_requests: state.auxiliaryRequests,
      waiting_visible: state.waitingVisibleAt !== null, resumed_visible: state.resumedVisible,
      third_request: third, input_writes: state.inputWrites, startup_tail: state.startupTail });
    if (options.scenario !== "idle" && !state.cliExited) {
      record("退出诊断", { screen_tail: outputWindow.replace(/sk-[\w-]+/g, "[已隐藏]")
        .replace(/\/root\/[^\s]+/g, "[本地路径]").slice(-2500) });
    }
    process.exitCode = passed ? 0 : 1;
  } finally {
    clearInterval(poll);
    clearTimeout(deadline);
    clearTimeout(observation);
    clearTimeout(exitAction);
    clearTimeout(exitEnterAction);
    if (owned.size) discoverDescendants(owned);
    signalOwned(owned, "SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 350));
    signalOwned(owned, "SIGKILL");
    if (setupInputHandler) {
      process.stdin.off("data", setupInputHandler);
      process.stdin.setRawMode(previousRawMode);
      process.stdin.pause();
    }
    if (options.mode === "stream-json" && child) {
      child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy();
    }
    server.closeAllConnections();
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    record("探针资源已清理", { tracked_processes: owned.size, completed_observation: finished });
  }
}

try {
  const options = parseOptions(process.argv.slice(2));
  if (options.help) {
    process.stdout.write("用法：node claude-background-probe.mjs [--mode tui|stream-json] [--bare] [--setup-input] [--timeout-ms 40000] [--observe-ms 8000] [--claude 本地路径]\n默认真实 TUI；不自动接受启动提示。setup-input 仅开放启动阶段的显式输入。stream-json 和 bare 均须单独标明证据限制。\n");
  } else {
    await main(options);
  }
} catch (error) {
  process.stderr.write(`探针未完成：${error instanceof Error ? error.message : "未知错误"}\n`);
  process.exitCode = 1;
}
