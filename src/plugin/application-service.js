import path from "node:path";
import { ProjectStore } from "./state/project-store.js";
import { parseCanonicalPluginId } from "./schemas/shared.js";
import { validatePluginsFile } from "./schemas/project-files.js";
import {
  PLUGIN_RUNTIME_ERROR_CODES,
  PluginRuntimeError,
} from "./runtime-errors.js";
import { resolvePluginGraph } from "./resolver/dependency-resolver.js";
import { buildPluginLock } from "./resolver/lock-builder.js";
import { detectPluginPlatforms } from "./install/platform-detector.js";
import { projectPluginContent } from "./install/content-projector.js";
import { createInstallPlan } from "./install/install-planner.js";
import { TransactionWriter } from "./install/transaction-writer.js";
import { hashDirectoryIfExists, hashFileIfExists } from "./install/content-hash.js";
import { getPluginPatchPlanner } from "./runtime-extensions.js";
import { isRuntimeBuiltinProviderTrusted } from "./runtime-extensions.js";
import { compareUtf8 } from "./stable-order.js";

/**
 * 计算 lock roots 可达的全部 Plugin。
 *
 * @param {import("./contracts.js").PluginLock} lock Plugin lock
 * @returns {Set<string>} 可达 Plugin ID
 */
function reachableLockIds(lock) {
  const byId = new Map(lock.plugins.map((plugin) => [plugin.id, plugin]));
  const reachable = new Set();
  const visit = (id) => {
    if (reachable.has(id)) return;
    reachable.add(id);
    const plugin = byId.get(id);
    if (!plugin) return;
    Object.keys(plugin.dependencies).sort(compareUtf8).forEach(visit);
  };
  [...lock.roots].sort(compareUtf8).forEach(visit);
  return reachable;
}

/**
 * 创建不产生写入的生命周期结果。
 *
 * @param {"update"} command 生命周期命令
 * @returns {object} 稳定的零变化结果
 */
function unchangedLifecycleResult(command) {
  return {
    ok: true,
    command,
    graph: { roots: [], plugins: [] },
    orphans: [],
    platforms: [],
    changes: [],
    diagnostics: [],
    approvalRequests: [],
    patchReport: null,
    transaction: {
      status: "unchanged",
      changed: [],
      unchanged: [],
      projectFiles: [],
      cleanup: { status: "not-needed", path: null },
    },
  };
}

/**
 * 创建未加载 P4 时的标准内容规划结果。
 *
 * @param {import("./contracts.js").ResolvedGraph} graph 已解析图
 * @returns {object} 空 Patch 规划结果
 */
function standardContentPlan(graph) {
  return {
    grants: graph.plugins.map(({ id, capabilities }) => ({
      pluginId: id,
      grant: capabilities,
      reusedApproval: false,
    })),
    approvalRequests: [],
    diagnostics: [],
    patchMutations: [],
    patchPayloads: new Map(),
    patchReport: null,
  };
}

/**
 * Flower Plugin 生命周期应用服务。
 */
export class PluginApplicationService {
  /**
   * 创建应用服务。
   *
   * @param {string} projectRoot 项目根
   * @param {{registry:{has?:(sourceId:string)=>boolean,get?:(sourceId:string)=>object,listCandidates:(id:string)=>import("./contracts.js").PluginCandidate[],readPackage:(plugin:object)=>object},store?:ProjectStore,writer?:TransactionWriter,platformDetector?:typeof detectPluginPlatforms}} options 运行时依赖
   */
  constructor(projectRoot, options) {
    this.projectRoot = path.resolve(projectRoot);
    this.registry = options.registry;
    this.store = options.store || new ProjectStore(this.projectRoot);
    this.platformDetector = options.platformDetector || detectPluginPlatforms;
    this.writer = options.writer || new TransactionWriter(this.projectRoot, { store: this.store });
  }

  /**
   * 列出项目直接声明、锁定图和本机应用状态。
   *
   * @returns {{plugins:import("./contracts.js").ProjectPluginsFile,lock:import("./contracts.js").PluginLock|null,state:import("./contracts.js").PluginState|null}} 项目视图
   */
  list() {
    return {
      plugins: this.store.readPlugins(),
      lock: this.store.readLock(),
      state: this.store.readState(),
    };
  }

