import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import http from "node:http";
import { generateKeyPairSync, randomUUID, sign, verify } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { WebSocket, WebSocketServer } from "ws";
import { CONFIRMATION_ID, CONFIRMATION_NATIVE_ID, confirmationDigest, confirmationDirectory,
  confirmationOperation, confirmationRoot, confirmationWitnessKey, readConfirmationFile, writeConfirmationFile } from "./confirmation-files.js";

const LIMIT = 16 * 1024 * 1024;
const NONCE = /^[a-f0-9-]{36}$/;
const validId = value => typeof value === "string" && CONFIRMATION_NATIVE_ID.test(value);
const pause = 30;

/** 验证确实是同一条仍存活的客户端连接；连接被关闭时不能用旁观者的 pong。 */
function pingOrigin(socket) {
  if (socket.readyState !== WebSocket.OPEN) return Promise.resolve(false);
  return new Promise(resolve => {
    const token = randomUUID();
    const stop = result => {
      clearTimeout(timer);
      socket.off("pong", pong);
      socket.off("close", close);
      resolve(result);
    };
    const pong = data => { if (data.toString() === token) stop(true); };
    const close = () => stop(false);
    const timer = setTimeout(close, 250);
    socket.on("pong", pong);
    socket.once("close", close);
    try { socket.ping(token, false, error => { if (error) close(); }); } catch { close(); }
  });
}

/**
 * 转发原版 App Server 的 Unix WebSocket，见证原发连接、当前回合和该回合的工具调用。
 * @param {object} options 上游和全新监听套接字的绝对路径。
 * @param {string} options.upstream 已运行的原版 App Server。
 * @param {string} options.listen 专用于见证的监听路径。
 * @returns {Promise<object>} 启动完成后返回关闭方法。
 */
