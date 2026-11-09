/**
 * 项目内后台确认演练：有界会话状态、单次投递和单次领取。
 * @module codex-confirmation
 */
import { randomUUID, createHash } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync, rmSync, rmdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { CodexQueueClient, confirmationId } from "./codex-queue-client.js";

const ACTIVE = new Set(["prepared", "waiting", "dispatching", "queued"]);
const STATES = new Set([...ACTIVE, "cancelled", "failed", "delivery_unknown", "consumed"]);
const MAX_STATE_BYTES = 65536;
const CLAIM_BUDGET_MS = 5 * 60 * 1000;

/** 检查路径链，防止本地状态沿软链接写入其它目录。
 * @param {string} directory 目录
 * @param {boolean} create 是否创建
 * @returns {void}
 */
function directory(value, create = false) {
  const parent = path.dirname(value);
  if (parent !== value) directory(parent, false);
  try {
    const stat = lstatSync(value);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("确认状态目录必须是普通目录");
  } catch (error) {
    if (error.code !== "ENOENT" || !create) { if (error.code === "ENOENT") return; throw error; }
    if (parent !== value) directory(parent, true);
    try { mkdirSync(value, { mode: 0o700 }); }
    catch (failure) { if (failure.code !== "EEXIST") throw failure; directory(value, false); }
  }
}

/** 读取有界 JSON，缺失时保留空状态，损坏时拒绝自动继续。
 * @param {string} file 状态文件
 * @returns {object|null} 状态
 */
