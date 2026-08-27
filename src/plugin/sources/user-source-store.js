import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  GITLAB_OAUTH_LEGACY_SCOPES,
  GITLAB_OAUTH_REQUEST_SCOPES,
} from "../auth/credential-store.js";
import { PluginIoError } from "../errors.js";
import { PLUGIN_RUNTIME_ERROR_CODES, PluginRuntimeError } from "../runtime-errors.js";
import {
  assertSafePosixRelativePath,
  isGitHubRepository,
  isGitLabProjectPath,
  isPluginId,
} from "../schemas/shared.js";
import { compareUtf8 } from "../stable-order.js";

const SOURCE_CONFIG_VERSION = 3;
const SOURCE_DESCRIPTOR_VERSION = 2;
const LEGACY_SOURCE_CONFIG_VERSION = 1;
const EXTERNAL_FORMATS = new Set(["auto", "flower", "codex", "claude-code", "skill-only"]);
const BUILTIN_DESCRIPTOR_PATH = fileURLToPath(
  new URL("../../builtin-marketplaces/rd-guide.json", import.meta.url),
);
const SECRET_FIELDS = new Set([
  "accessToken",
  "refreshToken",
  "token",
  "clientSecret",
  "applicationSecret",
]);

/**
 * 判断 GitLab source descriptor 的 OAuth scopes 是否属于兼容集合。
 *
 * @param {string[]} scopes 已排序 scope
 * @returns {boolean} 是否支持
 */
function isSupportedGitLabSourceScopes(scopes) {
  const serialized = scopes.join(" ");
  return serialized === [...GITLAB_OAUTH_LEGACY_SCOPES].sort(compareUtf8).join(" ") ||
    serialized === [...GITLAB_OAUTH_REQUEST_SCOPES].sort(compareUtf8).join(" ");
}

/**
 * 返回当前平台的 Flower 用户配置目录。
 *
 * @param {NodeJS.ProcessEnv} [env] 环境变量
 * @returns {string} 用户配置目录
 */
export function flowerConfigDirectory(env = process.env) {
  if (env.XDG_CONFIG_HOME) return path.join(env.XDG_CONFIG_HOME, "flower-trellis");
  if (process.platform === "win32" && env.APPDATA) return path.join(env.APPDATA, "flower-trellis");
  return path.join(os.homedir(), ".config", "flower-trellis");
}

/**
 * 校验 GitLab source descriptor。
 *
 * @param {unknown} value 原始 descriptor
 * @returns {object} 规范化 descriptor
 */
export function validateGitLabSourceDescriptor(value) {
  const source = /** @type {Record<string,unknown>} */ (value);
  const allowedFields = new Set([
    "schemaVersion", "id", "type", "name", "enabled", "baseUrl", "project", "ref",
    "marketplacePath", "oauth", "builtin",
  ]);
  const unknownField = Object.keys(source || {}).find((key) => !allowedFields.has(key));
  const unknownOauthField = Object.keys(/** @type {object} */ (source?.oauth || {}))
    .find((key) => !["applicationId", "scopes"].includes(key));
  if (unknownField || unknownOauthField) {
    throw new PluginRuntimeError(`Source 配置包含未知字段:${unknownField || `oauth.${unknownOauthField}`}`, {
      code: PLUGIN_RUNTIME_ERROR_CODES.SOURCE_CONFIG_INVALID,
      path: String(source?.id || ""),
    });
  }
  for (const key of SECRET_FIELDS) {
    if (key in (source || {}) || key in /** @type {object} */ (source?.oauth || {})) {
      throw new PluginRuntimeError(`Source 配置不得包含敏感字段:${key}`, {
        code: PLUGIN_RUNTIME_ERROR_CODES.SOURCE_CONFIG_INVALID,
        path: String(source?.id || ""),
      });
    }
  }
  let baseUrl;
  try {
    baseUrl = new URL(String(source?.baseUrl));
  } catch (error) {
    throw new PluginRuntimeError("GitLab source baseUrl 无效", {
      code: PLUGIN_RUNTIME_ERROR_CODES.SOURCE_CONFIG_INVALID,
      cause: error,
    });
  }
  const oauth = /** @type {Record<string,unknown>} */ (source?.oauth || {});
  const scopes = Array.isArray(oauth?.scopes) ? [...oauth.scopes].sort(compareUtf8) : [];
  if (
    ![LEGACY_SOURCE_CONFIG_VERSION, SOURCE_DESCRIPTOR_VERSION].includes(source.schemaVersion) ||
    !isPluginId(source.id) ||
    source.type !== "gitlab" ||
    typeof source.name !== "string" || !source.name ||
    typeof source.enabled !== "boolean" ||
    !["http:", "https:"].includes(baseUrl.protocol) ||
    Boolean(baseUrl.username || baseUrl.password) ||
    !isGitLabProjectPath(source.project) ||
    typeof source.ref !== "string" || !source.ref ||
    typeof source.marketplacePath !== "string" || !source.marketplacePath ||
    typeof oauth?.applicationId !== "string" || !oauth.applicationId ||
    !isSupportedGitLabSourceScopes(scopes)
  ) {
    throw new PluginRuntimeError(`GitLab source 配置无效:${String(source?.id || "")}`, {
      code: PLUGIN_RUNTIME_ERROR_CODES.SOURCE_CONFIG_INVALID,
      path: String(source?.id || ""),
    });
  }
  const marketplacePath = assertSafePosixRelativePath(source.marketplacePath, "Marketplace index path");
  baseUrl.pathname = baseUrl.pathname.replace(/\/+$/, "");
  baseUrl.search = "";
  baseUrl.hash = "";
  return {
    schemaVersion: SOURCE_DESCRIPTOR_VERSION,
    id: source.id,
    type: "gitlab",
    name: source.name,
    enabled: source.enabled,
    baseUrl: baseUrl.toString().replace(/\/$/, ""),
    project: source.project,
    ref: source.ref,
    marketplacePath,
    oauth: { applicationId: oauth.applicationId, scopes },
  };
}

