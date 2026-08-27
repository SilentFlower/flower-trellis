import { execFile } from "node:child_process";
import { PLUGIN_RUNTIME_ERROR_CODES, PluginRuntimeError } from "../runtime-errors.js";

const GLAB_COMMAND = "glab";
const GLAB_AUTH_TIMEOUT_MS = 5_000;
const GLAB_AUTH_MAX_BUFFER = 1024 * 1024;
const HOST_BOUND_TOKEN_NAMES = ["FLOWER_GITLAB_TOKEN", "GITLAB_TOKEN", "GLAB_TOKEN"];
const HOST_BOUND_HOST_NAMES = ["FLOWER_GITLAB_HOST", "GITLAB_HOST", "GLAB_HOST", "CI_SERVER_HOST", "CI_SERVER_URL"];

/**
 * 返回 GitLab source 的小写 host[:port]。
 *
 * @param {{baseUrl:string}} source GitLab 来源
 * @returns {string} host[:port]
 */
export function gitLabCredentialHost(source) {
  return new URL(source.baseUrl).host.toLowerCase();
}

/**
 * 把 host、origin 或项目 URL 规范化为小写 host[:port]。
 *
 * @param {unknown} value 原始 host 或 URL
 * @returns {string|null} 规范化 host；无法解析时返回 null
 */
