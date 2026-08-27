import { PLUGIN_RUNTIME_ERROR_CODES, PluginRuntimeError } from "../runtime-errors.js";

/** 凭据载荷 schema 版本。 */
export const CREDENTIAL_SCHEMA_VERSION = 1;

/** Flower GitLab OAuth 主动请求 scope。 */
export const GITLAB_OAUTH_REQUEST_SCOPES = Object.freeze([
  "openid",
  "profile",
  "read_user",
  "write_repository",
  "api",
]);

/** 旧版 GitLab OAuth 读取能力 scope。 */
export const GITLAB_OAUTH_LEGACY_SCOPES = Object.freeze(["read_api", "read_repository"]);

/** 兼容旧内部导入名；新代码应使用 GITLAB_OAUTH_REQUEST_SCOPES。 */
export const GITLAB_OAUTH_SCOPES = GITLAB_OAUTH_REQUEST_SCOPES;

/**
 * 规范化 GitLab 来源凭据账户名。
 *
 * @param {{baseUrl:string,id:string}} source GitLab 来源
 * @returns {string} Keyring account
 */
export function credentialAccount(source) {
  const url = new URL(source.baseUrl);
  const port = url.port ? `:${url.port}` : "";
  return `${url.hostname.toLowerCase()}${port}/${source.id}`;
}

/**
 * 判断 GitLab OAuth scope 是否具备当前 REST 读取能力。
 *
 * @param {string[]} scopes 实际授权 scope
 * @returns {boolean} 是否满足读取 Marketplace 所需能力
 */
export function isGitLabCredentialScopeSufficient(scopes) {
  return scopes.includes("api") || GITLAB_OAUTH_LEGACY_SCOPES.every((scope) => scopes.includes(scope));
}

/**
 * 校验并规范化版本化 OAuth 凭据。
 *
 * @param {unknown} value 原始凭据
 * @param {{id:string,baseUrl:string}} source 目标来源
 * @returns {{schemaVersion:1,sourceId:string,baseUrl:string,tokenType:string,scope:string[],accessToken:string,refreshToken:string|null,createdAt:number|null,expiresAt:number|null,redirectUri:string|null}} 凭据
 */
export function validateCredential(value, source) {
  const credential = /** @type {Record<string,unknown>} */ (value);
  const scopes = Array.isArray(credential?.scope)
    ? credential.scope.filter((scope) => typeof scope === "string").sort()
    : [];
  if (
    !credential ||
    credential.schemaVersion !== CREDENTIAL_SCHEMA_VERSION ||
    credential.sourceId !== source.id ||
    credential.baseUrl !== source.baseUrl ||
    typeof credential.accessToken !== "string" ||
    credential.accessToken.length === 0 ||
    typeof credential.tokenType !== "string" ||
    !isGitLabCredentialScopeSufficient(scopes) ||
    !(credential.refreshToken === null || typeof credential.refreshToken === "string") ||
    !(credential.createdAt === undefined || credential.createdAt === null || Number.isFinite(credential.createdAt)) ||
    !(credential.expiresAt === null || Number.isFinite(credential.expiresAt)) ||
    !(credential.redirectUri === undefined || credential.redirectUri === null || typeof credential.redirectUri === "string")
  ) {
    throw new PluginRuntimeError(`GitLab 凭据无效或 scope 不完整:${source.id}`, {
      code: PLUGIN_RUNTIME_ERROR_CODES.AUTH_SCOPE_INVALID,
      path: source.id,
    });
  }
  return {
    schemaVersion: CREDENTIAL_SCHEMA_VERSION,
    sourceId: source.id,
    baseUrl: source.baseUrl,
    tokenType: credential.tokenType,
    scope: scopes,
    accessToken: credential.accessToken,
    refreshToken: credential.refreshToken,
    createdAt: credential.createdAt ?? null,
    expiresAt: credential.expiresAt,
    redirectUri: credential.redirectUri || null,
  };
}

/**
 * 递归清理诊断对象中的敏感字段。
 *
 * @param {unknown} value 原始值
 * @returns {unknown} 已脱敏副本
 */
export function redactSensitive(value) {
  if (Array.isArray(value)) return value.map((entry) => redactSensitive(entry));
  if (!value || typeof value !== "object") return value;
  const sanitized = {};
  for (const [key, entry] of Object.entries(value)) {
    const normalized = key.toLowerCase().replaceAll("-", "_");
    if (
      normalized.includes("token") ||
      normalized === "authorization" ||
      normalized === "code" ||
      normalized === "client_secret"
    ) {
      sanitized[key] = "[REDACTED]";
    } else {
      sanitized[key] = redactSensitive(entry);
    }
  }
  return sanitized;
}

/**
 * OAuth 凭据存储公共接口。
 */
export class CredentialStore {
  /**
   * 读取来源凭据。
   *
   * @param {{id:string,baseUrl:string}} source 来源
   * @returns {Promise<object|null>} 凭据或空值
   */
  async get(source) {
    throw new TypeError(`CredentialStore.get() 未实现:${source.id}`);
  }

  /**
   * 保存来源凭据。
   *
   * @param {{id:string,baseUrl:string}} source 来源
   * @param {object} credential 凭据
   * @returns {Promise<void>} 完成信号
   */
  async set(source, credential) {
    throw new TypeError(`CredentialStore.set() 未实现:${source.id}:${Boolean(credential)}`);
  }

  /**
   * 删除来源凭据。
   *
   * @param {{id:string,baseUrl:string}} source 来源
   * @returns {Promise<void>} 完成信号
   */
  async delete(source) {
    throw new TypeError(`CredentialStore.delete() 未实现:${source.id}`);
  }
}
