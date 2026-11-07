/**
 * 隔离实验专用的最小 stdio MCP 服务，只提供一个等待工具。
 * @module mcp-wait-server
 */
import { createConnection } from "node:net";
import { createInterface } from "node:readline";

export const WAIT_TOOL = {
  name: "wait",
  description: "等待已展示方案的人工决定或超时结果；取消时不得执行默认动作。",
  inputSchema: { type: "object", properties: { request_id: { type: "string" } },
    required: ["request_id"], additionalProperties: false },
};

const pending = new Map();
const port = Number(process.env.FLOWER_CONFIRMATION_PROBE_PORT);
const nonce = process.env.FLOWER_CONFIRMATION_PROBE_NONCE;
if (!Number.isInteger(port) || port < 1 || !nonce) process.exit(2);

/**
 * 向 MCP 客户端发送一条协议响应，不将日志混入 stdout。
 * @param {string|number} id 请求标识。
 * @param {object} result 协议结果。
 * @returns {void}
 */
function reply(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

/**
 * 向本次前台控制器发出请求；连接断开时只返回取消状态。
 * @param {object} message 不含凭据的消息正文。
 * @param {string|number} id MCP 请求标识。
 * @returns {Promise<object|null>} 控制器决定，或宿主主动取消时的空结果。
 */
function contact(message, id) {
  return new Promise((resolve) => {
    let buffer = "";
    let ended = false;
    const socket = createConnection({ host: "127.0.0.1", port });
    const finish = (value) => {
      if (ended) return;
      ended = true;
      pending.delete(id);
      socket.destroy();
      resolve(value);
    };
    pending.set(id, () => finish(null));
    socket.on("connect", () => socket.write(`${JSON.stringify({ ...message, nonce })}\n`));
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      if (buffer.length > 8192) return finish({ source: "cancelled", decision: "stop" });
      if (!buffer.includes("\n")) return;
      try { finish(JSON.parse(buffer.split("\n")[0])); }
      catch { finish({ source: "cancelled", decision: "stop" }); }
    });
    socket.on("error", () => finish({ source: "cancelled", decision: "stop", reason: "controller_unavailable" }));
    socket.on("close", () => finish({ source: "cancelled", decision: "stop", reason: "controller_closed" }));
  });
}

/**
 * 处理有限的 MCP 消息；没有业务动作、后台通知或持久队列。
 * @param {object} message JSON-RPC 请求或通知。
 * @returns {Promise<void>} 本条消息处理完成。
 */
async function handle(message) {
  if (message.method === "notifications/cancelled") {
    pending.get(message.params?.requestId)?.();
    return;
  }
  if (message.id === undefined) return;
  if (message.method === "initialize") {
    const version = message.params?.protocolVersion;
    const supported = ["2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"];
    reply(message.id, { protocolVersion: supported.includes(version) ? version : "2025-11-25",
      capabilities: { tools: {} }, serverInfo: { name: "flower_confirmation_probe", version: "0.0.0" } });
  } else if (message.method === "ping") reply(message.id, {});
  else if (message.method === "tools/list") {
    reply(message.id, { tools: [WAIT_TOOL] });
    await contact({ type: "catalog", definition_bytes: Buffer.byteLength(JSON.stringify(WAIT_TOOL)), tool_count: 1 }, `catalog-${message.id}`);
  } else if (message.method === "tools/call") {
    const args = message.params?.arguments;
    if (message.params?.name !== "wait" || args?.request_id !== "probe" || Object.keys(args).some((key) => key !== "request_id")) {
      reply(message.id, { isError: true, content: [{ type: "text", text: "Invalid probe request" }] });
      return;
    }
    const result = await contact({ type: "wait", request_id: args.request_id }, message.id);
    if (result === null) return;
    const text = JSON.stringify({ request_id: args.request_id, ...result });
    reply(message.id, { content: [{ type: "text", text }], isError: false });
    await contact({ type: "delivered", result_bytes: Buffer.byteLength(text), source: result.source }, `delivered-${message.id}`);
  } else process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found" } })}\n`);
}

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on("line", (line) => {
  if (line.length > 65536) return;
  try {
    handle(JSON.parse(line)).catch(() => process.stderr.write("等待探针协议处理失败。\n"));
  } catch { process.stderr.write("等待探针收到无效 JSON。\n"); }
});
input.on("close", () => {
  for (const cancel of pending.values()) cancel();
});
