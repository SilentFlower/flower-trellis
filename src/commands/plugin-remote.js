import { stringifyCanonicalJson } from "../plugin/integrity/canonical-json.js";
import {
  PLUGIN_RUNTIME_ERROR_CODES,
  PluginRuntimeError,
} from "../plugin/runtime-errors.js";
import { parseCanonicalPluginId } from "../plugin/schemas/shared.js";
import { createCredentialStore } from "../plugin/auth/keyring-credential-store.js";
import { GitLabCredentialManager, GitLabOAuthClient } from "../plugin/auth/gitlab-oauth.js";
import { GitLabRestClient } from "../plugin/gitlab/rest-client.js";
import { GitLabSourceProvider } from "../plugin/sources/gitlab-provider.js";
import { UserSourceStore } from "../plugin/sources/user-source-store.js";
import { compareUtf8 } from "../plugin/stable-order.js";

/**
 * 输出 source、auth 与 search 管理命令结果。
 *
 * @param {object} result 命令结果
 * @param {boolean} json 是否 JSON 输出
 * @param {{log:(message:string)=>void}} output 输出适配器
 * @returns {void}
 */
function printManagementResult(result, json, output) {
  if (json) {
    output.log(stringifyCanonicalJson({ changes: [], diagnostics: [], ...result }).trimEnd());
    return;
  }
  if (result.command === "source") {
    if (result.subcommand === "list") {
      for (const source of result.sources) {
        output.log(`${source.id} ${source.enabled ? "enabled" : "disabled"} ${source.type} ${source.project}`);
      }
    } else output.log(`Plugin source ${result.subcommand} 完成:${result.source.id}`);
    return;
  }
  if (result.command === "search") {
    if (result.results.length === 0) output.log("未找到匹配 Plugin");
    for (const entry of result.results) output.log(`${entry.id} ${entry.versions.join(",")} ${entry.description}`);
    return;
  }
  if (result.subcommand === "status") {
    output.log(result.authorized
      ? `GitLab 已登录:${result.sourceId}，scope=${result.scopes.join(",")}`
      : `GitLab 未登录:${result.sourceId}`);
  } else output.log(`GitLab auth ${result.subcommand} 完成:${result.sourceId}`);
  if (result.persistent === false) output.log("系统 Keyring 不可用，凭据仅在当前进程内有效");
}

/**
 * 构造 GitLab Provider 依赖。
 *
 * @param {object} source 来源 descriptor
 * @param {string} projectRoot 项目根
 * @param {object} credentialManager 凭据管理器
 * @param {object} options 测试注入
 * @returns {GitLabSourceProvider|object} Provider
 */
function createGitLabProvider(source, projectRoot, credentialManager, options) {
  if (options.gitlabProviderFactory) {
    return options.gitlabProviderFactory({ source, projectRoot, credentialManager });
  }
  const client = options.gitlabClientFactory
    ? options.gitlabClientFactory({ source, credentialManager })
    : new GitLabRestClient({ source, credentialManager, fetch: options.fetch });
  return new GitLabSourceProvider({ source, projectRoot, client });
}

/**
 * 执行用户级 source、auth 与 search 命令。
 *
 * @param {object} parsed 参数
 * @param {object} ctx CLI 上下文
 * @param {object} options 测试注入
 * @param {object} output 输出适配器
 * @returns {Promise<number>} 退出码
 */
