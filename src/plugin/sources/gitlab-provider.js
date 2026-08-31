import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PluginIntegrityError, PluginIoError, PluginPathError } from "../errors.js";
import { hashCanonicalTree } from "../integrity/canonical-tree.js";
import { PLUGIN_RUNTIME_ERROR_CODES, PluginRuntimeError } from "../runtime-errors.js";
import { validateMarketplaceManifest } from "../schemas/marketplace-manifest.js";
import { validatePluginManifest } from "../schemas/plugin-manifest.js";
import {
  assertSafePosixRelativePath,
  composeCanonicalPluginId,
  parseCanonicalPluginId,
} from "../schemas/shared.js";
import { compareUtf8 } from "../stable-order.js";
import { PLUGIN_MANIFEST_FILE, verifyPluginPackage } from "./package-reader.js";
import {
  copyOrdinaryDirectory,
  extractRemoteArchive,
  REMOTE_PACKAGE_LIMITS,
} from "./remote-archive.js";

const PROFILE_RANK = Object.freeze({ standard: 0, integration: 1, system: 2 });
const RD_GUIDE_SOURCE_ID = "rd-guide";
const RD_GUIDE_PROJECT = "digital-rd-governance/rd-guide";
const LEGACY_RD_GUIDE_MARKETPLACE_PATH = ".flower-marketplace/marketplace.json";

/**
 * GitLab Marketplace Provider；网络阶段由 prepare() 显式触发。
 */
export class GitLabSourceProvider {
  /**
   * 创建 GitLab Provider。
   *
   * @param {{source:object,projectRoot:string,client:object,cacheRoot?:string,extractArchive?:Function}} options 依赖
   */
  constructor(options) {
    this.id = options.source.id;
    this.type = "gitlab";
    this.source = options.source;
    this.projectRoot = path.resolve(options.projectRoot);
    this.client = options.client;
    this.cacheRoot = options.cacheRoot || path.join(this.projectRoot, ".flower", "cache", "gitlab");
    this.extractArchive = options.extractArchive;
    this.index = null;
    this.indexCommit = null;
    this.candidates = new Map();
    this.packageRoots = new Map();
    this.preparedIds = new Set();
    this.preparing = new Set();
  }

  /**
   * 拉取并验证 Marketplace 索引。
   *
   * @returns {Promise<import("../contracts.js").MarketplaceManifest>} Marketplace
   */
  async prepareIndex() {
    if (this.index) return this.index;
    const commit = await this.client.resolveCommit(this.source.project, this.source.ref);
    const raw = await this.client.readRawFile(this.source.project, this.source.marketplacePath, commit);
    let value;
    try {
      value = JSON.parse(raw);
    } catch (error) {
      throw new PluginRuntimeError(`Marketplace JSON 无效:${this.id}`, {
        code: PLUGIN_RUNTIME_ERROR_CODES.SOURCE_CONFIG_INVALID,
        path: this.id,
        cause: error,
      });
    }
    const marketplace = validateMarketplaceManifest(value);
    if (marketplace.id !== this.id) {
      throw new PluginRuntimeError(`Marketplace ID 与 source 不一致:${marketplace.id}`, {
        code: PLUGIN_RUNTIME_ERROR_CODES.SOURCE_CONFIG_INVALID,
        path: this.id,
      });
    }
    this.index = marketplace;
    this.indexCommit = commit;
    return marketplace;
  }

  /**
   * 异步准备一个 Plugin 及其依赖闭包的固定包。
   *
   * @param {string} canonicalId canonical Plugin ID
   * @returns {Promise<void>} 准备完成
   */
  async prepare(canonicalId) {
    if (this.preparedIds.has(canonicalId) || this.preparing.has(canonicalId)) return;
    const { sourceId, pluginId } = parseCanonicalPluginId(canonicalId);
    if (sourceId !== this.id) return;
    this.preparing.add(canonicalId);
    try {
      const marketplace = await this.prepareIndex();
      const entry = marketplace.plugins.find((plugin) => plugin.id === pluginId);
      if (!entry) {
        throw new PluginRuntimeError(`Marketplace 中不存在 Plugin:${canonicalId}`, {
          code: PLUGIN_RUNTIME_ERROR_CODES.SOURCE_NOT_FOUND,
          path: canonicalId,
        });
      }
      const candidates = [];
      for (const version of entry.versions) {
        const root = await this.#preparePackage(entry.source, version);
        const manifest = this.#readPackageManifest(root);
        const candidate = this.#candidateFromMarketplaceVersion(canonicalId, entry, version, manifest);
        candidates.push(candidate);
        this.#registerCandidate(candidate, root);
      }
      this.preparedIds.add(canonicalId);
      const dependencies = new Set(candidates.flatMap((candidate) => Object.keys(candidate.manifest.dependencies || {})));
      for (const dependency of [...dependencies].sort(compareUtf8)) await this.prepare(dependency);
    } finally {
      this.preparing.delete(canonicalId);
    }
  }

