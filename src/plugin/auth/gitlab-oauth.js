import crypto from "node:crypto";
import http from "node:http";
import { spawn } from "node:child_process";
import { CREDENTIAL_SCHEMA_VERSION, GITLAB_OAUTH_SCOPES, validateCredential } from "./credential-store.js";
import { PLUGIN_RUNTIME_ERROR_CODES, PluginRuntimeError } from "../runtime-errors.js";

const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";

/**
 * 生成 OAuth PKCE 参数。
 *
 * @returns {{state:string,verifier:string,challenge:string}} PKCE 参数
 */
export function createPkceParameters() {
  const state = crypto.randomBytes(24).toString("base64url");
  const verifier = crypto.randomBytes(48).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { state, verifier, challenge };
}

/**
 * 生成当前平台的浏览器启动命令。
 *
 * @param {string} url 授权 URL
 * @param {NodeJS.Platform} [platform] 目标平台
 * @returns {[string,string[]]} 可直接传给 spawn 的命令与参数
 */
export function authorizationOpenCommand(url, platform = process.platform) {
  if (platform === "darwin") return ["open", [url]];
  if (platform === "win32") return ["explorer.exe", [url]];
  return ["xdg-open", [url]];
}

/**
 * 使用系统默认浏览器打开授权 URL。
 *
 * @param {string} url 授权 URL
 * @returns {Promise<void>} 启动完成
 */
