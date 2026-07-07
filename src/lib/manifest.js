import fs from "node:fs";
import path from "node:path";

/**
 * flower-trellis 自己的安装清单。
 *
 * 记录「flower 上一次为该项目铺设了哪些强化文件」,使升级(如 0.5/old → 0.6)时
 * 能精确删除当前变体不再包含的过期 skill / command —— 只删自己铺过的路径,
 * 绝不误删用户或 Trellis 本体的文件。
 *
 * 放在 .trellis/ 下,随项目的 Trellis 生命周期存在(uninstall 删 .trellis 时一并消失)。
 */
const MANIFEST_REL = path.join(".trellis", ".flower-manifest.json");
const UPDATE_POLICIES = new Set(["off", "notify", "ask", "auto"]);
const DEFAULT_UPDATE_CHECK = {
  enabled: true,
  policy: "ask",
  intervalHours: 8,
  lastCheckedAt: null,
  lastRemote: null,
  lastReleaseNotes: null,
  lastStatus: null,
  lastErrorCode: null,
};

/**
 * 归一化 release notes 范围字段。
 *
 * @param {object|null|undefined} value 原始 range 字段
 * @returns {{from:string|null,to:string|null,channel:string|null,reason:string|null}} 归一化 range
 */
function normalizeReleaseNotesRange(value) {
  const raw = value && typeof value === "object" ? value : {};
  return {
    from: typeof raw.from === "string" ? raw.from : null,
    to: typeof raw.to === "string" ? raw.to : null,
    channel: typeof raw.channel === "string" ? raw.channel : null,
    reason: typeof raw.reason === "string" ? raw.reason : null,
  };
}

/**
 * 归一化最近一次可用 release notes 摘要。
 *
 * @param {object|null|undefined} value 原始 lastReleaseNotes 字段
 * @returns {{source:string,range:object,versions:Array<{version:string,body:string,truncated:boolean}>,truncated:boolean,moreVersions:boolean,unavailable:boolean}|null} 归一化摘要
 */
function normalizeLastReleaseNotes(value) {
  if (!value || typeof value !== "object") return null;
  const versions = Array.isArray(value.versions)
    ? value.versions
        .map((entry) => {
          if (!entry || typeof entry !== "object") return null;
          const version = typeof entry.version === "string" ? entry.version : null;
          const body = typeof entry.body === "string" ? entry.body : null;
          if (!version || !body) return null;
          return {
            version,
            body,
            truncated: entry.truncated === true,
          };
        })
        .filter(Boolean)
    : [];
  if (!versions.length && value.unavailable !== true) return null;
  return {
    source: typeof value.source === "string" ? value.source : "npm-metadata",
    range: normalizeReleaseNotesRange(value.range),
    versions,
    truncated: value.truncated === true,
    moreVersions: value.moreVersions === true,
    unavailable: value.unavailable === true,
  };
}

/** manifest 文件的绝对路径。 */
export function manifestPath(target) {
  return path.join(target, MANIFEST_REL);
}

/** 读取 manifest;不存在或损坏时返回 null。 */
export function readManifest(target) {
  try {
    return JSON.parse(fs.readFileSync(manifestPath(target), "utf8"));
  } catch {
    return null;
  }
}

/**
 * 归一化启动更新检查配置。
 *
 * 用户策略字段启用保守默认值;缓存字段只保留结构化摘要,避免把网络错误细节写入项目。
 *
 * @param {object|null|undefined} value 原始 updateCheck 字段
 * @returns {{enabled:boolean,policy:string,intervalHours:number,lastCheckedAt:string|null,lastRemote:object|null,lastReleaseNotes:object|null,lastStatus:string|null,lastErrorCode:string|null}} 归一化后的 updateCheck
 */
export function normalizeUpdateCheck(value) {
  const raw = value && typeof value === "object" ? value : {};
  const policy = UPDATE_POLICIES.has(raw.policy) ? raw.policy : DEFAULT_UPDATE_CHECK.policy;
  const interval = Number(raw.intervalHours);
  const intervalHours = Number.isFinite(interval) && interval >= 0
    ? interval
    : DEFAULT_UPDATE_CHECK.intervalHours;
  const lastRemote = raw.lastRemote && typeof raw.lastRemote === "object"
    ? {
        latest: typeof raw.lastRemote.latest === "string" ? raw.lastRemote.latest : null,
        beta: typeof raw.lastRemote.beta === "string" ? raw.lastRemote.beta : null,
      }
    : null;

  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : DEFAULT_UPDATE_CHECK.enabled,
    policy,
    intervalHours,
    lastCheckedAt: typeof raw.lastCheckedAt === "string" ? raw.lastCheckedAt : null,
    lastRemote,
    lastReleaseNotes: normalizeLastReleaseNotes(raw.lastReleaseNotes),
    lastStatus: typeof raw.lastStatus === "string" ? raw.lastStatus : null,
    lastErrorCode: typeof raw.lastErrorCode === "string" ? raw.lastErrorCode : null,
  };
}

/**
 * 读取 manifest 里的启动更新检查配置。
 *
 * @param {string} target 目标项目根
 * @returns {ReturnType<typeof normalizeUpdateCheck>} 归一化后的配置
 */
export function readUpdateCheck(target) {
  return normalizeUpdateCheck(readManifest(target)?.updateCheck);
}

/**
 * 写入启动更新检查配置,保留 manifest 其它安装清单字段。
 *
 * @param {string} target 目标项目根
 * @param {object} patch 要合并进 updateCheck 的字段
 * @returns {object} 写入后的 manifest
 */
export function writeUpdateCheck(target, patch) {
  const current = readManifest(target) || {};
  const updateCheck = normalizeUpdateCheck({
    ...normalizeUpdateCheck(current.updateCheck),
    ...(patch || {}),
  });
  const next = { ...current, updateCheck };
  fs.writeFileSync(manifestPath(target), JSON.stringify(next, null, 2) + "\n");
  return next;
}

/**
 * 写入 manifest。
 *
 * 若调用方没有显式传入 `updateCheck`,保留目标项目已有策略与缓存,避免全装重写时覆盖用户选择。
 *
 * @param {string} target 目标项目根
 * @param {object} data manifest 新内容
 */
export function writeManifest(target, data) {
  const current = readManifest(target);
  const next = { ...data };
  if (Object.prototype.hasOwnProperty.call(data, "updateCheck")) {
    next.updateCheck = normalizeUpdateCheck(data.updateCheck);
  } else {
    next.updateCheck = normalizeUpdateCheck(current?.updateCheck);
  }
  fs.writeFileSync(manifestPath(target), JSON.stringify(next, null, 2) + "\n");
}
