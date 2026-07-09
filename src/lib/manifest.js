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
const UPDATE_CHECK_CACHE_REL = path.join(".trellis", ".flower-update-check.tmp");
const UPDATE_POLICIES = new Set(["off", "notify", "ask", "auto"]);
const UPDATE_CHECK_POLICY_KEYS = new Set(["enabled", "policy", "intervalHours"]);
const UPDATE_CHECK_CACHE_KEYS = new Set([
  "lastCheckedAt",
  "lastRemote",
  "lastReleaseNotes",
  "lastStatus",
  "lastErrorCode",
]);
const DEFAULT_UPDATE_CHECK_POLICY = {
  enabled: true,
  policy: "ask",
  intervalHours: 8,
};
const DEFAULT_UPDATE_CHECK_CACHE = {
  lastCheckedAt: null,
  lastRemote: null,
  lastReleaseNotes: null,
  lastStatus: null,
  lastErrorCode: null,
};
const DEFAULT_UPDATE_CHECK = {
  ...DEFAULT_UPDATE_CHECK_POLICY,
  ...DEFAULT_UPDATE_CHECK_CACHE,
};

/** 判断值是否为普通对象。 */
function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/** 判断对象是否显式包含给定字段。 */
function hasAnyOwn(value, keys) {
  if (!isPlainObject(value)) return false;
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(value, key)) return true;
  }
  return false;
}

/** 从对象里取出指定字段。 */
function pickOwn(value, keys) {
  const raw = isPlainObject(value) ? value : {};
  const picked = {};
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(raw, key)) picked[key] = raw[key];
  }
  return picked;
}

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

/**
 * 归一化远端 dist-tags 缓存。
 *
 * @param {object|null|undefined} value 原始 lastRemote 字段
 * @returns {{latest:string|null,beta:string|null}|null} 归一化后的 dist-tags
 */
function normalizeLastRemote(value) {
  return value && typeof value === "object"
    ? {
        latest: typeof value.latest === "string" ? value.latest : null,
        beta: typeof value.beta === "string" ? value.beta : null,
      }
    : null;
}

/**
 * 归一化启动更新检查策略字段。
 *
 * @param {object|null|undefined} value 原始 updateCheck 字段
 * @returns {{enabled:boolean,policy:string,intervalHours:number}} 归一化后的策略
 */
function normalizeUpdateCheckPolicy(value) {
  const raw = value && typeof value === "object" ? value : {};
  const policy = UPDATE_POLICIES.has(raw.policy) ? raw.policy : DEFAULT_UPDATE_CHECK.policy;
  const interval = Number(raw.intervalHours);
  const intervalHours = Number.isFinite(interval) && interval >= 0
    ? interval
    : DEFAULT_UPDATE_CHECK.intervalHours;
  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : DEFAULT_UPDATE_CHECK.enabled,
    policy,
    intervalHours,
  };
}

/**
 * 归一化启动更新检查运行缓存字段。
 *
 * @param {object|null|undefined} value 原始缓存字段
 * @returns {{lastCheckedAt:string|null,lastRemote:object|null,lastReleaseNotes:object|null,lastStatus:string|null,lastErrorCode:string|null}} 归一化后的缓存
 */
function normalizeUpdateCheckCache(value) {
  const raw = value && typeof value === "object" ? value : {};
  return {
    lastCheckedAt: typeof raw.lastCheckedAt === "string" ? raw.lastCheckedAt : null,
    lastRemote: normalizeLastRemote(raw.lastRemote),
    lastReleaseNotes: normalizeLastReleaseNotes(raw.lastReleaseNotes),
    lastStatus: typeof raw.lastStatus === "string" ? raw.lastStatus : null,
    lastErrorCode: typeof raw.lastErrorCode === "string" ? raw.lastErrorCode : null,
  };
}

/** 读取 tmp 内的 updateCheck 运行缓存;不存在或损坏时返回 null。 */
function readUpdateCheckCacheFile(target) {
  try {
    return normalizeUpdateCheckCache(
      JSON.parse(fs.readFileSync(updateCheckCachePath(target), "utf8")),
    );
  } catch {
    return null;
  }
}

/** 判断 updateCheck 是否仍含旧版 manifest 缓存字段。 */
function hasLegacyUpdateCheckCache(updateCheck) {
  return hasAnyOwn(updateCheck, UPDATE_CHECK_CACHE_KEYS);
}

/**
 * 把旧 manifest 内的缓存字段迁移到 tmp。
 *
 * 只在 tmp 尚不存在时迁移,避免旧 manifest 里的陈旧缓存覆盖新版本地缓存。
 */
function migrateLegacyUpdateCheckCache(target, updateCheck) {
  if (!hasLegacyUpdateCheckCache(updateCheck)) return;
  if (fs.existsSync(updateCheckCachePath(target))) return;
  fs.writeFileSync(
    updateCheckCachePath(target),
    JSON.stringify(normalizeUpdateCheckCache(updateCheck), null, 2) + "\n",
  );
}