export async function openAuthorizationUrl(url) {
  const command = authorizationOpenCommand(url);
  await new Promise((resolve, reject) => {
    const child = spawn(command[0], command[1], { detached: true, stdio: "ignore" });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

/**
 * 把 GitLab token 响应转换为版本化凭据。
 *
 * @param {object} payload token 响应
 * @param {{id:string,baseUrl:string}} source 来源
 * @param {number} now 当前时间毫秒
 * @param {string|null} [redirectUri] PKCE 首次授权回调地址
 * @returns {object} 版本化凭据
 */
export function credentialFromToken(payload, source, now = Date.now(), redirectUri = null) {
  if (typeof payload?.access_token !== "string" || !payload.access_token) {
    throw new PluginRuntimeError(`GitLab 未返回 access token:${source.id}`, {
      code: PLUGIN_RUNTIME_ERROR_CODES.AUTH_FAILED,
      path: source.id,
    });
  }
  const expiresIn = Number(payload.expires_in);
  const createdAtSeconds = Number(payload.created_at);
  const createdAt = Number.isFinite(createdAtSeconds) ? createdAtSeconds * 1000 : now;
  const scope = Array.isArray(payload.scope)
    ? payload.scope
    : typeof payload.scope === "string"
      ? payload.scope.split(/[ ,]+/).filter(Boolean)
      : [];
  return validateCredential({
    schemaVersion: CREDENTIAL_SCHEMA_VERSION,
    sourceId: source.id,
    baseUrl: source.baseUrl,
    tokenType: String(payload.token_type || "Bearer"),
    scope,
    accessToken: payload.access_token,
    refreshToken: typeof payload.refresh_token === "string" ? payload.refresh_token : null,
    createdAt,
    expiresAt: Number.isFinite(expiresIn) ? createdAt + expiresIn * 1000 : null,
    redirectUri,
  }, source);
}

/**
 * GitLab OAuth 公共客户端。
 */
export class GitLabOAuthClient {
  /**
   * 创建 OAuth 客户端。
   *
   * @param {{fetch?:typeof fetch,openUrl?:(url:string)=>Promise<void>,sleep?:(milliseconds:number)=>Promise<void>,now?:()=>number,callbackTimeoutMs?:number,requestTimeoutMs?:number}} [options] 依赖注入
   */
  constructor(options = {}) {
    this.fetch = options.fetch || globalThis.fetch;
    this.openUrl = options.openUrl || openAuthorizationUrl;
    this.sleep = options.sleep || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.now = options.now || Date.now;
    this.callbackTimeoutMs = options.callbackTimeoutMs || 180_000;
    this.requestTimeoutMs = options.requestTimeoutMs || 30_000;
  }

  /**
   * 使用 loopback Authorization Code + PKCE 登录。
   *
   * @param {object} source GitLab 来源
   * @returns {Promise<object>} 版本化凭据
   */
  async loginWithPkce(source) {
    const pkce = createPkceParameters();
    let callback;
    try {
      callback = await this.#createCallbackServer(pkce.state);
    } catch (error) {
      throw new PluginRuntimeError(`无法启动 GitLab OAuth callback:${source.id}`, {
        code: PLUGIN_RUNTIME_ERROR_CODES.AUTH_FAILED,
        path: source.id,
        cause: error,
        details: { deviceFallback: true },
      });
    }
    try {
      const authorizeUrl = new URL("/oauth/authorize", source.baseUrl);
      authorizeUrl.search = new URLSearchParams({
        client_id: source.oauth.applicationId,
        redirect_uri: callback.redirectUri,
        response_type: "code",
        state: pkce.state,
        scope: GITLAB_OAUTH_SCOPES.join(" "),
        code_challenge: pkce.challenge,
        code_challenge_method: "S256",
      }).toString();
      const openBrowser = this.openUrl(authorizeUrl.toString()).catch((error) => {
        throw new PluginRuntimeError(`无法打开 GitLab 授权页面:${source.id}`, {
          code: PLUGIN_RUNTIME_ERROR_CODES.AUTH_FAILED,
          path: source.id,
          cause: error,
          details: { deviceFallback: true },
        });
      });
      const [code] = await Promise.all([callback.waitForCode, openBrowser]);
      const token = await this.#postForm(source, "/oauth/token", {
        client_id: source.oauth.applicationId,
        code,
        grant_type: "authorization_code",
        redirect_uri: callback.redirectUri,
        code_verifier: pkce.verifier,
      });
      return this.#validatedCredential(token, source, callback.redirectUri);
    } finally {
      callback.close();
    }
  }

  /**
   * 使用 Device Authorization Grant 登录。
   *
   * @param {object} source GitLab 来源
   * @param {{onVerification?:(info:{verificationUri:string,verificationUriComplete:string|null,userCode:string})=>void,signal?:AbortSignal}} [options] 交互与取消
   * @returns {Promise<object>} 版本化凭据
   */
  async loginWithDevice(source, options = {}) {
    const device = await this.#postForm(source, "/oauth/authorize_device", {
      client_id: source.oauth.applicationId,
      scope: GITLAB_OAUTH_SCOPES.join(" "),
    }, { signal: options.signal });
    if (
      typeof device.device_code !== "string" ||
      typeof device.user_code !== "string" ||
      typeof device.verification_uri !== "string"
    ) {
      throw new PluginRuntimeError(`GitLab Device Flow 响应无效:${source.id}`, {
        code: PLUGIN_RUNTIME_ERROR_CODES.AUTH_FAILED,
        path: source.id,
      });
    }
    options.onVerification?.({
      verificationUri: device.verification_uri,
      verificationUriComplete: device.verification_uri_complete || null,
      userCode: device.user_code,
    });
    const deadline = this.now() + Number(device.expires_in || 300) * 1000;
    let interval = Math.max(1, Number(device.interval || 5));
    while (this.now() < deadline) {
      if (options.signal?.aborted) {
        throw new PluginRuntimeError(`GitLab 登录已取消:${source.id}`, {
          code: PLUGIN_RUNTIME_ERROR_CODES.AUTH_FAILED,
          path: source.id,
        });
      }
      await this.sleep(interval * 1000);
      if (options.signal?.aborted) {
        throw new PluginRuntimeError(`GitLab 登录已取消:${source.id}`, {
          code: PLUGIN_RUNTIME_ERROR_CODES.AUTH_FAILED,
          path: source.id,
        });
      }
      const response = await this.#postForm(source, "/oauth/token", {
        client_id: source.oauth.applicationId,
        device_code: device.device_code,
        grant_type: DEVICE_GRANT,
      }, { acceptOAuthError: true, signal: options.signal });
      if (!response.error) return this.#validatedCredential(response, source);
      if (response.error === "authorization_pending") continue;
      if (response.error === "slow_down") {
        interval += 5;
        continue;
      }
      throw new PluginRuntimeError(`GitLab Device Flow 失败:${response.error}`, {
        code: PLUGIN_RUNTIME_ERROR_CODES.AUTH_FAILED,
        path: source.id,
      });
    }
    throw new PluginRuntimeError(`GitLab Device Flow 已过期:${source.id}`, {
      code: PLUGIN_RUNTIME_ERROR_CODES.AUTH_FAILED,
      path: source.id,
    });
  }

  /**
   * 刷新 GitLab access token。
   *
   * @param {object} source GitLab 来源
   * @param {object} credential 当前凭据
   * @returns {Promise<object>} 新凭据
   */
  async refresh(source, credential) {
    if (!credential.refreshToken) {
      throw new PluginRuntimeError(`GitLab 凭据无法刷新，请重新登录:${source.id}`, {
        code: PLUGIN_RUNTIME_ERROR_CODES.AUTH_REQUIRED,
        path: source.id,
      });
    }
    const token = await this.#postForm(source, "/oauth/token", {
      client_id: source.oauth.applicationId,
      refresh_token: credential.refreshToken,
      grant_type: "refresh_token",
      ...(credential.redirectUri ? { redirect_uri: credential.redirectUri } : {}),
    });
    return this.#validatedCredential(token, source, credential.redirectUri || null);
  }

  /** @param {object} payload @param {object} source @param {string|null} [redirectUri] @returns {Promise<object>} */
  async #validatedCredential(payload, source, redirectUri = null) {
    const responseScopes = Array.isArray(payload.scope)
      ? payload.scope
      : typeof payload.scope === "string"
        ? payload.scope.split(/[ ,]+/).filter(Boolean)
        : [];
    let tokenPayload = payload;
    if (!GITLAB_OAUTH_SCOPES.every((scope) => responseScopes.includes(scope))) {
      const tokenInfo = await this.#readTokenInfo(source, payload.access_token);
      tokenPayload = { ...payload, scope: tokenInfo.scope || tokenInfo.scopes || [] };
    }
    return credentialFromToken(tokenPayload, source, this.now(), redirectUri);
  }

  /** @param {object} source @param {string} accessToken @returns {Promise<object>} */
  async #readTokenInfo(source, accessToken) {
    let response;
    try {
      response = await this.#fetchWithTimeout(new URL("/oauth/token/info", source.baseUrl), {
        headers: { authorization: `Bearer ${accessToken}` },
      });
    } catch (error) {
      throw new PluginRuntimeError(`无法验证 GitLab OAuth scope:${source.id}`, {
        code: PLUGIN_RUNTIME_ERROR_CODES.AUTH_SCOPE_INVALID,
        path: source.id,
        cause: error,
      });
    }
    const payload = await response?.json?.().catch(() => ({})) || {};
    if (!response?.ok) {
      throw new PluginRuntimeError(`GitLab OAuth scope 验证失败:${source.id}`, {
        code: PLUGIN_RUNTIME_ERROR_CODES.AUTH_SCOPE_INVALID,
        path: source.id,
      });
    }
    return payload;
  }

  /** @param {object} source @param {string} pathname @param {Record<string,string>} fields @param {{acceptOAuthError?:boolean,signal?:AbortSignal}} [options] @returns {Promise<object>} */
  async #postForm(source, pathname, fields, options = {}) {
    let response;
    try {
      response = await this.#fetchWithTimeout(new URL(pathname, source.baseUrl), {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(fields),
      }, options.signal);
    } catch (error) {
      throw new PluginRuntimeError(`GitLab OAuth 请求失败:${source.id}`, {
        code: PLUGIN_RUNTIME_ERROR_CODES.AUTH_FAILED,
        path: source.id,
        cause: error,
      });
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok && !(options.acceptOAuthError && payload.error)) {
      throw new PluginRuntimeError(`GitLab OAuth 请求被拒绝:${response.status}`, {
        code: PLUGIN_RUNTIME_ERROR_CODES.AUTH_FAILED,
        path: source.id,
      });
    }
    return payload;
  }

  /**
   * 为 OAuth 请求合并超时与外部取消信号。
   *
   * @param {URL} url 请求地址
   * @param {RequestInit} options 请求参数
   * @param {AbortSignal} [externalSignal] 外部取消信号
   * @returns {Promise<Response>} HTTP 响应
   */
  async #fetchWithTimeout(url, options, externalSignal) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (externalSignal?.aborted) controller.abort();
    else externalSignal?.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      return await this.fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", abort);
    }
  }

  /** @param {string} expectedState @returns {Promise<{redirectUri:string,waitForCode:Promise<string>,close:()=>void}>} */
  async #createCallbackServer(expectedState) {
    let settled = false;
    let resolveCode;
    let rejectCode;
    const waitForCode = new Promise((resolve, reject) => {
      resolveCode = resolve;
      rejectCode = reject;
    });
    const server = http.createServer((request, response) => {
      const requestUrl = new URL(request.url || "/", "http://127.0.0.1");
      if (settled || request.method !== "GET" || requestUrl.pathname !== "/oauth/callback") {
        response.writeHead(404).end("Not Found");
        return;
      }
      const state = requestUrl.searchParams.get("state");
      const code = requestUrl.searchParams.get("code");
      if (state !== expectedState || !code) {
        settled = true;
        response.writeHead(400, { "content-type": "text/plain; charset=utf-8" }).end("授权回调无效");
        rejectCode(new PluginRuntimeError("GitLab OAuth state 或 code 无效", {
          code: PLUGIN_RUNTIME_ERROR_CODES.AUTH_FAILED,
        }));
        return;
      }
      settled = true;
      response.writeHead(200, { "content-type": "text/plain; charset=utf-8" }).end("授权完成，可以关闭此页面。\n");
      resolveCode(code);
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    const redirectUri = `http://127.0.0.1:${address.port}/oauth/callback`;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      rejectCode(new PluginRuntimeError("等待 GitLab OAuth 回调超时", {
        code: PLUGIN_RUNTIME_ERROR_CODES.AUTH_FAILED,
        details: { deviceFallback: true },
      }));
      server.close();
    }, this.callbackTimeoutMs);
    timeout.unref?.();
    return {
      redirectUri,
      waitForCode,
      close: () => {
        clearTimeout(timeout);
        server.close();
      },
    };
  }
}

