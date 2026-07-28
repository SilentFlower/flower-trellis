import { PLUGIN_RUNTIME_ERROR_CODES, PluginRuntimeError } from "../runtime-errors.js";

/**
 * 对 GitLab project path 做 REST path 编码。
 *
 * @param {string} project GitLab project path
 * @returns {string} 编码结果
 */
export function encodeGitLabProject(project) {
  return encodeURIComponent(project);
}

/**
 * GitLab 只读 REST 客户端。
 */
export class GitLabRestClient {
  /**
   * 创建 REST 客户端。
   *
   * @param {{source:object,credentialManager:object,fetch?:typeof fetch,timeoutMs?:number,maxArchiveBytes?:number}} options 依赖
   */
  constructor(options) {
    this.source = options.source;
    this.credentialManager = options.credentialManager;
    this.fetch = options.fetch || globalThis.fetch;
    this.timeoutMs = options.timeoutMs || 30_000;
    this.maxArchiveBytes = options.maxArchiveBytes || 100 * 1024 * 1024;
  }

  /**
   * 解析 ref 对应的完整 commit SHA。
   *
   * @param {string} project GitLab project path
   * @param {string} ref 分支、标签或 commit
   * @returns {Promise<string>} 40 位 commit SHA
   */
  async resolveCommit(project, ref) {
    const payload = await this.getJson(
      `/projects/${encodeGitLabProject(project)}/repository/commits/${encodeURIComponent(ref)}`,
    );
    if (typeof payload?.id !== "string" || !/^[a-f0-9]{40}$/i.test(payload.id)) {
      throw this.#remoteError("GitLab commit 响应无效", project);
    }
    return payload.id.toLowerCase();
  }

  /**
   * 读取仓库文件原文。
   *
   * @param {string} project GitLab project path
   * @param {string} filePath 仓库内路径
   * @param {string} ref 固定 ref
   * @returns {Promise<string>} 文件内容
   */
  async readRawFile(project, filePath, ref) {
    const buffer = await this.getBuffer(
      `/projects/${encodeGitLabProject(project)}/repository/files/${encodeURIComponent(filePath)}/raw`,
      { ref },
    );
    return buffer.toString("utf8");
  }

  /**
   * 读取 repository tree，用于来源诊断与端点能力验证。
   *
   * @param {string} project GitLab project path
   * @param {{path?:string,ref:string}} options 查询参数
   * @returns {Promise<object[]>} tree 条目
   */
  async readTree(project, options) {
    const payload = await this.getJson(
      `/projects/${encodeGitLabProject(project)}/repository/tree`,
      { ref: options.ref, ...(options.path ? { path: options.path } : {}) },
    );
    if (!Array.isArray(payload)) throw this.#remoteError("GitLab tree 响应无效", project);
    return payload;
  }

  /**
   * 下载固定 commit 的仓库归档。
   *
   * @param {string} project GitLab project path
   * @param {string} commit 完整 commit SHA
   * @returns {Promise<Buffer>} gzip tar 归档
   */
  async downloadArchive(project, commit) {
    return this.getBuffer(
      `/projects/${encodeGitLabProject(project)}/repository/archive.tar.gz`,
      { sha: commit },
      { archive: true },
    );
  }

  /**
   * 发送 JSON GET 请求。
   *
   * @param {string} pathname API v4 相对路径
   * @param {Record<string,string>} [query] 查询参数
   * @returns {Promise<any>} JSON 响应
   */
  async getJson(pathname, query = {}) {
    const response = await this.#request(pathname, query);
    try {
      return await response.json();
    } catch (error) {
      throw this.#remoteError("GitLab 返回了无效 JSON", this.source.id, error);
    }
  }

  /**
   * 发送二进制 GET 请求。
   *
   * @param {string} pathname API v4 相对路径
   * @param {Record<string,string>} [query] 查询参数
   * @param {{archive?:boolean}} [options] 响应限制
   * @returns {Promise<Buffer>} 响应字节
   */
  async getBuffer(pathname, query = {}, options = {}) {
    const response = await this.#request(pathname, query);
    const contentLength = Number(response.headers.get("content-length"));
    if (options.archive && Number.isFinite(contentLength) && contentLength > this.maxArchiveBytes) {
      throw this.#remoteError("GitLab archive 超过大小限制", this.source.id);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (options.archive && buffer.length > this.maxArchiveBytes) {
      throw this.#remoteError("GitLab archive 超过大小限制", this.source.id);
    }
    return buffer;
  }

  /** @param {string} pathname @param {Record<string,string>} query @returns {Promise<Response>} */
  async #request(pathname, query) {
    const token = await this.credentialManager.getAccessToken(this.source);
    const url = new URL(`/api/v4${pathname}`, this.source.baseUrl);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    let lastError;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetch(url, {
          headers: { authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        if (response.ok) return response;
        if (attempt === 0 && response.status >= 500) continue;
        throw this.#remoteError(`GitLab REST 请求失败:${response.status}`, this.source.id);
      } catch (error) {
        lastError = error;
        if (error instanceof PluginRuntimeError || attempt > 0) break;
      } finally {
        clearTimeout(timeout);
      }
    }
    if (lastError instanceof PluginRuntimeError) throw lastError;
    throw this.#remoteError("GitLab REST 请求失败", this.source.id, lastError);
  }

  /** @param {string} message @param {string} diagnosticPath @param {unknown} [cause] @returns {PluginRuntimeError} */
  #remoteError(message, diagnosticPath, cause) {
    return new PluginRuntimeError(message, {
      code: PLUGIN_RUNTIME_ERROR_CODES.REMOTE_REQUEST_FAILED,
      path: diagnosticPath,
      cause,
    });
  }
}