export async function startConfirmationWitness({ upstream, listen }) {
  if (process.platform !== "linux" || !path.isAbsolute(upstream) || !path.isAbsolute(listen) || upstream === listen) {
    throw new Error("Codex 连接见证需要 Linux 及两个不同的本机 Unix 套接字绝对路径");
  }
  const parent = fs.lstatSync(path.dirname(listen));
  // 原版 managed daemon 公布的是指向其私有套接字的链接，按实际文件核对。
  const source = fs.statSync(upstream);
  if (!parent.isDirectory() || parent.uid !== process.getuid() || (parent.mode & 0o077)
    || fs.realpathSync(path.dirname(listen)) !== path.dirname(listen)
    || fs.lstatSync(upstream).uid !== process.getuid() || !source.isSocket() || source.uid !== process.getuid()
    || (source.mode & 0o022)) {
    throw new Error("见证监听目录必须为当前用户私有，且上游必须是当前用户的本机套接字");
  }
  if (fs.existsSync(listen)) throw new Error("见证监听路径已存在，请指定空闲路径");
  const keyFile = confirmationWitnessKey(undefined, true);
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const key = { pid: process.pid, listen, key: publicKey.export({ format: "pem", type: "spki" }) };
  const server = http.createServer((_req, res) => res.writeHead(404).end());
  const peers = new WebSocketServer({ server, maxPayload: LIMIT });
  const active = new Map();
  const seen = new Map();
  let scanning = false;
  let stopped = false;

  function revoke(thread, origin) {
    if (active.get(thread) === origin) active.delete(thread);
  }

  peers.on("connection", front => {
    if (peers.clients.size > 64) { front.terminate(); return; }
    const back = new WebSocket("ws://localhost/", {
      maxPayload: LIMIT, handshakeTimeout: 2000, createConnection: () => net.createConnection({ path: upstream }),
    });
    const pending = new Map();
    const interrupts = new Set();
    const queue = [];
    let client;
    let queuedBytes = 0;
    let closed = false;
    let heartbeat;

    /** 退订和断连共用中断记录，避免删除原窗口绑定后丢失尚未处理的回执。 */
    function interrupt(thread, origin) {
      if (!origin.confirming || back.readyState !== WebSocket.OPEN) return;
      const id = `flower-confirm-${randomUUID()}`;
      interrupts.add(id);
      back.send(JSON.stringify({ id, method: "turn/interrupt",
        params: { threadId: thread, turnId: origin.turn } }), () => {});
    }

    function close() {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      for (const [thread, origin] of active) {
        if (origin.front !== front) continue;
        revoke(thread, origin);
        interrupt(thread, origin);
      }
      front.terminate();
      if (!interrupts.size) { back.terminate(); return; }
      // 保持原上游连接到中断回执，避免 App Server 先按断连取消尚未处理的请求。
      const timeout = setTimeout(() => back.terminate(), 2000);
      timeout.unref();
      back.once("close", () => clearTimeout(timeout));
    }

    for (const peer of [front, back]) {
      peer.on("close", close);
      peer.on("error", close);
    }
    back.on("open", () => { for (const [data, binary] of queue.splice(0)) back.send(data, { binary }, onSend); });
    const onSend = error => { if (error) close(); };
    heartbeat = setInterval(async () => {
      if ([...active.values()].some(origin => origin.front === front && origin.confirming) && !await pingOrigin(front)) close();
    }, 300);
    heartbeat.unref();
    function forward(peer, data, binary) {
      if (peer.bufferedAmount > LIMIT) return close();
      peer.send(data, { binary }, onSend);
    }
    function parse(data) { try { return JSON.parse(data.toString()); } catch { return null; } }

    front.on("message", (data, binary) => {
      const message = parse(data);
      const params = message?.params;
      const thread = params?.threadId;
      if (message?.method === "initialize") client = params?.clientInfo?.name;
      if (validId(thread)) {
        const current = active.get(thread);
        if (current && (["turn/start", "turn/steer", "turn/interrupt", "thread/archive"].includes(message.method)
          || (message.method === "thread/unsubscribe" && current.front === front))) {
          revoke(thread, current);
          if (message.method === "thread/unsubscribe") interrupt(thread, current);
        }
        if (message.method === "turn/start" && client === "codex-tui" && params.turnTrigger === "user"
          && ["number", "string"].includes(typeof message.id) && pending.size < 64) pending.set(message.id, thread);
      }
      if (back.readyState === WebSocket.OPEN) forward(back, data, binary);
      else if (back.readyState === WebSocket.CONNECTING && queue.length < 64 && (queuedBytes += data.length) <= LIMIT) {
        queue.push([data, binary]);
      } else close();
    });

    back.on("message", (data, binary) => {
      const message = parse(data);
      if (interrupts.delete(message?.id)) {
        if (closed && !interrupts.size) back.close();
        return;
      }
      if (closed) return;
      if (message && !message.method && pending.has(message.id)) {
        const thread = pending.get(message.id);
        pending.delete(message.id);
        const turn = message.result?.turn?.id;
        const id = `${thread}/${turn}`;
        // 回放或同一回合的第二个客户端不能改写真实发起者。
        if (validId(turn) && !seen.has(id) && !active.has(thread)) {
          seen.set(id, true);
          if (seen.size > 2048) seen.delete(seen.keys().next().value);
          active.set(thread, { front, turn, binding: randomUUID(), reviews: [], calls: new Map(), initialUser: null });
        }
      }
      const { threadId: thread, turnId, turn, item } = message?.params || {};
      const origin = active.get(thread);
      if (origin?.front === front) {
        const method = message.method;
        if ((method === "turn/completed" && turn?.id === origin.turn)
          || (method === "turn/started" && turn?.id !== origin.turn)) revoke(thread, origin);
        if (turnId === origin.turn && ["item/started", "item/completed"].includes(method)) {
          if (item?.type === "userMessage" && validId(item.id)) {
            if (origin.initialUser && origin.initialUser !== item.id) revoke(thread, origin);
            origin.initialUser ??= item.id;
          }
          if (item?.type === "agentMessage" && method === "item/completed" && item.phase === "commentary"
            && typeof item.text === "string") {
            origin.reviews.push(confirmationDigest(item.text));
            if (origin.reviews.length > 12) origin.reviews.shift();
          }
          if (item?.type === "commandExecution" && validId(item.id)) {
            if (method === "item/completed") {
              const call = origin.calls.get(item.id);
              if (item.exitCode === 0 && call?.operation.startsWith(`finish ${origin.confirming} `)) origin.confirming = null;
              origin.calls.delete(item.id);
            } else {
              const operation = confirmationOperation(item.command);
              if (operation && typeof item.cwd === "string" && path.isAbsolute(item.cwd) && origin.calls.size < 32) {
                try { origin.calls.set(item.id, { operation, root: confirmationRoot(item.cwd), reviews: [...origin.reviews] }); }
                catch { /* 无法把命令归到真实项目，仍按原协议转发。 */ }
              }
            }
          }
        }
      }
      forward(front, data, binary);
    });
  });

  async function answer(root, directory, file) {
    const nonce = file.slice(0, -4);
    const requestFile = path.join(directory, file);
    let query;
    try { query = JSON.parse(readConfirmationFile(requestFile, 4096)); }
    finally { fs.rmSync(requestFile, { force: true }); }
    const { thread, call, operation, review } = query || {};
    if (nonce !== query?.nonce || !validId(thread) || !validId(call) || typeof operation !== "string"
      || (review !== null && (typeof review !== "string" || !CONFIRMATION_ID.test(review)))) return;
    const origin = active.get(thread);
    const tool = origin?.calls.get(call);
    const match = tool?.root === root && tool.operation === operation && (!review || tool.reviews.includes(review));
    const alive = match && await pingOrigin(origin.front) && active.get(thread) === origin && origin.calls.get(call) === tool;
    if (alive && review && CONFIRMATION_ID.test(operation)) origin.confirming = operation;
    const payload = Buffer.from(JSON.stringify({ nonce, thread, call, operation, review,
      ...(alive ? { binding: origin.binding } : { unavailable: true }) }));
    // 签名只证明这一挑战的窗口和正文，不能作为可恢复或可重复的许可。
    writeConfirmationFile(path.join(directory, `${nonce}.res`),
      { payload: payload.toString("base64"), signature: sign(null, payload, privateKey).toString("base64") });
  }

  const timer = setInterval(async () => {
    if (scanning || stopped) return;
    scanning = true;
    try {
      const roots = new Set([...active.values()].flatMap(origin => [...origin.calls.values()].map(call => call.root)));
      const jobs = [];
      for (const root of roots) {
        try {
          const directory = confirmationDirectory(root, "mail", false);
          for (const file of fs.readdirSync(directory).filter(file => file.endsWith(".req")).slice(0, 64)) {
            if (file.endsWith(".req") && NONCE.test(file.slice(0, -4))) jobs.push(answer(root, directory, file));
          }
        } catch { /* 尚无挑战或运行目录不可用时，不向该项目授予许可。 */ }
      }
      await Promise.allSettled(jobs);
    } finally { scanning = false; }
  }, pause);
  timer.unref();
  let ownsKey = false;

  async function close() {
    stopped = true;
    clearInterval(timer);
    for (const peer of peers.clients) peer.terminate();
    peers.close();
    await new Promise(resolve => server.close(resolve));
    if (ownsKey) {
      try {
        if (JSON.parse(readConfirmationFile(keyFile, 4096)).key === key.key) fs.rmSync(keyFile);
      } catch { /* 不能删除后来启动的见证者的公钥。 */ }
    }
  }
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(listen, resolve);
    });
    fs.chmodSync(listen, 0o600);
    writeConfirmationFile(keyFile, key, true);
    ownsKey = true;
  } catch (error) {
    await close();
    if (error.code === "EEXIST") throw new Error("本机见证已存在；检查运行状态后再清理遗留的公钥文件");
    throw error;
  }
  return { close };
}

