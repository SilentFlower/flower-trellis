import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, appendFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawn as 启动子进程 } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { gunzipSync, inflateSync, brotliDecompressSync } from "node:zlib";
import { spawn as 启动PTY } from "node-pty";

/**
 * 隔离观察真实 Codex TUI 的后台完成通知；只有显式 --run 才启动进程。
 * 本文件不连接真实模型，也不向已有线程发送输入。
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const DONE = "FLOWER_TIMER_DONE";
const WAITING = "FLOWER_WAITING";
const RESUMED = "FLOWER_RESUMED";
const PYTHON = `import time; time.sleep(3); print("${DONE}", flush=True)`;
const DUMMY = "flower-timeout-probe-dummy-not-a-real-key";

/**
 * 解析有限的研究参数，拒绝会改变测试含义的未知选项。
 * @param {string[]} argv 进程参数
 * @returns {object} 有界测试选项
 */
function 解析参数(argv) {
  const options = { run: false, mode: "tui", codex: "codex", idleMs: 8000, totalMs: 40000, yieldMs: 250 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--run") options.run = true;
    else if (arg === "--help") options.run = false;
    else if (["--codex", "--idle-ms", "--total-ms", "--yield-ms", "--mode"].includes(arg)) {
      const value = argv[++i];
      if (!value) throw new Error("缺少探针参数值");
      if (arg === "--codex") options.codex = value;
      else if (arg === "--mode") options.mode = value;
      else if (arg === "--idle-ms") options.idleMs = Number(value);
      else if (arg === "--total-ms") options.totalMs = Number(value);
      else options.yieldMs = Number(value);
    } else throw new Error("存在未知探针参数");
  }
  if (!["tui", "exec", "server-tui"].includes(options.mode) || !Number.isInteger(options.idleMs) || options.idleMs < 8000 || options.idleMs > 15000
    || !Number.isInteger(options.totalMs) || options.totalMs < 20000 || options.totalMs > 60000
    || ![250, 1000].includes(options.yieldMs)) throw new Error("探针时长超出允许范围");
  return options;
}

/**
 * 创建不含继承凭证的子环境，保留原有 HOME/home/CODEX_HOME 值。
 * @param {number} port 本机 mock 端口
 * @returns {object} 仅用于该测试子进程的环境
 */
function 构造环境(port) {
  const env = {};
  for (const key of ["HOME", "home", "CODEX_HOME", "CODEX_SQLITE_HOME", "PATH", "SHELL", "USER", "LOGNAME", "LANG", "LC_ALL", "LC_CTYPE", "TMPDIR", "TMP", "TEMP"]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  Object.assign(env, {
    TERM: "xterm-256color", COLORTERM: "truecolor", RUST_LOG: "warn", RUST_BACKTRACE: "0",
    FLOWER_TIMEOUT_PROBE_TOKEN: DUMMY,
    HTTP_PROXY: `http://127.0.0.1:${port}`, HTTPS_PROXY: `http://127.0.0.1:${port}`,
    ALL_PROXY: `http://127.0.0.1:${port}`, NO_PROXY: "127.0.0.1,localhost,::1",
    http_proxy: `http://127.0.0.1:${port}`, https_proxy: `http://127.0.0.1:${port}`,
    all_proxy: `http://127.0.0.1:${port}`, no_proxy: "127.0.0.1,localhost,::1",
  });
  return env;
}

/**
 * 读取有界 HTTP body；不保存正文或请求头。
 * @param {object} request 原生 HTTP 请求
 * @returns {Promise<object>} 仅内存使用的 JSON
 */
async function 读取请求(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 16 * 1024 * 1024) throw new Error("请求正文过大");
    chunks.push(chunk);
  }
  let bytes = Buffer.concat(chunks);
  const encoding = request.headers["content-encoding"];
  if (encoding === "gzip") bytes = gunzipSync(bytes);
  else if (encoding === "deflate") bytes = inflateSync(bytes);
  else if (encoding === "br") bytes = brotliDecompressSync(bytes);
  else if (encoding && encoding !== "identity") throw new Error("未验证的请求压缩格式");
  if (bytes.length > 16 * 1024 * 1024) throw new Error("解压后的正文过大");
  return JSON.parse(bytes.toString("utf8"));
}

