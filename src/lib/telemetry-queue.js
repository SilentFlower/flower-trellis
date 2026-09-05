import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ProjectStore } from "../plugin/state/project-store.js";
import { SKILL_GARDEN_PLUGIN_ID } from "../builtin-plugins/skill-garden/provider.js";
import { flowerVersion, trellisVersion } from "./versions.js";
import { readUpdateCheck } from "./manifest.js";
import { buildTelemetryPayload, isWithinInterval, readProjectVersions, resolveDeveloperName, withTelemetryState, FLOWER_TELEMETRY_ENDPOINT } from "./telemetry-context.js";
import { readTelemetryJson, writeTelemetryJson, telemetryDirectory, telemetryQueueDirectory } from "./telemetry-files.js";

const EVENT_FILE = /^event-[0-9a-f-]{36}\.json$/;
const MAX_AGE = 72 * 3600000;
const VERSION = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,63}$/;
const REASONS = new Set(["invalid_time", "invalid_event", "event_too_large", "event_conflict", "invalid_batch"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BASE_FIELDS = ["event_id", "event", "observed_at", "source_kind", "ai_platform", "platform", "arch", "flower_version", "bundled_trellis_version", "project_trellis_version", "installed_skill_garden_version", "developer_name"];
const OP_FIELDS = ["operation", "outcome", "error_category", "failure_stage", "duration_ms", "duration_kind"];

/** 本地白名单用于拒绝损坏队列，不把磁盘额外字段发送到服务端。
 * @param {object} payload 载荷
 * @returns {boolean} 是否可发送
 */
function validPayload(payload) {
  if (!payload || typeof payload !== "object" || !UUID.test(payload.event_id || "") || !Number.isFinite(Date.parse(payload.observed_at))) return false;
  const operation = payload.event === "operation_completed";
  const fields = operation ? [...BASE_FIELDS, ...OP_FIELDS] : BASE_FIELDS;
  if (Object.keys(payload).some(key => !fields.includes(key)) || fields.some(key => !Object.hasOwn(payload, key))) return false;
  if (!VERSION.test(payload.flower_version || "") || ["platform", "arch"].some(key => !/^[a-z0-9][a-z0-9_-]{0,31}$/.test(payload[key] || ""))) return false;
  if (["bundled_trellis_version", "project_trellis_version", "installed_skill_garden_version"].some(key => payload[key] !== null && (typeof payload[key] !== "string" || !VERSION.test(payload[key])))) return false;
  if (payload.developer_name !== null && (typeof payload.developer_name !== "string" || payload.developer_name.length > 100)) return false;
  if (operation) {
    if (payload.source_kind !== "cli" || payload.ai_platform !== null || !["init", "update", "self_update", "plugin_add"].includes(payload.operation)
      || !["success", "failure", "cancelled"].includes(payload.outcome)) return false;
    if (payload.outcome === "failure" ? !["precondition", "network", "permission", "conflict", "upstream", "io", "unknown"].includes(payload.error_category)
      || !["prepare", "resolve", "authorize", "upstream", "apply", "recover", "unknown"].includes(payload.failure_stage)
      : payload.error_category !== null || payload.failure_stage !== null) return false;
    if (!["execution", "elapsed", "unavailable"].includes(payload.duration_kind) || (payload.duration_kind === "unavailable" ? payload.duration_ms !== null : !Number.isSafeInteger(payload.duration_ms) || payload.duration_ms < 0)) return false;
  } else if (payload.event !== "activity_daily" || payload.source_kind !== "ai_hook" || !["claude", "codex"].includes(payload.ai_platform)) return false;
  return Buffer.byteLength(JSON.stringify(payload)) <= 4096;
}

/** 重读 v1 快照时重新检查白名单，损坏文件留在本地。
 * @param {object} entry 快照封套
 * @returns {boolean} 是否可发送
 */
function validLegacyEntry(entry) {
  const p = entry?.payload;
  const fields = ["schema_version", "device_id", "event", "flower_version", "bundled_trellis_version", "project_flower_version", "project_trellis_version", "developer_name", "platform", "arch", "client_time"];
  if (!p || !UUID.test(entry.id || "") || !Number.isFinite(Date.parse(entry.queuedAt)) || p.schema_version !== 1 || !UUID.test(p.device_id || "")
    || !["version_check", "init_completed", "update_completed"].includes(p.event) || Object.keys(p).some(key => !fields.includes(key))) return false;
  return validPayload({ event_id: entry.id, event: "activity_daily", source_kind: "ai_hook", ai_platform: "claude", observed_at: p.client_time,
    flower_version: p.flower_version, bundled_trellis_version: p.bundled_trellis_version,
    project_trellis_version: p.project_trellis_version, installed_skill_garden_version: p.project_flower_version,
    developer_name: p.developer_name, platform: p.platform, arch: p.arch });
}

/** 读取经过结构检查的诊断与日提示，损坏时交由调用方静默降级。
 * @param {string} directory 用户遥测目录
 * @returns {object} 元数据
 */
function metadata(directory) {
  const value = readTelemetryJson(path.join(directory, "meta.json"), { hints: {}, pending: 0, attempts: 0, dropped: 0 });
  if (!value || typeof value !== "object" || Array.isArray(value) || !value.hints || typeof value.hints !== "object"
    || Array.isArray(value.hints) || ["pending", "attempts", "dropped"].some(key => !Number.isSafeInteger(value[key]) || value[key] < 0)
    || (value.nextRetryAt && !Number.isFinite(Date.parse(value.nextRetryAt)))
    || Object.entries(value.hints).some(([key, hint]) => !/^\d{4}-\d{2}-\d{2}:(claude|codex)$/.test(key) || !UUID.test(hint?.event_id || "") || typeof hint.delivered !== "boolean")) throw new Error("遥测元数据损坏");
  return value;
}

/** 读取有界事件文件；无效文件保留作本地诊断，不发送未知内容。
 * @param {string} directory 目录
 * @returns {object[]} 按入队时刻排序的记录
 */
function entries(directory) {
  telemetryDirectory(directory, false);
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory).filter(name => EVENT_FILE.test(name)).map(name => {
    const entry = readTelemetryJson(path.join(directory, name), null, 8192);
    if (!entry || !UUID.test(entry.deviceId || "") || !validPayload(entry.payload) || !Number.isFinite(Date.parse(entry.queuedAt)) || name !== `event-${entry.payload?.event_id}.json`) throw new Error("遥测队列损坏");
    return { ...entry, name };
  }).sort((a, b) => a.queuedAt.localeCompare(b.queuedAt) || a.name.localeCompare(b.name));
}

/** 清理过期与被淘汰记录，并使尚未送达的日提示失效。
 * @param {string} directory 目录
 * @param {object} meta 元数据
 * @param {number} now 时间戳
 * @param {number} reserve 预留队列位置
 * @returns {object[]} 剩余记录
 */
function prune(directory, meta, now, reserve = 0) {
  const records = entries(directory);
  const remove = records.filter(entry => now - Date.parse(entry.queuedAt) >= MAX_AGE);
  const kept = records.filter(entry => !remove.includes(entry));
  remove.push(...kept.splice(0, Math.max(0, kept.length - (200 - reserve))));
  for (const entry of remove) {
    fs.unlinkSync(path.join(directory, entry.name));
    meta.dropped += 1;
    for (const [key, hint] of Object.entries(meta.hints)) if (hint.event_id === entry.payload.event_id && !hint.delivered) delete meta.hints[key];
  }
  for (const key of Object.keys(meta.hints)) if (Date.parse(key.slice(0, 10)) < now - 4 * 86400000) delete meta.hints[key];
  const pendingIds = new Set(kept.map(entry => entry.payload.event_id));
  for (const [key, hint] of Object.entries(meta.hints)) if (!hint.delivered && !pendingIds.has(hint.event_id)) delete meta.hints[key];
  return kept;
}

/** 捕获白名单运行和目标版本；项目路径仅用于本地读取。
 * @param {string} target 项目
 * @param {object} state 唯一身份
 * @param {object} options 环境与开始时版本
 * @returns {object} 白名单快照
 */
export function telemetrySnapshot(target, state, options = {}) {
  let installed = null;
  try { installed = new ProjectStore(target).readLock()?.plugins.find(({ id }) => id === SKILL_GARDEN_PLUGIN_ID)?.version || null; } catch { /* 缺失版本明确为空。 */ }
  const bundled = options.bundledVersion || trellisVersion();
  return { platform: process.platform, arch: process.arch, flower_version: options.runtimeVersion || flowerVersion(),
    bundled_trellis_version: VERSION.test(bundled) ? bundled : null,
    project_trellis_version: readProjectVersions(target).trellis,
    installed_skill_garden_version: VERSION.test(installed || "") ? installed : null,
    developer_name: resolveDeveloperName(target, { env: options.env, developerName: state.developerName }) };
}

/** 按需启动单次独立 sender；不继承标准流，也不让子进程阻止 CLI 退出。
 * @param {object} options 环境与启动依赖
 * @returns {void}
 */
export function launchTelemetrySender(options = {}) {
  const env = options.env || process.env;
  if (env.FLOWER_NO_TELEMETRY) return;
  try {
    if (options.launch) { options.launch(); return; }
    const child = spawn(process.execPath, [fileURLToPath(new URL("./telemetry-sender.js", import.meta.url))], {
      env, detached: true, stdio: "ignore", windowsHide: true,
    });
    child.on("error", () => {});
    child.unref();
  } catch { /* 启动失败留待后续活动再次唤起。 */ }
}

/** 将事件可靠写入用户队列后才发布日去重提示。
 * @param {string} target 项目
 * @param {object} event 受控事件字段
 * @param {object} options 环境和依赖
 * @returns {{status:string}} 本地结果
 */
export function queueTelemetryEvent(target, event, options = {}) {
  try {
    const now = options.now || new Date();
    const directory = telemetryQueueDirectory(options.env);
    let wake = false;
    const result = withTelemetryState((state, save) => {
      if (!state.enabled) return { status: "disabled" };
      const meta = metadata(directory);
      let records = prune(directory, meta, now.getTime());
      const key = event.event === "activity_daily" ? `${now.toISOString().slice(0, 10)}:${event.ai_platform}` : null;
      if (key && !["claude", "codex"].includes(event.ai_platform)) return { status: "invalid_event" };
      wake = (!meta.nextRetryAt || Date.parse(meta.nextRetryAt) <= now.getTime()) && (!meta.lease || meta.lease.until <= now.getTime());
      if (key && meta.hints[key]) {
        meta.pending = records.length + (fs.existsSync(path.join(directory, "legacy.json")) ? 1 : 0);
        writeTelemetryJson(path.join(directory, "meta.json"), meta);
        wake &&= meta.pending > 0;
        return { status: "duplicate" };
      }
      const payload = { event_id: event.event_id || crypto.randomUUID(), event: event.event,
        observed_at: now.toISOString(), source_kind: key ? "ai_hook" : "cli", ai_platform: key ? event.ai_platform : null,
        ...telemetrySnapshot(target, state, options) };
      if (!key) for (const field of ["operation", "outcome", "error_category", "failure_stage", "duration_ms", "duration_kind"]) payload[field] = event[field];
      if (!validPayload(payload)) return { status: "invalid_event" };
      const file = path.join(directory, `event-${payload.event_id}.json`);
      if (fs.existsSync(file)) return { status: "duplicate" };
      records = prune(directory, meta, now.getTime(), 1);
      save({ developerName: payload.developer_name });
      writeTelemetryJson(file, { deviceId: state.deviceId, queuedAt: now.toISOString(), payload });
      if (key) meta.hints[key] = { event_id: payload.event_id, delivered: false };
      meta.pending = records.length + 1 + (fs.existsSync(path.join(directory, "legacy.json")) ? 1 : 0);
      writeTelemetryJson(path.join(directory, "meta.json"), meta);
      return { status: "queued" };
    }, { ...options, create: true });
    if (wake) launchTelemetrySender(options);
    return result;
  } catch { return { status: "failed" }; }
}

/** v1 仍保留原采集口径和节流，网络改由同一 sender 执行。
 * @param {string} target 项目
 * @param {string} event 旧事件
 * @param {object} options 依赖
 * @returns {object} 入队结果
 */
export function queueLegacyTelemetry(target, event, options = {}) {
  const now = options.now || new Date();
  const directory = telemetryQueueDirectory(options.env);
  const result = withTelemetryState((state, save) => {
    if (!state.enabled) return { status: "disabled" };
    const payload = buildTelemetryPayload(target, event, { ...options, deviceId: state.deviceId, developerName: state.developerName, now });
    if (!payload) return { status: "missing_developer" };
    if (!options.force && isWithinInterval(state, now, readUpdateCheck(path.resolve(target)).intervalHours)) return { status: "throttled" };
    const meta = metadata(directory);
    const records = prune(directory, meta, now.getTime());
    save({ developerName: payload.developer_name, lastAttemptAt: now.toISOString() });
    writeTelemetryJson(path.join(directory, "legacy.json"), { id: crypto.randomUUID(), queuedAt: now.toISOString(), payload });
    meta.pending = records.length + 1;
    writeTelemetryJson(path.join(directory, "meta.json"), meta);
    return { status: "queued" };
  }, { ...options, create: true });
  if (result.status === "queued") launchTelemetrySender(options);
  return result;
}

/** 只读展示本地队列诊断，不创建身份、锁或网络请求。
 * @param {object} options 环境
 * @returns {object} 诊断
 */
export function telemetryQueueStatus(options = {}) {
  try {
    const directory = telemetryQueueDirectory(options.env);
    return { ...metadata(directory), pending: entries(directory).length + (readTelemetryJson(path.join(directory, "legacy.json")) ? 1 : 0) };
  } catch { return { pending: null, diagnostic: "corrupt_queue" }; }
}

/** 单次发送最多一批；网络之外的状态更新均共锁并复核禁用。
 * @param {object} options 环境、HTTP 和测试时钟
 * @returns {Promise<object>} 发送结果
 */
export async function flushTelemetryQueue(options = {}) {
  const env = options.env || process.env;
  if (env.FLOWER_NO_TELEMETRY) return { status: "disabled_by_env" };
  const now = options.now || new Date();
  const directory = telemetryQueueDirectory(env);
  const token = crypto.randomUUID();
  let batch, legacy, deviceId;
  try {
    const claimed = withTelemetryState(state => {
      if (!state.enabled) return { status: "disabled" };
      const meta = metadata(directory);
      if ((meta.lease && meta.lease.until > now.getTime()) || Date.parse(meta.nextRetryAt) > now.getTime()) return { status: "deferred" };
      batch = prune(directory, meta, now.getTime()).filter(entry => entry.deviceId === state.deviceId).slice(0, 20);
      // 4 KiB 单事件之外 envelope 也占字节，批次总量留出余量。
      while (batch.length && Buffer.byteLength(JSON.stringify(batch.map(entry => entry.payload))) > 63000) batch.pop();
      legacy = batch.length ? null : readTelemetryJson(path.join(directory, "legacy.json"));
      if (legacy && (!validLegacyEntry(legacy) || legacy.payload.device_id !== state.deviceId)) throw new Error("兼容遥测队列损坏");
      if (legacy && now.getTime() - Date.parse(legacy.queuedAt) >= MAX_AGE) { fs.unlinkSync(path.join(directory, "legacy.json")); legacy = null; meta.dropped += 1; }
      if (!batch.length && !legacy) return { status: "empty" };
      deviceId = state.deviceId;
      meta.lease = { token, until: now.getTime() + 15000 };
      meta.nextRetryAt = new Date(now.getTime() + 60000).toISOString();
      writeTelemetryJson(path.join(directory, "meta.json"), meta);
      return { status: "claimed" };
    }, { env });
    if (claimed.status !== "claimed") return claimed;
    let response, receipts, diagnostic;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 10000);
    try {
      // 紧靠请求发起再次读取开关；已发出的请求无法由后来的 disable 撤回。
      const allowed = withTelemetryState(state => state.enabled && state.deviceId === deviceId, { env });
      if (allowed !== true) return { status: "disabled" };
      response = await (options.fetch || fetch)(options.endpoint || `${FLOWER_TELEMETRY_ENDPOINT}${legacy ? "" : "/events"}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify(legacy ? legacy.payload : { schema_version: 2, device_id: deviceId, events: batch.map(entry => entry.payload) }),
      });
      if (response.ok) {
        if (!legacy) receipts = (await response.json()).results;
        if (!legacy && !Array.isArray(receipts)) throw new Error("invalid_response");
      } else diagnostic = response.status === 429 ? "rate_limited" : response.status === 400 || response.status === 413 ? "invalid_batch" : "server_unavailable";
    } catch { diagnostic = controller.signal.aborted ? "timeout" : "network"; }
    finally { clearTimeout(timer); }
    return withTelemetryState((state, save) => {
      if (!state.enabled || state.deviceId !== deviceId) return { status: "disabled" };
      const meta = metadata(directory);
      if (meta.lease?.token !== token) return { status: "superseded" };
      let acknowledged = 0;
      if (legacy && (response?.ok || diagnostic === "invalid_batch")) {
        if (readTelemetryJson(path.join(directory, "legacy.json"))?.id === legacy.id) fs.unlinkSync(path.join(directory, "legacy.json"));
        if (response?.ok) { save({ lastSuccessAt: now.toISOString() }); acknowledged = 1; }
      }
      if (!legacy) for (const entry of batch) {
        const receipt = receipts?.find(item => item?.event_id === entry.payload.event_id);
        const accepted = ["accepted", "duplicate"].includes(receipt?.status);
        const rejected = receipt?.status === "rejected" && REASONS.has(receipt.reason);
        if (accepted || rejected || diagnostic === "invalid_batch") {
          fs.rmSync(path.join(directory, entry.name), { force: true });
          for (const [key, hint] of Object.entries(meta.hints)) if (hint.event_id === entry.payload.event_id) {
            if (accepted) hint.delivered = true; else delete meta.hints[key];
          }
          if (accepted) acknowledged += 1;
          else diagnostic = receipt?.reason || "invalid_batch";
        }
      }
      meta.pending = entries(directory).length + (fs.existsSync(path.join(directory, "legacy.json")) ? 1 : 0);
      meta.lease = null;
      meta.attempts = acknowledged ? 0 : Math.min(meta.attempts + 1, 10);
      let delay = Math.min(3600000, 60000 * 2 ** Math.max(0, meta.attempts - 1) * (1 + Math.random() * 0.2));
      const retry = response?.headers?.get?.("Retry-After");
      if (retry) {
        const retryDelay = /^\d+$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry) - now.getTime();
        if (Number.isFinite(retryDelay) && retryDelay > 0) delay = Math.max(delay, Math.min(retryDelay, 86400000));
      }
      meta.nextRetryAt = meta.pending ? new Date(now.getTime() + delay).toISOString() : null;
      if (acknowledged && !legacy) meta.lastSuccessAt = now.toISOString();
      if (diagnostic) { meta.diagnostic = diagnostic; meta.lastFailureAt = now.toISOString(); }
      else if (!acknowledged) meta.diagnostic = "invalid_response";
      writeTelemetryJson(path.join(directory, "meta.json"), meta);
      return { status: acknowledged ? "reported" : "failed" };
    }, { env });
  } catch { return { status: "failed" }; }
}
