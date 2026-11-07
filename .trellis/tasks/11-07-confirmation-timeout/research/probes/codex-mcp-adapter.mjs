import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

/** 本机 mock 专用占位值，不是真实凭据。 */
export const CODEX_PROBE_DUMMY = "flower-timeout-probe-dummy-not-a-real-key";
/** 统一实验 MCP server 的注册名。 */
export const CODEX_MCP_SERVER = "flower_confirmation_probe";
/** 关联本次 MCP 等待调用的固定协议标识。 */
export const CODEX_MCP_CALL_ID = "call_flower_confirmation_wait";

/**
 * 仅从 PATH 定位本机已安装文件并核对版本，不启动 CLI。
 * @returns {{executable:string,version:string}} 已核对的可执行文件及版本
 */
function 定位Codex() {
  for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
    const candidate = path.join(directory, "codex");
    if (!directory || !existsSync(candidate)) continue;
    const executable = realpathSync(candidate);
    const packageFile = path.resolve(path.dirname(executable), "../codex-package.json");
    if (!existsSync(packageFile)) throw new Error("本机 Codex 安装布局与研究证据不一致");
    const metadata = JSON.parse(readFileSync(packageFile, "utf8"));
    if (metadata.version !== "0.167.0") throw new Error("本适配器只核对过 Codex 0.167.0");
    return { executable, version: metadata.version };
  }
  throw new Error("PATH 中未找到本机 Codex");
}

/**
 * 为独立测试进程构造白名单环境，保留 HOME/home/CODEX_HOME 原值。
 * @param {number} port mock 回环端口
 * @returns {object} 不包含继承认证变量的环境
 */