  /**
   * 只准备指定版本的固定包。
   *
   * TUI 读取 Skill 清单只需要一个已选版本；完整 add/update 生命周期仍调用 `prepare()`，
   * 继续准备全部候选和依赖闭包。
   *
   * @param {string} canonicalId canonical Plugin ID
   * @param {string} requestedVersion 需要读取的 Plugin 版本
   * @returns {Promise<void>} 准备完成
   */
  async prepareVersion(canonicalId, requestedVersion) {
    const { sourceId, pluginId } = parseCanonicalPluginId(canonicalId);
    if (sourceId !== this.id) return;
    const existing = this.candidates.get(canonicalId)
      ?.find((candidate) => candidate.version === requestedVersion);
    if (existing && this.packageRoots.has(this.#key(existing))) return;

    const marketplace = await this.prepareIndex();
    const entry = marketplace.plugins.find((plugin) => plugin.id === pluginId);
    const version = entry?.versions.find((candidate) => candidate.version === requestedVersion);
    if (!entry || !version) {
      throw new PluginRuntimeError(`Marketplace Plugin 版本不存在:${canonicalId}@${requestedVersion}`, {
        code: PLUGIN_RUNTIME_ERROR_CODES.SOURCE_NOT_FOUND,
        path: canonicalId,
      });
    }
    const root = await this.#preparePackage(entry.source, version);
    const manifest = this.#readPackageManifest(root);
    const candidate = this.#candidateFromMarketplaceVersion(canonicalId, entry, version, manifest);
    this.#registerCandidate(candidate, root);
  }

  /**
   * 为 TUI inspection 只读取指定版本的 manifest。
   *
   * @param {string} canonicalId canonical Plugin ID
   * @param {{version?:string|null,lockedPlugin?:import("../contracts.js").ResolvedPlugin|null}} [options] inspection 选项
   * @returns {Promise<import("../contracts.js").PluginCandidate|null>} manifest 元数据候选
   */
  async inspectContentManifest(canonicalId, options = {}) {
    const { sourceId, pluginId } = parseCanonicalPluginId(canonicalId);
    if (sourceId !== this.id) return null;
    const lockedPlugin = options.lockedPlugin || null;
    const requestedVersion = options.version || lockedPlugin?.version;
    if (!requestedVersion) {
      throw new PluginRuntimeError(`读取 GitLab Plugin manifest 需要版本:${canonicalId}`, {
        code: PLUGIN_RUNTIME_ERROR_CODES.USAGE_ERROR,
        path: canonicalId,
      });
    }

    const inspected = lockedPlugin
      ? await this.#lockedMarketplaceVersionForInspection(pluginId, lockedPlugin)
      : await this.#marketplaceVersionForInspection(pluginId, requestedVersion);
    const manifest = await this.#readRepositoryManifest(
      inspected.entry.source,
      inspected.version.commit.toLowerCase(),
      canonicalId,
    );
    const candidate = this.#candidateFromMarketplaceVersion(
      canonicalId,
      inspected.entry,
      inspected.version,
      manifest,
      inspected.indexCommit,
      inspected.indexPath,
    );
    if (lockedPlugin) this.#assertLockedInspectionMatches(lockedPlugin, candidate);
    return candidate;
  }

