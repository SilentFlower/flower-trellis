import { PLUGIN_RUNTIME_ERROR_CODES, PluginRuntimeError } from "../runtime-errors.js";
import { isGitCommit } from "../schemas/shared.js";
import { normalizeGitHubRepository } from "../sources/user-source-store.js";

const API_VERSION = "2022-11-28";
const ALLOWED_ARCHIVE_HOSTS = new Set(["api.github.com", "github.com", "codeload.github.com"]);

/**
 * GitHub 公共仓库只读 REST 客户端。
 */
export class GitHubRestClient {
  /**
   * 创建 GitHub REST 客户端。
   *
   * @param {{fetch?:typeof fetch,timeoutMs?:number,maxArchiveBytes?:number}} [options] 客户端选项
   */
  constructor(options = {}) {
    this.fetch = options.fetch || globalThis.fetch;
    this.timeoutMs = options.timeoutMs || 30_000;
    this.maxArchiveBytes = options.maxArchiveBytes || 100 * 1024 * 1024;
  }

  /**
   * 读取仓库默认分支。
   *
   * @param {string} repository GitHub `owner/repository`
   * @returns {Promise<{repository:string,defaultBranch:string}>} 仓库信息
   */
  async resolveRepository(repository) {
    const normalized = normalizeGitHubRepository(repository);
    const payload = await this.getJson(`/repos/${normalized}`);
    if (typeof payload?.default_branch !== "string" || !payload.default_branch) {
      throw this.#remoteError("GitHub 仓库响应缺少默认分支", normalized);
    }
    return { repository: normalized, defaultBranch: payload.default_branch };
  }

  /**
   * 解析 ref 对应的完整 commit 与时间。
   *
   * @param {string} repository GitHub `owner/repository`
   * @param {string} ref 分支、标签或 commit；空值使用默认分支
   * @returns {Promise<{sha:string,committedAt:string}>} 固定 commit
   */
  async resolveCommit(repository, ref) {
    const normalized = normalizeGitHubRepository(repository);
    const targetRef = ref || (await this.resolveRepository(normalized)).defaultBranch;
    const payload = await this.getJson(`/repos/${normalized}/commits/${encodeURIComponent(targetRef)}`);
    const sha = String(payload?.sha || "").toLowerCase();
    const committedAt = payload?.commit?.committer?.date || payload?.commit?.author?.date;
    if (!isGitCommit(sha) || typeof committedAt !== "string" || Number.isNaN(Date.parse(committedAt))) {
      throw this.#remoteError("GitHub commit 响应无效", normalized);
    }
    return { sha, committedAt };
  }

  /**
   * 下载固定 commit 的 tar archive。
   *
   * @param {string} repository GitHub `owner/repository`
   * @param {string} commit 完整 commit
   * @returns {Promise<Buffer>} tar gzip 字节
   */
  async downloadArchive(repository, commit) {
    const normalized = normalizeGitHubRepository(repository);
    if (!isGitCommit(commit)) throw this.#remoteError("GitHub archive commit 无效", normalized);
    const response = await this.#request(`/repos/${normalized}/tarball/${commit}`, { archive: true });
    if (response.url) {
      const finalUrl = new URL(response.url);
      if (finalUrl.protocol !== "https:" || !ALLOWED_ARCHIVE_HOSTS.has(finalUrl.hostname.toLowerCase())) {
        throw this.#remoteError("GitHub archive 重定向到了不受信任的地址", normalized);
      }
    }
    return this.#readBuffer(response, normalized, true);
  }

  /**
   * 发送 GitHub JSON GET。
   *
   * @param {string} pathname API 路径
   * @returns {Promise<any>} JSON 响应
   */
  async getJson(pathname) {
    const response = await this.#request(pathname);
    try {
      return await response.json();
    } catch (error) {
      throw this.#remoteError("GitHub 返回了无效 JSON", pathname, error);
    }
  }

  /** @param {string} pathname @param {{archive?:boolean}} [options] @returns {Promise<Response>} */
  async #request(pathname, options = {}) {
    const url = new URL(pathname, "https://api.github.com");
    let lastError;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetch(url, {
          headers: {
            accept: options.archive ? "application/vnd.github+json" : "application/vnd.github+json",
            "x-github-api-version": API_VERSION,
            "user-agent": "flower-trellis",
          },
          redirect: "follow",
          signal: controller.signal,
        });
        if (response.ok) return response;
        if ([403, 429].includes(response.status) && response.headers.get("x-ratelimit-remaining") === "0") {
          throw new PluginRuntimeError("GitHub 匿名 API 已达到速率限制", {
            code: PLUGIN_RUNTIME_ERROR_CODES.REMOTE_RATE_LIMITED,
            path: pathname,
            details: {
              limit: response.headers.get("x-ratelimit-limit"),
              reset: response.headers.get("x-ratelimit-reset"),
            },
          });
        }
        if (attempt === 0 && response.status >= 500) continue;
        throw this.#remoteError(`GitHub REST 请求失败:${response.status}`, pathname);
      } catch (error) {
        lastError = error;
        if (error instanceof PluginRuntimeError || attempt > 0) break;
      } finally {
        clearTimeout(timeout);
      }
    }
    if (lastError instanceof PluginRuntimeError) throw lastError;
    throw this.#remoteError("GitHub REST 请求失败", pathname, lastError);
  }

  /** @param {Response} response @param {string} pathValue @param {boolean} archive @returns {Promise<Buffer>} */
  async #readBuffer(response, pathValue, archive) {
    const contentLength = Number(response.headers.get("content-length"));
    if (archive && Number.isFinite(contentLength) && contentLength > this.maxArchiveBytes) {
      throw this.#remoteError("GitHub archive 超过大小限制", pathValue);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (archive && buffer.length > this.maxArchiveBytes) {
      throw this.#remoteError("GitHub archive 超过大小限制", pathValue);
    }
    return buffer;
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
