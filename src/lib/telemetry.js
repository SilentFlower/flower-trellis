import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { flowerConfigDirectory } from "../plugin/sources/user-source-store.js";
import { ProjectStore } from "../plugin/state/project-store.js";
import { SKILL_GARDEN_PLUGIN_ID } from "../builtin-plugins/skill-garden/provider.js";
import { readManifest, readUpdateCheck } from "./manifest.js";
import { flowerVersion, trellisVersion } from "./versions.js";

/** Flower 遥测接收地址。 */
export const FLOWER_TELEMETRY_ENDPOINT = "https://ai-api.flower-cli.com/api/flower-trellis/telemetry";

const TELEMETRY_SCHEMA_VERSION = 1;
/** 遥测请求保留 10 秒公网预算，避免慢速 TLS 建连或服务端响应被过早中止。 */
const DEFAULT_TIMEOUT_MS = 10000;
const VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,63}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVENTS = new Set(["version_check", "init_completed", "update_completed"]);

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
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new TypeError("遥测状态必须是普通文件");
    }
    const state = normalizeTelemetryState(JSON.parse(fs.readFileSync(filePath, "utf8")));
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
  const filePath = telemetryStatePath(options.env);
  const parent = path.dirname(filePath);
  const randomBytes = options.randomBytes || crypto.randomBytes;
  const temporary = path.join(
    parent,
    `.${path.basename(filePath)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`,
  );
  const normalized = normalizeTelemetryState(state);
  let descriptor = null;

  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(parent, 0o700);
  } catch {
    // Windows 等平台可能不支持 POSIX 权限，目录仍由当前用户配置目录边界保护。
  }
  try {
    const existing = fs.lstatSync(filePath);
    if (existing.isSymbolicLink() || !existing.isFile()) {
      throw new TypeError(`遥测状态必须是普通文件:${filePath}`);
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  try {
    descriptor = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(descriptor, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    fs.renameSync(temporary, filePath);
    try {
      fs.chmodSync(filePath, 0o600);
    } catch {
      // Windows 等平台可能不支持 POSIX 权限，原子写入模式仍限制了 Unix 新文件权限。
    }
    return normalized;
  } catch (error) {
    if (descriptor !== null) {
      try {
        fs.closeSync(descriptor);
      } catch {
        // 保留原始写入错误。
      }
    }
    try {
      fs.unlinkSync(temporary);
    } catch (cleanupError) {
      if (cleanupError?.code !== "ENOENT") throw cleanupError;
    }
    throw error;
  }
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
  const result = readTelemetryState(options);
  const state = result.status === "valid"
    ? result.state
    : createTelemetryState(options);
  return writeTelemetryState({ ...state, enabled }, options);
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
    const name = line?.slice("name=".length).trim() || "";
    return name && name.length <= 100 ? name : null;
  } catch {
    return null;
  }
}

/**
 * 读取项目当前 Flower 与 Trellis 版本，不采集任何项目路径或仓库信息。
 *
 * @param {string} target 项目根目录
 * @returns {{flower:string|null,trellis:string|null}} 项目版本
 */
function readProjectVersions(target) {
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
 * @param {{deviceId:string,now?:Date}} options 设备与时间参数
 * @returns {object} 可上报载荷
 */
export function buildTelemetryPayload(target, event, options) {
  if (!EVENTS.has(event)) throw new TypeError(`未知遥测事件:${event}`);
  if (!UUID_PATTERN.test(String(options?.deviceId || ""))) {
    throw new TypeError("遥测设备 ID 无效");
  }
  const now = options.now instanceof Date ? options.now : new Date();
  const project = readProjectVersions(path.resolve(target));
  const bundledTrellis = trellisVersion();
  return {
    schema_version: TELEMETRY_SCHEMA_VERSION,
    device_id: options.deviceId,
    event,
    flower_version: flowerVersion(),
    bundled_trellis_version: VERSION_PATTERN.test(bundledTrellis) ? bundledTrellis : null,
    project_flower_version: project.flower,
    project_trellis_version: project.trellis,
    developer_name: readProjectDeveloper(path.resolve(target)),
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
function isWithinInterval(state, now, intervalHours) {
  if (!state.lastAttemptAt) return false;
  const attemptedAt = new Date(state.lastAttemptAt).getTime();
  if (!Number.isFinite(attemptedAt)) return false;
  return now.getTime() - attemptedAt < intervalHours * 60 * 60 * 1000;
}

/**
 * 尽力而为地上报 Flower 匿名安装遥测。
 *
 * 网络、状态文件或服务端失败均只返回状态，不输出日志也不影响调用命令。
 *
 * @param {string} target 项目根目录
 * @param {"version_check"|"init_completed"|"update_completed"} event 遥测事件
 * @param {{force?:boolean,env?:NodeJS.ProcessEnv,fetch?:typeof fetch,now?:Date,timeoutMs?:number,endpoint?:string,randomUUID?:()=>string,randomBytes?:(size:number)=>Buffer}} [options] 上报选项
 * @returns {Promise<{status:string}>} 上报结果
 */
export async function reportTelemetry(target, event, options = {}) {
  try {
    const env = options.env || process.env;
    if (env.FLOWER_NO_TELEMETRY) return { status: "disabled_by_env" };

    const readResult = readTelemetryState({ env });
    if (readResult.status === "corrupt") return { status: "corrupt_state" };
    let state = readResult.status === "valid"
      ? readResult.state
      : createTelemetryState(options);
    if (!state.enabled) return { status: "disabled" };

    const now = options.now instanceof Date ? options.now : new Date();
    const intervalHours = readUpdateCheck(path.resolve(target)).intervalHours;
    if (!options.force && isWithinInterval(state, now, intervalHours)) {
      return { status: "throttled" };
    }

    state = writeTelemetryState({ ...state, lastAttemptAt: now.toISOString() }, options);
    const payload = buildTelemetryPayload(target, event, { deviceId: state.deviceId, now });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    try {
      const fetchRequest = options.fetch || fetch;
      const response = await fetchRequest(options.endpoint || FLOWER_TELEMETRY_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!response.ok) return { status: "failed" };
      writeTelemetryState({ ...state, lastSuccessAt: now.toISOString() }, options);
      return { status: "reported" };
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return { status: "failed" };
  }
}