export async function runPluginManagementCommand(parsed, ctx, options, output) {
  const sourceStore = options.sourceStore || new UserSourceStore(options.sourceStoreOptions);
  if (parsed.command === "source") {
    let result;
    if (parsed.subcommand === "list") {
      result = { ok: true, command: "source", subcommand: "list", sources: sourceStore.list() };
    } else if (["enable", "disable"].includes(parsed.subcommand)) {
      result = {
        ok: true,
        command: "source",
        subcommand: parsed.subcommand,
        source: sourceStore.setEnabled(parsed.sourceId, parsed.subcommand === "enable"),
      };
    } else if (parsed.subcommand === "remove") {
      const removed = sourceStore.remove(parsed.sourceId);
      if (!removed) throw new PluginRuntimeError(`没有可删除的用户 source:${parsed.sourceId}`, {
        code: PLUGIN_RUNTIME_ERROR_CODES.SOURCE_NOT_FOUND,
        path: parsed.sourceId,
      });
      result = { ok: true, command: "source", subcommand: "remove", source: { id: parsed.sourceId } };
    } else {
      const existing = sourceStore.list().find(({ id }) => id === parsed.sourceId);
      if (parsed.subcommand === "add" && existing) throw new PluginRuntimeError(`Plugin source 已存在:${parsed.sourceId}`, {
        code: PLUGIN_RUNTIME_ERROR_CODES.SOURCE_DUPLICATE,
        path: parsed.sourceId,
      });
      if (parsed.subcommand === "update" && !existing) throw new PluginRuntimeError(`Plugin source 不存在:${parsed.sourceId}`, {
        code: PLUGIN_RUNTIME_ERROR_CODES.SOURCE_NOT_FOUND,
        path: parsed.sourceId,
      });
      const base = existing || {};
      const source = sourceStore.set({
        schemaVersion: 1,
        id: parsed.sourceId,
        type: "gitlab",
        name: parsed.name || base.name || parsed.sourceId,
        enabled: base.enabled ?? true,
        baseUrl: parsed.baseUrl || base.baseUrl,
        project: parsed.project || base.project,
        ref: parsed.ref || base.ref || "main",
        marketplacePath: parsed.marketplacePath || base.marketplacePath || ".flower-marketplace/marketplace.json",
        oauth: {
          applicationId: parsed.applicationId || base.oauth?.applicationId,
          scopes: ["read_api", "read_repository"],
        },
      });
      result = { ok: true, command: "source", subcommand: parsed.subcommand, source };
    }
    printManagementResult(result, parsed.json, output);
    return 0;
  }

  if (parsed.command === "auth") {
    const source = sourceStore.get(parsed.sourceId, { includeDisabled: true });
    const credentialBundle = options.credentialBundle || await createCredentialStore(options.credentialStoreOptions);
    const oauth = options.oauth || new GitLabOAuthClient({
      fetch: options.fetch,
      openUrl: options.openUrl,
      sleep: options.sleep,
      now: options.now,
    });
    let result;
    if (parsed.subcommand === "logout") {
      await credentialBundle.store.delete(source);
      result = { ok: true, command: "auth", subcommand: "logout", sourceId: source.id, persistent: credentialBundle.persistent };
    } else if (parsed.subcommand === "status") {
      const credential = await credentialBundle.store.get(source);
      result = {
        ok: true,
        command: "auth",
        subcommand: "status",
        sourceId: source.id,
        authorized: Boolean(credential),
        scopes: credential?.scope || [],
        expiresAt: credential?.expiresAt || null,
        persistent: credentialBundle.persistent,
      };
    } else {
      let credential;
      const onVerification = ({ verificationUri, verificationUriComplete, userCode }) => {
        (output.error || output.log)(`请访问 ${verificationUriComplete || verificationUri} 并输入设备码 ${userCode}`);
      };
      if (parsed.device) credential = await oauth.loginWithDevice(source, { onVerification });
      else {
        try {
          credential = await oauth.loginWithPkce(source);
        } catch (error) {
          if (error?.details?.deviceFallback !== true) throw error;
          credential = await oauth.loginWithDevice(source, { onVerification });
        }
      }
      await credentialBundle.store.set(source, credential);
      result = {
        ok: true,
        command: "auth",
        subcommand: "login",
        sourceId: source.id,
        scopes: credential.scope,
        expiresAt: credential.expiresAt,
        persistent: credentialBundle.persistent,
      };
    }
    printManagementResult(result, parsed.json, output);
    return 0;
  }

  const credentialBundle = options.credentialBundle || await createCredentialStore(options.credentialStoreOptions);
  const oauth = options.oauth || new GitLabOAuthClient({
    fetch: options.fetch,
    openUrl: options.openUrl,
    sleep: options.sleep,
    now: options.now,
  });
  const manager = new GitLabCredentialManager({ store: credentialBundle.store, oauth, now: options.now });
  const sources = parsed.source ? [sourceStore.get(parsed.source)] : sourceStore.list().filter(({ enabled }) => enabled);
  const results = [];
  for (const entry of sources) {
    const provider = createGitLabProvider(entry, ctx.target, manager, options);
    results.push(...await provider.search(parsed.query));
  }
  const result = { ok: true, command: "search", query: parsed.query, results: results.sort((left, right) => compareUtf8(left.id, right.id)) };
  printManagementResult(result, parsed.json, output);
  return 0;
}

/**
 * 为生命周期命令登记所需的远程 Source Provider。
 *
 * @param {{parsed:object,projectRoot:string,options:object,registry:object,lock:object|null}} context 远程准备上下文
 * @returns {Promise<void>} 登记完成
 */