/**
 * 只统计真实输入或工具输出中的探针标记，排除工具定义和调用参数。
 * @param {object} body Responses 请求
 * @returns {object} 可写入报告的最小摘要
 */
function 归纳输入(body) {
  const result = { 工具结果数: 0, 计时完成数: 0, 最终等待数: 0, 后台会话已返回: false, 计时调用结果存在: false };
  for (const item of Array.isArray(body.input) ? body.input : []) {
    let texts = [];
    if (["function_call_output", "custom_tool_call_output"].includes(item.type)) {
      result.工具结果数++;
      result.计时调用结果存在 ||= item.call_id === "call_flower_timer";
      texts = typeof item.output === "string" ? [item.output]
        : (Array.isArray(item.output) ? item.output : []).flatMap((part) => typeof part.text === "string" ? [part.text] : []);
    } else if (item.type === "message" && ["user", "developer"].includes(item.role)) {
      texts = (Array.isArray(item.content) ? item.content : []).flatMap((part) =>
        typeof part.text === "string" ? [part.text] : []);
    }
    for (const text of texts) {
      result.计时完成数 += text.split(DONE).length - 1;
      result.最终等待数 += text.split(WAITING).length - 1;
      result.后台会话已返回 ||= /Process running with session ID|"session_id"\s*:\s*\d+/.test(text);
    }
  }
  return result;
}

/**
 * 只从实际广告的工具 schema 或代码执行声明选择计时入口。
 * @param {object} body 首个真实 Responses 请求
 * @param {object} options 测试选项
 * @param {string} cwd 只读计时命令工作目录
 * @returns {object} 工具调用与参数
 */
function 选择命令工具(body, options, cwd) {
  const candidates = [];
  for (const tool of Array.isArray(body.tools) ? body.tools : []) {
    if (tool.type === "function") candidates.push(tool);
    // 只有请求自己声明 namespace 才携带该字段，避免把命名空间字符串当工具名猜测。
    if (tool.type === "namespace" && Array.isArray(tool.tools)) {
      for (const nested of tool.tools) if (nested.type === "function") candidates.push({ ...nested, namespace: tool.name });
    }
  }
  const tool = candidates.find((candidate) => candidate.name === "exec_command");
  const properties = tool?.parameters?.properties;
  const command = { cmd: `python3 -I -S -B -c '${PYTHON}'`, yield_time_ms: options.yieldMs,
    login: false, workdir: cwd, max_output_tokens: 256 };
  if (!tool) {
    const codeTool = body.tools.find((candidate) => candidate.type === "namespace" && candidate.name === "functions")
      ?.tools?.find((candidate) => candidate.type === "custom" && candidate.name === "exec");
    if (codeTool?.format?.type === "grammar" && codeTool.format.syntax === "lark"
      && codeTool.description.includes("exec_command(args: {")
      && codeTool.description.includes("yield_time_ms?: number")) {
      // 本机版本将终端工具放在代码执行器中，仍调用宿主原有终端而不轮询。
      return { name: codeTool.name, namespace: "functions", type: "custom",
        input: `text(await tools.exec_command(${JSON.stringify(command)}));`, keys: Object.keys(command) };
    }
  }
  if (!properties || properties.cmd?.type !== "string" || !["integer", "number"].includes(properties.yield_time_ms?.type)) {
    throw new Error("真实工具列表没有已验证的 exec_command 参数");
  }
  const args = { cmd: command.cmd, yield_time_ms: options.yieldMs };
  if (properties.login?.type === "boolean") args.login = false;
  if (properties.workdir?.type === "string") args.workdir = cwd;
  if (["integer", "number"].includes(properties.max_output_tokens?.type)) args.max_output_tokens = 256;
  if ((tool.parameters.required ?? []).some((key) => !(key in args))) throw new Error("真实工具要求未知必填参数");
  return { name: tool.name, namespace: tool.namespace, arguments: args, keys: Object.keys(properties) };
}

/**
 * 构造官方 Responses 生命周期事件所需的响应对象。
 * @param {number} number 当前主请求序号
 * @param {object[]} output 最终输出项
 * @returns {object} 完整响应的最小字段集
 */
function 构造响应(number, output) {
  return {
    id: `resp_flower_${number}`, object: "response", created_at: Math.floor(Date.now() / 1000),
    status: "completed", error: null, incomplete_details: null, model: "flower-timeout-probe",
    output, parallel_tool_calls: false, store: false, metadata: {},
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2,
      input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } },
  };
}

