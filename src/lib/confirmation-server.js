import fs from "node:fs";
import path from "node:path";
import { createServer } from "node:net";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createConfirmationState } from "./confirmation-state.js";
import { CONFIRMATION_MCP_SERVER, CONFIRMATION_TOOL_BUDGET_SECONDS } from "../constants.js";

/**
 * 创建只绑定回环、只存活于当前前台入口的控制服务。
 * @param {object} options 项目、平台、材料复核、可信展示和生命周期回调。
 * @returns {Promise<object>} 描述符、状态机及确定性关闭方法。
 */
export async function startConfirmationServer({ root, platform, snapshot, display,
  audit, onAuditError, onReviewEnd = () => {}, onExitCode = () => {}, toolBudgetSeconds = CONFIRMATION_TOOL_BUDGET_SECONDS }) {
  const project = fs.realpathSync.native(root);
  const instanceId = randomUUID();
  const token = randomBytes(32).toString("hex");
  const sockets = new Set();
  let boundOwner = null;
  let closed = false;
  let closePromise;
  let toolReady = false;
  const state = createConfirmationState({ snapshot: (spec, owner) => snapshot(spec, owner, descriptor),
    display, audit, onAuditError, instanceId, maxWaitSeconds: toolBudgetSeconds });
  const rootKey = value => process.platform === "win32" ? value.toLowerCase() : value;

  /** 每条连接只执行一个请求，避免重放同一缓冲区产生两次领取。 */
  async function dispatch(message, socket) {
    if (closed) throw new Error("当前入口已退出");
    switch (message.method) {
      case "status": {
        const status = state.describe();
        const ready = toolReady && status.audit_ok;
        return { ...status, platform, ready, server_name: descriptor.server_name, manual: !boundOwner || !ready };
      }
      case "ready":
        toolReady = (toolReady || state.auditReady()) && state.describe().audit_ok;
        return { ready: toolReady, ...(!toolReady ? { manual: true } : {}) };
      case "bind": {
        if (typeof message.root !== "string" || rootKey(fs.realpathSync.native(message.root)) !== rootKey(project)) throw new Error("会话绑定项目不匹配");
        if (boundOwner && message.owner !== boundOwner) {
          state.cancelAll("session_changed");
          throw new Error("原主会话已切换，请重新通过统一入口启动");
        }
        const result = state.bind(message.owner);
        boundOwner = message.owner;
        return { ...result, platform };
      }
      case "prepare":
        if (!toolReady) throw new Error("等待工具尚未就绪，保持人工确认");
        return state.prepare(message.spec, message.owner);
      case "wait": {
        if (typeof message.request_id !== "string") throw new Error("等待请求标识无效");
        socket.requestId = message.request_id;
        try { return await state.wait(message.request_id); }
        finally { onReviewEnd(); }
      }
      case "claim": return state.claim(message.request_id, message.owner);
      case "finish": return state.finish(message.request_id, message.owner, message.outcome);
      case "guard":
        socket.guard = true;
        socket.write('{"ready":true}\n');
        return null;
      case "exit":
        if (!Number.isInteger(message.code) || message.code < 0 || message.code > 255) throw new Error("子进程退出码无效");
        onExitCode(message.code);
        return { ok: true };
      default: throw new Error("未知确认协议操作");
    }
  }

  const server = createServer((socket) => {
    sockets.add(socket);
    socket.setEncoding("utf8");
    let buffer = "";
    let received = false;
    socket.on("error", () => socket.destroy());
    socket.on("close", () => {
      sockets.delete(socket);
      if (socket.requestId && !socket.responded) state.cancel(socket.requestId, "tool_disconnected");
    });
    socket.on("data", (chunk) => {
      if (received) return;
      buffer += chunk;
      if (Buffer.byteLength(buffer) > 1024 * 1024) return socket.destroy();
      if (!buffer.includes("\n")) return;
      received = true;
      let message;
      try { message = JSON.parse(buffer.split("\n")[0]); } catch { return socket.destroy(); }
      if (!message || typeof message !== "object" || Array.isArray(message)) return socket.destroy();
      if (typeof message.token !== "string" || !/^[a-f0-9]{64}$/.test(message.token)
        || !timingSafeEqual(Buffer.from(message.token), Buffer.from(token)) || message.instance_id !== instanceId) return socket.destroy();
      void dispatch(message, socket).then((result) => {
        if (result === null || socket.destroyed) return;
        socket.responded = true;
        socket.end(`${JSON.stringify(result)}\n`);
      }).catch((error) => {
        if (!socket.destroyed) { socket.responded = true; socket.end(`${JSON.stringify({ error: error.message, manual: true })}\n`); }
      });
    });
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const descriptor = { version: 1, instance_id: instanceId, platform, root: project, owner_pid: process.pid,
    port: server.address().port, token, server_name: `${CONFIRMATION_MCP_SERVER}_${instanceId.split("-")[0]}` };

  /**
   * 撤销内存许可并切断守护连接，让原生进程约束结束自有会话。
   * @returns {Promise<void>} 全部监听与连接关闭后完成。
   */
  async function close() {
    if (closePromise) return closePromise;
    closed = true;
    closePromise = (async () => {
      try { state.close(); }
      finally {
        for (const socket of sockets) socket.destroy();
        await new Promise(resolve => server.close(resolve));
      }
    })();
    return closePromise;
  }
  return { descriptor, state, close };
}
