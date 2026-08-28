import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { stringifyCanonicalJson } from "../plugin/integrity/canonical-json.js";
import {
  PLUGIN_RUNTIME_ERROR_CODES,
  PluginRuntimeError,
} from "../plugin/runtime-errors.js";
import { parseCanonicalPluginId } from "../plugin/schemas/shared.js";
import { GITLAB_OAUTH_REQUEST_SCOPES } from "../plugin/auth/credential-store.js";
import { GitLabCredentialResolver } from "../plugin/auth/gitlab-credential-resolver.js";
import { createCredentialStore } from "../plugin/auth/keyring-credential-store.js";
import { GitLabCredentialManager, GitLabOAuthClient } from "../plugin/auth/gitlab-oauth.js";
import { GitLabRestClient } from "../plugin/gitlab/rest-client.js";
import { GitHubRestClient } from "../plugin/github/rest-client.js";
import { GitLabSourceProvider } from "../plugin/sources/gitlab-provider.js";
import { GitHubSourceProvider } from "../plugin/sources/github-provider.js";
import { SourceRegistry } from "../plugin/sources/source-registry.js";
import { UserSourceStore } from "../plugin/sources/user-source-store.js";
import { listContentSkillChoices } from "../plugin/content-selection.js";
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
        output.log(`${source.id} ${source.enabled ? "enabled" : "disabled"} ${source.type} ${source.project || source.repository}`);
      }
    } else {
      const labels = {
        add: "新增",
        update: "更新",
        remove: "删除",
        enable: "启用",
        disable: "停用",
      };
      output.log(`Plugin 来源${labels[result.subcommand] || result.subcommand}完成:${result.source.id}`);
    }
    return;
  }
  if (result.command === "search") {
    if (result.results.length === 0) output.log("未找到匹配 Plugin");
    for (const entry of result.results) output.log(`${entry.id} ${entry.versions.join(",")} ${entry.description}`);
    for (const diagnostic of result.diagnostics || []) output.log(`! ${diagnostic.source}: ${diagnostic.message}`);
    return;
  }
  if (result.subcommand === "status") {
    const scopeSuffix = result.scopes?.length ? `，scope=${result.scopes.join(",")}` : "";
    output.log(result.authorized
      ? `GitLab 已登录:${result.sourceId}${scopeSuffix}`
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
 * 构造 GitHub Provider 依赖。
 *
 * @param {object} source 来源 descriptor
 * @param {string} projectRoot 项目根
 * @param {object} options 测试注入
 * @param {string} [cacheRoot] 显式缓存根；预览时使用临时目录
 * @returns {GitHubSourceProvider|object} Provider
 */
function createGitHubProvider(source, projectRoot, options, cacheRoot) {
  if (options.githubProviderFactory) return options.githubProviderFactory({ source, projectRoot, cacheRoot });
  const client = options.githubClientFactory
    ? options.githubClientFactory({ source })
    : new GitHubRestClient({ fetch: options.fetch });
  return new GitHubSourceProvider({ source, projectRoot, client, ...(cacheRoot ? { cacheRoot } : {}) });
}

/**
 * 按来源类型构造远程 Provider。
 *
 * @param {object} source 来源 descriptor
 * @param {string} projectRoot 项目根
 * @param {object|null} credentialManager GitLab 凭据管理器
 * @param {object} options 测试注入
 * @returns {GitLabSourceProvider|GitHubSourceProvider|object} Provider
 */
function createRemoteProvider(source, projectRoot, credentialManager, options) {
  if (source.type === "github") return createGitHubProvider(source, projectRoot, options);
  return createGitLabProvider(source, projectRoot, credentialManager, options);
}

/**
 * 读取一个 GitLab source 的结构化登录状态。
 *
 * @param {string} sourceId source ID
 * @param {object} [options] source、凭据和测试注入
 * @returns {Promise<object>} 非敏感登录状态
 */
export async function getPluginAuthStatus(sourceId, options = {}) {
  const sourceStore = options.sourceStore || new UserSourceStore(options.sourceStoreOptions);
  const source = sourceStore.get(sourceId, { includeDisabled: true });
  if (source.type === "github") {
    return {
      ok: true,
      command: "auth",
      subcommand: "status",
      sourceId: source.id,
      authorized: true,
      authRequired: false,
      scopes: [],
      expiresAt: null,
      persistent: false,
    };
  }
  const credentialBundle = options.credentialBundle || await createCredentialStore(options.credentialStoreOptions);
  const resolver = options.credentialResolver || new GitLabCredentialResolver({
    store: credentialBundle.store,
    persistent: credentialBundle.persistent,
    env: options.env,
    runGlab: options.runGlab,
    glabCommand: options.glabCommand,
  });
  const status = await resolver.status(source);
  return {
    ok: true,
    command: "auth",
    subcommand: "status",
    sourceId: source.id,
    authorized: status.authorized,
    scopes: status.scopes,
    expiresAt: status.expiresAt,
    persistent: status.persistent,
  };
}

/**
 * 搜索已启用 GitLab Marketplace，并返回结构化结果。
 *
 * @param {{query?:string,source?:string}} parsed 搜索参数
 * @param {object} ctx CLI 上下文
 * @param {object} [options] Provider、凭据和测试注入
 * @returns {Promise<object>} 搜索结果
 */
export async function searchPluginMarketplaces(parsed, ctx, options = {}) {
  const sourceStore = options.sourceStore || new UserSourceStore(options.sourceStoreOptions);
  const sources = parsed.source ? [sourceStore.get(parsed.source)] : sourceStore.list().filter(({ enabled }) => enabled);
  let manager = null;
  if (sources.some(({ type }) => type === "gitlab")) {
    const credentialBundle = options.credentialBundle || await createCredentialStore(options.credentialStoreOptions);
    const oauth = options.oauth || new GitLabOAuthClient({
      fetch: options.fetch,
      openUrl: options.openUrl,
      sleep: options.sleep,
      now: options.now,
    });
    manager = new GitLabCredentialManager({
      store: credentialBundle.store,
      oauth,
      now: options.now,
      persistent: credentialBundle.persistent,
      credentialResolver: options.credentialResolver,
      env: options.env,
      runGlab: options.runGlab,
      glabCommand: options.glabCommand,
    });
  }
  const results = [];
  const diagnostics = [];
  for (const entry of sources) {
    const provider = createRemoteProvider(entry, ctx.target, manager, options);
    try {
      results.push(...await provider.search(parsed.query || ""));
    } catch (error) {
      if (parsed.source) throw error;
      diagnostics.push({
        source: entry.id,
        code: error?.code || "PLUGIN_REMOTE_FAILED",
        message: error?.message || String(error),
      });
    }
  }
  return {
    ok: true,
    command: "search",
    query: parsed.query || "",
    results: results.sort((left, right) => compareUtf8(left.id || left.source, right.id || right.source)),
    diagnostics: diagnostics.sort((left, right) => compareUtf8(left.source, right.source)),
  };
}

/**
 * 为 TUI 按需读取 Marketplace Plugin 的 manifest Skill 清单。
 *
 * @param {{pluginId:string,version?:string,source?:string|null,lockedPlugin?:import("../plugin/contracts.js").ResolvedPlugin|null}} request 读取请求
 * @param {object} ctx CLI 上下文
 * @param {object} [options] Provider、凭据和测试注入
 * @returns {Promise<{ok:true,pluginId:string,version:string,name:string,skills:Array<{name:string,path:string,description?:string,version?:string}>}>} Skill 清单
 */
export async function inspectPluginContentSkills(request, ctx, options = {}) {
  const canonicalId = request.pluginId || request.lockedPlugin?.id;
  if (!canonicalId) {
    throw new PluginRuntimeError("读取 Plugin Skill 清单需要 Plugin ID", {
      code: PLUGIN_RUNTIME_ERROR_CODES.USAGE_ERROR,
      path: "pluginId",
    });
  }
  const registry = new SourceRegistry(options.providers || []);
  const lock = request.lockedPlugin
    ? { schemaVersion: 1, roots: [request.lockedPlugin.id], plugins: [request.lockedPlugin] }
    : null;
  const parsed = request.lockedPlugin
    ? { command: "verify", pluginId: canonicalId, source: null }
    : { command: "add", pluginId: canonicalId, source: request.source || null };

  await registerRemotePluginSources({
    parsed,
    projectRoot: ctx.target,
    options,
    registry,
    lock,
  });
  const manifestInspection = await inspectRemotePluginContentManifest({
    canonicalId,
    registry,
    version: request.version,
    lockedPlugin: request.lockedPlugin || null,
  });
  if (manifestInspection) {
    return {
      ok: true,
      pluginId: canonicalId,
      version: manifestInspection.version,
      name: manifestInspection.manifest.name,
      skills: listContentSkillChoices(manifestInspection.manifest.content.skills || [], canonicalId),
    };
  }
  await prepareRemotePluginForSkillInspection({
    parsed,
    canonicalId,
    registry,
    lock,
    version: request.version,
  });

  let plugin = request.lockedPlugin || null;
  if (!plugin) {
    const candidates = registry.listCandidates(canonicalId);
    plugin = candidates.find((candidate) => candidate.version === request.version) || null;
    if (!plugin) {
      throw new PluginRuntimeError(`Marketplace Plugin 版本不存在:${canonicalId}@${request.version}`, {
        code: PLUGIN_RUNTIME_ERROR_CODES.SOURCE_NOT_FOUND,
        path: canonicalId,
      });
    }
  }

  const pluginPackage = registry.readPackage(plugin);
  return {
    ok: true,
    pluginId: canonicalId,
    version: plugin.version,
    name: pluginPackage.manifest.name,
    skills: listContentSkillChoices(pluginPackage.manifest.content.skills || [], canonicalId),
  };
}

/**
 * 优先用 Provider 的 manifest-only inspection 读取 Skill 清单元数据。
 *
 * 这里不需要运行时包内容，也不需要 canonical tree hash；完整安装/更新仍会在生命周期
 * 中准备固定包并校验摘要。TUI 首屏只展示 manifest 声明，避免为 checkbox 下载 archive。
 *
 * @param {{canonicalId:string,registry:object,version?:string|null,lockedPlugin?:object|null}} context 读取上下文
 * @returns {Promise<{version:string,manifest:import("../plugin/contracts.js").PluginManifest}|null>} manifest inspection 结果
 */
async function inspectRemotePluginContentManifest({ canonicalId, registry, version, lockedPlugin }) {
  const { sourceId } = parseCanonicalPluginId(canonicalId);
  if (!registry.has(sourceId)) return null;
  const provider = registry.get(sourceId);
  if (typeof provider.inspectContentManifest !== "function") return null;
  return provider.inspectContentManifest(canonicalId, { version, lockedPlugin });
}

/**
 * 为 TUI Skill inspection 准备远程包。
 *
 * inspection 只需要读取用户当前选择的一个包版本；Provider 支持单版本准备时不走完整依赖闭包，
 * 避免为了展示 checkbox 下载同一 Plugin 的全部历史版本。
 *
 * @param {{parsed:object,canonicalId:string,registry:object,lock:object|null,version?:string|null}} context 准备上下文
 * @returns {Promise<void>} 准备完成
 */
async function prepareRemotePluginForSkillInspection({ parsed, canonicalId, registry, lock, version }) {
  if (lock) {
    await prepareRemotePluginCandidates({ parsed, canonicalId, registry, lock });
    return;
  }
  const { sourceId } = parseCanonicalPluginId(canonicalId);
  const provider = registry.has(sourceId) ? registry.get(sourceId) : null;
  if (version && typeof provider?.prepareVersion === "function") {
    await provider.prepareVersion(canonicalId, version);
    return;
  }
  await prepareRemotePluginCandidates({ parsed, canonicalId, registry, lock });
}

/**
 * 探测 GitHub 来源并返回可持久化 descriptor 与兼容性结果。
 *
 * @param {object} source GitHub 来源草稿
 * @param {object} ctx CLI 上下文
 * @param {object} [options] Provider 与网络注入
 * @returns {Promise<object>} 探测结果
 */
export async function inspectGitHubPluginSource(source, ctx, options = {}) {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "flower-plugin-inspect-"));
  try {
    const provider = createGitHubProvider(source, ctx.target, options, temporaryRoot);
    if (typeof provider.inspect !== "function") {
      throw new TypeError("GitHub Provider 必须实现 inspect()");
    }
    return await provider.inspect();
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

/**
 * 汇总 GitHub 来源探测结果，供 JSON 输出稳定消费。
 *
 * @param {object} inspection Provider 探测结果
 * @returns {{detectedFormat:string,entryPath:string,resolvedCommit:string,compatibility:object}} 非敏感探测摘要
 */
function githubInspectionSummary(inspection) {
  const candidates = inspection.candidates || (inspection.candidate ? [inspection.candidate] : []);
  const reports = candidates.map(({ id, version, compatibilityReport }) => ({
    id,
    version,
    report: compatibilityReport,
  }));
  return {
    detectedFormat: inspection.detection.format,
    entryPath: inspection.detection.entryPath,
    resolvedCommit: inspection.resolvedCommit,
    compatibility: inspection.candidate?.compatibilityReport || {
      status: reports.some(({ report }) => report?.status === "partial") ? "partial" : "compatible",
      plugins: reports,
      diagnostics: inspection.diagnostics || [],
    },
  };
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
      const sourceType = parsed.sourceType || base.type || "gitlab";
      if (!new Set(["gitlab", "github"]).has(sourceType)) {
        throw new PluginRuntimeError(`不支持的 Plugin source 类型:${sourceType}`, {
          code: PLUGIN_RUNTIME_ERROR_CODES.USAGE_ERROR,
          path: sourceType,
        });
      }
      const githubFormat = parsed.format ?? base.format ?? "auto";
      const githubSubdir = parsed.clearSubdir ? undefined : (parsed.subdir ?? base.subdir);
      const githubEntryPath = githubFormat === "auto" ? undefined : (parsed.entryPath ?? base.entryPath);
      const descriptor = sourceType === "github" ? {
        schemaVersion: 2,
        id: parsed.sourceId,
        type: "github",
        name: parsed.name || base.name || parsed.sourceId,
        enabled: base.enabled ?? true,
        repository: parsed.repository ?? base.repository,
        ...(parsed.ref ?? base.ref ? { ref: parsed.ref ?? base.ref } : {}),
        ...(githubSubdir ? { subdir: githubSubdir } : {}),
        format: githubFormat,
        ...(githubEntryPath ? { entryPath: githubEntryPath } : {}),
      } : {
        schemaVersion: 2,
        id: parsed.sourceId,
        type: "gitlab",
        name: parsed.name || base.name || parsed.sourceId,
        enabled: base.enabled ?? true,
        baseUrl: parsed.baseUrl || base.baseUrl,
        project: parsed.project || base.project,
        ref: parsed.ref || base.ref || "main",
        marketplacePath: parsed.marketplacePath || base.marketplacePath || ".flower-plugin/marketplace.json",
        oauth: {
          applicationId: parsed.applicationId || base.oauth?.applicationId,
          scopes: GITLAB_OAUTH_REQUEST_SCOPES,
        },
      };
      if (sourceType === "github") {
        const inspection = await inspectGitHubPluginSource(descriptor, ctx, options);
        const source = sourceStore.set(inspection.source);
        result = {
          ok: true,
          command: "source",
          subcommand: parsed.subcommand,
          source,
          ...githubInspectionSummary(inspection),
        };
      } else {
        result = {
          ok: true,
          command: "source",
          subcommand: parsed.subcommand,
          source: sourceStore.set(descriptor),
        };
      }
    }
    printManagementResult(result, parsed.json, output);
    return 0;
  }

  if (parsed.command === "auth") {
    const source = sourceStore.get(parsed.sourceId, { includeDisabled: true });
    if (source.type !== "gitlab") {
      throw new PluginRuntimeError(`GitHub 公共来源无需登录:${source.id}`, {
        code: PLUGIN_RUNTIME_ERROR_CODES.USAGE_ERROR,
        path: source.id,
      });
    }
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
      result = await getPluginAuthStatus(source.id, {
        ...options,
        sourceStore,
        credentialBundle,
      });
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

  const result = await searchPluginMarketplaces(parsed, ctx, { ...options, sourceStore });
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
    ? (lock?.plugins || []).filter(({ source }) => ["gitlab", "github"].includes(source.type)).map(({ source }) => source.id)
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
    } else if (
      declaredSourceId &&
      !parsed.source &&
      declaredSourceId !== "local" &&
      !registry.has(declaredSourceId)
    ) {
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
  let manager = null;
  if (sources.some(({ type }) => type === "gitlab")) {
    const credentialBundle = options.credentialBundle || await createCredentialStore(options.credentialStoreOptions);
    const oauth = options.oauth || new GitLabOAuthClient({
      fetch: options.fetch,
      openUrl: options.openUrl,
      sleep: options.sleep,
      now: options.now,
    });
    manager = new GitLabCredentialManager({
      store: credentialBundle.store,
      oauth,
      now: options.now,
      persistent: credentialBundle.persistent,
      credentialResolver: options.credentialResolver,
      env: options.env,
      runGlab: options.runGlab,
      glabCommand: options.glabCommand,
    });
  }
  // 依赖闭包可能跨 source，因此登记全部可用来源，而不是只登记入口来源。
  for (const source of sources) {
    if (registry.has(source.id)) continue;
    registry.register(createRemoteProvider(source, projectRoot, manager, options));
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
      : (lock?.plugins || []).filter(({ source }) => ["gitlab", "github"].includes(source.type)).map(({ id }) => id);
    await prepareRemoteClosure(registry, updateIds);
    assertExternalVersionsNotReused(registry, lock, updateIds);
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
    if (!["gitlab", "github"].includes(plugin.source.type) || !registry.has(plugin.source.id)) continue;
    const provider = registry.get(plugin.source.id);
    if (typeof provider.prepareLocked === "function") await provider.prepareLocked(plugin);
    else if (typeof provider.prepare === "function") await provider.prepare(plugin.id);
  }
}

/**
 * 阻止外部来源在相同显式 SemVer 下替换内容。
 *
 * @param {object} registry Provider 注册表
 * @param {import("../plugin/contracts.js").PluginLock|null} lock 当前 lock
 * @param {string[]} ids 本轮显式更新目标
 * @returns {void}
 */
function assertExternalVersionsNotReused(registry, lock, ids) {
  const locked = new Map((lock?.plugins || []).map((plugin) => [plugin.id, plugin]));
  for (const id of ids) {
    const previous = locked.get(id);
    if (!previous || previous.source.type !== "github" || !registry.has(previous.source.id)) continue;
    for (const candidate of registry.get(previous.source.id).listCandidates(id)) {
      if (
        candidate.version === previous.version &&
        (candidate.commit !== previous.commit || candidate.integrity !== previous.integrity)
      ) {
        throw new PluginRuntimeError(`外部 Plugin 复用了已发布版本:${id}@${candidate.version}`, {
          code: PLUGIN_RUNTIME_ERROR_CODES.EXTERNAL_VERSION_REUSED,
          path: id,
        });
      }
    }
  }
}