export function normalizeGitLabCredentialHost(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  try {
    const url = /^https?:\/\//i.test(raw) ? new URL(raw) : new URL(`https://${raw.replace(/^\/+/, "")}`);
    return url.host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * 判断原始 host/URL 是否与 GitLab source 完全同 host。
 *
 * @param {unknown} value 原始 host 或 URL
 * @param {{baseUrl:string}} source GitLab 来源
 * @returns {boolean} 是否同 host
 */
export function isSameGitLabCredentialHost(value, source) {
  return normalizeGitLabCredentialHost(value) === gitLabCredentialHost(source);
}

/**
 * 从 `glab auth status --show-token` 输出中提取同 host token。
 *
 * @param {string} output glab stdout/stderr 合并文本
 * @param {{baseUrl:string}} source GitLab 来源
 * @returns {string|null} access token；无法证明同 host 或未输出 token 时返回 null
 */
export function parseGlabAuthStatusToken(output, source) {
  const text = String(output || "");
  const host = gitLabCredentialHost(source);
  const escapedHost = host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const hostPattern = new RegExp(`(^|[^A-Za-z0-9.-])${escapedHost}($|[^A-Za-z0-9.-])`, "i");
  if (!hostPattern.test(text)) return null;
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/\btoken\b[^:]*:\s*([^\s]+)/i);
    if (!match) continue;
    const token = match[1].replace(/^['"]|['"]$/g, "");
    if (!token || token.includes("*") || token === "[REDACTED]") continue;
    return token;
  }
  return null;
}

/**
 * 从 host 绑定的环境变量中解析 GitLab token。
 *
 * @param {{baseUrl:string}} source GitLab 来源
 * @param {NodeJS.ProcessEnv|Record<string,string|undefined>} [env] 环境变量
 * @returns {{authorized:true,scopes:string[],expiresAt:null,persistent:false,accessToken:string,credentialSource:"env"}|null} 环境凭据
 */
export function resolveGitLabEnvironmentCredential(source, env = process.env) {
  const hostKey = gitLabCredentialHost(source).toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  for (const name of HOST_BOUND_TOKEN_NAMES.map((prefix) => `${prefix}_${hostKey}`)) {
    const accessToken = String(env[name] || "").trim();
    if (accessToken) return externalCredential(accessToken, "env");
  }
  const hostMatched = HOST_BOUND_HOST_NAMES.some((name) => isSameGitLabCredentialHost(env[name], source));
  if (!hostMatched) return null;
  for (const name of HOST_BOUND_TOKEN_NAMES) {
    const accessToken = String(env[name] || "").trim();
    if (accessToken) return externalCredential(accessToken, "env");
  }
  return null;
}

/**
 * 默认执行 glab 的安全包装。
 *
 * @param {string[]} args glab 参数
 * @param {{command?:string,timeoutMs?:number}} [options] 命令配置
 * @returns {Promise<{stdout:string,stderr:string}>} 子进程输出
 */
export async function runGlab(args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(options.command || GLAB_COMMAND, args, {
      timeout: options.timeoutMs || GLAB_AUTH_TIMEOUT_MS,
      maxBuffer: GLAB_AUTH_MAX_BUFFER,
      windowsHide: true,
    }, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

/**
 * GitLab 凭据解析器，统一 Flower Keyring、glab 与环境 fallback。
 */
export class GitLabCredentialResolver {
  /**
   * 创建 GitLab 凭据解析器。
   *
   * @param {{store:import("./credential-store.js").CredentialStore,persistent?:boolean,env?:NodeJS.ProcessEnv|Record<string,string|undefined>,runGlab?:(args:string[],options?:object)=>Promise<{stdout?:string,stderr?:string}>,glabCommand?:string,glabTimeoutMs?:number}} options 依赖注入
   */
  constructor(options) {
    this.store = options.store;
    this.persistent = Boolean(options.persistent);
    this.env = options.env || process.env;
    this.runGlab = options.runGlab || runGlab;
    this.glabCommand = options.glabCommand || GLAB_COMMAND;
    this.glabTimeoutMs = options.glabTimeoutMs || GLAB_AUTH_TIMEOUT_MS;
  }

  /**
   * 按 Flower Keyring、glab、环境变量顺序解析凭据。
   *
   * @param {object} source GitLab 来源
   * @returns {Promise<{authorized:boolean,scopes:string[],expiresAt:number|null,persistent:boolean,accessToken?:string,credentialSource?:string,credential?:object}>} 解析结果
   */
  async resolve(source) {
    const credential = await this.store.get(source);
    if (credential) {
      return {
        authorized: true,
        scopes: credential.scope,
        expiresAt: credential.expiresAt,
        persistent: this.persistent,
        accessToken: credential.accessToken,
        credentialSource: "flower",
        credential,
      };
    }
    const external = await this.resolveExternal(source);
    return external || {
      authorized: false,
      scopes: [],
      expiresAt: null,
      persistent: false,
    };
  }

  /**
   * 解析非 Flower 管理的全局 GitLab 凭据。
   *
   * @param {object} source GitLab 来源
   * @returns {Promise<{authorized:true,scopes:string[],expiresAt:null,persistent:false,accessToken:string,credentialSource:string}|null>} 外部凭据
   */
  async resolveExternal(source) {
    const glabCredential = await this.#resolveGlab(source);
    if (glabCredential) return glabCredential;
    return resolveGitLabEnvironmentCredential(source, this.env);
  }

  /**
   * 返回不含 token 的登录状态。
   *
   * @param {object} source GitLab 来源
   * @returns {Promise<{authorized:boolean,scopes:string[],expiresAt:number|null,persistent:boolean}>} 非敏感状态
   */
  async status(source) {
    const resolution = await this.resolve(source);
    return {
      authorized: resolution.authorized,
      scopes: resolution.scopes,
      expiresAt: resolution.expiresAt,
      persistent: resolution.persistent,
    };
  }

  /** @param {object} source @returns {Promise<{authorized:true,scopes:string[],expiresAt:null,persistent:false,accessToken:string,credentialSource:"glab"}|null>} */
  async #resolveGlab(source) {
    let output;
    try {
      output = await this.runGlab([
        "auth",
        "status",
        "--hostname",
        gitLabCredentialHost(source),
        "--show-token",
      ], {
        command: this.glabCommand,
        timeoutMs: this.glabTimeoutMs,
        source,
      });
    } catch {
      return null;
    }
    const accessToken = parseGlabAuthStatusToken(`${output?.stdout || ""}\n${output?.stderr || ""}`, source);
    return accessToken ? externalCredential(accessToken, "glab") : null;
  }
}

/**
 * 构造非持久外部凭据结果。
 *
 * @param {string} accessToken access token
 * @param {"glab"|"env"} credentialSource 凭据来源
 * @returns {{authorized:true,scopes:string[],expiresAt:null,persistent:false,accessToken:string,credentialSource:"glab"|"env"}} 外部凭据
 */
function externalCredential(accessToken, credentialSource) {
  if (!accessToken) {
    throw new PluginRuntimeError("GitLab 外部凭据为空", {
      code: PLUGIN_RUNTIME_ERROR_CODES.AUTH_REQUIRED,
    });
  }
  return {
    authorized: true,
    scopes: [],
    expiresAt: null,
    persistent: false,
    accessToken,
    credentialSource,
  };
}
