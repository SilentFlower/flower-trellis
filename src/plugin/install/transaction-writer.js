import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PluginError, PluginIoError, PluginPathError } from "../errors.js";
import { stringifyCanonicalJson } from "../integrity/canonical-json.js";
import { listVolatileTreeEntries } from "../integrity/canonical-tree.js";
import {
  validatePluginLock,
  validatePluginsFile,
  validatePluginState,
} from "../schemas/project-files.js";
import {
  PLUGIN_RUNTIME_ERROR_CODES,
  PluginRuntimeError,
} from "../runtime-errors.js";
import { contentMutationKey } from "./content-projector.js";
import { hashContent, hashDirectoryIfExists, hashFileIfExists } from "./content-hash.js";

const PROJECT_FILES = [
  { name: "plugins", file: "plugins.json", writer: "writePlugins" },
  { name: "lock", file: "plugin-lock.json", writer: "writeLock" },
  { name: "state", file: "state.json", writer: "writeState" },
];

/**
 * 判断 candidate 是否位于 root 内部或等于 root。
 *
 * @param {string} root 根目录
 * @param {string} candidate 候选路径
 * @returns {boolean} 是否位于边界内
 */
function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function transactionTargets(plan) {
  const targets = plan.contentMutations.map((mutation) => ({
    kind: "content",
    owners: [mutation.owner],
    target: mutation.target,
    operation: mutation.operation,
    beforeHash: mutation.beforeHash,
    afterHash: mutation.afterHash,
    mutation,
  }));
  const patches = new Map();
  for (const mutation of plan.patchMutations || []) {
    const previous = patches.get(mutation.target);
    if (previous) {
      previous.owners.push(mutation.owner);
      continue;
    }
    const entry = {
      kind: "patch",
      owners: [mutation.owner],
      target: mutation.target,
      operation: "write",
      beforeHash: mutation.beforeHash,
      afterHash: mutation.afterHash,
      mutation,
    };
    patches.set(mutation.target, entry);
    targets.push(entry);
  }
  return targets.sort((left, right) => Buffer.compare(Buffer.from(left.target), Buffer.from(right.target)));
}

function mutationPayload(entry, input) {
  if (entry.operation !== "write") return null;
  if (entry.kind === "patch") return input.patchPayloads?.get(entry.target) || null;
  return input.payloads.get(contentMutationKey(entry.mutation)) || null;
}

/**
 * Plugin 普通内容与项目状态的事务写入器。
 */
export class TransactionWriter {
  /**
   * 创建事务写入器。
   *
   * @param {string} projectRoot 项目根
   * @param {{store:{ensureLayout:()=>object,writePlugins:(value:unknown)=>object,writeLock:(value:unknown)=>object,writeState:(value:unknown)=>object},fileSystem?:typeof fs,randomBytes?:(size:number)=>Buffer,onOperation?:(event:{phase:string,kind:string,path:string,index:number})=>void}} options 写入依赖
   */
  constructor(projectRoot, options) {
    this.projectRoot = path.resolve(projectRoot);
    this.store = options.store;
    this.fileSystem = options.fileSystem || fs;
    this.randomBytes = options.randomBytes || crypto.randomBytes;
    this.onOperation = options.onOperation || (() => {});
  }

