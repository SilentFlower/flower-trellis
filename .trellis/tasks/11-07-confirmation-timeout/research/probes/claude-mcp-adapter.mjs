/**
 * 为统一前台控制器准备 Claude 的隔离 MCP 等待实验。
 * 本模块不启动 CLI、MCP 服务器、PTY 或网络连接；运行与清理由根控制器拥有。
 * @module claude-mcp-adapter
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const SERVER_NAME = "flower_confirmation_probe";
const PERMISSION_NAME = "mcp__flower_confirmation_probe__wait";
const EXPECTED_VERSION = "2.1.293";
const TOOL_TIMEOUT_MS = 300000;
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const SETUP_FIXTURE = path.join(PROJECT_ROOT, ".trellis-tmp/confirmation-timeout-claude-A1Ktoy/config");

/**
 * 从 PATH 解析当前 Claude 的实际可执行文件，不运行进程。
 * @returns {string} 已存在且可执行的绝对路径。
 */
function resolveClaudeExecutable() {
  for (const directory of (process.env.PATH || "").split(path.delimiter)) {
    if (!directory) continue;
    const candidate = path.join(directory, "claude");
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return fs.realpathSync(candidate);
    } catch {
      // 仅继续检查本地 PATH，不调用 shell 或安装程序。
    }
  }
  throw new Error("找不到本轮已核对的本地 Claude 可执行文件");
}

/**
 * 从官方安装包元数据核对版本，避免准备阶段启动 CLI。
 * @param {string} executable 已解析的可执行文件。
 * @returns {string} 官方安装包版本。
 */
function installedVersion(executable) {
  let directory = path.dirname(executable);
  for (let depth = 0; depth < 6; depth += 1) {
    const metadataPath = path.join(directory, "package.json");
    if (fs.existsSync(metadataPath)) {
      const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
      if (metadata.name === "@anthropic-ai/claude-code") {
        if (metadata.version !== EXPECTED_VERSION) throw new Error("Claude 安装版本变化，需要先重新核对实验参数");
        return metadata.version;
      }
    }
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  throw new Error("无法只靠已安装官方元数据核实 Claude 版本；请根控制器先核对安装位置");
}

/**
 * 读取已完成的本探针设置，仅返回明示允许复制的非凭据字段。
 * @returns {{global: object, theme: string|undefined}} 安全设置片段。
 */
function readSetupFixture() {
  const selected = {};
  const globalFile = path.join(SETUP_FIXTURE, ".claude.json");
  if (fs.existsSync(globalFile)) {
    const fixture = JSON.parse(fs.readFileSync(globalFile, "utf8"));
    if (fixture.hasCompletedOnboarding === true) selected.hasCompletedOnboarding = true;
    for (const key of ["lastOnboardingVersion", "lastReleaseNotesSeen"]) {
      if (fixture[key] === EXPECTED_VERSION) selected[key] = EXPECTED_VERSION;
    }
    // 仅迁移此前由主会话明确批准的 dummy；不迁移其他 key 或任何项目的 trust。
    if (fixture.customApiKeyResponses?.approved?.includes("dummy")) {
      selected.customApiKeyResponses = { approved: ["dummy"], rejected: [] };
    }
  }
  let theme;
  const settingsFile = path.join(SETUP_FIXTURE, "settings.json");
  if (fs.existsSync(settingsFile)) {
    const fixture = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
    if (fixture.theme === "dark") theme = "dark";
  }
  return { global: selected, theme };
}

/**
 * 准备普通 TUI 的隔离配置与单个 MCP 服务器，绝不自动批准新目录的信任提示。
 * @param {object} options 根控制器提供的实验参数。
 * @param {string} options.sandbox 已由根控制器 git init 的独立目录，也是后续 PTY 的 cwd。
 * @param {number} options.mockPort 只绑定 127.0.0.1 的 Messages mock 端口。
 * @param {number} options.controlPort 根控制器为等待服务器提供的回环控制端口。
 * @param {string} options.nonce 此次实验专属的控制通道随机代号，不写入诊断。
 * @param {string} options.mcpServerPath 根控制器拥有的 Node stdio MCP 服务器脚本。
 * @param {string} options.requestId 本实验固定为 probe。
 * @returns {{executable: string, args: string[], env: object, version: string}} 不含初始提示词的启动配置。
 */
export function prepareClaude({ sandbox, mockPort, controlPort, nonce, mcpServerPath, requestId }) {
  if (process.platform !== "linux") throw new Error("本轮 Claude 普通 TUI 适配仅核对了 Linux");
  if (requestId !== "probe") throw new Error("本实验仅允许 request_id 为 probe");
  for (const port of [mockPort, controlPort]) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("实验回环端口无效");
  }
  if (typeof nonce !== "string" || !nonce || nonce.includes("\0")) throw new Error("实验控制通道代号无效");
  if (typeof sandbox !== "string" || !path.isAbsolute(sandbox)) throw new Error("sandbox 必须是独立实验目录的绝对路径");
  const directory = fs.realpathSync(sandbox);
  if (!fs.statSync(path.join(directory, ".git")).isDirectory()) throw new Error("sandbox 尚未具备独立的 .git 目录");
  if (directory === PROJECT_ROOT) throw new Error("不能把真实项目根目录用作实验 sandbox");
  if (typeof mcpServerPath !== "string" || !path.isAbsolute(mcpServerPath)
    || !fs.statSync(mcpServerPath).isFile()) throw new Error("MCP 服务器必须是根控制器提供的本地脚本绝对路径");
  for (const managedPath of ["/etc/claude-code/managed-settings.json", "/etc/claude-code/managed-settings.d"]) {
    if (fs.existsSync(managedPath)) throw new Error("存在机器级 Claude 受管配置，需根控制器先审查路由影响");
  }

  const executable = resolveClaudeExecutable();
  const version = installedVersion(executable);
  const privateDirectory = path.join(directory, ".claude-confirmation-probe");
  const configDirectory = path.join(privateDirectory, "config");
  fs.mkdirSync(configDirectory, { recursive: true, mode: 0o700 });
  const setup = readSetupFixture();
  const globalFile = path.join(configDirectory, ".claude.json");
  if (!fs.existsSync(globalFile)) {
    fs.writeFileSync(globalFile, JSON.stringify(setup.global, null, 2), { mode: 0o600, flag: "wx" });
  }
  const settingsFile = path.join(privateDirectory, "settings.json");
  const settings = {
    permissions: { allow: [PERMISSION_NAME], defaultMode: "dontAsk" },
    enabledPlugins: {}, hooks: {},
  };
  if (setup.theme) settings.theme = setup.theme;
  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2), { mode: 0o600 });
  const mcpFile = path.join(privateDirectory, "mcp.json");
  fs.writeFileSync(mcpFile, JSON.stringify({
    mcpServers: {
      [SERVER_NAME]: {
        type: "stdio", command: process.execPath, args: [fs.realpathSync(mcpServerPath)],
        env: {
          FLOWER_CONFIRMATION_PROBE_PORT: String(controlPort),
          FLOWER_CONFIRMATION_PROBE_NONCE: nonce,
        },
        timeout: TOOL_TIMEOUT_MS,
      },
    },
  }, null, 2), { mode: 0o600 });

  // 不复制宿主的认证或代理变量；HOME 仅保持原值，隔离配置由专用变量承载。
  const env = {};
  for (const key of ["PATH", "HOME", "LANG", "LC_ALL", "TMPDIR"]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  const address = `http://127.0.0.1:${mockPort}`;
  Object.assign(env, {
    TERM: "xterm-256color", CLAUDE_CONFIG_DIR: configDirectory,
    ANTHROPIC_BASE_URL: address, ANTHROPIC_API_KEY: "dummy",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1", DISABLE_TELEMETRY: "1",
    DISABLE_ERROR_REPORTING: "1", DISABLE_AUTOUPDATER: "1", DISABLE_GROWTHBOOK: "1",
    CLAUDE_CODE_DISABLE_TERMINAL_TITLE: "1", CLAUDE_CODE_SKIP_PROMPT_HISTORY: "1",
    CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION: "false", CLAUDE_CODE_MAX_RETRIES: "0",
    CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS: "0", MCP_TOOL_TIMEOUT: String(TOOL_TIMEOUT_MS),
    CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT: String(TOOL_TIMEOUT_MS), ENABLE_TOOL_SEARCH: "false",
    API_TIMEOUT_MS: "5000", HTTP_PROXY: address, HTTPS_PROXY: address,
    NO_PROXY: "127.0.0.1,localhost,::1", no_proxy: "127.0.0.1,localhost,::1",
  });
  const args = [
    "--setting-sources", "", "--settings", settingsFile,
    "--mcp-config", mcpFile, "--strict-mcp-config", "--tools", "",
    "--permission-mode", "dontAsk", "--no-chrome", "--disable-slash-commands",
    "--prompt-suggestions", "false", "--model", "sonnet",
  ];
  return { executable, args, env, version };
}