export async function registerRemotePluginSources({ parsed, projectRoot, options, registry, lock }) {
  const remoteIds = new Set(["add", "update", "remove", "verify", "replay"].includes(parsed.command)
    ? (lock?.plugins || []).filter(({ source }) => source.type === "gitlab").map(({ source }) => source.id)
    : []);
  let sourceStore = null;
  let configuredSources = null;
  if (parsed.command === "add") {
    const declaredSourceId = parsed.pluginId?.includes("/")
      ? parseCanonicalPluginId(parsed.pluginId).sourceId
      : null;
    const simpleSourceOption = parsed.source && !parsed.source.includes("/") && !parsed.source.includes(".")
      ? parsed.source
      : null;
    if ((declaredSourceId && declaredSourceId !== "local") || simpleSourceOption) {
      sourceStore = options.sourceStore || new UserSourceStore(options.sourceStoreOptions);
      configuredSources = sourceStore.list();
    }
    const configuredIds = new Set((configuredSources || []).map(({ id }) => id));
    if (declaredSourceId && configuredIds.has(declaredSourceId)) {
      if (parsed.source && parsed.source !== declaredSourceId) {
        throw new PluginRuntimeError(`远程 Plugin source 与 --source 不一致:${declaredSourceId}`, {
          code: PLUGIN_RUNTIME_ERROR_CODES.USAGE_ERROR,
          path: declaredSourceId,
        });
      }
      remoteIds.add(declaredSourceId);
    } else if (declaredSourceId && !parsed.source && declaredSourceId !== "local") {
      remoteIds.add(declaredSourceId);
    }
    if (simpleSourceOption && configuredIds.has(simpleSourceOption)) {
      if (declaredSourceId && declaredSourceId !== simpleSourceOption) {
        throw new PluginRuntimeError(`Plugin ID 与 --source 不一致:${declaredSourceId}/${simpleSourceOption}`, {
          code: PLUGIN_RUNTIME_ERROR_CODES.USAGE_ERROR,
          path: simpleSourceOption,
        });
      }
      remoteIds.add(simpleSourceOption);
    }
  }
  remoteIds.delete("local");
  if (remoteIds.size === 0) return;

  sourceStore ||= options.sourceStore || new UserSourceStore(options.sourceStoreOptions);
  configuredSources ||= sourceStore.list();
  const sources = configuredSources.filter(({ enabled }) => enabled || ["remove", "verify"].includes(parsed.command));
  const requested = sources.filter(({ id }) => remoteIds.has(id));
  if (requested.length !== remoteIds.size) {
    const missing = [...remoteIds].filter((id) => !requested.some((source) => source.id === id));
    throw new PluginRuntimeError(`远程 Plugin source 不存在或已禁用:${missing.join(",")}`, {
      code: PLUGIN_RUNTIME_ERROR_CODES.SOURCE_NOT_FOUND,
      path: missing[0] || "",
    });
  }
  const credentialBundle = options.credentialBundle || await createCredentialStore(options.credentialStoreOptions);
  const oauth = options.oauth || new GitLabOAuthClient({
    fetch: options.fetch,
    openUrl: options.openUrl,
    sleep: options.sleep,
    now: options.now,
  });
  const manager = new GitLabCredentialManager({ store: credentialBundle.store, oauth, now: options.now });
  // 依赖闭包可能跨 source，因此登记全部可用来源，而不是只登记入口来源。
  for (const source of sources) {
    if (registry.has(source.id)) continue;
    registry.register(createGitLabProvider(source, projectRoot, manager, options));
  }
}

/**
 * 准备远程 Plugin 候选及固定 lock 缓存。
 *
 * @param {{parsed:object,canonicalId:string|null,registry:object,lock:object|null}} context 候选准备上下文
 * @returns {Promise<void>} 准备完成
 */
export async function prepareRemotePluginCandidates({ parsed, canonicalId, registry, lock }) {
  if (parsed.command === "add" && registry.has(parseCanonicalPluginId(canonicalId).sourceId)) {
    await prepareRemoteLock(registry, lock);
    await prepareRemoteClosure(registry, [canonicalId]);
  } else if (parsed.command === "update") {
    // 更新单一 Plugin 时，解析器仍会 lock-first 重放完整图；先恢复全部远程固定包，
    // 再只为本轮显式更新目标加载新候选，避免顺带升级其它外部 Plugin。
    await prepareRemoteLock(registry, lock);
    const updateIds = canonicalId
      ? [canonicalId]
      : (lock?.plugins || []).filter(({ source }) => source.type === "gitlab").map(({ id }) => id);
    await prepareRemoteClosure(registry, updateIds);
  } else if (["remove", "verify", "replay"].includes(parsed.command)) {
    await prepareRemoteLock(registry, lock);
  }
}

/**
 * 准备远程 Plugin 及跨来源依赖闭包。
 *
 * @param {object} registry Provider 注册表
 * @param {string[]} initialIds 初始 canonical ID
 * @returns {Promise<void>} 准备完成
 */
async function prepareRemoteClosure(registry, initialIds) {
  const pending = [...new Set(initialIds)];
  const visited = new Set();
  while (pending.length > 0) {
    const id = pending.shift();
    if (visited.has(id)) continue;
    visited.add(id);
    const { sourceId } = parseCanonicalPluginId(id);
    if (!registry.has(sourceId)) continue;
    const provider = registry.get(sourceId);
    if (typeof provider.prepare !== "function") continue;
    await provider.prepare(id);
    for (const candidate of provider.listCandidates(id)) {
      pending.push(...Object.keys(candidate.manifest.dependencies || {}));
    }
  }
}

/**
 * 从 lock 恢复远程 Provider 的固定缓存。
 *
 * @param {object} registry Provider 注册表
 * @param {import("../plugin/contracts.js").PluginLock|null} lock 当前 lock
 * @returns {Promise<void>} 恢复完成
 */
async function prepareRemoteLock(registry, lock) {
  for (const plugin of lock?.plugins || []) {
    if (plugin.source.type !== "gitlab" || !registry.has(plugin.source.id)) continue;
    const provider = registry.get(plugin.source.id);
    if (typeof provider.prepareLocked === "function") await provider.prepareLocked(plugin);
    else if (typeof provider.prepare === "function") await provider.prepare(plugin.id);
  }
}