  /**
   * 应用 InstallPlan，并保证项目 state 最后写入。
   *
   * @param {{plan:import("../contracts.js").InstallPlan,payloads:Map<string,Buffer>,patchPayloads?:Map<string,Buffer>,plugins:import("../contracts.js").ProjectPluginsFile,lock:import("../contracts.js").PluginLock,state:import("../contracts.js").PluginState,directoryClaims?:Array<{owner:string,path:string,beforeHash:string|null}>,directoryRemovals?:Array<{owner:string,path:string,beforeHash:string}>,dryRun?:boolean}} input 事务输入
   * @returns {{status:"applied"|"dry-run"|"unchanged",changed:string[],unchanged:string[],projectFiles:Array<{name:string,status:string}>,cleanup:{status:"clean"|"retained"|"not-needed",path:string|null}}} 应用结果
   */
  apply(input) {
    const plugins = validatePluginsFile(input.plugins);
    const lock = validatePluginLock(input.lock);
    const state = validatePluginState(input.state);
    const realRoot = this.#assertProjectRoot();
    const changed = [];
    const unchanged = [];
    const directoryClaims = input.directoryClaims || [];
    const directoryRemovals = input.directoryRemovals || [];
    const targetMutations = transactionTargets(input.plan);

    for (const mutation of targetMutations) {
      const absoluteTarget = this.#resolveTarget(realRoot, mutation.target);
      const actualHash = hashFileIfExists(absoluteTarget);
      if (actualHash !== mutation.beforeHash) {
        throw new PluginRuntimeError(`Plugin 目标在计划后发生漂移:${mutation.target}`, {
          code: PLUGIN_RUNTIME_ERROR_CODES.TARGET_DRIFT,
          path: mutation.target,
          details: { expected: mutation.beforeHash, actual: actualHash },
        });
      }
      if (mutation.operation === "write") {
        const content = mutationPayload(mutation, input);
        if (!Buffer.isBuffer(content) || hashContent(content) !== mutation.afterHash) {
          throw new PluginRuntimeError(`Plugin mutation payload 与计划不一致:${mutation.target}`, {
            code: PLUGIN_RUNTIME_ERROR_CODES.TARGET_DRIFT,
            path: mutation.target,
          });
        }
      }
      if (mutation.beforeHash === mutation.afterHash) unchanged.push(mutation.target);
      else changed.push(mutation.target);
    }
    for (const claim of directoryClaims) {
      const actualHash = hashDirectoryIfExists(this.#resolveTarget(realRoot, claim.path));
      if (actualHash !== claim.beforeHash) {
        throw new PluginRuntimeError(`Plugin 目录在计划后发生漂移:${claim.path}`, {
          code: PLUGIN_RUNTIME_ERROR_CODES.TARGET_DRIFT,
          path: claim.path,
          details: { expected: claim.beforeHash, actual: actualHash },
        });
      }
      if (claim.beforeHash === null) changed.push(claim.path);
    }
    for (const removal of directoryRemovals) {
      const actualHash = hashDirectoryIfExists(this.#resolveTarget(realRoot, removal.path));
      if (actualHash !== removal.beforeHash) {
        throw new PluginRuntimeError(`Plugin 待删目录在计划后发生漂移:${removal.path}`, {
          code: PLUGIN_RUNTIME_ERROR_CODES.TARGET_DRIFT,
          path: removal.path,
          details: { expected: removal.beforeHash, actual: actualHash },
        });
      }
      changed.push(removal.path);
    }

    if (input.dryRun) {
      return {
        status: "dry-run",
        changed,
        unchanged,
        projectFiles: [],
        cleanup: { status: "not-needed", path: null },
      };
    }

    const transactionId = this.randomBytes(12).toString("hex");
    const transactionRoot = path.join(this.projectRoot, ".flower", "transactions", transactionId);
    const stagingRoot = path.join(transactionRoot, "staging");
    const backupRoot = path.join(transactionRoot, "backup");
    const targetBackups = [];
    const projectBackups = [];
    const createdDirectories = new Set();
    const removedDirectories = [];
    const completed = [];
    let transactionCreated = false;
    const manifestPath = path.join(transactionRoot, "transaction.json");
    const transactionManifest = {
      schemaVersion: 1,
      id: transactionId,
      targets: targetMutations.map(({ kind, owners, target, operation, beforeHash, afterHash }) => ({
        kind,
        owners: [...owners].sort(),
        target,
        operation,
        beforeHash,
        afterHash,
      })),
      completed,
    };

    try {
      this.store.ensureLayout();
      this.fileSystem.mkdirSync(transactionRoot, { mode: 0o700 });
      transactionCreated = true;
      this.fileSystem.mkdirSync(stagingRoot);
      this.fileSystem.mkdirSync(backupRoot);
      targetMutations.forEach((mutation, index) => {
        const absoluteTarget = this.#resolveTarget(realRoot, mutation.target);
        const existed = this.fileSystem.existsSync(absoluteTarget);
        const backupPath = path.join(backupRoot, `target-${index}.bin`);
        if (existed) this.fileSystem.copyFileSync(absoluteTarget, backupPath);
        targetBackups.push({ mutation, absoluteTarget, existed, backupPath });
        if (mutation.operation === "write" && mutation.beforeHash !== mutation.afterHash) {
          const stagingPath = path.join(stagingRoot, `target-${index}.bin`);
          this.fileSystem.writeFileSync(stagingPath, mutationPayload(mutation, input));
        }
      });
      for (const descriptor of PROJECT_FILES) {
        const absolutePath = path.join(this.projectRoot, ".flower", descriptor.file);
        const existed = this.fileSystem.existsSync(absolutePath);
        const backupPath = path.join(backupRoot, `project-${descriptor.name}.bin`);
        if (existed) this.fileSystem.copyFileSync(absolutePath, backupPath);
        projectBackups.push({ ...descriptor, absolutePath, existed, backupPath });
      }
      this.#writeTransactionManifest(manifestPath, transactionManifest);

      targetMutations.forEach((mutation, index) => {
        if (mutation.beforeHash === mutation.afterHash) return;
        const backup = targetBackups[index];
        this.onOperation({ phase: "before-write", kind: "target", path: mutation.target, index });
        if (mutation.operation === "remove") {
          this.#resolveTarget(realRoot, mutation.target);
          this.fileSystem.unlinkSync(backup.absoluteTarget);
        } else {
          const stagingPath = path.join(stagingRoot, `target-${index}.bin`);
          this.#ensureTargetParent(realRoot, backup.absoluteTarget, createdDirectories);
          this.#atomicWrite(backup.absoluteTarget, this.fileSystem.readFileSync(stagingPath));
        }
        completed.push({ kind: "target", path: mutation.target });
        this.#writeTransactionManifest(manifestPath, transactionManifest);
      });

      for (const claim of [...directoryClaims].sort((left, right) => left.path.length - right.path.length)) {
        const absoluteTarget = this.#resolveTarget(realRoot, claim.path);
        if (!this.fileSystem.existsSync(absoluteTarget)) {
          this.onOperation({ phase: "before-write", kind: "directory", path: claim.path, index: 0 });
          this.#ensureTargetParent(realRoot, absoluteTarget, createdDirectories);
          this.fileSystem.mkdirSync(absoluteTarget);
          createdDirectories.add(absoluteTarget);
          completed.push({ kind: "directory", path: claim.path });
          this.#writeTransactionManifest(manifestPath, transactionManifest);
        }
      }
      for (const removal of [...directoryRemovals].sort((left, right) => right.path.length - left.path.length)) {
        const absoluteTarget = this.#resolveTarget(realRoot, removal.path);
        this.onOperation({ phase: "before-write", kind: "directory", path: removal.path, index: 0 });
        // 目录摘要已忽略运行时字节码缓存，删除前必须同步清场，否则非递归 rmdir 报 ENOTEMPTY。
        // 这类缓存由解释器随时重建，回滚不还原它们不会丢失任何用户内容。
        for (const volatilePath of listVolatileTreeEntries(absoluteTarget)) {
          this.fileSystem.rmSync(volatilePath, { recursive: true, force: true });
        }
        this.fileSystem.rmdirSync(absoluteTarget);
        removedDirectories.push(absoluteTarget);
        completed.push({ kind: "directory", path: removal.path });
        this.#writeTransactionManifest(manifestPath, transactionManifest);
      }

      const finalState = structuredClone(state);
      for (const claim of directoryClaims) {
        const plugin = finalState.plugins.find(({ id }) => id === claim.owner);
        if (!plugin) throw new Error(`目录 claim 缺少 Plugin state:${claim.owner}`);
        const target = this.#resolveTarget(realRoot, claim.path);
        const directoryHash = hashDirectoryIfExists(target);
        if (!directoryHash) throw new Error(`目录 claim 未创建:${claim.path}`);
        plugin.paths = plugin.paths.filter(({ path: managedPath }) => managedPath !== claim.path);
        plugin.paths.push({
          path: claim.path,
          kind: "directory",
          hash: directoryHash,
          ownership: "exclusive",
        });
        plugin.paths.sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
      }
      validatePluginState(finalState);

      const values = { plugins, lock, state: finalState };
      const projectFiles = [];
      PROJECT_FILES.forEach((descriptor, index) => {
        this.onOperation({
          phase: "before-write",
          kind: descriptor.name,
          path: `.flower/${descriptor.file}`,
          index,
        });
        const result = this.store[descriptor.writer](values[descriptor.name]);
        projectFiles.push({ name: descriptor.name, status: result.status });
        completed.push({ kind: descriptor.name, path: `.flower/${descriptor.file}` });
        if (descriptor.name !== "state") this.#writeTransactionManifest(manifestPath, transactionManifest);
      });

      const cleanupPath = `.flower/transactions/${transactionId}`;
      let cleanup = { status: "clean", path: null };
      try {
        this.fileSystem.rmSync(transactionRoot, { recursive: true, force: true });
      } catch {
        // 成功 state 已写入；清理失败时保留事务证据，不能回滚已确认成功的事务。
        cleanup = { status: "retained", path: cleanupPath };
      }
      return {
        status: changed.length === 0 && projectFiles.every(({ status }) => status === "unchanged")
          ? "unchanged"
          : "applied",
        changed,
        unchanged,
        projectFiles,
        cleanup,
      };
    } catch (error) {
      const rollbackFailures = [];
      const completedKeys = new Set(completed.map((entry) => `${entry.kind}\u0000${entry.path}`));
      for (const backup of [...projectBackups].reverse().filter((entry) => (
        completedKeys.has(`${entry.name}\u0000.flower/${entry.file}`)
      ))) {
        try {
          this.onOperation({ phase: "rollback", kind: backup.name, path: `.flower/${backup.file}`, index: 0 });
          this.#restoreBackup(backup);
        } catch (rollbackError) {
          rollbackFailures.push({ path: `.flower/${backup.file}`, error: rollbackError });
        }
      }
      for (const directory of [...removedDirectories].sort((left, right) => left.length - right.length)) {
        try {
          this.fileSystem.mkdirSync(directory);
        } catch (rollbackError) {
          if (rollbackError?.code !== "EEXIST") rollbackFailures.push({ path: directory, error: rollbackError });
        }
      }
      for (const backup of [...targetBackups].reverse().filter((entry) => (
        completedKeys.has(`target\u0000${entry.mutation.target}`)
      ))) {
        try {
          this.onOperation({ phase: "rollback", kind: "target", path: backup.mutation.target, index: 0 });
          this.#restoreBackup(backup);
        } catch (rollbackError) {
          rollbackFailures.push({ path: backup.mutation.target, error: rollbackError });
        }
      }
      for (const directory of [...createdDirectories].sort((left, right) => right.length - left.length)) {
        try {
          this.fileSystem.rmdirSync(directory);
        } catch (cleanupError) {
          if (cleanupError?.code !== "ENOENT" && cleanupError?.code !== "ENOTEMPTY") {
            rollbackFailures.push({ path: directory, error: cleanupError });
          }
        }
      }
      if (rollbackFailures.length === 0 && transactionCreated) {
        try {
          this.fileSystem.rmSync(transactionRoot, { recursive: true, force: true });
        } catch (cleanupError) {
          rollbackFailures.push({ path: transactionRoot, error: cleanupError });
        }
      }
      if (rollbackFailures.length > 0) {
        throw new PluginRuntimeError(`Plugin 事务失败且回滚不完整，证据保留于:${transactionRoot}`, {
          code: PLUGIN_RUNTIME_ERROR_CODES.TRANSACTION_REPAIR_REQUIRED,
          path: transactionRoot,
          cause: error,
          details: { rollbackFailures: rollbackFailures.map(({ path: failedPath }) => failedPath) },
        });
      }
      if (error instanceof PluginError) throw error;
      throw new PluginRuntimeError("Plugin 事务写入失败，已恢复原状态", {
        code: PLUGIN_RUNTIME_ERROR_CODES.TRANSACTION_FAILED,
        path: transactionRoot,
        cause: error,
      });
    }
  }

  /**
   * 校验项目根并返回真实路径。
   *
   * @returns {string} 项目根真实路径
   */
  #assertProjectRoot() {
    try {
      const stat = this.fileSystem.lstatSync(this.projectRoot);
      if (stat.isSymbolicLink()) throw new PluginPathError(`项目根不能是软链:${this.projectRoot}`);
      if (!stat.isDirectory()) throw new PluginPathError(`项目根必须是目录:${this.projectRoot}`);
      return this.fileSystem.realpathSync(this.projectRoot);
    } catch (error) {
      if (error instanceof PluginError) throw error;
      throw new PluginIoError(`无法读取 Plugin 项目根:${this.projectRoot}`, {
        path: this.projectRoot,
        cause: error,
      });
    }
  }

  /**
   * 解析并校验 mutation 目标边界。
   *
   * @param {string} realRoot 项目真实根
   * @param {string} relativeTarget POSIX 相对目标
   * @returns {string} 绝对目标
   */
  #resolveTarget(realRoot, relativeTarget) {
    const absolute = path.join(this.projectRoot, ...relativeTarget.split("/"));
    if (!isWithin(realRoot, path.resolve(absolute))) {
      throw new PluginPathError(`Plugin mutation 逃逸项目:${relativeTarget}`, { path: relativeTarget });
    }
    let current = this.projectRoot;
    const segments = relativeTarget.split("/");
    for (const segment of segments.slice(0, -1)) {
      current = path.join(current, segment);
      try {
        const stat = this.fileSystem.lstatSync(current);
        if (stat.isSymbolicLink()) {
          throw new PluginPathError(`Plugin 目标父目录不能是软链:${relativeTarget}`, {
            path: relativeTarget,
          });
        }
        if (!stat.isDirectory()) {
          throw new PluginPathError(`Plugin 目标父路径不是目录:${relativeTarget}`, {
            path: relativeTarget,
          });
        }
        if (!isWithin(realRoot, this.fileSystem.realpathSync(current))) {
          throw new PluginPathError(`Plugin 目标父目录逃逸项目:${relativeTarget}`, {
            path: relativeTarget,
          });
        }
      } catch (error) {
        if (error?.code === "ENOENT") break;
        throw error;
      }
    }
    return absolute;
  }

