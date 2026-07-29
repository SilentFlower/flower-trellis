import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  PluginError,
  PluginIoError,
  PluginPathError,
  PluginSchemaError,
  PluginStateError,
} from "../errors.js";
import { stringifyCanonicalJson } from "../integrity/canonical-json.js";
import {
  createEmptyPluginsFile,
  validatePluginLock,
  validatePluginsFile,
  validatePluginState,
} from "../schemas/project-files.js";

const FLOWER_DIR_NAME = ".flower";
const REQUIRED_IGNORE_RULES = ["state.json", "cache/", "transactions/", "*.tmp"];

/**
 * 判断 candidate 是否位于 root 内部或等于 root。
 *
 * @param {string} root 根目录真实路径
 * @param {string} candidate 候选真实路径
 * @returns {boolean} 是否位于边界内
 */
function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/**
 * `.flower/` 项目声明、锁和本机状态存储。
 */
export class ProjectStore {
  /**
   * 创建 Project Store。
   *
   * @param {string} projectRoot 目标项目根目录
   * @param {{fileSystem?:typeof fs,randomBytes?:(size:number)=>Buffer}} [options] 测试替换项
   */
  constructor(projectRoot, options = {}) {
    this.projectRoot = path.resolve(projectRoot);
    this.fileSystem = options.fileSystem || fs;
    this.randomBytes = options.randomBytes || crypto.randomBytes;
    this.flowerDir = path.join(this.projectRoot, FLOWER_DIR_NAME);
  }