  /**
   * 添加或更新一个直接 Plugin 声明并应用完整图。
   *
   * @param {{id:string,version?:string,platforms?:string[],dryRun?:boolean,approvals?:string[],approvedDigests?:Map<string,string>|Record<string,string>,nonInteractive?:boolean,onPreflight?:(result:object)=>void}} options 添加选项
   * @returns {object} 生命周期结果
   */
  add(options) {
    const pluginsFile = this.store.readPlugins();
    const { sourceId } = parseCanonicalPluginId(options.id);
    if (typeof this.registry.has === "function" && !this.registry.has(sourceId)) {
      throw new PluginRuntimeError(`未注册 Plugin source:${sourceId}`, {
        code: PLUGIN_RUNTIME_ERROR_CODES.SOURCE_NOT_FOUND,
        path: sourceId,
      });
    }
    const declaration = {
      id: options.id,
      source: sourceId,
      version: options.version || "*",
    };
    const declarations = pluginsFile.plugins.filter(({ id }) => id !== options.id);
    declarations.push(declaration);
    return this.#applyLifecycle("add", {
      plugins: { schemaVersion: 1, plugins: declarations.sort((left, right) => compareUtf8(left.id, right.id)) },
      platforms: options.platforms || [],
      dryRun: Boolean(options.dryRun),
      update: [],
      approvals: options.approvals || [],
      approvedDigests: options.approvedDigests,
      nonInteractive: options.nonInteractive,
      onPreflight: options.onPreflight,
    });
  }

  /**
   * 更新一个或全部直接 Plugin，同时保持未请求节点的 lock-first 语义。
   *
   * @param {{id?:string|null,version?:string,platforms?:string[],dryRun?:boolean,approvals?:string[],approvedDigests?:Map<string,string>|Record<string,string>,nonInteractive?:boolean,onPreflight?:(result:object)=>void}} [options] 更新选项
   * @returns {object} 生命周期结果
   */
  update(options = {}) {
    const pluginsFile = this.store.readPlugins();
    if (options.id && !pluginsFile.plugins.some(({ id }) => id === options.id)) {
      throw new PluginRuntimeError(`项目未声明 Plugin:${options.id}`, {
        code: PLUGIN_RUNTIME_ERROR_CODES.USAGE_ERROR,
        path: options.id,
      });
    }
    if (!options.id && pluginsFile.plugins.length === 0) {
      return unchangedLifecycleResult("update");
    }
    if (options.version && !options.id) {
      throw new PluginRuntimeError("更新 Plugin 版本约束时必须指定 Plugin ID", {
        code: PLUGIN_RUNTIME_ERROR_CODES.USAGE_ERROR,
        path: "version",
      });
    }
    const nextPlugins = options.version
      ? {
        ...pluginsFile,
        plugins: pluginsFile.plugins.map((plugin) => (
          plugin.id === options.id ? { ...plugin, version: options.version } : plugin
        )),
      }
      : pluginsFile;
    return this.#applyLifecycle("update", {
      plugins: nextPlugins,
      platforms: options.platforms || [],
      dryRun: Boolean(options.dryRun),
      update: options.id ? [options.id] : "all",
      approvals: options.approvals || [],
      approvedDigests: options.approvedDigests,
      nonInteractive: options.nonInteractive,
      onPreflight: options.onPreflight,
    });
  }

  /**
   * 按现有 lock-first 身份重放完整 Plugin 图，并可冻结指定节点的 mutation/state。
   *
   * @param {{platforms?:string[],dryRun?:boolean,preserveIds?:string[],nonInteractive?:boolean}} [options] 重放选项
   * @returns {object} 生命周期结果
   */
  replay(options = {}) {
    const pluginsFile = this.store.readPlugins();
    if (pluginsFile.plugins.length === 0) return unchangedLifecycleResult("update");
    return this.#applyLifecycle("update", {
      plugins: pluginsFile,
      platforms: options.platforms || [],
      dryRun: Boolean(options.dryRun),
      update: [],
      approvals: [],
      approvedDigests: null,
      nonInteractive: options.nonInteractive ?? true,
      preserveIds: options.preserveIds || [],
    });
  }

  /**
   * 移除直接 Plugin，并清理不再可达的传递依赖。
   *
   * @param {{id:string,platforms?:string[],dryRun?:boolean}} options 移除选项
   * @returns {object} 生命周期结果
   */
  remove(options) {
    const pluginsFile = this.store.readPlugins();
    if (!pluginsFile.plugins.some(({ id }) => id === options.id)) {
      throw new PluginRuntimeError(`项目未声明 Plugin:${options.id}`, {
        code: PLUGIN_RUNTIME_ERROR_CODES.USAGE_ERROR,
        path: options.id,
      });
    }
    return this.#applyLifecycle("remove", {
      plugins: {
        schemaVersion: 1,
        plugins: pluginsFile.plugins.filter(({ id }) => id !== options.id),
      },
      platforms: options.platforms || [],
      dryRun: Boolean(options.dryRun),
      update: [],
      approvals: [],
      approvedDigests: null,
      nonInteractive: true,
    });
  }

  /**
   * 只读校验声明、lock、固定包、state ownership 与目标摘要。
   *
   * @param {{id?:string|null}} [options] 校验过滤
   * @returns {{ok:boolean,diagnostics:import("./contracts.js").PluginDiagnostic[]}} 校验结果
   */
  verify(options = {}) {
    const pluginsFile = this.store.readPlugins();
    const lock = this.store.readLock();
    const state = this.store.readState();
    const diagnostics = [];
    if (!lock) {
      diagnostics.push({
        code: "verify.lock-missing",
        path: ".flower/plugin-lock.json",
        message: "Plugin lock 不存在",
        severity: "error",
      });
    }
    const lockById = new Map((lock?.plugins || []).map((plugin) => [plugin.id, plugin]));
    const stateById = new Map((state?.plugins || []).map((plugin) => [plugin.id, plugin]));
    const declaredIds = new Set(pluginsFile.plugins.map(({ id }) => id));
    const lockedRoots = new Set(lock?.roots || []);
    const requestedIds = options.id
      ? [options.id]
      : [...new Set([
        ...pluginsFile.plugins.map(({ id }) => id),
        ...(lock?.plugins || []).map(({ id }) => id),
        ...(state?.plugins || []).map(({ id }) => id),
      ])].sort(compareUtf8);
    if (options.id && requestedIds.length === 1 && !lockById.has(options.id) && !stateById.has(options.id)) {
      diagnostics.push({
        code: "verify.plugin-unknown",
        path: options.id,
        message: `项目中不存在 Plugin:${options.id}`,
        severity: "error",
      });
    }

    for (const id of [...declaredIds].sort(compareUtf8)) {
      if (options.id && id !== options.id) continue;
      if (!lockedRoots.has(id)) {
        diagnostics.push({
          code: "verify.root-missing",
          path: id,
          message: `直接 Plugin 未声明为 lock root:${id}`,
          severity: "error",
        });
      }
    }
    for (const id of [...lockedRoots].sort(compareUtf8)) {
      if (options.id && id !== options.id) continue;
      if (!declaredIds.has(id)) {
        diagnostics.push({
          code: "verify.root-extra",
          path: id,
          message: `lock root 不存在对应直接声明:${id}`,
          severity: "error",
        });
      }
    }
    if (lock) {
      const reachable = reachableLockIds(lock);
      for (const id of [...lockById.keys()].sort(compareUtf8)) {
        if (options.id && id !== options.id) continue;
        if (!reachable.has(id)) {
          diagnostics.push({
            code: "verify.lock-orphan",
            path: id,
            message: `lock 包含不可达 Plugin:${id}`,
            severity: "error",
          });
        }
      }
    }

    const pathOwners = new Map();
    for (const plugin of state?.plugins || []) {
      if (!lockById.has(plugin.id)) {
        diagnostics.push({
          code: "verify.state-extra",
          path: plugin.id,
          message: `state 包含 lock 外 Plugin:${plugin.id}`,
          severity: "error",
        });
      }
      for (const entry of plugin.paths) {
        const previousOwner = pathOwners.get(entry.path);
        if (previousOwner && previousOwner !== plugin.id) {
          diagnostics.push({
            code: "verify.ownership-conflict",
            path: entry.path,
            message: `多个 Plugin 声明同一路径 ownership:${previousOwner}, ${plugin.id}`,
            severity: "error",
          });
        }
        pathOwners.set(entry.path, plugin.id);
      }
    }

    for (const declaration of pluginsFile.plugins) {
      if (options.id && declaration.id !== options.id) continue;
      if (!lockById.has(declaration.id)) {
        diagnostics.push({
          code: "verify.root-unlocked",
          path: declaration.id,
          message: `直接 Plugin 未进入 lock:${declaration.id}`,
          severity: "error",
        });
      }
    }
    for (const id of requestedIds) {
      const locked = lockById.get(id);
      const applied = stateById.get(id);
      if (!locked) continue;
      try {
        this.registry.readPackage(locked);
      } catch (error) {
        diagnostics.push({
          code: "verify.package-invalid",
          path: id,
          message: `固定 Plugin 包校验失败:${error.message}`,
          severity: "error",
        });
      }
      if (!applied) {
        diagnostics.push({
          code: "verify.state-missing",
          path: id,
          message: `Plugin 缺少本机 state:${id}`,
          severity: "error",
        });
        continue;
      }
      if (applied.version !== locked.version) {
        diagnostics.push({
          code: "verify.version-mismatch",
          path: id,
          message: `Plugin state 版本与 lock 不一致:${id}`,
          severity: "error",
        });
      }
      for (const entry of applied.paths) {
        const target = path.join(this.projectRoot, ...entry.path.split("/"));
        let actual = null;
        try {
          actual = entry.kind === "directory"
            ? hashDirectoryIfExists(target)
            : hashFileIfExists(target);
        } catch (error) {
          diagnostics.push({
            code: "verify.target-invalid",
            path: entry.path,
            message: error.message,
            severity: "error",
          });
          continue;
        }
        if (actual !== entry.hash) {
          diagnostics.push({
            code: "verify.target-drift",
            path: entry.path,
            message: `Plugin 目标摘要漂移:${entry.path}`,
            severity: "error",
          });
        }
      }
    }
    diagnostics.sort((left, right) => compareUtf8(left.path, right.path) || compareUtf8(left.code, right.code));
    return { ok: diagnostics.every(({ severity }) => severity !== "error"), diagnostics };
  }

  /**
   * 解析、投影、规划并执行一次生命周期变更。
   *
   * @param {"add"|"update"|"remove"} command 生命周期命令
   * @param {{plugins:import("./contracts.js").ProjectPluginsFile,platforms:string[],dryRun:boolean,update:string[]|"all",approvals:string[],approvedDigests?:Map<string,string>|Record<string,string>|null,nonInteractive?:boolean,onPreflight?:(result:object)=>void,preserveIds?:string[]}} input 变更输入
   * @returns {object} 生命周期结果
   */
  #applyLifecycle(command, input) {
    const pluginsFile = validatePluginsFile(input.plugins);
    const previousLock = this.store.readLock();
    const previousState = this.store.readState();
    const resolution = resolvePluginGraph(pluginsFile.plugins, this.registry, {
      lockedPlugins: previousLock?.plugins || [],
      update: input.update,
    });
    let projection = {
      mutations: [],
      payloads: new Map(),
      state: { schemaVersion: 1, transactionVersion: 1, plugins: [] },
      directoryClaims: [],
      directoryRemovals: [],
    };
    let platformSelection = { platforms: [], targets: [] };
    if (resolution.graph.plugins.length > 0) {
      platformSelection = this.platformDetector(this.projectRoot, input.platforms);
      projection = projectPluginContent({
        projectRoot: this.projectRoot,
        graph: resolution.graph,
        selected: resolution.selected,
        registry: this.registry,
        platformSelection,
        previousState,
      });
    }
    const preservedIds = new Set(input.preserveIds || []);
    if (preservedIds.size > 0) {
      for (const id of preservedIds) {
        const previousEntry = previousState?.plugins.find((plugin) => plugin.id === id);
        const nextIndex = projection.state.plugins.findIndex((plugin) => plugin.id === id);
        if (!previousEntry || nextIndex < 0) {
          throw new PluginRuntimeError(`冻结 Plugin 缺少既有 state:${id}`, {
            code: PLUGIN_RUNTIME_ERROR_CODES.TARGET_DRIFT,
            path: id,
          });
        }
        projection.state.plugins[nextIndex] = structuredClone(previousEntry);
        const previousLocked = previousLock?.plugins.find((plugin) => plugin.id === id);
        const graphIndex = resolution.graph.plugins.findIndex((plugin) => plugin.id === id);
        if (!previousLocked || graphIndex < 0) {
          throw new PluginRuntimeError(`冻结 Plugin 缺少既有 lock:${id}`, {
            code: PLUGIN_RUNTIME_ERROR_CODES.TARGET_DRIFT,
            path: id,
          });
        }
        resolution.graph.plugins[graphIndex] = structuredClone(previousLocked);
      }
      projection.mutations = projection.mutations.filter(({ owner }) => !preservedIds.has(owner));
      projection.directoryClaims = projection.directoryClaims.filter(({ owner }) => !preservedIds.has(owner));
      projection.directoryRemovals = projection.directoryRemovals
        .filter(({ owner }) => !preservedIds.has(owner));
      if (previousState?.migration) projection.state.migration = structuredClone(previousState.migration);
    }

    const previousDirectories = new Map();
    for (const plugin of previousState?.plugins || []) {
      for (const entry of plugin.paths) {
        if (entry.kind === "directory") previousDirectories.set(entry.path, { owner: plugin.id, ...entry });
      }
    }
    const directoryClaims = [];
    const desiredDirectoryPaths = new Set();
    const directoryOwners = new Map();
    for (const claim of projection.directoryClaims) {
      desiredDirectoryPaths.add(claim.path);
      const otherOwner = directoryOwners.get(claim.path);
      if (otherOwner && otherOwner !== claim.owner) {
        throw new PluginRuntimeError(`多个 Plugin 声明同一目录 ownership:${claim.path}`, {
          code: PLUGIN_RUNTIME_ERROR_CODES.CONTENT_CONFLICT,
          path: claim.path,
          details: { owners: [otherOwner, claim.owner].sort(compareUtf8) },
        });
      }
      directoryOwners.set(claim.path, claim.owner);
      const previous = previousDirectories.get(claim.path);
      if (previous && previous.owner !== claim.owner) {
        throw new PluginRuntimeError(`Plugin 目录 ownership 冲突:${claim.path}`, {
          code: PLUGIN_RUNTIME_ERROR_CODES.CONTENT_CONFLICT,
          path: claim.path,
        });
      }
      const target = path.join(this.projectRoot, ...claim.path.split("/"));
      const currentHash = hashDirectoryIfExists(target);
      if (previous && currentHash !== previous.hash) {
        throw new PluginRuntimeError(`受管 Plugin 目录已被用户修改:${claim.path}`, {
          code: PLUGIN_RUNTIME_ERROR_CODES.CONTENT_CONFLICT,
          path: claim.path,
          details: { expected: previous.hash, actual: currentHash },
        });
      }
      if (previous || currentHash === null) {
        directoryClaims.push({ ...claim, beforeHash: currentHash });
      }
    }

    const desiredPaths = new Set(
      projection.state.plugins.flatMap((plugin) => plugin.paths.map(({ path: target }) => target)),
    );
    const removalMutations = [];
    const directoryRemovals = [...projection.directoryRemovals];
    for (const plugin of previousState?.plugins || []) {
      for (const entry of plugin.paths) {
        if (entry.ownership === "shared") continue;
        if (entry.kind === "directory") {
          if (desiredDirectoryPaths.has(entry.path)) continue;
          const target = path.join(this.projectRoot, ...entry.path.split("/"));
          const currentHash = hashDirectoryIfExists(target);
          if (currentHash !== entry.hash) {
            throw new PluginRuntimeError(`受管 Plugin 目录已被用户修改，拒绝删除:${entry.path}`, {
              code: PLUGIN_RUNTIME_ERROR_CODES.CONTENT_CONFLICT,
              path: entry.path,
              details: { expected: entry.hash, actual: currentHash },
            });
          }
          if (!directoryRemovals.some(({ path: targetPath }) => targetPath === entry.path)) {
            directoryRemovals.push({ owner: plugin.id, path: entry.path, beforeHash: currentHash });
          }
          continue;
        }
        if (desiredPaths.has(entry.path)) continue;
        const target = path.join(this.projectRoot, ...entry.path.split("/"));
        const currentHash = hashFileIfExists(target);
        if (currentHash !== entry.hash) {
          throw new PluginRuntimeError(`受管 Plugin 文件已被用户修改，拒绝删除:${entry.path}`, {
            code: PLUGIN_RUNTIME_ERROR_CODES.CONTENT_CONFLICT,
            path: entry.path,
            details: { expected: entry.hash, actual: currentHash },
          });
        }
        removalMutations.push({
          owner: plugin.id,
          target: entry.path,
          operation: "remove",
          beforeHash: currentHash,
          afterHash: null,
          source: `state:${plugin.id}:${entry.path}`,
        });
      }
    }

    const patchPlanner = getPluginPatchPlanner();
    let patchResult = standardContentPlan(resolution.graph);
    if (patchPlanner) {
      const previousApprovals = new Map(
        (previousLock?.plugins || [])
          .filter(({ capabilities }) => capabilities.approvalDigest)
          .map(({ id, capabilities }) => [id, capabilities.approvalDigest]),
      );
      const selectedById = new Map(resolution.selected.map((candidate) => [candidate.id, candidate]));
      const patchEntries = resolution.graph.plugins
        .filter((plugin) => !preservedIds.has(plugin.id))
        .map((plugin) => {
          const candidate = selectedById.get(plugin.id);
          if (!candidate) throw new Error(`Resolved Plugin 缺少 Patch 候选:${plugin.id}`);
          const pluginPackage = this.registry.readPackage(candidate);
          return {
            plugin: candidate,
            manifest: pluginPackage.manifest,
            packageRoot: pluginPackage.root,
            marketplaceMaxProfile: candidate.marketplaceMaxProfile,
            provider: typeof this.registry.get === "function" ? this.registry.get(candidate.source.id) : undefined,
            catalogs: pluginPackage.catalogs,
            systemAdapters: pluginPackage.systemAdapters,
            patchOptions: pluginPackage.patchOptions,
            allowContentPatchOverlap: pluginPackage.allowContentPatchOverlap === true &&
              isRuntimeBuiltinProviderTrusted(
                typeof this.registry.get === "function" ? this.registry.get(candidate.source.id) : null,
              ),
          };
        });
      const contentPatchOverlapOwners = new Set(
        patchEntries
          .filter(({ allowContentPatchOverlap }) => allowContentPatchOverlap)
          .map(({ plugin }) => plugin.id),
      );
      const approvedDigests = input.approvedDigests || previousApprovals;
      patchResult = patchPlanner(this.projectRoot, patchEntries, {
        contentMutations: [...projection.mutations, ...removalMutations],
        approvedDigests,
        approvals: input.approvals,
        approvalMode: input.dryRun ? "preview" : "require",
        nonInteractive: input.nonInteractive,
        systemAdapters: Object.assign(
          {},
          ...patchEntries.map((entry) => entry.systemAdapters || {}),
        ),
        patchOptions: Object.assign(
          {},
          ...patchEntries
            .filter(({ allowContentPatchOverlap }) => allowContentPatchOverlap)
            .map((entry) => entry.patchOptions || {}),
        ),
        contentPatchOverlapOwners,
      });
      if (contentPatchOverlapOwners.size > 0) {
        const patchByTarget = new Map(
          patchResult.patchMutations.map((mutation) => [mutation.target, mutation]),
        );
        projection.mutations = projection.mutations.filter((mutation) => {
          const patch = patchByTarget.get(mutation.target);
          if (!patch) return true;
          if (
            mutation.owner !== patch.owner ||
            !contentPatchOverlapOwners.has(mutation.owner) ||
            mutation.operation !== "write" ||
            mutation.afterHash !== patch.afterHash
          ) {
            throw new PluginRuntimeError(`Plugin 内容与 Patch 最终字节不一致:${mutation.target}`, {
              code: PLUGIN_RUNTIME_ERROR_CODES.CONTENT_CONFLICT,
              path: mutation.target,
            });
          }
          return false;
        });
      }
    }
    const grants = new Map(patchResult.grants.map(({ pluginId, grant }) => [pluginId, grant]));
    for (const plugin of resolution.graph.plugins) {
      const grant = grants.get(plugin.id) || (
        preservedIds.has(plugin.id)
          ? previousLock?.plugins.find(({ id }) => id === plugin.id)?.capabilities
          : null
      );
      if (!grant) throw new Error(`Resolved Plugin 缺少 capability grant:${plugin.id}`);
      plugin.capabilities = grant;
    }
    for (const mutation of patchResult.patchMutations) {
      const plugin = projection.state.plugins.find(({ id }) => id === mutation.owner);
      if (!plugin) throw new Error(`Patch mutation 缺少 Plugin state:${mutation.owner}`);
      for (const provenance of mutation.provenance) {
        plugin.patches = plugin.patches.filter((entry) => !(
          entry.operation === provenance.qualifiedId && entry.target === mutation.target
        ));
        plugin.patches.push({
          operation: provenance.qualifiedId,
          target: mutation.target,
          resultHash: mutation.afterHash,
        });
      }
      plugin.patches.sort((left, right) => (
        compareUtf8(left.target, right.target) || compareUtf8(left.operation, right.operation)
      ));
    }
    const lock = buildPluginLock(resolution.graph);

    const plan = createInstallPlan(
      resolution.graph,
      [...projection.mutations, ...removalMutations],
      {
        projectRoot: this.projectRoot,
        currentState: previousState,
        patchMutations: patchResult.patchMutations,
        diagnostics: patchResult.diagnostics,
      },
    );
    input.onPreflight?.({
      diagnostics: [...plan.diagnostics],
      approvalRequests: [...patchResult.approvalRequests],
      patchReport: patchResult.patchReport,
      plan,
    });
    const transaction = this.writer.apply({
      plan,
      payloads: projection.payloads,
      patchPayloads: patchResult.patchPayloads,
      plugins: pluginsFile,
      lock,
      state: projection.state,
      directoryClaims,
      directoryRemovals,
      dryRun: input.dryRun,
    });
    return {
      ok: true,
      command,
      graph: resolution.graph,
      orphans: resolution.orphans,
      platforms: platformSelection.platforms,
      changes: [
        ...plan.contentMutations.map(({ owner, target, operation, beforeHash, afterHash }) => ({
          owner,
          target,
          operation,
          beforeHash,
          afterHash,
        })),
        ...plan.patchMutations.map(({ owner, target, beforeHash, afterHash }) => ({
          owner,
          target,
          operation: "patch",
          beforeHash,
          afterHash,
        })),
        ...directoryClaims.map(({ owner, path: target, beforeHash }) => ({
          owner,
          target,
          operation: "ensure-directory",
          beforeHash,
          afterHash: null,
        })),
        ...directoryRemovals.map(({ owner, path: target, beforeHash }) => ({
          owner,
          target,
          operation: "remove-directory",
          beforeHash,
          afterHash: null,
        })),
      ].sort((left, right) => compareUtf8(left.target, right.target)),
      diagnostics: [
        ...plan.diagnostics,
        ...(transaction.cleanup.status === "retained" ? [{
          code: "transaction.cleanup-retained",
          path: transaction.cleanup.path,
          message: `事务已成功，但清理失败，证据保留于:${transaction.cleanup.path}`,
          severity: "warning",
        }] : []),
      ],
      approvalRequests: patchResult.approvalRequests,
      patchReport: patchResult.patchReport,
      transaction,
    };
  }
}