/**
 * 发送已查证的 SSE 调用或最终文本序列，不依赖真实模型。
 * @param {object} response HTTP 响应
 * @param {number} number 主请求序号
 * @param {object|string} value 工具调用或最终文本
 * @returns {void}
 */
function 发送事件(response, number, value) {
  const call = typeof value !== "string";
  const custom = call && value.type === "custom";
  const item = call
    ? { id: `fc_flower_${number}`, type: custom ? "custom_tool_call" : "function_call", call_id: "call_flower_timer", name: value.name,
      ...(value.namespace ? { namespace: value.namespace } : {}),
      ...(custom ? { input: value.input } : { arguments: JSON.stringify(value.arguments) }), status: "completed" }
    : { id: `msg_flower_${number}`, type: "message", role: "assistant", phase: "final_answer", status: "completed",
      content: [{ type: "output_text", text: value, annotations: [], logprobs: [] }] };
  const completed = 构造响应(number, [item]);
  const events = [
    { type: "response.created", response: { ...completed, status: "in_progress", output: [] } },
    { type: "response.output_item.added", response_id: completed.id, output_index: 0,
      item: call ? { ...item, status: "in_progress", ...(custom ? { input: "" } : { arguments: "" }) } : { ...item, status: "in_progress", content: [] } },
  ];
  if (custom) {
    events.push(
      { type: "response.custom_tool_call_input.delta", item_id: item.id, output_index: 0, delta: item.input },
      { type: "response.custom_tool_call_input.done", item_id: item.id, output_index: 0, input: item.input },
    );
  } else if (call) {
    events.push(
      { type: "response.function_call_arguments.delta", response_id: completed.id, item_id: item.id, output_index: 0, delta: item.arguments },
      { type: "response.function_call_arguments.done", response_id: completed.id, item_id: item.id, output_index: 0, arguments: item.arguments },
    );
  } else {
    const part = item.content[0];
    events.push(
      { type: "response.content_part.added", item_id: item.id, output_index: 0, content_index: 0, part: { ...part, text: "" } },
      { type: "response.output_text.delta", item_id: item.id, output_index: 0, content_index: 0, delta: value, logprobs: [] },
      { type: "response.output_text.done", item_id: item.id, output_index: 0, content_index: 0, text: value, logprobs: [] },
      { type: "response.content_part.done", item_id: item.id, output_index: 0, content_index: 0, part },
    );
  }
  events.push({ type: "response.output_item.done", response_id: completed.id, output_index: 0, item },
    { type: "response.completed", response: completed });
  response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "close" });
  for (const [index, event] of events.entries()) {
    response.write(`event: ${event.type}\ndata: ${JSON.stringify({ ...event, sequence_number: index })}\n\n`);
  }
  response.end();
}

/**
 * 从 Linux 自有进程树读取身份，防止清理时误杀被复用的 PID。
 * @param {number} pid 待观察的进程
 * @returns {object|null} 不含命令参数的身份
 */
function 读取进程(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const fields = stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/);
    return { pid, start: fields[19], state: fields[0] };
  } catch { return null; }
}

/**
 * 枚举自己启动的 TUI 后代；不扫描无关进程或读取其环境变量。
 * @param {number} rootPid 专用 TUI PID
 * @returns {object[]} 当前可见的自有后代身份
 */
function 读取后代(rootPid) {
  const queue = [rootPid];
  const seen = new Set();
  const result = [];
  while (queue.length && seen.size < 256) {
    const pid = queue.shift();
    if (seen.has(pid)) continue;
    seen.add(pid);
    const identity = 读取进程(pid);
    if (!identity) continue;
    result.push(identity);
    try {
      for (const task of readdirSync(`/proc/${pid}/task`)) {
        const text = readFileSync(`/proc/${pid}/task/${task}/children`, "utf8").trim();
        if (text) queue.push(...text.split(/\s+/).map(Number));
      }
    } catch { /* 进程正常退出与枚举可以竞争，不把它误判为探针异常。 */ }
  }
  return result;
}

/**
 * 启动有界、无人输入的真实 TUI 实验，并只保存摘要。
 * @param {object} options 已解析的运行选项
 * @returns {Promise<void>} 清理完成后返回
 */