function 构造环境(port) {
  const env = {};
  for (const key of ["HOME", "home", "CODEX_HOME", "CODEX_SQLITE_HOME", "PATH", "SHELL", "USER", "LOGNAME", "LANG", "LC_ALL", "LC_CTYPE", "TMPDIR", "TMP", "TEMP"]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return Object.assign(env, {
    TERM: "xterm-256color", COLORTERM: "truecolor", RUST_LOG: "warn", RUST_BACKTRACE: "0",
    FLOWER_TIMEOUT_PROBE_TOKEN: CODEX_PROBE_DUMMY,
    HTTP_PROXY: `http://127.0.0.1:${port}`, HTTPS_PROXY: `http://127.0.0.1:${port}`,
    ALL_PROXY: `http://127.0.0.1:${port}`, NO_PROXY: "127.0.0.1,localhost,::1",
    http_proxy: `http://127.0.0.1:${port}`, https_proxy: `http://127.0.0.1:${port}`,
    all_proxy: `http://127.0.0.1:${port}`, no_proxy: "127.0.0.1,localhost,::1",
  });
}

/**
 * 准备独立原生 TUI 参数；不写配置、不启动任何进程。
 * @param {object} options 根控制器准备的专用实验资源
 * @param {string} options.sandbox 已创建且已 git init 的专用绝对路径
 * @param {number} options.mockPort 本机 Responses mock 端口
 * @param {number} options.controlPort 等待 server 的本机控制端口
 * @param {string} options.nonce 本次控制通道随机标识
 * @param {string} options.mcpServerPath 已存在的 Node stdio MCP server 脚本
 * @param {string} options.requestId 本实验固定为 probe
 * @returns {{executable:string,args:string[],env:object,version:string}} 交给根控制器启动的参数
 */
export function prepareCodex({ sandbox, mockPort, controlPort, nonce, mcpServerPath, requestId = "probe" }) {
  if (!path.isAbsolute(sandbox) || !path.isAbsolute(mcpServerPath) || !existsSync(mcpServerPath)
    || !existsSync(path.join(sandbox, ".git")) || requestId !== "probe"
    || typeof nonce !== "string" || nonce.length < 8 || nonce.length > 256
    || ![mockPort, controlPort].every((port) => Number.isInteger(port) && port > 0 && port < 65536)) {
    throw new Error("Codex MCP 实验资源不符合固定合同");
  }
  const installed = 定位Codex();
  const provider = `flower_mcp_probe_${randomUUID().replaceAll("-", "")}`;
  const serverConfig = `{command=${JSON.stringify(process.execPath)},args=[${JSON.stringify(mcpServerPath)}],`
    + `env={FLOWER_CONFIRMATION_PROBE_PORT=${JSON.stringify(String(controlPort))},FLOWER_CONFIRMATION_PROBE_NONCE=${JSON.stringify(nonce)}},`
    + 'enabled=true,enabled_tools=["wait"],startup_timeout_sec=10,tool_timeout_sec=260,tools={wait={approval_mode="approve"}}}';
  const overrides = [
    'model="gpt-6.1-sol"', `model_provider="${provider}"`,
    `model_providers.${provider}={name="Flower MCP 等待研究",base_url="http://127.0.0.1:${mockPort}/v1",wire_api="responses",env_key="FLOWER_TIMEOUT_PROBE_TOKEN",requires_openai_auth=false,supports_websockets=false}`,
    `log_dir=${JSON.stringify(path.join(sandbox, "native-logs"))}`,
    "features.hooks=false", "features.apps=false", "features.plugins=false", "features.memories=false",
    "features.unified_exec=true", 'web_search="disabled"', "features.shell_snapshot=false",
    "features.prevent_idle_sleep=false", "features.api_key_model_discovery=false", "check_for_update_on_startup=false",
    "mcp_servers.mysql.enabled=false", "mcp_servers.openaiDeveloperDocs.enabled=false",
    `mcp_servers.${CODEX_MCP_SERVER}=${serverConfig}`,
    `projects={${JSON.stringify(sandbox)}={trust_level="trusted"}}`,
  ];
  return {
    ...installed,
    args: ["--no-daemon", "--no-alt-screen", "--sandbox", "read-only", "--ask-for-approval", "on-request",
      "--cd", sandbox, ...overrides.flatMap((value) => ["-c", value]),
      "展示本次只读确认方案后，调用已注册的统一 MCP 等待工具；只根据工具的可核验决定输出结果，不运行其他动作。"],
    env: 构造环境(mockPort),
  };
}

/**
 * 收集主工具和已验证 additional_tools 载体，不修改原请求。
 * @param {object} body 原生 Responses 请求
 * @returns {object[]} 实际广告的工具定义
 */
function 收集工具(body) {
  return [...(Array.isArray(body.tools) ? body.tools : []),
    ...(Array.isArray(body.input) ? body.input : []).filter((item) => item.type === "additional_tools")
      .flatMap((item) => Array.isArray(item.tools) ? item.tools : [])];
}

/**
 * 根据实际广告定义构造等待调用，延迟工具只通过 ALL_TOOLS 元数据定位。
 * @param {object} body 原生 Responses 请求
 * @returns {{call:object,toolSummary:object}} 调用与不含定义正文的尺寸摘要
 */
function 构造等待调用(body) {
  const candidates = [];
  for (const tool of 收集工具(body)) {
    if (tool.type === "function") candidates.push(tool);
    if (tool.type === "namespace" && Array.isArray(tool.tools)) {
      for (const nested of tool.tools) candidates.push({ ...nested, namespace: tool.name });
    }
  }
  const direct = candidates.find((tool) => tool.type === "function"
    && ((tool.namespace === CODEX_MCP_SERVER && tool.name === "wait")
      || /(?:^|__)flower_confirmation_probe__wait$/.test(tool.name)));
  if (direct) {
    const schema = direct.parameters;
    if (schema?.properties?.request_id?.type !== "string" || !(schema.required ?? []).includes("request_id")
      || (schema.required ?? []).some((key) => key !== "request_id")) throw new Error("实际 MCP wait schema 不匹配");
    return {
      call: { type: "function", name: direct.name, namespace: direct.namespace, arguments: { request_id: "probe" } },
      toolSummary: { exposure: "direct", name: direct.name, definitionBytes: Buffer.byteLength(JSON.stringify(direct)),
        descriptionBytes: Buffer.byteLength(direct.description ?? "") },
    };
  }
  const executor = candidates.find((tool) => tool.namespace === "functions" && tool.name === "exec"
    && tool.type === "custom" && tool.format?.type === "grammar" && tool.format.syntax === "lark"
    && typeof tool.description === "string" && tool.description.includes("ALL_TOOLS"));
  if (!executor) throw new Error("实际工具没有可核验的 MCP wait 或 code-mode 入口");
  // 这里仅通过宿主提供的实际元数据取名，不把惯用 MCP 名称拼成调用目标。
  const input = [
    '// @exec: {"yield_time_ms":260000,"max_output_tokens":500}',
    'const byteLength = (value) => encodeURIComponent(value).replace(/%[A-F0-9]{2}/g,"_").length;',
    'const matches = ALL_TOOLS.filter((entry) => /(?:^|__)flower_confirmation_probe__wait$/.test(entry.name));',
    'if (matches.length !== 1) throw new Error("本次 MCP wait 元数据不唯一或尚未可用");',
    'const selected = matches[0];',
    'text(JSON.stringify({probe:"FLOWER_MCP_TOOL_META",name:selected.name,metadata_bytes:byteLength(JSON.stringify(selected)),description_bytes:byteLength(selected.description)}));',
    'const result = await tools[selected.name]({request_id:"probe"});',
    'if (result?.isError || !Array.isArray(result?.content)) throw new Error("MCP wait 未返回正常结果");',
    'const results = result.content.filter((part) => part.type === "text").map((part) => JSON.parse(part.text));',
    'const outcome = results.find((value) => value.request_id === "probe" && ((value.source === "policy_timeout" && value.decision === "continue") || (value.source === "cancelled" && value.decision === "stop")));',
    'if (!outcome) throw new Error("MCP wait 结果不符合研究合同");',
    'text(JSON.stringify({probe:"FLOWER_MCP_RESULT",request_id:outcome.request_id,source:outcome.source,decision:outcome.decision}));',
  ].join("\n");
  return {
    call: { type: "custom", name: executor.name, namespace: executor.namespace, input },
    toolSummary: { exposure: "code-mode", wrapperName: "functions.exec",
      wrapperDefinitionBytes: Buffer.byteLength(JSON.stringify(executor)), metadataPending: true },
  };
}

/**
 * 包装已验证的 Responses SSE 事件；首次调用可在同一响应先输出方案标记。
 * @param {object} options 输出参数
 * @param {number} options.sequence 本次响应的独立序号
 * @param {string} [options.text] 最终文本
 * @param {object} [options.toolCall] 实际工具定义派生的调用
 * @param {string} [options.planText] 工具前的 commentary 方案文本
 * @returns {object[]} 有序事件；发送与网络生命周期由根控制器负责
 */
export function buildCodexResponseEvents({ sequence, text, toolCall, planText }) {
  if (!Number.isInteger(sequence) || sequence < 1 || (typeof text === "string") === Boolean(toolCall)) {
    throw new Error("Responses 研究输出参数不合法");
  }
  const items = [];
  if (typeof planText === "string") items.push({ id: `msg_flower_plan_${sequence}`, type: "message", role: "assistant",
    phase: "commentary", status: "completed", content: [{ type: "output_text", text: planText, annotations: [], logprobs: [] }] });
  if (toolCall) items.push({ id: `fc_flower_mcp_${sequence}`, type: toolCall.type === "custom" ? "custom_tool_call" : "function_call",
    call_id: CODEX_MCP_CALL_ID, name: toolCall.name, ...(toolCall.namespace ? { namespace: toolCall.namespace } : {}),
    ...(toolCall.type === "custom" ? { input: toolCall.input } : { arguments: JSON.stringify(toolCall.arguments) }), status: "completed" });
  else items.push({ id: `msg_flower_final_${sequence}`, type: "message", role: "assistant", phase: "final_answer",
    status: "completed", content: [{ type: "output_text", text, annotations: [], logprobs: [] }] });
  const completed = { id: `resp_flower_mcp_${sequence}`, object: "response", created_at: Math.floor(Date.now() / 1000),
    status: "completed", error: null, incomplete_details: null, model: "gpt-6.1-sol", output: items,
    parallel_tool_calls: false, store: false, metadata: {}, usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2,
      input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } };
  const events = [{ type: "response.created", response: { ...completed, status: "in_progress", output: [] } }];
  for (const [index, item] of items.entries()) {
    const custom = item.type === "custom_tool_call";
    const message = item.type === "message";
    events.push({ type: "response.output_item.added", response_id: completed.id, output_index: index,
      item: { ...item, status: "in_progress", ...(message ? { content: [] } : custom ? { input: "" } : { arguments: "" }) } });
    if (message) {
      const part = item.content[0];
      events.push(
        { type: "response.content_part.added", item_id: item.id, output_index: index, content_index: 0, part: { ...part, text: "" } },
        { type: "response.output_text.delta", item_id: item.id, output_index: index, content_index: 0, delta: part.text, logprobs: [] },
        { type: "response.output_text.done", item_id: item.id, output_index: index, content_index: 0, text: part.text, logprobs: [] },
        { type: "response.content_part.done", item_id: item.id, output_index: index, content_index: 0, part },
      );
    } else if (custom) events.push(
      { type: "response.custom_tool_call_input.delta", item_id: item.id, output_index: index, delta: item.input },
      { type: "response.custom_tool_call_input.done", item_id: item.id, output_index: index, input: item.input },
    );
    else events.push(
      { type: "response.function_call_arguments.delta", item_id: item.id, output_index: index, delta: item.arguments },
      { type: "response.function_call_arguments.done", item_id: item.id, output_index: index, arguments: item.arguments },
    );
    events.push({ type: "response.output_item.done", response_id: completed.id, output_index: index, item });
  }
  events.push({ type: "response.completed", response: completed });
  return events.map((event, sequence_number) => ({ ...event, sequence_number }));
}