  /**
   * 创建目标父目录并拒绝软链边界。
   *
   * @param {string} realRoot 项目真实根
   * @param {string} absoluteTarget 目标绝对路径
   * @param {Set<string>} createdDirectories 本事务创建目录
   */
  #ensureTargetParent(realRoot, absoluteTarget, createdDirectories) {
    const relativeParent = path.relative(this.projectRoot, path.dirname(absoluteTarget));
    let current = this.projectRoot;
    for (const segment of relativeParent.split(path.sep).filter(Boolean)) {
      current = path.join(current, segment);
      try {
        const stat = this.fileSystem.lstatSync(current);
        if (stat.isSymbolicLink()) throw new PluginPathError(`Plugin 目标父目录不能是软链:${current}`);
        if (!stat.isDirectory()) throw new PluginPathError(`Plugin 目标父路径不是目录:${current}`);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
        this.fileSystem.mkdirSync(current);
        createdDirectories.add(current);
      }
      if (!isWithin(realRoot, this.fileSystem.realpathSync(current))) {
        throw new PluginPathError(`Plugin 目标父目录逃逸项目:${current}`);
      }
    }
  }

  /**
   * 原子替换普通文件。
   *
   * @param {string} target 目标绝对路径
   * @param {Buffer} content 新字节
   */
  #atomicWrite(target, content) {
    const temporary = path.join(
      path.dirname(target),
      `.${path.basename(target)}.${process.pid}.${this.randomBytes(6).toString("hex")}.tmp`,
    );
    let descriptor = null;
    try {
      descriptor = this.fileSystem.openSync(temporary, "wx", 0o600);
      this.fileSystem.writeFileSync(descriptor, content);
      this.fileSystem.fsyncSync(descriptor);
      this.fileSystem.closeSync(descriptor);
      descriptor = null;
      this.fileSystem.renameSync(temporary, target);
    } catch (error) {
      if (descriptor !== null) {
        try {
          this.fileSystem.closeSync(descriptor);
        } catch {
          // 保留原始写入错误。
        }
      }
      try {
        this.fileSystem.unlinkSync(temporary);
      } catch (cleanupError) {
        if (cleanupError?.code !== "ENOENT") throw cleanupError;
      }
      throw error;
    }
  }

  /**
   * 恢复备份或删除事务前不存在的目标。
   *
   * @param {{absolutePath?:string,absoluteTarget?:string,existed:boolean,backupPath:string}} backup 备份描述
   */
  #restoreBackup(backup) {
    const target = backup.absolutePath || backup.absoluteTarget;
    if (backup.existed) {
      this.#atomicWrite(target, this.fileSystem.readFileSync(backup.backupPath));
      return;
    }
    try {
      this.fileSystem.unlinkSync(target);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }

  /**
   * changed-only 写事务 manifest。
   *
   * @param {string} manifestPath manifest 路径
   * @param {object} value manifest 值
   */
  #writeTransactionManifest(manifestPath, value) {
    const content = stringifyCanonicalJson(value);
    let current = null;
    try {
      current = this.fileSystem.readFileSync(manifestPath, "utf8");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    if (current !== content) this.fileSystem.writeFileSync(manifestPath, content, "utf8");
  }
}