async function 执行探针(options) {
  if (process.platform !== "linux") throw new Error("最小探针目前只验证 Linux 进程清理");
  const version = execFileSync(options.codex, ["--version"], { encoding: "utf8", timeout: 3000 }).trim();
  if (version !== "codex-cli 0.167.0") throw new Error("探针只核对过 Codex 0.167.0");
  const parent = path.join(ROOT, ".trellis-tmp");
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  const sandbox = mkdtempSync(path.join(parent, "confirmation-timeout-codex-"));
  execFileSync("git", ["init", "--quiet", sandbox], { stdio: "ignore" });
  const eventsFile = path.join(sandbox, "events.jsonl");
  const start = performance.now();
  const state = { 主请求数: 0, 辅助请求数: 0, 重试数: 0, 最终等待输出毫秒: null, 继续输出毫秒: null,
    后台会话已返回: false, 计时进程启动毫秒: null, 计时进程结束毫秒: null,
    合格后续请求: false, 请求包含完成标记: false, 人工输入次数: 0, 轮询工具调用次数: 0,
    测试结果: "尚未完成", 退出码: null, 启动诊断: null };
  let child;
  let nativeServer;
  let timerIdentity;
  let finished = false;
  let phase = 0;
  let baselineMarkers = 0;
  let mainThreadId;
  let terminalText = "";
  let terminalControl = "";
  let monitor;
  let hardTimeout;
  let idleTimeout;
  let resolveDone;
  const done = new Promise((resolve) => { resolveDone = resolve; });
  const owned = new Map();
  const responses = new Map();
  const sockets = new Set();

  /** 写入固定白名单摘要，永不接收原始提示或请求头。 */
  function 记录事件(事件, 摘要 = {}) {
    const entry = { 事件, 相对毫秒: Math.round(performance.now() - start), ...摘要 };
    appendFileSync(eventsFile, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
    process.stdout.write(`${entry.相对毫秒}ms ${事件}\n`);
  }

  /** 标记本次观察完成，由单一 finally 统一清理。 */
  function 完成(结果) {
    if (finished) return;
    finished = true;
    state.测试结果 = 结果;
    记录事件("观察结束", { 结果 });
    resolveDone();
  }

  /** 只终止当前仍具有相同启动身份的自有进程。 */
  function 终止自有进程(signal) {
    for (const identity of [...owned.values()].reverse()) {
      if (读取进程(identity.pid)?.start !== identity.start) continue;
      try { process.kill(identity.pid, signal); } catch { /* 退出与清理竞争可以忽略。 */ }
    }
  }

  const server = createServer(async (request, response) => {
    const localPath = request.url?.split("?")[0];
    if (request.method !== "POST" || localPath !== "/v1/responses") {
      state.辅助请求数++;
      记录事件("辅助或外连代理请求已拒绝", { 序号: state.辅助请求数 });
      response.writeHead(403).end();
      return;
    }
    try {
      // 只比较本探针 dummy；任何其他认证都立即拒绝，不打印或保存其值。
      if (request.headers.authorization !== `Bearer ${DUMMY}`) {
        response.writeHead(403).end();
        完成("失败：自定义 provider 未使用指定 dummy");
        return;
      }
      const body = await 读取请求(request);
      const metadata = JSON.parse(body.client_metadata?.["x-codex-turn-metadata"] || "{}");
      记录事件("请求控制分类", { 来源: metadata.thread_source, 类型: metadata.request_kind, 触发: metadata.turn_trigger });
      const threadId = body.client_metadata?.thread_id;
      if (metadata.thread_source === "thread_title" || (mainThreadId && threadId !== mainThreadId)) {
        state.辅助请求数++;
        记录事件("其他线程辅助请求", { 序号: state.辅助请求数 });
        发送事件(response, 1000 + state.辅助请求数, "FLOWER_AUXILIARY");
        return;
      }
      mainThreadId ||= threadId;
      const additional = (Array.isArray(body.input) ? body.input : []).filter((item) => item.type === "additional_tools");
      if (additional.length > 0) {
        const shapes = additional.map((item) => {
          const shape = {};
          for (const [key, value] of Object.entries(item)) {
            shape[key] = Array.isArray(value)
              ? { 类型: "数组", 个数: value.length, 首项字段: value[0] && typeof value[0] === "object" ? Object.keys(value[0]) : typeof value[0] }
              : value && typeof value === "object" ? { 类型: "对象", 字段: Object.keys(value) } : { 类型: typeof value };
          }
          return shape;
        });
        记录事件("附加工具载体结构", { 项: shapes });
      }
      body.tools = [...(Array.isArray(body.tools) ? body.tools : []), ...additional.flatMap((item) => item.tools)];
      if (!Array.isArray(body.tools) || body.tools.length === 0) {
        state.辅助请求数++;
        记录事件("无工具请求对照", { 序号: state.辅助请求数, 字段: Object.keys(body), 模型: body.model,
          输入类型: Array.isArray(body.input) ? body.input.map((item) => ({ 类型: item.type, 角色: item.role })) : typeof body.input });
        发送事件(response, 1000 + state.辅助请求数, "FLOWER_AUXILIARY");
        return;
      }
      const number = ++state.主请求数;
      const summary = 归纳输入(body);
      if (phase === 1) 记录事件("计时后输入结构", { 项: body.input.map((item) => ({ 类型: item.type,
        角色: item.role, 字段: Object.keys(item), 内容: Array.isArray(item.content)
          ? item.content.map((part) => ({ 类型: part.type, 字段: Object.keys(part) })) : typeof item.content })) });
      const fingerprint = createHash("sha256").update(JSON.stringify({ input: body.input, previous_response_id: body.previous_response_id })).digest("hex");
      记录事件("主请求", { 序号: number, 输入摘要: summary });
      if (responses.has(fingerprint)) {
        state.重试数++;
        记录事件("相同输入重试", { 序号: number });
        发送事件(response, number, responses.get(fingerprint));
        return;
      }
      let output;
      if (phase === 0) {
        记录事件("真实工具结构摘要", { 工具: (body.tools || []).map((tool) => ({
          名称: tool.name, 类型: tool.type, 子工具: tool.tools?.map((nested) => ({ 名称: nested.name, 类型: nested.type, 字段: Object.keys(nested) })),
        })) });
        const codeTool = body.tools.find((tool) => tool.name === "functions")?.tools?.find((tool) => tool.name === "exec");
        if (codeTool) writeFileSync(path.join(sandbox, "exec-tool-schema.json"), `${JSON.stringify(codeTool, null, 2)}\n`, { mode: 0o600 });
        output = 选择命令工具(body, options, sandbox);
        phase = 1;
        记录事件("计时工具已核对并返回", { 序号: number, 工具名: output.name, 参数名: output.keys });
      } else if (phase === 1) {
        const timerOutput = body.input.find((item) => ["function_call_output", "custom_tool_call_output"].includes(item.type)
          && item.call_id === "call_flower_timer");
        if (timerOutput) 记录事件("计时工具原生结果", { 输出: timerOutput.output });
        state.后台会话已返回 = summary.计时调用结果存在 && summary.后台会话已返回;
        if (!state.后台会话已返回 || summary.计时完成数 > 0) {
          output = "FLOWER_INCONCLUSIVE_TOOL_NOT_BACKGROUND";
          完成("未定：计时工具未先返回后台 session");
        } else {
          output = WAITING;
          baselineMarkers = summary.计时完成数;
          phase = 2;
          记录事件("最终等待响应已发送", { 序号: number });
        }
      } else {
        const eligible = state.最终等待输出毫秒 !== null && summary.计时完成数 > baselineMarkers;
        state.请求包含完成标记 ||= summary.计时完成数 > baselineMarkers;
        state.合格后续请求 ||= eligible;
        记录事件("后续主请求判定", { 序号: number, 最终标记已经输出: state.最终等待输出毫秒 !== null,
          新增完成标记: summary.计时完成数 > baselineMarkers, 合格: eligible });
        output = eligible ? RESUMED : "FLOWER_INCONCLUSIVE_FOLLOWUP";
      }
      responses.set(fingerprint, output);
      发送事件(response, number, output);
    } catch (error) {
      记录事件("协议或工具核验异常", { 类别: error?.name || "未知", 原因: /^真实工具/.test(error?.message || "") ? error.message : "未记录正文" });
      if (!response.headersSent) response.writeHead(422, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { type: "invalid_request_error", message: "FLOWER_PROBE_PROTOCOL_OR_TOOL_SCHEMA_UNSUPPORTED" } }));
      完成("未定：实际协议或工具 schema 不符合已核查入口");
    }
  });
  server.on("connection", (socket) => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  server.on("connect", (_request, socket) => {
    记录事件("HTTPS 外连代理已拒绝");
    socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
  });
  const interrupt = () => 完成("已取消：探针收到终止信号");
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  try {
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const port = server.address().port;
    const provider = `flower_timeout_probe_${randomUUID().replaceAll("-", "")}`;
    const overrides = [
      'model="gpt-6.1-sol"', `model_provider="${provider}"`,
      `model_providers.${provider}={name="Flower 本机计时研究",base_url="http://127.0.0.1:${port}/v1",wire_api="responses",env_key="FLOWER_TIMEOUT_PROBE_TOKEN",requires_openai_auth=false,supports_websockets=false}`,
      `log_dir=${JSON.stringify(path.join(sandbox, "native-logs"))}`,
      "features.hooks=false", "features.apps=false", "features.plugins=false", "features.memories=false",
      "features.unified_exec=true", "mcp_servers={}", 'web_search="disabled"',
      "features.shell_snapshot=false", "features.prevent_idle_sleep=false",
      "features.api_key_model_discovery=false",
      "check_for_update_on_startup=false",
      `projects={${JSON.stringify(sandbox)}={trust_level="trusted"}}`,
    ];
    if (options.mode !== "exec") {
      overrides.push("mcp_servers.mysql.enabled=false", "mcp_servers.openaiDeveloperDocs.enabled=false");
    }
    const prompt = "执行本次隔离的只读后台计时能力探针。只按本机 mock 的工具调用工作，最终回答后保持界面打开。";
    const configArguments = overrides.flatMap((value) => ["-c", value]);
    let socketPath;
    if (options.mode === "server-tui") {
      socketPath = path.join(sandbox, "probe.sock");
      nativeServer = 启动子进程(options.codex, ["app-server", "--listen", `unix://${socketPath}`, ...configArguments],
        { cwd: sandbox, env: 构造环境(port), stdio: "ignore" });
      nativeServer.on("error", () => 完成("未定：专用 App Server 启动失败"));
      const serverIdentity = 读取进程(nativeServer.pid);
      if (serverIdentity) owned.set(serverIdentity.pid, serverIdentity);
      记录事件("专用 App Server 已启动", { pid: nativeServer.pid, 说明: "独立server对照，不是默认managed daemon" });
      const serverStart = performance.now();
      while (!existsSync(socketPath)) {
        if (nativeServer.exitCode !== null || performance.now() - serverStart > 5000) throw new Error("专用服务未就绪");
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    const args = options.mode === "exec"
      ? ["exec", "--ignore-user-config", "--ignore-rules", "--ephemeral", "--skip-git-repo-check", "--json", "--sandbox", "read-only", "--cd", sandbox, ...configArguments, prompt]
      : [...(socketPath ? ["--remote", `unix://${socketPath}`] : ["--no-daemon"]), "--no-alt-screen", "--sandbox", "read-only",
      "--ask-for-approval", "on-request", "--cd", sandbox,
      ...configArguments, prompt];
    记录事件("独立原生 CLI 启动", { 版本: version, 模式: options.mode, 观察毫秒: options.idleMs });
    child = 启动PTY(options.codex, args, { cwd: sandbox, env: 构造环境(port), name: "xterm-256color", cols: 160, rows: 50 });
    记录事件("专用 CLI 进程已创建", { pid: child.pid, 工作目录: sandbox });
    const identity = 读取进程(child.pid);
    if (identity) owned.set(identity.pid, identity);
    child.onExit(({ exitCode }) => {
      state.退出码 = exitCode;
      记录事件("专用 TUI 已退出", { 退出码: exitCode });
      完成(options.mode === "exec" ? "exec 对照已退出，不能作为空闲 TUI 证据" : "未定：TUI 在观察结束前退出");
    });
    child.onData((chunk) => {
      // 只回复终端设备查询，不输入用户消息、/命令、write_stdin 或轮询请求。
      terminalControl = (terminalControl + chunk).slice(-512);
      if (terminalControl.includes("\x1b[6n")) {
        terminalControl = terminalControl.replaceAll("\x1b[6n", "");
        child.write("\x1b[1;1R");
        记录事件("终端位置查询已应答");
      }
      if (terminalControl.includes("\x1b[c") || terminalControl.includes("\x1b[0c")) {
        terminalControl = terminalControl.replaceAll("\x1b[c", "").replaceAll("\x1b[0c", "");
        child.write("\x1b[?1;2c");
        记录事件("普通终端设备属性已应答");
      }
      terminalText = (terminalText + chunk).replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "").replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").slice(-16384);
      if (terminalText.includes(WAITING) && state.最终等待输出毫秒 === null) {
        state.最终等待输出毫秒 = Math.round(performance.now() - start);
        记录事件("PTY 已输出最终等待标记");
        idleTimeout = setTimeout(() => 完成(state.合格后续请求 && state.继续输出毫秒 !== null
          ? "通过：最终回答后收到携带后台完成标记的原生续接"
          : "未观察到满足判据的原生续接"), options.idleMs);
      }
      if (terminalText.includes(RESUMED) && state.继续输出毫秒 === null) {
        state.继续输出毫秒 = Math.round(performance.now() - start);
        记录事件("PTY 已输出继续标记");
      }
    });
    monitor = setInterval(() => {
      for (const proc of [...读取后代(child.pid), ...(nativeServer ? 读取后代(nativeServer.pid) : [])]) {
        owned.set(proc.pid, proc);
        if (!timerIdentity) {
          try {
            const name = readFileSync(`/proc/${proc.pid}/comm`, "utf8").trim();
            if (name === "python3" && readFileSync(`/proc/${proc.pid}/cmdline`, "utf8").split("\0").includes(PYTHON)) {
              timerIdentity = proc;
              state.计时进程启动毫秒 = Math.round(performance.now() - start);
              记录事件("自有计时进程已出现");
            }
          } catch { /* 短命自有后代允许在观察期间退出。 */ }
        }
      }
      if (timerIdentity && state.计时进程结束毫秒 === null) {
        const current = 读取进程(timerIdentity.pid);
        if (!current || current.start !== timerIdentity.start || current.state === "Z") {
          state.计时进程结束毫秒 = Math.round(performance.now() - start);
          记录事件("自有计时进程已结束");
        }
      }
    }, 100);
    hardTimeout = setTimeout(() => 完成("未定：达到总超时"), options.totalMs - 2500);
    await done;
  } finally {
    clearInterval(monitor);
    clearTimeout(hardTimeout);
    clearTimeout(idleTimeout);
    if (child) for (const proc of 读取后代(child.pid)) owned.set(proc.pid, proc);
    if (nativeServer) for (const proc of 读取后代(nativeServer.pid)) owned.set(proc.pid, proc);
    终止自有进程("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 700));
    终止自有进程("SIGKILL");
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);
    if (state.主请求数 === 0) {
      state.启动诊断 = terminalText.replace(/Bearer\s+\S+/gi, "Bearer [已隐藏]")
        .replace(/sk-[a-zA-Z0-9_-]+/g, "[已隐藏]")
        .replace(/^.*codex_rollout::recorder:.*$/gm, "[原生历史索引诊断，正文已省略]")
        .replace(/\/root\/[^\s]+/g, "[本地路径]").slice(-3000);
      记录事件("启动诊断", { 摘要: state.启动诊断 });
      process.stdout.write(`启动诊断：${state.启动诊断}\n`);
    }
    writeFileSync(path.join(sandbox, "result.json"), `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    process.stdout.write(`研究摘要：${path.join(sandbox, "result.json")}\n`);
    process.exitCode = state.测试结果.startsWith("通过") ? 0 : 2;
  }
}

try {
  const options = 解析参数(process.argv.slice(2));
  if (options.run) await 执行探针(options);
  else process.stdout.write("运行需显式 --run。可选：--mode tui|exec|server-tui --codex 路径 --yield-ms 250|1000 --idle-ms 8000 --total-ms 40000。\n");
} catch {
  // 外部异常可能含配置值、提示或路径周边内容，故不打印原始异常或堆栈。
  process.stderr.write("探针未能启动或完成；未记录原始异常、提示正文或认证信息。请先检查版本、参数和审查说明。\n");
  process.exitCode = 2;
}