/**
 * 把 GitHub URL 或 shorthand 规范化为 `owner/repository`。
 *
 * @param {unknown} value 原始仓库地址
 * @returns {string} GitHub 仓库标识
 */
export function normalizeGitHubRepository(value) {
  const raw = String(value || "").trim();
  let repository = raw;
  if (/^https?:\/\//i.test(raw)) {
    let url;
    try {
      url = new URL(raw);
    } catch (error) {
      throw new PluginRuntimeError("GitHub 仓库地址无效", {
        code: PLUGIN_RUNTIME_ERROR_CODES.SOURCE_CONFIG_INVALID,
        cause: error,
      });
    }
    if (url.hostname.toLowerCase() !== "github.com" || url.username || url.password || url.search || url.hash) {
      throw new PluginRuntimeError("GitHub 来源只允许无凭据的 github.com 公共仓库 URL", {
        code: PLUGIN_RUNTIME_ERROR_CODES.SOURCE_CONFIG_INVALID,
        path: raw,
      });
    }
    repository = url.pathname.replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "");
  } else {
    repository = raw.replace(/\.git$/i, "").replace(/^\/+|\/+$/g, "");
  }
  if (!isGitHubRepository(repository)) {
    throw new PluginRuntimeError(`GitHub 仓库标识无效:${repository}`, {
      code: PLUGIN_RUNTIME_ERROR_CODES.SOURCE_CONFIG_INVALID,
      path: repository,
    });
  }
  return repository;
}

/**
 * 校验 GitHub 公共 source descriptor。
 *
 * @param {unknown} value 原始 descriptor
 * @returns {object} 规范化 descriptor
 */
export function validateGitHubSourceDescriptor(value) {
  const source = /** @type {Record<string,unknown>} */ (value);
  const allowedFields = new Set([
    "schemaVersion", "id", "type", "name", "enabled", "repository", "ref",
    "subdir", "format", "entryPath", "builtin",
  ]);
  const unknownField = Object.keys(source || {}).find((key) => !allowedFields.has(key));
  if (unknownField) {
    throw new PluginRuntimeError(`GitHub source 配置包含未知字段:${unknownField}`, {
      code: PLUGIN_RUNTIME_ERROR_CODES.SOURCE_CONFIG_INVALID,
      path: String(source?.id || ""),
    });
  }
  for (const key of SECRET_FIELDS) {
    if (key in (source || {})) {
      throw new PluginRuntimeError(`Source 配置不得包含敏感字段:${key}`, {
        code: PLUGIN_RUNTIME_ERROR_CODES.SOURCE_CONFIG_INVALID,
        path: String(source?.id || ""),
      });
    }
  }
  const format = String(source?.format || "auto");
  if (
    Number(source?.schemaVersion) !== SOURCE_DESCRIPTOR_VERSION ||
    !isPluginId(source?.id) ||
    source?.type !== "github" ||
    typeof source?.name !== "string" || !source.name ||
    typeof source?.enabled !== "boolean" ||
    typeof source?.ref !== "string" || !source.ref ||
    !EXTERNAL_FORMATS.has(format)
  ) {
    throw new PluginRuntimeError(`GitHub source 配置无效:${String(source?.id || "")}`, {
      code: PLUGIN_RUNTIME_ERROR_CODES.SOURCE_CONFIG_INVALID,
      path: String(source?.id || ""),
    });
  }
  const subdir = source.subdir === undefined
    ? undefined
    : assertSafePosixRelativePath(source.subdir, "GitHub source subdir");
  const entryPath = source.entryPath === undefined
    ? undefined
    : assertSafePosixRelativePath(source.entryPath, "GitHub source entryPath");
  if ((format === "auto") !== (entryPath === undefined)) {
    throw new PluginRuntimeError("GitHub source 自动格式不能固定 entryPath，已确认格式必须固定 entryPath", {
      code: PLUGIN_RUNTIME_ERROR_CODES.SOURCE_CONFIG_INVALID,
      path: String(source.id),
    });
  }
  return {
    schemaVersion: SOURCE_DESCRIPTOR_VERSION,
    id: source.id,
    type: "github",
    name: source.name,
    enabled: source.enabled,
    repository: normalizeGitHubRepository(source.repository),
    ref: source.ref,
    ...(subdir ? { subdir } : {}),
    format,
    ...(entryPath ? { entryPath } : {}),
  };
}