/**
 * 将事件编码为 SSE；不创建服务或记录任何正文。
 * @param {object[]} events 已构造的有序事件
 * @returns {string} 可直接写入 text/event-stream 响应的载荷
 */
export function encodeCodexSse(events) {
  return events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("");
}

/**
 * 只从关联工具结果提取安全决定和定义尺寸，不读取历史 prompt 正文。
 * @param {object} body 原生 Responses 请求
 * @returns {object} 根控制器可以记录的有限摘要
 */
function 提取等待结果(body) {
  const summary = { found: false, pendingCell: false, outcome: null, metadata: null };
  for (const item of Array.isArray(body.input) ? body.input : []) {
    if (!["function_call_output", "custom_tool_call_output"].includes(item.type) || item.call_id !== CODEX_MCP_CALL_ID) continue;
    summary.found = true;
    const texts = typeof item.output === "string" ? [item.output]
      : (Array.isArray(item.output) ? item.output : []).flatMap((part) => typeof part.text === "string" ? [part.text] : []);
    for (const text of texts) {
      summary.pendingCell ||= /Script running with cell ID/.test(text);
      for (const fragment of text.match(/\{[^{}\n]*\}/g) ?? []) {
        let value;
        try { value = JSON.parse(fragment); } catch { continue; }
        if (value.probe === "FLOWER_MCP_TOOL_META" && typeof value.name === "string"
          && /(?:^|__)flower_confirmation_probe__wait$/.test(value.name)
          && Number.isInteger(value.metadata_bytes) && Number.isInteger(value.description_bytes)) {
          summary.metadata = { name: value.name, metadataBytes: value.metadata_bytes, descriptionBytes: value.description_bytes };
        }
        if (value.request_id === "probe" && ((value.source === "policy_timeout" && value.decision === "continue")
          || (value.source === "cancelled" && value.decision === "stop"))) {
          summary.outcome = { request_id: "probe", source: value.source, decision: value.decision };
        }
      }
    }
  }
  return summary;
}