  /**
   * 从 lock 恢复固定缓存；缓存缺失时再回退到远程准备。
   *
   * @param {import("../contracts.js").ResolvedPlugin} plugin 已锁定 Plugin
   * @returns {Promise<void>} 恢复完成
   */
  async prepareLocked(plugin) {
    if (this.packageRoots.has(this.#key(plugin))) return;
    const indexPath = this.#lockedMarketplacePath(plugin);
    const cached = this.#findCachedPackage(plugin);
    if (cached) {
      this.#registerLockedCandidate(plugin, cached.root, cached.manifest, "standard");
      return;
    }
    const raw = await this.client.readRawFile(
      this.source.project,
      indexPath,
      plugin.source.indexCommit,
    );
    let marketplace;
    try {
      marketplace = validateMarketplaceManifest(JSON.parse(raw));
    } catch (error) {
      throw new PluginRuntimeError(`锁定 Marketplace index 无效:${plugin.id}`, {
        code: PLUGIN_RUNTIME_ERROR_CODES.SOURCE_CONFIG_INVALID,
        path: plugin.id,
        cause: error,
      });
    }
    if (marketplace.id !== this.id) {
      throw new PluginRuntimeError(`锁定 Marketplace ID 与 source 不一致:${plugin.id}`, {
        code: PLUGIN_RUNTIME_ERROR_CODES.SOURCE_CONFIG_INVALID,
        path: plugin.id,
      });
    }
    const { pluginId } = parseCanonicalPluginId(plugin.id);
    const entry = marketplace.plugins.find((candidate) => candidate.id === pluginId);
    const version = entry?.versions.find((candidate) => (
      candidate.version === plugin.version &&
      candidate.commit.toLowerCase() === plugin.commit &&
      candidate.integrity === plugin.integrity
    ));
    if (!entry || !version) {
      throw new PluginRuntimeError(`锁定 Marketplace index 不包含 Plugin:${plugin.id}@${plugin.version}`, {
        code: PLUGIN_RUNTIME_ERROR_CODES.SOURCE_NOT_FOUND,
        path: plugin.id,
      });
    }
    const expectedProject = this.#sourceProject(entry.source);
    if (plugin.source.reference !== expectedProject) {
      throw new PluginRuntimeError(`GitLab lock project 与 Marketplace 不一致:${plugin.id}`, {
        code: PLUGIN_RUNTIME_ERROR_CODES.TARGET_DRIFT,
        path: plugin.id,
      });
    }
    const root = await this.#preparePackage(entry.source, version);
    let manifest;
    try {
      manifest = this.#readPackageManifest(root);
      if (composeCanonicalPluginId(this.id, manifest.id) !== plugin.id || manifest.version !== plugin.version) {
        throw new PluginIntegrityError("GitLab Plugin 缓存身份不匹配", { path: this.id });
      }
      if (PROFILE_RANK[manifest.capabilities.profile] > PROFILE_RANK[entry.trust.maxProfile]) {
        throw new PluginIntegrityError("GitLab Plugin 超出 Marketplace trust 上限", { path: this.id });
      }
    } catch (error) {
      throw new PluginRuntimeError(`GitLab Plugin 缓存无效:${plugin.id}@${plugin.version}`, {
        code: error?.code || PLUGIN_RUNTIME_ERROR_CODES.TARGET_DRIFT,
        path: plugin.id,
        cause: error,
      });
    }
    this.#registerLockedCandidate(plugin, root, manifest, entry.trust.maxProfile);
  }

  /**
   * 搜索 Marketplace 元数据。
   *
   * @param {string} [query] 关键词
   * @returns {Promise<object[]>} 搜索结果
   */
  async search(query = "") {
    const marketplace = await this.prepareIndex();
    const needle = query.trim().toLowerCase();
    return marketplace.plugins
      .filter((plugin) => !needle || plugin.id.includes(needle) || plugin.description.toLowerCase().includes(needle))
      .map((plugin) => ({
        id: composeCanonicalPluginId(this.id, plugin.id),
        description: plugin.description,
        versions: plugin.versions.map(({ version }) => version),
        source: this.id,
      }));
  }

  /**
   * 返回已准备的同步候选。
   *
   * @param {string} canonicalId canonical Plugin ID
   * @returns {import("../contracts.js").PluginCandidate[]} 候选列表
   */
  listCandidates(canonicalId) {
    const candidates = this.candidates.get(canonicalId);
    if (!candidates) {
      throw new PluginRuntimeError(`远程 Plugin 尚未准备:${canonicalId}`, {
        code: PLUGIN_RUNTIME_ERROR_CODES.SOURCE_NOT_FOUND,
        path: canonicalId,
      });
    }
    return candidates;
  }

  /**
   * 读取并复核已缓存固定包。
   *
   * @param {import("../contracts.js").PluginCandidate|import("../contracts.js").ResolvedPlugin} plugin Plugin 身份
   * @returns {{root:string,manifest:import("../contracts.js").PluginManifest,integrity:string}} 固定包
   */
  readPackage(plugin) {
    const root = this.packageRoots.get(this.#key(plugin));
    if (!root) {
      throw new PluginRuntimeError(`远程 Plugin 缓存不存在:${plugin.id}@${plugin.version}`, {
        code: PLUGIN_RUNTIME_ERROR_CODES.SOURCE_NOT_FOUND,
        path: plugin.id,
      });
    }
    try {
      return verifyPluginPackage(plugin, root);
    } catch (error) {
      throw new PluginRuntimeError(`远程 Plugin 固定包校验失败:${plugin.id}@${plugin.version}`, {
        code: error?.code || PLUGIN_RUNTIME_ERROR_CODES.TARGET_DRIFT,
        path: plugin.id,
        cause: error,
      });
    }
  }

  /** @param {object} source @param {object} version @returns {Promise<string>} */
  async #preparePackage(source, version) {
    const project = this.#sourceProject(source);
    const subdir = this.#sourceSubdir(source);
    const manifestPath = this.#manifestPath(source);
    const commit = version.commit.toLowerCase();
    const target = this.#cacheTarget(project, commit, subdir, manifestPath, version.integrity);
    const key = path.basename(target);
    if (fs.existsSync(target)) {
      try {
        if (hashCanonicalTree(target) !== version.integrity) {
          throw new PluginIntegrityError("GitLab Plugin 缓存摘要不匹配", { path: this.id });
        }
        this.#writeCacheMetadata(target, { project, commit, subdir, manifestPath, integrity: version.integrity });
        return target;
      } catch (error) {
        // 缓存只按不可变哈希键寻址，损坏后删除并重建不会影响 lock 或项目目标。
        fs.rmSync(target, { recursive: true, force: true });
        fs.rmSync(this.#cacheMetadataPath(target), { force: true });
      }
    }
    fs.mkdirSync(this.cacheRoot, { recursive: true });
    const staging = fs.mkdtempSync(path.join(this.cacheRoot, `.staging-${key.slice(0, 12)}-`));
    const archiveFile = path.join(staging, "archive.tar.gz");
    const extractRoot = path.join(staging, "extract");
    const snapshotRoot = path.join(staging, "snapshot");
    const packageRoot = path.join(staging, "package");
    try {
      fs.mkdirSync(extractRoot);
      try {
        fs.writeFileSync(archiveFile, await this.client.downloadArchive(project, commit));
        const { selectedRoot } = await extractRemoteArchive({
          archiveFile,
          extractRoot,
          subdir,
          label: "GitLab Plugin",
          sourceId: this.id,
          extractArchive: this.extractArchive,
        });
        copyOrdinaryDirectory(selectedRoot, snapshotRoot, "GitLab Plugin");
      } catch (error) {
        if (!this.#canFallbackToRepositoryTree(error)) throw error;
        await this.#materializeRepositoryTree(project, commit, subdir, snapshotRoot);
      }
      this.#buildRuntimePackage(snapshotRoot, packageRoot, source);
      const integrity = hashCanonicalTree(packageRoot);
      if (integrity !== version.integrity) {
        throw new PluginIntegrityError(`GitLab Plugin 摘要不匹配:${version.version}`, { path: this.id });
      }
      try {
        fs.renameSync(packageRoot, target);
      } catch (error) {
        if (!fs.existsSync(target)) throw error;
        try {
          if (hashCanonicalTree(target) !== version.integrity) throw error;
        } catch {
          fs.rmSync(target, { recursive: true, force: true });
          fs.renameSync(packageRoot, target);
        }
      }
      this.#writeCacheMetadata(target, { project, commit, subdir, manifestPath, integrity: version.integrity });
      return target;
    } catch (error) {
      if (error instanceof PluginRuntimeError) throw error;
      if (error instanceof PluginIntegrityError || error instanceof PluginPathError) {
        throw new PluginRuntimeError(`GitLab Plugin 包校验失败:${this.id}@${version.version}`, {
          code: error.code,
          path: this.id,
          cause: error,
        });
      }
      throw new PluginIoError(`无法准备 GitLab Plugin:${this.id}`, { path: this.id, cause: error });
    } finally {
      fs.rmSync(staging, { recursive: true, force: true });
    }
  }

  /** @param {unknown} error @returns {boolean} */
  #canFallbackToRepositoryTree(error) {
    return (
      error?.code === PLUGIN_RUNTIME_ERROR_CODES.REMOTE_REQUEST_FAILED &&
      error?.details?.status === 406 &&
      typeof this.client.readRepositoryTree === "function" &&
      typeof this.client.readRawBuffer === "function"
    );
  }

  /**
   * 在 GitLab archive 对 OAuth 返回 406 时，用固定 commit 的 tree/raw API 重建选中目录。
   *
   * @param {string} project GitLab project path
   * @param {string} commit 固定 commit
   * @param {string|null} subdir 选中的仓库子目录
   * @param {string} target 目标目录
   * @returns {Promise<void>} 完成信号
   */
  async #materializeRepositoryTree(project, commit, subdir, target) {
    const normalizedSubdir = subdir
      ? assertSafePosixRelativePath(subdir, "GitLab Plugin subdir")
      : null;
    const entries = await this.client.readRepositoryTree(project, {
      ref: commit,
      ...(normalizedSubdir ? { path: normalizedSubdir } : {}),
    });
    if (!Array.isArray(entries) || entries.length === 0 || entries.length > REMOTE_PACKAGE_LIMITS.maxEntries) {
      throw new PluginRuntimeError("GitLab Plugin repository tree 无效或超过条目限制", {
        code: PLUGIN_RUNTIME_ERROR_CODES.REMOTE_ARCHIVE_INVALID,
        path: this.id,
      });
    }
    const prefix = normalizedSubdir ? `${normalizedSubdir}/` : "";
    const paths = new Set();
    let totalBytes = 0;
    fs.mkdirSync(target, { recursive: true });
    for (const entry of entries.sort((left, right) => compareUtf8(String(left.path), String(right.path)))) {
      const repositoryPath = assertSafePosixRelativePath(entry?.path, "GitLab repository tree 路径");
      if (prefix && !repositoryPath.startsWith(prefix)) {
        throw new PluginRuntimeError(`GitLab Plugin tree 条目逃逸选中目录:${repositoryPath}`, {
          code: PLUGIN_RUNTIME_ERROR_CODES.REMOTE_ARCHIVE_INVALID,
          path: this.id,
        });
      }
      const relativePath = assertSafePosixRelativePath(
        prefix ? repositoryPath.slice(prefix.length) : repositoryPath,
        "GitLab Plugin tree 路径",
      );
      if (paths.has(relativePath)) {
        throw new PluginRuntimeError(`GitLab Plugin tree 包含重复路径:${relativePath}`, {
          code: PLUGIN_RUNTIME_ERROR_CODES.REMOTE_ARCHIVE_INVALID,
          path: this.id,
        });
      }
      paths.add(relativePath);
      const destination = path.join(target, ...relativePath.split("/"));
      if (entry.type === "tree" && entry.mode === "040000") {
        fs.mkdirSync(destination, { recursive: true });
        continue;
      }
      if (entry.type !== "blob" || !["100644", "100755"].includes(entry.mode)) {
        throw new PluginRuntimeError(`GitLab Plugin tree 包含不安全条目:${repositoryPath}`, {
          code: PLUGIN_RUNTIME_ERROR_CODES.REMOTE_ARCHIVE_INVALID,
          path: this.id,
        });
      }
      const content = await this.client.readRawBuffer(project, repositoryPath, commit);
      if (!Buffer.isBuffer(content) || content.length > REMOTE_PACKAGE_LIMITS.maxEntryBytes) {
        throw new PluginRuntimeError(`GitLab Plugin 文件超过大小限制:${repositoryPath}`, {
          code: PLUGIN_RUNTIME_ERROR_CODES.REMOTE_ARCHIVE_INVALID,
          path: this.id,
        });
      }
      totalBytes += content.length;
      if (totalBytes > REMOTE_PACKAGE_LIMITS.maxExtractedBytes) {
        throw new PluginRuntimeError("GitLab Plugin repository tree 超过总大小限制", {
          code: PLUGIN_RUNTIME_ERROR_CODES.REMOTE_ARCHIVE_INVALID,
          path: this.id,
        });
      }
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, content, { mode: entry.mode === "100755" ? 0o755 : 0o644 });
    }
  }

  /** @param {object} source @returns {string} */
  #sourceReference(source) {
    return this.#sourceProject(source);
  }