/**
 * 用项目文件交换一次性挑战，让受限的 Codex 命令无需连接套接字。
 * @param {string} root 当前项目根。
 * @param {string} operation 当前 CLI 操作。
 * @param {object} env 原生工具注入的环境。
 * @returns {object} 主会话及异步窗口/展示复核函数。
 */
export function codexConfirmationOrigin(root, operation, env) {
  const thread = env.CODEX_THREAD_ID;
  const call = env.CODEX_TOOL_CALL_ID;
  if (process.platform !== "linux" || !validId(thread) || !validId(call)) {
    throw new Error("当前调用缺少原版 Codex 前台工具身份");
  }
  let key;
  try { key = JSON.parse(readConfirmationFile(confirmationWitnessKey(root), 4096)).key; }
  catch { throw new Error("当前 Codex 窗口没有可用的本机连接见证"); }
  const directory = confirmationDirectory(root, "mail");
  return {
    owner: `codex_${thread}`,
    async verify(review = null, signal) {
      const nonce = randomUUID();
      const query = { nonce, thread, call, operation, review };
      const request = path.join(directory, `${nonce}.req`);
      const response = path.join(directory, `${nonce}.res`);
      const deadline = performance.now() + 1000;
      try {
        writeConfirmationFile(request, query, true);
        while (performance.now() < deadline && !signal?.aborted) {
          let reply;
          try { reply = JSON.parse(readConfirmationFile(response, 4096)); }
          catch (error) {
            if (error.code !== "ENOENT") throw error;
            await sleep(20, undefined, { signal });
            continue;
          }
          const bytes = Buffer.from(reply.payload, "base64");
          if (!verify(null, bytes, key, Buffer.from(reply.signature, "base64"))) break;
          const data = JSON.parse(bytes);
          if (Object.keys(query).every(name => query[name] === data[name]) && validId(data.binding)) return data.binding;
          break;
        }
      } finally {
        fs.rmSync(request, { force: true });
        fs.rmSync(response, { force: true });
      }
      throw new Error(review ? "原 Codex 窗口已中断或未展示完整确认正文" : "无法核验原 Codex 窗口");
    },
  };
}
