import { createConnection } from "node:net";

/**
 * 验证只属于本次前台入口的控制描述符。
 * @param {string|object} value 环境JSON或已经解析的描述符。
 * @returns {object} 经过校验的本地描述符。
 */
export function parseConfirmationDescriptor(value) {
  const descriptor = typeof value === "string" ? JSON.parse(value) : value;
  if (!descriptor || descriptor.version !== 1 || !["codex", "claude"].includes(descriptor.platform)
    || !Number.isSafeInteger(descriptor.port) || descriptor.port <= 0 || descriptor.port > 65535
    || typeof descriptor.token !== "string" || descriptor.token.length < 24
    || typeof descriptor.instance_id !== "string" || !descriptor.instance_id) {
    throw new Error("当前确认入口信息无效，保持人工确认");
  }
  return descriptor;
}

/**
 * 调用本次入口的本地协议；关闭连接即取消尚在进行的等待。
 * @param {object} input 入口描述符。
 * @param {object} message 控制请求，不包含凭据。
 * @param {{timeoutMs?:number,signal?:AbortSignal}} options 超时与宿主取消信号。
 * @returns {Promise<object>} 不含控制凭据的响应。
 */
export function callConfirmation(input, message, { timeoutMs = 15000, signal } = {}) {
  const descriptor = parseConfirmationDescriptor(input);
  return new Promise((resolve, reject) => {
    let buffer = "";
    let settled = false;
    const socket = createConnection({ host: "127.0.0.1", port: descriptor.port });
    socket.setEncoding("utf8");
    const timer = setTimeout(() => finish(new Error("确认入口等待超时，保持人工确认")), timeoutMs);
    const abort = () => finish(new Error("确认等待已取消"));
    function finish(error, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      socket.destroy();
      if (error) reject(error); else resolve(value);
    }
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) return abort();
    socket.on("connect", () => socket.write(`${JSON.stringify({ ...message, token: descriptor.token, instance_id: descriptor.instance_id })}\n`));
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      if (Buffer.byteLength(buffer) > 1024 * 1024) return finish(new Error("确认响应过大"));
      if (!buffer.includes("\n")) return;
      try {
        const result = JSON.parse(buffer.split("\n")[0]);
        if (!result || typeof result !== "object" || result.error) return finish(new Error(result?.error || "确认响应无效"));
        finish(null, result);
      } catch { finish(new Error("确认响应不是有效JSON")); }
    });
    socket.on("error", () => finish(new Error("确认入口不可用，保持人工确认")));
    socket.on("close", () => finish(new Error("确认入口已关闭，保持人工确认")));
  });
}