/**
 * 管理凭据读取、刷新与单飞并发。
 */
export class GitLabCredentialManager {
  /**
   * 创建凭据管理器。
   *
   * @param {{store:import("./credential-store.js").CredentialStore,oauth:GitLabOAuthClient,now?:()=>number}} options 依赖
   */
  constructor(options) {
    this.store = options.store;
    this.oauth = options.oauth;
    this.now = options.now || Date.now;
    this.refreshes = new Map();
  }

  /**
   * 返回可用于 REST 的 access token，必要时刷新。
   *
   * @param {object} source GitLab 来源
   * @returns {Promise<string>} access token
   */
  async getAccessToken(source) {
    const credential = await this.store.get(source);
    if (!credential) {
      throw new PluginRuntimeError(`GitLab source 尚未登录:${source.id}`, {
        code: PLUGIN_RUNTIME_ERROR_CODES.AUTH_REQUIRED,
        path: source.id,
      });
    }
    if (credential.expiresAt === null || credential.expiresAt > this.now() + 60_000) {
      return credential.accessToken;
    }
    if (!this.refreshes.has(source.id)) {
      const refresh = this.oauth.refresh(source, credential)
        .then(async (next) => {
          await this.store.set(source, next);
          return next.accessToken;
        })
        .catch(async (error) => {
          try {
            await this.store.delete(source);
          } catch {
            // 删除失败不能掩盖原始 refresh/scope 错误。
          }
          throw new PluginRuntimeError(`GitLab 凭据已失效，请重新登录:${source.id}`, {
            code: PLUGIN_RUNTIME_ERROR_CODES.AUTH_REQUIRED,
            path: source.id,
            cause: error,
          });
        })
        .finally(() => this.refreshes.delete(source.id));
      this.refreshes.set(source.id, refresh);
    }
    return this.refreshes.get(source.id);
  }
}