/**
 * 按来源类型校验用户 source descriptor。
 *
 * @param {unknown} value 原始 descriptor
 * @returns {object} 规范化 descriptor
 */
export function validateSourceDescriptor(value) {
  if (value?.type === "gitlab") return validateGitLabSourceDescriptor(value);
  if (value?.type === "github") return validateGitHubSourceDescriptor(value);
  throw new PluginRuntimeError(`未知 Plugin source 类型:${String(value?.type || "")}`, {
    code: PLUGIN_RUNTIME_ERROR_CODES.SOURCE_CONFIG_INVALID,
    path: String(value?.id || ""),
  });
}

/**
 * XDG 用户级 Plugin source 存储。
 */
export class UserSourceStore {
  /**
   * 创建用户级 source 存储。
   *
   * @param {{configFile?:string,builtinDescriptors?:object[]}} [options] 路径与内置来源注入
   */
  constructor(options = {}) {
    this.configFile = options.configFile || path.join(flowerConfigDirectory(), "plugin-sources.json");
    this.builtinDescriptors = options.builtinDescriptors || [
      JSON.parse(fs.readFileSync(BUILTIN_DESCRIPTOR_PATH, "utf8")),
    ];
  }

  /**
   * 列出合并后的全部来源。
   *
   * @returns {object[]} 稳定排序的来源
   */
  list() {
    const merged = new Map(this.builtinDescriptors.map((source) => [
      source.id,
      { ...validateSourceDescriptor(source), builtin: true },
    ]));
    for (const source of this.#readUserSources()) {
      const builtin = merged.get(source.id);
      if (builtin) {
        // 内置来源的远程连接定义随包升级，用户层只保留显式启停偏好。
        merged.set(source.id, { ...builtin, enabled: source.enabled });
      } else {
        merged.set(source.id, { ...source, builtin: false });
      }
    }
    return [...merged.values()].sort((left, right) => compareUtf8(left.id, right.id));
  }

  /**
   * 读取一个启用来源。
   *
   * @param {string} id 来源 ID
   * @param {{includeDisabled?:boolean}} [options] 是否包含禁用来源
   * @returns {object} 来源
   */
  get(id, options = {}) {
    const source = this.list().find((entry) => entry.id === id);
    if (!source || (!source.enabled && !options.includeDisabled)) {
      throw new PluginRuntimeError(`Plugin source 不存在或已禁用:${id}`, {
        code: PLUGIN_RUNTIME_ERROR_CODES.SOURCE_NOT_FOUND,
        path: id,
      });
    }
    return source;
  }

  /**
   * 新增或替换用户来源。
   *
   * @param {object} source 来源 descriptor
   * @returns {object} 保存后的来源
   */
  set(source) {
    const normalized = validateSourceDescriptor({ schemaVersion: SOURCE_DESCRIPTOR_VERSION, ...source });
    if (this.builtinDescriptors.some(({ id }) => id === normalized.id)) {
      throw new PluginRuntimeError(`内置 Plugin source 仅支持启用或停用:${normalized.id}`, {
        code: PLUGIN_RUNTIME_ERROR_CODES.SOURCE_CONFIG_INVALID,
        path: normalized.id,
      });
    }
    const sources = this.#readUserSources().filter((entry) => entry.id !== normalized.id);
    sources.push(normalized);
    this.#writeUserSources(sources);
    return normalized;
  }

