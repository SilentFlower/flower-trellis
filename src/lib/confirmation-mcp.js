import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { callConfirmation, parseConfirmationDescriptor } from "./confirmation-ipc.js";
import { CONFIRMATION_MCP_SERVER, CONFIRMATION_SESSION_ENV, CONFIRMATION_TOOL_BUDGET_SECONDS } from "../constants.js";

/** 唯一模型工具不携带方案正文，计时与实际授权保存在前台入口中。 */
export const CONFIRMATION_WAIT_TOOL = Object.freeze({
  name: "wait",
  description: "完整展示已准备方案并等待人工介入或到期；返回后须领取许可，取消时停止默认动作。",
  inputSchema: { type: "object", properties: { request_id: { type: "string" } }, required: ["request_id"], additionalProperties: false },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
});

/**
 * 在宿主的标准输入输出上运行一个小型 MCP 服务，不创建后台模型回合。
 * @param {object} options 本次入口、标准流和可替换的RPC客户端。
 * @returns {object} 可供退出清理的 close 方法。
 */
export function runConfirmationMcp({ descriptor, stdin = process.stdin, stdout = process.stdout, call = callConfirmation }) {
  const session = parseConfirmationDescriptor(descriptor);
  const pending = new Map();
  const input = createInterface({ input: stdin, crlfDelay: Infinity });
  const send = (id, result, error) => stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, ...(error ? { error } : { result }) })}\n`);

  /** 异步消息不阻塞取消通知；stdio只输出协议JSON。 */
  async function handle(message) {
    if (message.method === "notifications/cancelled") {
      pending.get(message.params?.requestId)?.abort();
      return;
    }
    if (message.id === undefined) return;
    if (message.method === "initialize") {
      const versions = ["2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"];
      send(message.id, { protocolVersion: versions.includes(message.params?.protocolVersion) ? message.params.protocolVersion : "2025-11-25",
        capabilities: { tools: {} }, serverInfo: { name: CONFIRMATION_MCP_SERVER, version: "1.0.0" } });
    } else if (message.method === "ping") send(message.id, {});
    else if (message.method === "tools/list") {
      await call(session, { method: "ready" }, { timeoutMs: 3000 });
      send(message.id, { tools: [CONFIRMATION_WAIT_TOOL] });
    }
    else if (message.method === "tools/call") {
      const args = message.params?.arguments;
      if (message.params?.name !== "wait" || !args || typeof args.request_id !== "string"
        || !/^[a-f0-9-]{36}$/.test(args.request_id) || Object.keys(args).some(key => key !== "request_id")) {
        send(message.id, { isError: true, content: [{ type: "text", text: "等待请求无效，保持人工确认。" }] });
        return;
      }
      const controller = new AbortController();
      pending.set(message.id, controller);
      try {
        const result = await call(session, { method: "wait", request_id: args.request_id },
          { signal: controller.signal, timeoutMs: (CONFIRMATION_TOOL_BUDGET_SECONDS + 30) * 1000 });
        if (!controller.signal.aborted) send(message.id, { content: [{ type: "text", text: JSON.stringify(result) }], isError: false });
      } catch {
        if (!controller.signal.aborted) send(message.id, { content: [{ type: "text", text: JSON.stringify({ request_id: args.request_id,
          source: "cancelled", decision: "stop", reason: "session_unavailable" }) }], isError: false });
      } finally { pending.delete(message.id); }
    } else send(message.id, null, { code: -32601, message: "Method not found" });
  }
  input.on("line", (line) => {
    if (Buffer.byteLength(line) > 65536) return;
    try { void handle(JSON.parse(line)).catch(() => {}); } catch { /* 无效协议不回显未知正文。 */ }
  });
  const close = () => { for (const controller of pending.values()) controller.abort(); input.close(); };
  input.once("close", () => { for (const controller of pending.values()) controller.abort(); });
  return { close };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { runConfirmationMcp({ descriptor: process.env[CONFIRMATION_SESSION_ENV] }); }
  catch { process.stderr.write("确认MCP入口不可用。\n"); process.exitCode = 2; }
}