/**
 * 复用旧探针已核对的 Messages SSE，支持同一响应的文本与工具调用混合块。
 * @param {import("node:http").ServerResponse} response 根 mock 的 HTTP 响应。
 * @param {object} body 根 mock 读取的 Messages 请求，不记录其原文。
 * @param {object[]} content 受控 text/tool_use 块。
 * @returns {void}
 */
export function sendClaudeMessage(response, body, content) {
  const message = {
    id: `msg_flower_${randomUUID().replaceAll("-", "")}`,
    type: "message", role: "assistant", model: body.model || "sonnet",
    content, stop_reason: content.some((block) => block.type === "tool_use") ? "tool_use" : "end_turn",
    stop_sequence: null, usage: { input_tokens: 20, output_tokens: 10 },
  };
  if (!body.stream) {
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
 * 从真实 Messages 工具定义选择本实验唯一的 wait，不推造工具名称或参数。
 * @param {object} body 根 mock 读取的 Messages 请求。
 * @param {string} requestId 固定的 probe 请求标识。
 * @returns {object|null} 可直接作为响应块的 tool_use；缺少或不匹配时返回 null。
 */
export function createClaudeToolCall(body, requestId) {
  const tools = Array.isArray(body?.tools) ? body.tools : [];
  const matches = tools.filter((tool) => typeof tool?.name === "string"
    && tool.name.includes(SERVER_NAME) && /(?:__|_)wait$/.test(tool.name));
  let reason;
  if (requestId !== "probe") reason = "请求标识不是 probe";
  else if (matches.length !== 1) reason = matches.length === 0 ? "请求中尚未暴露等待工具" : "等待工具名称不唯一";
  else {
    const schema = matches[0].input_schema;
    if (schema?.type !== "object" || !schema.properties
      || Object.keys(schema.properties).length !== 1 || schema.properties.request_id?.type !== "string"
      || !Array.isArray(schema.required) || schema.required.length !== 1 || schema.required[0] !== "request_id"
      || schema.additionalProperties !== false) reason = "真实等待工具的参数结构与实验合同不符";
  }
  if (reason) {
    process.stderr.write(`${JSON.stringify({ event: "Claude MCP 工具诊断", reason,
      observed_tools: tools.map((tool) => tool?.name).filter((name) => typeof name === "string").slice(0, 30) })}\n`);
    return null;
  }
  return { type: "tool_use", id: `toolu_flower_${randomUUID().replaceAll("-", "")}`,
    name: matches[0].name, input: { request_id: requestId } };
}