/** 写入 tmp 内的 updateCheck 运行缓存。 */
function writeUpdateCheckCache(target, patch, legacyUpdateCheck) {
  const current = readUpdateCheckCacheFile(target) ||
    normalizeUpdateCheckCache(legacyUpdateCheck);
  const cache = normalizeUpdateCheckCache({
    ...current,
    ...patch,
  });
  fs.writeFileSync(updateCheckCachePath(target), JSON.stringify(cache, null, 2) + "\n");
  return cache;
}

/**
 * manifest 文件的绝对路径。
 *
 * @param {string} target 目标项目根
 * @returns {string} manifest 文件绝对路径
 */
export function manifestPath(target) {
  return path.join(target, MANIFEST_REL);
}

/**
 * updateCheck 运行缓存 tmp 文件的绝对路径。
 *
 * @param {string} target 目标项目根
 * @returns {string} updateCheck 运行缓存文件绝对路径
 */
export function updateCheckCachePath(target) {
  return path.join(target, UPDATE_CHECK_CACHE_REL);
}

/**
 * 读取 manifest;不存在或损坏时返回 null。
 *
 * @param {string} target 目标项目根
 * @returns {object|null} manifest 内容
 */
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
  return {
    ...normalizeUpdateCheckPolicy(value),
    ...normalizeUpdateCheckCache(value),
  };
}

/**
 * 读取启动更新检查配置。
 *
 * 返回 manifest 策略与 tmp 运行缓存的合并视图;tmp 不存在时兼容读取旧 manifest 缓存字段。
 *
 * @param {string} target 目标项目根
 * @returns {ReturnType<typeof normalizeUpdateCheck>} 归一化后的配置
 */
export function readUpdateCheck(target) {
  const manifestUpdateCheck = readManifest(target)?.updateCheck;
  return {
    ...normalizeUpdateCheckPolicy(manifestUpdateCheck),
    ...(
      readUpdateCheckCacheFile(target) ||
      // 兼容旧版本:首次写入前仍可复用 manifest 里的运行缓存。
      normalizeUpdateCheckCache(manifestUpdateCheck)
    ),
  };
}

/**
 * 写入启动更新检查配置。
 *
 * 策略字段写入 `.flower-manifest.json`;运行缓存字段写入 `.flower-update-check.tmp`。
 * 若旧 manifest 仍包含缓存字段,本函数会在写入时顺带清理,避免运行态继续进入 git。
 *
 * @param {string} target 目标项目根
 * @param {object} patch 要合并进 updateCheck 的字段
 * @returns {object|null} 写入后的 manifest;没有 manifest 且仅写缓存时返回 null
 */
export function writeUpdateCheck(target, patch) {
  const current = readManifest(target);
  const policyPatch = pickOwn(patch, UPDATE_CHECK_POLICY_KEYS);
  const cachePatch = pickOwn(patch, UPDATE_CHECK_CACHE_KEYS);
  const hasPolicyPatch = Object.keys(policyPatch).length > 0;
  const hasCachePatch = Object.keys(cachePatch).length > 0;
  const hasLegacyCache = hasLegacyUpdateCheckCache(current?.updateCheck);

  if (hasCachePatch && current) {
    writeUpdateCheckCache(target, cachePatch, current.updateCheck);
  } else if (hasLegacyCache) {
    migrateLegacyUpdateCheckCache(target, current.updateCheck);
  }

  if (!hasPolicyPatch && !hasLegacyCache) return current;

  const next = {
    ...(current || {}),
    updateCheck: normalizeUpdateCheckPolicy({
      ...normalizeUpdateCheckPolicy(current?.updateCheck),
      ...policyPatch,
    }),
  };
  fs.writeFileSync(manifestPath(target), JSON.stringify(next, null, 2) + "\n");
  return next;
}

/**
 * 写入 manifest。
 *
 * 若调用方没有显式传入 `updateCheck`,保留目标项目已有策略,避免全装重写时覆盖用户选择。
 * 运行缓存会迁移到 `.flower-update-check.tmp`,不得继续写入 manifest。
 *
 * @param {string} target 目标项目根
 * @param {object} data manifest 新内容
 */
export function writeManifest(target, data) {
  const current = readManifest(target);
  const next = { ...data };
  if (hasLegacyUpdateCheckCache(current?.updateCheck)) {
    migrateLegacyUpdateCheckCache(target, current.updateCheck);
  }
  if (Object.prototype.hasOwnProperty.call(data, "updateCheck")) {
    migrateLegacyUpdateCheckCache(target, data.updateCheck);
    next.updateCheck = normalizeUpdateCheckPolicy(data.updateCheck);
  } else {
    next.updateCheck = normalizeUpdateCheckPolicy(current?.updateCheck);
  }
  fs.writeFileSync(manifestPath(target), JSON.stringify(next, null, 2) + "\n");
}