  /**
   * 删除用户覆盖；内置来源会恢复默认值。
   *
   * @param {string} id 来源 ID
   * @returns {boolean} 是否删除用户记录
   */
  remove(id) {
    const existing = this.#readUserSources();
    const sources = existing.filter((entry) => entry.id !== id);
    if (sources.length === existing.length) return false;
    this.#writeUserSources(sources);
    return true;
  }

  /**
   * 判断来源是否存在用户级覆盖。
   *
   * @param {string} id 来源 ID
   * @returns {boolean} 是否存在用户级覆盖
   */
  hasOverride(id) {
    return this.#readUserSources().some((entry) => entry.id === id);
  }

  /**
   * 切换来源启用状态。
   *
   * @param {string} id 来源 ID
   * @param {boolean} enabled 新状态
   * @returns {object} 保存后的来源
   */
  setEnabled(id, enabled) {
    const source = this.get(id, { includeDisabled: true });
    const sources = this.#readUserSources().filter((entry) => entry.id !== id);
    if (source.builtin) {
      const builtin = validateSourceDescriptor(this.builtinDescriptors.find((entry) => entry.id === id));
      if (enabled !== builtin.enabled) sources.push({ id, enabled, builtinPreference: true });
    } else {
      sources.push({ ...source, enabled, builtin: undefined });
    }
    this.#writeUserSources(sources);
    return this.get(id, { includeDisabled: true });
  }

  /** @returns {object[]} 用户配置中的来源 */
  #readUserSources() {
    if (!fs.existsSync(this.configFile)) return [];
    try {
      const raw = JSON.parse(fs.readFileSync(this.configFile, "utf8"));
      if (![LEGACY_SOURCE_CONFIG_VERSION, SOURCE_DESCRIPTOR_VERSION, SOURCE_CONFIG_VERSION].includes(raw.schemaVersion) || !Array.isArray(raw.sources)) {
        throw new TypeError("用户 source 配置 schemaVersion 或 sources 无效");
      }
      if (raw.schemaVersion === LEGACY_SOURCE_CONFIG_VERSION && raw.sources.some(({ type }) => type !== "gitlab")) {
        throw new TypeError("schemaVersion 1 只允许旧 GitLab source");
      }
      const builtinIds = new Set(this.builtinDescriptors.map(({ id }) => id));
      const sources = raw.sources.map((source) => {
        const fields = Object.keys(source || {});
        if (
          fields.length === 2 &&
          fields.every((field) => ["id", "enabled"].includes(field)) &&
          builtinIds.has(source.id) &&
          typeof source.enabled === "boolean"
        ) {
          return { id: source.id, enabled: source.enabled, builtinPreference: true };
        }
        const normalized = validateSourceDescriptor({
          ...source,
          schemaVersion: source.schemaVersion || Math.min(raw.schemaVersion, SOURCE_DESCRIPTOR_VERSION),
        });
        return builtinIds.has(normalized.id)
          ? { id: normalized.id, enabled: normalized.enabled, builtinPreference: true }
          : normalized;
      });
      if (new Set(sources.map(({ id }) => id)).size !== sources.length) {
        throw new TypeError("用户 source 配置包含重复 ID");
      }
      return sources;
    } catch (error) {
      if (error instanceof PluginRuntimeError) throw error;
      throw new PluginRuntimeError(`用户 source 配置损坏:${this.configFile}`, {
        code: PLUGIN_RUNTIME_ERROR_CODES.SOURCE_CONFIG_INVALID,
        path: this.configFile,
        cause: error,
      });
    }
  }

  /**
   * 原子写入用户配置。
   *
   * @param {object[]} sources 用户来源
   */
  #writeUserSources(sources) {
    const parent = path.dirname(this.configFile);
    const temporary = `${this.configFile}.${process.pid}.tmp`;
    try {
      fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
      const serialized = sources.map((source) => (
        source.builtinPreference
          ? { id: source.id, enabled: source.enabled }
          : source
      ));
      fs.writeFileSync(temporary, `${JSON.stringify({
        schemaVersion: SOURCE_CONFIG_VERSION,
        sources: serialized.sort((left, right) => compareUtf8(left.id, right.id)),
      }, null, 2)}\n`, { mode: 0o600 });
      fs.renameSync(temporary, this.configFile);
    } catch (error) {
      fs.rmSync(temporary, { force: true });
      throw new PluginIoError(`无法写入用户 source 配置:${this.configFile}`, {
        path: this.configFile,
        cause: error,
      });
    }
  }
}
