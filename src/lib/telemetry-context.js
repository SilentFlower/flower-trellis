import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { clearTelemetryQueue, readTelemetryJson, writeTelemetryJson, withTelemetryLock } from "./telemetry-files.js";
import { flowerConfigDirectory } from "../plugin/sources/user-source-store.js";
import { ProjectStore } from "../plugin/state/project-store.js";
import { SKILL_GARDEN_PLUGIN_ID } from "../builtin-plugins/skill-garden/provider.js";
import { readGitDeveloper } from "./developer.js";
import { readManifest } from "./manifest.js";
import { flowerVersion, trellisVersion } from "./versions.js";

/** Flower 遥测接收地址。主机名与 `/api/flower-trellis` 路由前缀都由服务端契约固定,缺一不可。 */
export const FLOWER_TELEMETRY_ENDPOINT = "https://ai-api.hub.flower-cli.com/api/flower-trellis/telemetry";

const TELEMETRY_SCHEMA_VERSION = 1;
const VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,63}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVENTS = new Set(["version_check", "init_completed", "update_completed"]);

/**
 * 规范化可上报的开发者名称。
 *
 * @param {unknown} value 原始名称
 * @returns {string|null} 有效名称，无法使用时返回 null
 */
function normalizeDeveloperName(value) {
  if (typeof value !== "string") return null;
  const name = value.trim();
  return name && name.length <= 100 ? name : null;
}

/**
 * 返回 Flower 用户级遥测状态文件路径。
 *
 * @param {NodeJS.ProcessEnv} [env] 环境变量
 * @returns {string} 状态文件绝对路径
 */
export function telemetryStatePath(env = process.env) {
  return path.join(flowerConfigDirectory(env), "telemetry.json");
}

/**
 * 校验并规范化遥测状态。
 *
 * @param {unknown} value 原始状态
 * @returns {object} 规范化状态
 */
function normalizeTelemetryState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("遥测状态必须是对象");
  }
  if (value.schemaVersion !== TELEMETRY_SCHEMA_VERSION) {
    throw new TypeError("遥测状态 schemaVersion 无效");
  }
  if (!UUID_PATTERN.test(String(value.deviceId || ""))) {
    throw new TypeError("遥测设备 ID 无效");
  }
  if (typeof value.enabled !== "boolean") {
    throw new TypeError("遥测 enabled 无效");
  }
  const developerName = normalizeDeveloperName(value.developerName);
  if (value.developerName !== undefined && value.developerName !== null && !developerName) {
    throw new TypeError("遥测 developerName 无效");
  }
  for (const field of ["lastAttemptAt", "lastSuccessAt"]) {
    if (value[field] !== null && (
      typeof value[field] !== "string" || Number.isNaN(Date.parse(value[field]))
    )) {
      throw new TypeError(`遥测 ${field} 无效`);
    }
  }
  return {
    schemaVersion: TELEMETRY_SCHEMA_VERSION,
    deviceId: value.deviceId,
    developerName,
    enabled: value.enabled,
    lastAttemptAt: value.lastAttemptAt,
    lastSuccessAt: value.lastSuccessAt,
  };
}

/**
 * 读取用户级遥测状态，并区分缺失与损坏。
 *
 * @param {{env?:NodeJS.ProcessEnv}} [options] 读取选项
 * @returns {{status:"missing"|"valid"|"corrupt",state:object|null,path:string,error?:Error}} 状态读取结果
 */
export function readTelemetryState(options = {}) {
  const filePath = telemetryStatePath(options.env);
  try {
    const value = readTelemetryJson(filePath);
    if (value === null && !fs.existsSync(filePath)) return { status: "missing", state: null, path: filePath };
    const state = normalizeTelemetryState(value);
    return { status: "valid", state, path: filePath };
  } catch (error) {
    if (error?.code === "ENOENT") return { status: "missing", state: null, path: filePath };
    return { status: "corrupt", state: null, path: filePath, error };
  }
}

/**
 * 原子写入用户级遥测状态。
 *
 * @param {object} state 已规范化状态
 * @param {{env?:NodeJS.ProcessEnv,randomBytes?:(size:number)=>Buffer}} [options] 写入选项
 * @returns {object} 写入后的状态
 */
function writeTelemetryState(state, options = {}) {
  const normalized = normalizeTelemetryState(state);
  writeTelemetryJson(telemetryStatePath(options.env), normalized);
  return normalized;
}

/**
 * 创建新的默认遥测状态。
 *
 * @param {{randomUUID?:()=>string}} [options] 随机 ID 注入
 * @returns {object} 默认启用的遥测状态
 */
function createTelemetryState(options = {}) {
  const randomUUID = options.randomUUID || crypto.randomUUID;
  return {
    schemaVersion: TELEMETRY_SCHEMA_VERSION,
    deviceId: randomUUID(),
    developerName: null,
    enabled: true,
    lastAttemptAt: null,
    lastSuccessAt: null,
  };
}

/**
 * 显式启用或停用用户级遥测。
 *
 * 损坏状态只允许通过显式设置修复，普通后台上报不会覆盖现场证据。
 *
 * @param {boolean} enabled 是否启用
 * @param {{env?:NodeJS.ProcessEnv,randomUUID?:()=>string,randomBytes?:(size:number)=>Buffer}} [options] 状态选项
 * @returns {object} 写入后的遥测状态
 */