/**
 * 为单一实验处理请求并返回 SSE 事件，不拥有 HTTP 或进程生命周期。
 * @param {object} body 已解析的 Responses 请求；不得落盘完整正文
 * @param {object} state 每个实验新建的可变状态；不要跨 nonce 或进程复用
 * @returns {{events:object[],auxiliary:boolean,phase:string,toolSummary:object|null,summary:object|null,retry:boolean}} 安全分类与 mock 输出
 */
export function handleCodexRequest(body, state) {
  if (!state || typeof state !== "object") throw new Error("需要本次实验的独立 state");
  state.sequence = (state.sequence ?? 0) + 1;
  const sequence = state.sequence;
  let metadata = {};
  try { metadata = JSON.parse(body.client_metadata?.["x-codex-turn-metadata"] ?? "{}"); } catch { /* 缺失辅助元数据不读取正文补猜。 */ }
  const threadId = body.client_metadata?.thread_id;
  const tools = 收集工具(body);
  if (metadata.thread_source === "thread_title" || (state.mainThreadId && threadId && threadId !== state.mainThreadId)
    || (!state.phase && tools.length === 0)) {
    return { events: buildCodexResponseEvents({ sequence, text: "FLOWER_AUXILIARY" }), auxiliary: true,
      phase: "auxiliary", toolSummary: null, summary: null, retry: false };
  }
  state.mainThreadId ??= threadId;
  state.replies ??= new Map();
  const fingerprint = createHash("sha256").update(JSON.stringify({ input: body.input, previous_response_id: body.previous_response_id })).digest("hex");
  if (state.replies.has(fingerprint)) return { ...state.replies.get(fingerprint), retry: true };
  let reply;
  if (!state.phase) {
    const selected = 构造等待调用(body);
    state.phase = "waiting";
    state.toolSummary = selected.toolSummary;
    reply = { events: buildCodexResponseEvents({ sequence, planText: "FLOWER_MCP_PLAN", toolCall: selected.call }),
      auxiliary: false, phase: "waiting", toolSummary: selected.toolSummary, summary: null, retry: false };
  } else {
    const summary = 提取等待结果(body);
    if (summary.metadata) state.toolSummary = { ...state.toolSummary, ...summary.metadata, metadataPending: false };
    const phase = summary.outcome?.source === "policy_timeout" ? "continued"
      : summary.outcome?.source === "cancelled" ? "cancelled" : summary.pendingCell ? "pending" : "unverified";
    state.phase = phase;
    reply = { events: buildCodexResponseEvents({ sequence, text: phase === "continued" ? "FLOWER_MCP_CONTINUED"
      : phase === "cancelled" ? "FLOWER_MCP_CANCELLED" : phase === "pending" ? "FLOWER_MCP_PENDING" : "FLOWER_MCP_UNVERIFIED" }),
    auxiliary: false, phase, toolSummary: state.toolSummary ?? null, summary, retry: false };
  }
  state.replies.set(fingerprint, reply);
  return reply;
}