  /**
   * 初始化 `.flower/`、局部忽略规则和本机目录。
   *
   * @returns {{flowerDir:string,gitignorePath:string,status:"written"|"unchanged"}} 初始化结果
   */
  ensureLayout() {
    const realRoot = this.#assertProjectRoot();
    this.#ensureManagedDirectory(this.flowerDir, realRoot, ".flower");
    this.#ensureManagedDirectory(path.join(this.flowerDir, "cache"), realRoot, ".flower/cache");
    this.#ensureManagedDirectory(
      path.join(this.flowerDir, "transactions"),
      realRoot,
      ".flower/transactions",
    );
    const gitignorePath = path.join(this.flowerDir, ".gitignore");
    const existing = this.#readTextIfExists(gitignorePath);
    const next = this.#mergeIgnoreRules(existing || "");
    const result = this.#atomicWriteText(gitignorePath, next);
    return { flowerDir: this.flowerDir, gitignorePath, status: result.status };
  }

  /**
   * 读取 `.flower/plugins.json`；文件缺失时返回空直接声明。
   *
   * @returns {import("../contracts.js").ProjectPluginsFile} 直接 Plugin 声明
   */
  readPlugins() {
    return /** @type {import("../contracts.js").ProjectPluginsFile} */ (
      this.#readJson("plugins.json", validatePluginsFile, createEmptyPluginsFile())
    );
  }

  /**
   * 原子写入 `.flower/plugins.json`。
   *
   * @param {unknown} value 直接 Plugin 声明
   * @returns {{status:"written"|"unchanged",path:string}} 写入结果
   */
  writePlugins(value) {
    return this.#writeJson("plugins.json", value, validatePluginsFile);
  }

  /**
   * 读取 `.flower/plugin-lock.json`；文件缺失时返回 null。
   *
   * @returns {import("../contracts.js").PluginLock|null} Plugin 锁文件
   */
  readLock() {
    return /** @type {import("../contracts.js").PluginLock|null} */ (
      this.#readJson("plugin-lock.json", validatePluginLock, null)
    );
  }

  /**
   * 原子写入 `.flower/plugin-lock.json`。
   *
   * @param {unknown} value Plugin 锁文件
   * @returns {{status:"written"|"unchanged",path:string}} 写入结果
   */
  writeLock(value) {
    return this.#writeJson("plugin-lock.json", value, validatePluginLock);
  }

  /**
   * 读取 `.flower/state.json`；文件缺失时返回 null。
   *
   * @returns {import("../contracts.js").PluginState|null} 本机应用状态
   */
  readState() {
    return /** @type {import("../contracts.js").PluginState|null} */ (
      this.#readJson("state.json", validatePluginState, null)
    );
  }

  /**
   * 原子写入 `.flower/state.json`。
   *
   * @param {unknown} value 本机应用状态
   * @returns {{status:"written"|"unchanged",path:string}} 写入结果
   */
  writeState(value) {
    return this.#writeJson("state.json", value, validatePluginState);
  }

  /**
   * 校验项目根并返回真实路径。
   *
   * @returns {string} 项目根真实路径
   */
  #assertProjectRoot() {
    try {
      const stat = this.fileSystem.lstatSync(this.projectRoot);
      if (stat.isSymbolicLink()) {
        throw new PluginPathError(`项目根不能是软链:${this.projectRoot}`, { path: this.projectRoot });
      }
      if (!stat.isDirectory()) {
        throw new PluginPathError(`项目根必须是目录:${this.projectRoot}`, { path: this.projectRoot });
      }
      return this.fileSystem.realpathSync(this.projectRoot);
    } catch (error) {
      if (error instanceof PluginError) throw error;
      throw new PluginIoError(`无法读取项目根:${this.projectRoot}`, {
        path: this.projectRoot,
        cause: error,
      });
    }
  }

  /**
   * 创建或校验受管目录，拒绝软链逃逸。
   *
   * @param {string} directory 目录绝对路径
   * @param {string} realRoot 项目根真实路径
   * @param {string} label 诊断标签
   */
  #ensureManagedDirectory(directory, realRoot, label) {
    try {
      try {
        const stat = this.fileSystem.lstatSync(directory);
        if (stat.isSymbolicLink()) throw new PluginPathError(`${label} 不能是软链`, { path: label });
        if (!stat.isDirectory()) throw new PluginPathError(`${label} 必须是目录`, { path: label });
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
        this.fileSystem.mkdirSync(directory, { recursive: true });
      }
      const realDirectory = this.fileSystem.realpathSync(directory);
      if (!isWithin(realRoot, realDirectory)) {
        throw new PluginPathError(`${label} 通过软链逃逸项目`, { path: label });
      }
    } catch (error) {
      if (error instanceof PluginError) throw error;
      throw new PluginIoError(`无法初始化 ${label}`, { path: label, cause: error });
    }
  }

  /**
   * 读取前校验项目根和既有 `.flower/` 目录，缺失目录保持只读且不创建。
   */
  #assertReadBoundary() {
    const realRoot = this.#assertProjectRoot();
    try {
      const stat = this.fileSystem.lstatSync(this.flowerDir);
      if (stat.isSymbolicLink()) {
        throw new PluginPathError(".flower 不能是软链", { path: ".flower" });
      }
      if (!stat.isDirectory()) {
        throw new PluginPathError(".flower 必须是目录", { path: ".flower" });
      }
      const realFlowerDir = this.fileSystem.realpathSync(this.flowerDir);
      if (!isWithin(realRoot, realFlowerDir)) {
        throw new PluginPathError(".flower 通过软链逃逸项目", { path: ".flower" });
      }
    } catch (error) {
      if (error?.code === "ENOENT") return;
      if (error instanceof PluginError) throw error;
      throw new PluginIoError("无法校验 .flower 读取边界", {
        path: this.flowerDir,
        cause: error,
      });
    }
  }

  /**
   * 读取 JSON 并只把 ENOENT 解释为缺失。
   *
   * @param {string} name `.flower/` 下固定文件名
   * @param {(value:unknown)=>unknown} validator schema validator
   * @param {unknown} missingValue 文件缺失时返回值
   * @returns {unknown} 已校验值或缺失默认值
   */
  #readJson(name, validator, missingValue) {
    this.#assertReadBoundary();
    const target = path.join(this.flowerDir, name);
    const text = this.#readTextIfExists(target);
    if (text === null) return missingValue;
    let value;
    try {
      value = JSON.parse(text);
    } catch (error) {
      throw new PluginStateError(`Plugin 状态 JSON 损坏:${name}`, { path: target, cause: error });
    }
    try {
      return validator(value);
    } catch (error) {
      if (error instanceof PluginSchemaError) {
        throw new PluginStateError(`Plugin 状态 schema 无效:${name}`, {
          path: target,
          issues: error.issues,
          cause: error,
        });
      }
      throw error;
    }
  }

  /**
   * 校验新旧 JSON 后执行 changed-only 原子写。
   *
   * @param {string} name `.flower/` 下固定文件名
   * @param {unknown} value 新值
   * @param {(value:unknown)=>unknown} validator schema validator
   * @returns {{status:"written"|"unchanged",path:string}} 写入结果
   */
  #writeJson(name, value, validator) {
    validator(value);
    this.ensureLayout();
    const target = path.join(this.flowerDir, name);
    if (this.#readTextIfExists(target) !== null) {
      // 先完整读取和校验旧状态，避免普通写入把损坏文件静默覆盖。
      this.#readJson(name, validator, null);
    }
    return this.#atomicWriteText(target, stringifyCanonicalJson(value));
  }

  /**
   * 读取受管普通文件；缺失时返回 null。
   *
   * @param {string} target 文件绝对路径
   * @returns {string|null} UTF-8 内容
   */
  #readTextIfExists(target) {
    try {
      const stat = this.fileSystem.lstatSync(target);
      if (stat.isSymbolicLink()) {
        throw new PluginPathError(`受管文件不能是软链:${target}`, { path: target });
      }
      if (!stat.isFile()) {
        throw new PluginPathError(`受管路径必须是普通文件:${target}`, { path: target });
      }
      return this.fileSystem.readFileSync(target, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      if (error instanceof PluginError) throw error;
      throw new PluginIoError(`无法读取受管文件:${target}`, { path: target, cause: error });
    }
  }

  /**
   * 合并局部 `.gitignore` 必需规则并保留用户内容。
   *
   * @param {string} current 当前内容
   * @returns {string} 幂等合并后的内容
   */
  #mergeIgnoreRules(current) {
    const normalized = current.replaceAll("\r\n", "\n");
    const lines = normalized.split("\n");
    const existing = new Set(lines.filter(Boolean));
    const missing = REQUIRED_IGNORE_RULES.filter((rule) => !existing.has(rule));
    if (missing.length === 0) return normalized.endsWith("\n") ? normalized : `${normalized}\n`;
    const prefix = normalized && !normalized.endsWith("\n") ? `${normalized}\n` : normalized;
    return `${prefix}${missing.join("\n")}\n`;
  }

  /**
   * 使用同目录临时文件和 rename 原子替换文本。
   *
   * @param {string} target 目标绝对路径
   * @param {string} content 新内容
   * @returns {{status:"written"|"unchanged",path:string}} 写入结果
   */
  #atomicWriteText(target, content) {
    const current = this.#readTextIfExists(target);
    if (current === content) return { status: "unchanged", path: target };
    const token = this.randomBytes(8).toString("hex");
    const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${token}.tmp`);
    let descriptor = null;
    try {
      descriptor = this.fileSystem.openSync(temporary, "wx", 0o600);
      this.fileSystem.writeFileSync(descriptor, content, "utf8");
      this.fileSystem.fsyncSync(descriptor);
      this.fileSystem.closeSync(descriptor);
      descriptor = null;
      this.fileSystem.renameSync(temporary, target);
      return { status: "written", path: target };
    } catch (error) {
      if (descriptor !== null) {
        try {
          this.fileSystem.closeSync(descriptor);
        } catch {
          // 原始错误更能说明失败原因，关闭失败只影响后续临时文件清理。
        }
      }
      try {
        this.fileSystem.unlinkSync(temporary);
      } catch (cleanupError) {
        if (cleanupError?.code !== "ENOENT") {
          throw new PluginIoError(`原子写失败且无法清理临时文件:${temporary}`, {
            path: target,
            cause: cleanupError,
          });
        }
      }
      throw new PluginIoError(`无法原子写入 Plugin 状态:${target}`, { path: target, cause: error });
    }
  }
}