export function setTelemetryEnabled(enabled, options = {}) {
  return withTelemetryLock(() => {
    const result = readTelemetryState(options);
    const state = result.status === "valid" ? result.state : createTelemetryState(options);
    const updated = writeTelemetryState({ ...state, enabled }, options);
    if (!enabled || result.status === "corrupt") clearTelemetryQueue(options.env);
    return updated;
  }, options);
}

/**
 * 读取项目 `.trellis/.developer` 中由 Trellis 明确记录的开发者名称。
 *
 * @param {string} target 项目根目录
 * @returns {string|null} 开发者名称
 */
function readProjectDeveloper(target) {
  try {
    const content = fs.readFileSync(path.join(target, ".trellis", ".developer"), "utf8");
    const line = content.split(/\r?\n/).find((entry) => entry.startsWith("name="));
    return normalizeDeveloperName(line?.slice("name=".length));
  } catch {
    return null;
  }
}

/**
 * 按项目自报、Git 配置、用户级缓存的顺序解析开发者名称。
 *
 * @param {string} target 项目根目录
 * @param {{developerName?:string|null,env?:NodeJS.ProcessEnv}} [options] 回退选项
 * @returns {string|null} 开发者名称
 */
export function resolveDeveloperName(target, options = {}) {
  return readProjectDeveloper(target) ||
    normalizeDeveloperName(readGitDeveloper(target, { env: options.env, timeoutMs: 200 })) ||
    normalizeDeveloperName(options.developerName);
}

/**
 * 读取项目当前 Flower 与 Trellis 版本，不采集任何项目路径或仓库信息。
 *
 * @param {string} target 项目根目录
 * @returns {{flower:string|null,trellis:string|null}} 项目版本
 */
export function readProjectVersions(target) {
  let projectFlower = null;
  let projectTrellis = null;
  try {
    const lock = new ProjectStore(target).readLock();
    const skillGarden = lock?.plugins.find(({ id }) => id === SKILL_GARDEN_PLUGIN_ID);
    projectFlower = skillGarden?.version || readManifest(target)?.flowerVersion || null;
  } catch {
    projectFlower = readManifest(target)?.flowerVersion || null;
  }
  try {
    projectTrellis = fs.readFileSync(path.join(target, ".trellis", ".version"), "utf8").trim();
  } catch {
    projectTrellis = null;
  }
  return {
    flower: VERSION_PATTERN.test(String(projectFlower || "")) ? projectFlower : null,
    trellis: VERSION_PATTERN.test(String(projectTrellis || "")) ? projectTrellis : null,
  };
}

/**
 * 构造严格白名单的匿名遥测载荷。
 *
 * @param {string} target 项目根目录
 * @param {string} event 遥测事件
 * @param {{deviceId:string,developerName?:string|null,env?:NodeJS.ProcessEnv,now?:Date}} options 设备、身份与时间参数
 * @returns {object|null} 可上报载荷；全部身份来源缺失时返回 null
 */
export function buildTelemetryPayload(target, event, options) {
  if (!EVENTS.has(event)) throw new TypeError(`未知遥测事件:${event}`);
  if (!UUID_PATTERN.test(String(options?.deviceId || ""))) {
    throw new TypeError("遥测设备 ID 无效");
  }
  const now = options.now instanceof Date ? options.now : new Date();
  const resolvedTarget = path.resolve(target);
  const developerName = resolveDeveloperName(resolvedTarget, options);
  // 三种可信身份来源都缺失时无法诚实构造开发者名称，保留静默降级作为最后边界。
  if (!developerName) return null;
  const project = readProjectVersions(resolvedTarget);
  const bundledTrellis = trellisVersion();
  return {
    schema_version: TELEMETRY_SCHEMA_VERSION,
    device_id: options.deviceId,
    event,
    flower_version: flowerVersion(),
    bundled_trellis_version: VERSION_PATTERN.test(bundledTrellis) ? bundledTrellis : null,
    project_flower_version: project.flower,
    project_trellis_version: project.trellis,
    developer_name: developerName,
    platform: process.platform,
    arch: process.arch,
    client_time: now.toISOString(),
  };
}

/**
 * 判断常规遥测是否仍处于上报间隔内。
 *
 * @param {object} state 遥测状态
 * @param {Date} now 当前时间
 * @param {number} intervalHours 上报间隔小时数
 * @returns {boolean} 是否应跳过
 */
export function isWithinInterval(state, now, intervalHours) {
  if (!state.lastAttemptAt) return false;
  const attemptedAt = new Date(state.lastAttemptAt).getTime();
  if (!Number.isFinite(attemptedAt)) return false;
  return now.getTime() - attemptedAt < intervalHours * 60 * 60 * 1000;
}

/** 锁内重读唯一身份和开关，调用方仅合并自己拥有的字段。
 * @param {Function} callback 同步回调 (state, save)
 * @param {object} options 环境、创建选项
 * @returns {unknown} 回调结果或静默状态
 */
export function withTelemetryState(callback, options = {}) {
  const env = options.env || process.env;
  if (env.FLOWER_NO_TELEMETRY) return { status: "disabled_by_env" };
  return withTelemetryLock(() => {
    const result = readTelemetryState({ env });
    if (result.status === "corrupt") return { status: "corrupt_state" };
    if (result.status === "missing" && !options.create) return { status: "missing" };
    let state = result.state || createTelemetryState(options);
    return callback(state, (patch = {}) => {
      state = writeTelemetryState({ ...state, ...patch }, { ...options, env });
      return state;
    });
  }, { ...options, env });
}