  /** @param {object} source @returns {string} */
  #sourceProject(source) {
    if (source.type === "path") return this.source.project;
    if (source.type === "gitlab") return source.project;
    throw new PluginRuntimeError(`GitLab Marketplace 暂不支持跨接来源:${source.type}`, {
      code: PLUGIN_RUNTIME_ERROR_CODES.FORMAT_UNSUPPORTED,
      path: this.id,
    });
  }

  /** @param {object} source @returns {string|null} */
  #sourceSubdir(source) {
    if (source.type === "path") return source.path || null;
    return source.subdir || null;
  }

  /** @param {object} source @returns {string} */
  #manifestPath(source) {
    return assertSafePosixRelativePath(
      source.manifestPath || PLUGIN_MANIFEST_FILE,
      "GitLab Plugin manifest 路径",
    );
  }

  /** @param {object} source @returns {string} */
  #repositoryManifestPath(source) {
    const manifestPath = this.#manifestPath(source);
    const subdir = this.#sourceSubdir(source);
    if (!subdir) return manifestPath;
    return `${assertSafePosixRelativePath(subdir, "GitLab Plugin subdir")}/${manifestPath}`;
  }

  /** @param {string} root @returns {import("../contracts.js").PluginManifest} */
  #readPackageManifest(root) {
    return validatePluginManifest(JSON.parse(fs.readFileSync(path.join(root, PLUGIN_MANIFEST_FILE), "utf8")));
  }

  /** @param {string} root @param {object} source @returns {{manifest:import("../contracts.js").PluginManifest,raw:string}} */
  #readSourceManifest(root, source) {
    const manifestPath = this.#manifestPath(source);
    const raw = fs.readFileSync(path.join(root, ...manifestPath.split("/")), "utf8");
    return { manifest: validatePluginManifest(JSON.parse(raw)), raw };
  }

  /** @param {import("../contracts.js").PluginManifest} manifest @returns {string[]} */
  #declaredPackagePaths(manifest) {
    const content = manifest.content || {};
    const skills = (content.skills || []).map(({ path: skillPath }) => skillPath);
    const passive = ["specs", "assets", "scripts", "tests"].flatMap((kind) => content[kind] || []);
    const patches = [
      manifest.patches?.catalog,
      manifest.patches?.bundles,
    ].filter(Boolean);
    return [...new Set([...skills, ...passive, ...patches])].sort(compareUtf8);
  }

  /** @param {string} sourceRoot @param {string} targetRoot @param {string} relative @returns {void} */
  #copyDeclaredPath(sourceRoot, targetRoot, relative) {
    const safeRelative = assertSafePosixRelativePath(relative, "GitLab Plugin content 路径");
    const source = path.join(sourceRoot, ...safeRelative.split("/"));
    const target = path.join(targetRoot, ...safeRelative.split("/"));
    let stat;
    try {
      stat = fs.lstatSync(source);
    } catch (error) {
      throw new PluginIoError(`GitLab Plugin 声明内容不存在:${safeRelative}`, {
        path: safeRelative,
        cause: error,
      });
    }
    if (stat.isSymbolicLink()) {
      throw new PluginPathError(`GitLab Plugin 声明内容不能是软链:${safeRelative}`, { path: safeRelative });
    }
    if (stat.isDirectory()) {
      copyOrdinaryDirectory(source, target, "GitLab Plugin content");
      return;
    }
    if (!stat.isFile()) {
      throw new PluginPathError(`GitLab Plugin 声明内容必须是普通文件或目录:${safeRelative}`, {
        path: safeRelative,
      });
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }

  /** @param {string} sourceRoot @param {string} targetRoot @param {import("../contracts.js").PluginManifest} manifest @returns {void} */
  #copyPlatformOverrides(sourceRoot, targetRoot, manifest) {
    const platformsRoot = path.join(sourceRoot, "platforms");
    if (!fs.existsSync(platformsRoot)) return;
    for (const platform of fs.readdirSync(platformsRoot, { withFileTypes: true }).sort((left, right) => compareUtf8(left.name, right.name))) {
      if (!platform.isDirectory()) continue;
      for (const relative of this.#declaredPackagePaths(manifest)) {
        const override = `platforms/${platform.name}/${relative}`;
        if (fs.existsSync(path.join(sourceRoot, ...override.split("/")))) {
          this.#copyDeclaredPath(sourceRoot, targetRoot, override);
        }
      }
    }
  }

  /** @param {string} sourceRoot @param {string} targetRoot @param {object} source @returns {import("../contracts.js").PluginManifest} */
  #buildRuntimePackage(sourceRoot, targetRoot, source) {
    const { manifest, raw } = this.#readSourceManifest(sourceRoot, source);
    fs.mkdirSync(targetRoot, { recursive: true });
    fs.writeFileSync(path.join(targetRoot, PLUGIN_MANIFEST_FILE), raw);
    for (const relative of this.#declaredPackagePaths(manifest)) {
      this.#copyDeclaredPath(sourceRoot, targetRoot, relative);
    }
    this.#copyPlatformOverrides(sourceRoot, targetRoot, manifest);
    return manifest;
  }

  /**
   * 读取固定 commit 上的原始 manifest，不准备运行时包。
   *
   * @param {object} source Marketplace source 条目
   * @param {string} commit 固定 Plugin commit
   * @param {string} canonicalId 诊断用 canonical Plugin ID
   * @returns {Promise<import("../contracts.js").PluginManifest>} 已校验 manifest
   */
  async #readRepositoryManifest(source, commit, canonicalId) {
    const project = this.#sourceProject(source);
    const manifestPath = this.#repositoryManifestPath(source);
    const raw = await this.client.readRawFile(project, manifestPath, commit);
    try {
      return validatePluginManifest(JSON.parse(raw));
    } catch (error) {
      throw new PluginRuntimeError(`GitLab Plugin manifest 无效:${canonicalId}`, {
        code: error?.code || PLUGIN_RUNTIME_ERROR_CODES.SOURCE_CONFIG_INVALID,
        path: canonicalId,
        cause: error,
      });
    }
  }

  /**
   * 从当前 Marketplace 中定位 inspection 版本。
   *
   * @param {string} pluginId Plugin 本地 ID
   * @param {string} requestedVersion 请求版本
   * @returns {Promise<{entry:object,version:object,indexCommit:string,indexPath:string}>} Marketplace 版本上下文
   */
  async #marketplaceVersionForInspection(pluginId, requestedVersion) {
    const marketplace = await this.prepareIndex();
    const entry = marketplace.plugins.find((plugin) => plugin.id === pluginId);
    const version = entry?.versions.find((candidate) => candidate.version === requestedVersion);
    if (!entry || !version) {
      throw new PluginRuntimeError(`Marketplace Plugin 版本不存在:${this.id}/${pluginId}@${requestedVersion}`, {
        code: PLUGIN_RUNTIME_ERROR_CODES.SOURCE_NOT_FOUND,
        path: `${this.id}/${pluginId}`,
      });
    }
    return { entry, version, indexCommit: this.indexCommit, indexPath: this.source.marketplacePath };
  }

  /**
   * 从锁定 Marketplace 中定位 inspection 版本。
   *
   * @param {string} pluginId Plugin 本地 ID
   * @param {import("../contracts.js").ResolvedPlugin} plugin 已锁定 Plugin
   * @returns {Promise<{entry:object,version:object,indexCommit:string,indexPath:string}>} Marketplace 版本上下文
   */
  async #lockedMarketplaceVersionForInspection(pluginId, plugin) {
    const indexPath = this.#lockedMarketplacePath(plugin);
    const raw = await this.client.readRawFile(
      this.source.project,
      indexPath,
      plugin.source.indexCommit,
    );
    let marketplace;
    try {
      marketplace = validateMarketplaceManifest(JSON.parse(raw));
    } catch (error) {
      throw new PluginRuntimeError(`锁定 Marketplace index 无效:${plugin.id}`, {
        code: PLUGIN_RUNTIME_ERROR_CODES.SOURCE_CONFIG_INVALID,
        path: plugin.id,
        cause: error,
      });
    }
    if (marketplace.id !== this.id) {
      throw new PluginRuntimeError(`锁定 Marketplace ID 与 source 不一致:${plugin.id}`, {
        code: PLUGIN_RUNTIME_ERROR_CODES.SOURCE_CONFIG_INVALID,
        path: plugin.id,
      });
    }
    const entry = marketplace.plugins.find((candidate) => candidate.id === pluginId);
    const version = entry?.versions.find((candidate) => (
      candidate.version === plugin.version &&
      candidate.commit.toLowerCase() === plugin.commit.toLowerCase() &&
      candidate.integrity === plugin.integrity
    ));
    if (!entry || !version) {
      throw new PluginRuntimeError(`锁定 Marketplace index 不包含 Plugin:${plugin.id}@${plugin.version}`, {
        code: PLUGIN_RUNTIME_ERROR_CODES.SOURCE_NOT_FOUND,
        path: plugin.id,
      });
    }
    return { entry, version, indexCommit: plugin.source.indexCommit, indexPath };
  }

  /**
   * 确认 manifest-only 读取到的锁定身份没有漂移。
   *
   * @param {import("../contracts.js").ResolvedPlugin} lockedPlugin 已锁定 Plugin
   * @param {import("../contracts.js").PluginCandidate} candidate inspection 候选
   * @returns {void}
   */
  #assertLockedInspectionMatches(lockedPlugin, candidate) {
    if (
      lockedPlugin.id !== candidate.id ||
      lockedPlugin.version !== candidate.version ||
      lockedPlugin.commit.toLowerCase() !== candidate.commit ||
      lockedPlugin.integrity !== candidate.integrity ||
      lockedPlugin.source.reference !== candidate.source.reference ||
      lockedPlugin.source.indexCommit !== candidate.source.indexCommit ||
      this.#lockedMarketplacePath(lockedPlugin) !== candidate.source.indexPath
    ) {
      throw new PluginRuntimeError(`GitLab lock 与 Marketplace 不一致:${lockedPlugin.id}`, {
        code: PLUGIN_RUNTIME_ERROR_CODES.TARGET_DRIFT,
        path: lockedPlugin.id,
      });
    }
  }

  /**
   * 从 Marketplace version 和固定包 manifest 构造候选。
   *
   * @param {string} canonicalId canonical Plugin ID
   * @param {object} entry Marketplace Plugin 条目
   * @param {object} version Marketplace 版本条目
   * @param {object} manifest 已校验 Plugin manifest
   * @param {string} [indexCommit] Marketplace index commit
   * @param {string} [indexPath] Marketplace index path
   * @returns {import("../contracts.js").PluginCandidate} Provider 候选
   */
  #candidateFromMarketplaceVersion(
    canonicalId,
    entry,
    version,
    manifest,
    indexCommit = this.indexCommit,
    indexPath = this.source.marketplacePath,
  ) {
    const id = composeCanonicalPluginId(this.id, manifest.id);
    if (id !== canonicalId || manifest.version !== version.version) {
      throw new PluginRuntimeError(`远程 Plugin 身份与索引不一致:${canonicalId}@${version.version}`, {
        code: PLUGIN_RUNTIME_ERROR_CODES.TARGET_DRIFT,
        path: canonicalId,
      });
    }
    if (PROFILE_RANK[manifest.capabilities.profile] > PROFILE_RANK[entry.trust.maxProfile]) {
      throw new PluginRuntimeError(`远程 Plugin 超出 Marketplace trust 上限:${canonicalId}`, {
        code: PLUGIN_RUNTIME_ERROR_CODES.SOURCE_CONFIG_INVALID,
        path: canonicalId,
      });
    }
    return {
      id,
      version: manifest.version,
      source: {
        id: this.id,
        type: "gitlab",
        reference: this.#sourceReference(entry.source),
        indexCommit,
        indexPath: assertSafePosixRelativePath(indexPath, "Marketplace index path"),
      },
      commit: version.commit.toLowerCase(),
      integrity: version.integrity,
      manifest,
      marketplaceMaxProfile: entry.trust.maxProfile,
    };
  }

  /** @param {import("../contracts.js").ResolvedPlugin} plugin @returns {{root:string,manifest:object}|null} */
  #findCachedPackage(plugin) {
    if (!fs.existsSync(this.cacheRoot)) return null;
    let entries;
    try {
      entries = fs.readdirSync(this.cacheRoot, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const entry of entries.sort((left, right) => compareUtf8(left.name, right.name))) {
      if (!entry.isDirectory() || entry.name.startsWith(".staging-")) continue;
      const root = path.join(this.cacheRoot, entry.name);
      try {
        const metadata = JSON.parse(fs.readFileSync(this.#cacheMetadataPath(root), "utf8"));
        if (
          metadata.schemaVersion !== 1 ||
          metadata.sourceId !== this.id ||
          metadata.baseUrl !== this.source.baseUrl ||
          metadata.project !== plugin.source.reference ||
          metadata.commit !== plugin.commit.toLowerCase() ||
          metadata.integrity !== plugin.integrity
        ) continue;
        if (hashCanonicalTree(root) !== plugin.integrity) continue;
        const manifest = this.#readPackageManifest(root);
        if (composeCanonicalPluginId(this.id, manifest.id) === plugin.id && manifest.version === plugin.version) {
          return { root, manifest };
        }
      } catch {
        // 其它缓存项损坏不应阻断当前锁定包的查找。
      }
    }
    return null;
  }

  /** @param {string} target @returns {string} */
  #cacheMetadataPath(target) {
    return `${target}.metadata.json`;
  }

  /** @param {string} target @param {{project:string,commit:string,subdir:string|null,manifestPath:string,integrity:string}} metadata */
  #writeCacheMetadata(target, metadata) {
    const metadataPath = this.#cacheMetadataPath(target);
    const temporary = `${metadataPath}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(temporary, `${JSON.stringify({
        schemaVersion: 1,
        sourceId: this.id,
        baseUrl: this.source.baseUrl,
        project: metadata.project,
        commit: metadata.commit,
        subdir: metadata.subdir,
        manifestPath: metadata.manifestPath,
        integrity: metadata.integrity,
      }, null, 2)}\n`, { mode: 0o600 });
      fs.renameSync(temporary, metadataPath);
    } catch (error) {
      fs.rmSync(temporary, { force: true });
      throw new PluginIoError(`无法写入 GitLab Plugin 缓存元数据:${this.id}`, {
        path: this.id,
        cause: error,
      });
    }
  }

  /**
   * 登记从 lock 恢复的固定候选。
   *
   * @param {import("../contracts.js").ResolvedPlugin} plugin 锁定身份
   * @param {string} root 固定包根
   * @param {object} manifest 已校验 manifest
   * @param {"standard"|"integration"} marketplaceMaxProfile Marketplace 来源上限
   */
  #registerLockedCandidate(plugin, root, manifest, marketplaceMaxProfile) {
    const candidate = {
      id: plugin.id,
      version: plugin.version,
      source: {
        ...plugin.source,
        indexPath: this.#lockedMarketplacePath(plugin),
      },
      commit: plugin.commit,
      integrity: plugin.integrity,
      manifest,
      marketplaceMaxProfile,
    };
    this.#registerCandidate(candidate, root);
  }

  /**
   * 解析旧 lock 固定使用的 Marketplace 路径。
   *
   * 旧 RD Guide 独立 Plugin 只存在于历史 `.flower-marketplace` 索引；该映射同时限定来源
   * ID、项目和 Plugin ID 族，避免对其它 GitLab Marketplace 做多路径探测或误判。
   *
   * @param {import("../contracts.js").ResolvedPlugin} plugin 已锁定 Plugin
   * @returns {string} 安全的固定 Marketplace 索引路径
   */
  #lockedMarketplacePath(plugin) {
    const indexPath = plugin.source.indexPath || (
      this.id === RD_GUIDE_SOURCE_ID &&
      this.source.project === RD_GUIDE_PROJECT &&
      plugin.source.id === RD_GUIDE_SOURCE_ID &&
      plugin.source.reference === RD_GUIDE_PROJECT &&
      plugin.id.startsWith(`${RD_GUIDE_SOURCE_ID}/xhgj-`)
        ? LEGACY_RD_GUIDE_MARKETPLACE_PATH
        : this.source.marketplacePath
    );
    return assertSafePosixRelativePath(indexPath, "Marketplace index path");
  }

  /**
   * 登记已准备固定包候选。
   *
   * @param {import("../contracts.js").PluginCandidate} candidate Provider 候选
   * @param {string} root 固定包根
   * @returns {void}
   */
  #registerCandidate(candidate, root) {
    this.packageRoots.set(this.#key(candidate), root);
    const candidates = this.candidates.get(candidate.id) || [];
    if (!candidates.some(({ version, commit }) => (
      version === candidate.version &&
      commit === candidate.commit
    ))) {
      candidates.push(candidate);
      candidates.sort((left, right) => compareUtf8(left.version, right.version));
    }
    this.candidates.set(candidate.id, candidates);
  }

  /** @param {string} project @param {string} commit @param {string|null} subdir @param {string} manifestPath @param {string} integrity @returns {string} */
  #cacheTarget(project, commit, subdir, manifestPath, integrity) {
    const key = crypto.createHash("sha256")
      .update(`${this.source.baseUrl}\0${project}\0${commit}\0${subdir || ""}\0${manifestPath}\0${integrity}`)
      .digest("hex");
    return path.join(this.cacheRoot, key);
  }

  /** @param {{id:string,version:string,integrity:string}} plugin @returns {string} */
  #key(plugin) {
    return `${plugin.id}\u0000${plugin.version}\u0000${plugin.integrity}`;
  }
}