function readJson(file) {
  directory(path.dirname(file));
  try {
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_STATE_BYTES) throw new Error("确认状态必须是有界普通文件");
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

/** 同目录原子写入，避免并发读取半份状态。
 * @param {string} file 状态文件
 * @param {object} value 新状态
 * @returns {void}
 */
function writeJson(file, value) {
  const text = JSON.stringify(value);
  if (Buffer.byteLength(text) > MAX_STATE_BYTES) throw new Error("确认状态超出大小限制");
  readJson(file);
  const temporary = `${file}.${randomUUID()}.tmp`;
  let fd;
  try {
    fd = openSync(temporary, "wx", 0o600);
    writeFileSync(fd, text);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(temporary, file);
  } finally {
    if (fd !== undefined) closeSync(fd);
    rmSync(temporary, { force: true });
  }
}

/** 单会话状态存储。目录锁只包围同步读写，不能在临界区调用网络。
 */
export class ConfirmationStore {
  /** 定位当前项目与唯一会话的状态。
   * @param {string} project 项目根目录
   * @param {string} sessionId 精确会话标识
   */
  constructor(project, sessionId) {
    this.project = realpathSync(project);
    this.sessionId = confirmationId(sessionId);
    this.directory = path.join(this.project, ".trellis", ".runtime", "codex-confirmation");
    this.file = path.join(this.directory, `${sessionId}.json`);
  }

  /** 读取并验证持久状态；查询不创建目录。
   * @returns {object|null} 会话状态
   */
  read() {
    const state = readJson(this.file);
    if (state && (state.version !== 1 || state.sessionId !== this.sessionId || !Number.isSafeInteger(state.generation)
      || !state.request || !STATES.has(state.request.state) || state.request.generation > state.generation)) {
      throw new Error("确认状态版本、会话或结构无效");
    }
    if (state) confirmationId(state.request.id);
    return state;
  }

  /** 原子修改当前会话；同步回调返回完整状态，null 表示不创建。
   * @param {Function} mutate 同步状态转换
   * @returns {object|null} 写入后的状态
   */
  update(mutate) {
    directory(this.directory, true);
    const lock = `${this.file}.lock`;
    const token = randomUUID();
    const deadline = Date.now() + 1000;
    for (;;) {
      try {
        mkdirSync(lock, { mode: 0o700 });
        writeJson(path.join(lock, "owner.json"), { pid: process.pid, token });
        break;
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        let stat;
        let owner;
        try {
          stat = lstatSync(lock);
          if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("确认状态锁必须是普通目录");
          owner = readJson(path.join(lock, "owner.json"));
        } catch (failure) {
          if (!["ENOENT", "EPERM", "EACCES"].includes(failure.code)) throw failure;
          if (Date.now() >= deadline) throw new Error("确认状态锁繁忙");
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
          continue;
        }
        let dead = false;
        if (Number.isSafeInteger(owner?.pid) && owner.pid > 0) {
          try { process.kill(owner.pid, 0); } catch (failure) { dead = failure.code === "ESRCH"; }
        }
        if (dead || (!owner && Date.now() - stat.mtimeMs > 30000)) {
          // 清锁者串行复核身份，避免把下一位竞争者的新锁也删除。
          const reaper = `${lock}.reap`;
          let reaping = false;
          try {
            mkdirSync(reaper, { mode: 0o700 });
            reaping = true;
            const current = readJson(path.join(lock, "owner.json"));
            const currentStat = lstatSync(lock);
            if (current?.token === owner?.token && currentStat.ino === stat.ino && currentStat.mtimeMs === stat.mtimeMs) {
              const stale = `${lock}.${token}.stale`;
              renameSync(lock, stale);
              rmSync(stale, { recursive: true, force: true });
            }
          } catch { /* 竞争或 Windows 删除中状态只在当前预算内重试。 */ }
          finally { if (reaping) rmdirSync(reaper); }
        }
        if (Date.now() >= deadline) throw new Error("确认状态锁繁忙");
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      }
    }
    try {
      const state = mutate(this.read());
      if (state?.then) throw new Error("确认状态临界区不允许异步操作");
      if (state) writeJson(this.file, state);
      return state;
    } finally {
      if (readJson(path.join(lock, "owner.json"))?.token === token) rmSync(lock, { recursive: true, force: true });
    }
  }

  /** 只修改仍为当前请求的记录，旧 worker 不能覆盖新等待。
   * @param {string} requestId 请求标识
   * @param {Function} mutate 同步转换
   * @returns {object|null} 当前状态
   */
  change(requestId, mutate) {
    return this.update(state => { if (state?.request.id === requestId) mutate(state.request, state); return state; });
  }
}

/** 校验演练时间与文本，帮助及非法参数不需要连接 daemon。
 * @param {number} seconds 等待秒数
 * @param {string} message 仅成功领取后输出的文本
 * @returns {void}
 */
export function validateConfirmation(seconds, message) {
  if (!Number.isFinite(seconds) || seconds < 0.1 || seconds > 86400) throw new Error("等待时间必须在 0.1 到 86400 秒之间");
  if (typeof message !== "string" || !message.trim() || Buffer.byteLength(message) > 8192) throw new Error("演练文本不能为空，且最多 8192 字节");
}

/** 创建新一代请求，替换旧等待并保留旧队列回执供撤回。
 * @param {ConfirmationStore} store 会话存储
 * @param {object} options 时间、文本和原生消息快照
 * @returns {object} 当前请求及旧请求
 */
export function prepareConfirmation(store, { seconds, message, snapshot }) {
  validateConfirmation(seconds, message);
  if (!snapshot.humanId) throw new Error("缺少人工消息基线");
  if (!["inProgress", "completed"].includes(snapshot.turn?.status)) throw new Error("原回合已经中断、失败或无法核对");
  let previous;
  const state = store.update(old => {
    previous = old?.request || null;
    const generation = (old?.generation || 0) + 1;
    return { version: 1, sessionId: store.sessionId, generation, lastHumanMessageId: snapshot.humanId,
      request: { id: randomUUID(), generation, baselineMessageId: snapshot.humanId, seconds, message,
        messageSha256: createHash("sha256").update(message).digest("hex"),
        originTurnId: snapshot.turn?.status === "inProgress" ? snapshot.turn.id : null,
        state: "prepared", createdAt: Date.now(), deadline: null, queueId: null, wakeTurnId: null,
        workerToken: null, receipt: null, error: null, revocation: null } };
  });
  return { request: state.request, previous };
}

/** 将新人工输入记录为取消；同一条 started/completed 消息只改变一次代次。
 * @param {ConfirmationStore} store 会话存储
 * @param {string} requestId 请求标识
 * @param {string} humanId 人工消息标识
 * @returns {object|null} 当前状态
 */
function observeHuman(store, requestId, humanId) {
  return store.change(requestId, (request, state) => {
    if (state.lastHumanMessageId === humanId || request.baselineMessageId === humanId) return;
    state.lastHumanMessageId = humanId;
    state.generation += 1;
    if (ACTIVE.has(request.state)) { request.state = "cancelled"; request.error = "user_replied"; }
  });
}

/** 尽力撤回本请求精确队列项，失败只记录，不向其它会话补投递。
 * @param {ConfirmationStore} store 会话存储
 * @param {CodexQueueClient} client 原生连接
 * @param {object} request 待撤回请求
 * @returns {Promise<void>}
 */
async function revoke(store, client, request) {
  if (!request?.queueId) return;
  let result;
  try { result = await client.remove(request.queueId); }
  catch (error) { result = `failed: ${error.message}`.slice(0, 1000); }
  store.change(request.id, current => { current.revocation = result; });
}

/** 持续观察原回合结束、人工回复及到期；同一请求只允许一个 worker 投递。
 * @param {object} options 存储、原生连接、请求、终止信号及事件输出
 * @returns {Promise<object>} 最终请求状态
 */
export async function runConfirmationWorker({ store, client, requestId, signal, notify = () => {} }) {
  const token = randomUUID();
  const owned = store.change(requestId, request => {
    if (request.state === "prepared" && !request.workerToken) request.workerToken = token;
  });
  if (owned?.request.id !== requestId || owned.request.workerToken !== token) return { state: "duplicate_worker", id: requestId };
  let failure;
  let lastOwnedRequest = owned.request;
  const human = value => {
    try { observeHuman(store, requestId, value.id); } catch (error) { failure = error; }
  };
  const wake = value => {
    try {
      if (value.requestId === requestId) store.change(requestId, request => { request.wakeTurnId = value.turnId; });
    } catch (error) { failure = error; }
  };
  let originDone = !owned.request.originTurnId;
  let originFailed = false;
  const disconnected = error => { failure = error; };
  const notification = packet => {
    if (packet.method === "turn/completed" && packet.params.turn?.id === owned.request.originTurnId) {
      originDone = true;
      originFailed = packet.params.turn.status !== "completed";
    }
  };
  client.on("human", human);
  client.on("wake", wake);
  client.on("disconnect", disconnected);
  client.on("notification", notification);
  try {
    // 重新读取消除准备与 worker 订阅之间的窗口；新回复优先于启动计时。
    const initial = await client.snapshot();
    observeHuman(store, requestId, initial.humanId);
    if (initial.turn?.id !== owned.request.originTurnId || initial.turn?.status !== "inProgress") {
      originDone = true;
      if (initial.turn?.id === owned.request.originTurnId && initial.turn.status !== "completed") originFailed = true;
    }
    notify({ event: "prepared", requestId, state: store.read().request.state, seconds: owned.request.seconds });
    for (;;) {
      let current = store.read();
      if (current?.request.id !== requestId) { await revoke(store, client, lastOwnedRequest); return { state: "replaced", id: requestId }; }
      const request = current.request;
      lastOwnedRequest = request;
      if (!ACTIVE.has(request.state)) { if (request.state !== "consumed") await revoke(store, client, request); return store.read().request; }
      if (signal?.aborted) throw new Error("worker_interrupted");
      if (failure || client.failure) throw failure || client.failure;
      if (originFailed) throw new Error("origin_turn_interrupted");
      if (Date.now() - request.createdAt > 2 * 86400 * 1000) throw new Error("worker_lifetime_exceeded");
      if (request.state === "prepared" && originDone) {
        current = store.change(requestId, value => {
          if (value.state === "prepared") { value.state = "waiting"; value.deadline = Date.now() + Math.round(value.seconds * 1000); }
        });
        notify({ event: "waiting", requestId, deadline: current.request.deadline });
      } else if (request.state === "waiting" && Date.now() >= request.deadline) {
        const snapshot = await client.snapshot();
        observeHuman(store, requestId, snapshot.humanId);
        let dispatch = false;
        store.change(requestId, value => {
          if (value.state === "waiting") { value.state = "dispatching"; dispatch = true; }
        });
        if (dispatch) {
          let queued;
          try { queued = await client.add(requestId); }
          catch (error) {
            // 队列可能已经接收而回执丢失，绝不重发或把未知解释为成功。
            store.change(requestId, value => {
              if (value.state === "dispatching") { value.state = "delivery_unknown"; value.error = error.message.slice(0, 1000); }
            });
            throw error;
          }
          current = store.change(requestId, value => {
            value.queueId = queued.id;
            if (value.state === "dispatching") { value.state = "queued"; value.claimDeadline = Date.now() + CLAIM_BUDGET_MS; }
          });
          if (current?.request.id !== requestId || current.request.state !== "queued") {
            await revoke(store, client, { id: requestId, queueId: queued.id });
          } else notify({ event: "queued", requestId, queueId: queued.id, wakeObserved: Boolean(current.request.wakeTurnId) });
        }
      } else if (request.state === "queued" && Date.now() > request.claimDeadline) throw new Error("claim_expired");
      await sleep(50);
    }
  } catch (error) {
    const state = store.change(requestId, request => {
      if (ACTIVE.has(request.state)) { request.state = signal?.aborted ? "cancelled" : "failed"; request.error = error.message.slice(0, 1000); }
    });
    await revoke(store, client, state?.request.id === requestId ? state.request : lastOwnedRequest);
    notify({ event: "stopped", requestId, error: error.message });
    return state?.request.id === requestId ? state.request : { id: requestId, state: "replaced" };
  } finally {
    client.off("human", human);
    client.off("wake", wake);
    client.off("disconnect", disconnected);
    client.off("notification", notification);
  }
}

/** 核对原生消息基线后原子领取一次；无效请求不返回演练文本。
 * @param {object} options 会话存储、原生客户端和请求标识
 * @returns {Promise<object>} claimed=true 时才包含 message
 */
export async function claimConfirmation({ store, client, requestId }) {
  confirmationId(requestId);
  const state = store.read();
  const denied = reason => ({ claimed: false, requestId, reason });
  if (state?.request.id !== requestId) return denied("not_current");
  if (!ACTIVE.has(state.request.state)) return denied(state.request.state);
  let failure;
  const human = value => {
    try { observeHuman(store, requestId, value.id); } catch (error) { failure = error; }
  };
  client.on("human", human);
  try {
    const snapshot = await client.snapshot();
    observeHuman(store, requestId, snapshot.humanId);
    // idle 入队可能先启动模型，再返回回执；短暂等待回执落盘但绝不自行补发。
    const deadline = Date.now() + 1000;
    while (store.read()?.request.state === "dispatching" && Date.now() < deadline && !client.failure) await sleep(20);
    let result = denied("not_ready");
    store.change(requestId, (request, current) => {
      if (request.state !== "queued") { result = denied(request.state); return; }
      if (failure || client.failure || current.generation !== request.generation || current.lastHumanMessageId !== request.baselineMessageId
        || Date.now() > request.claimDeadline || createHash("sha256").update(request.message).digest("hex") !== request.messageSha256) {
        request.state = "failed"; request.error = "claim_validation_failed"; result = denied(request.error); return;
      }
      request.state = "consumed";
      request.receipt = { id: randomUUID(), at: Date.now() };
      result = { claimed: true, requestId, message: request.message, receipt: request.receipt };
    });
    return result;
  } catch (error) {
    store.change(requestId, request => { if (ACTIVE.has(request.state)) { request.state = "failed"; request.error = error.message.slice(0, 1000); } });
    throw error;
  } finally { client.off("human", human); }
}

/** 显式取消当前请求，撤回失败时仍保留取消状态供消费者拒绝。
 * @param {object} options 存储、可选客户端和可选目标请求
 * @returns {Promise<object>} 取消结果
 */
export async function cancelConfirmation({ store, client, requestId }) {
  const state = store.update(current => {
    if (current && (!requestId || current.request.id === requestId) && ACTIVE.has(current.request.state)) {
      current.request.state = "cancelled"; current.request.error = "explicit_cancel"; current.generation += 1;
    }
    return current;
  });
  if (state && (!requestId || state.request.id === requestId) && state.request.state === "cancelled" && client) await revoke(store, client, state.request);
  return confirmationStatus(store);
}

/** 返回不包含演练正文的查询结果。
 * @param {ConfirmationStore} store 存储
 * @returns {object} 只读状态
 */
export function confirmationStatus(store) {
  const state = store.read();
  if (!state) return { sessionId: store.sessionId, state: "absent" };
  const { message, messageSha256, ...request } = state.request;
  return { sessionId: state.sessionId, generation: state.generation, ...request };
}
