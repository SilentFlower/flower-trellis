import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import semver from "semver";
import { PluginError, PluginIoError } from "../errors.js";
import { PluginFormatRegistry } from "../formats/registry.js";
import { readExternalMarketplaceEntries } from "../formats/marketplace.js";
import { hashCanonicalTree } from "../integrity/canonical-tree.js";
import { PLUGIN_RUNTIME_ERROR_CODES, PluginRuntimeError } from "../runtime-errors.js";
import { validateMarketplaceManifest } from "../schemas/marketplace-manifest.js";
import { composeCanonicalPluginId, parseCanonicalPluginId } from "../schemas/shared.js";
import { compareUtf8 } from "../stable-order.js";
import { listOrdinaryDirectories } from "../formats/shared.js";
import { verifyPluginPackage } from "./package-reader.js";
import { copyOrdinaryDirectory, extractRemoteArchive } from "./remote-archive.js";

/**
 * GitHub 公共仓库 Source Provider。
 */
export class GitHubSourceProvider {
  /**
   * 创建 GitHub Provider。
   *
   * @param {{source:object,projectRoot:string,client:object,cacheRoot?:string,extractArchive?:Function,formatRegistry?:PluginFormatRegistry}} options 依赖
   */
  constructor(options) {
    this.id = options.source.id;
    this.type = "github";
    this.source = options.source;
    this.projectRoot = path.resolve(options.projectRoot);
    this.client = options.client;
    this.cacheRoot = options.cacheRoot || path.join(this.projectRoot, ".flower", "cache", "github");
    this.extractArchive = options.extractArchive;
    this.formatRegistry = options.formatRegistry || new PluginFormatRegistry();
    this.candidates = new Map();
    this.packageRoots = new Map();
    this.flowerCatalog = new Map();
    this.flowerIndex = null;
    this.prepared = false;
  }

  /**
   * 探测当前 ref 对应的格式入口并准备可安装候选。
   *
   * @returns {Promise<{source:object,resolvedCommit:string,committedAt:string,detection:object,candidate:import("../contracts.js").PluginCandidate|null,candidates:import("../contracts.js").PluginCandidate[],diagnostics:object[]}>} 探测结果
   */
  async inspect() {
    const ref = this.source.ref || (await this.client.resolveRepository(this.source.repository)).defaultBranch;
    const resolved = await this.client.resolveCommit(this.source.repository, ref);
    const prepared = await this.#preparePackage({
      repository: this.source.repository,
      commit: resolved.sha,
      committedAt: resolved.committedAt,
      subdir: this.source.subdir || null,
      format: this.source.format || "auto",
      entryPath: this.source.entryPath || null,
    });
    for (const entry of prepared.packages) this.#register(entry.candidate, entry.root);
    if (prepared.catalog) {
      this.flowerCatalog = new Map(prepared.catalog.map((entry) => [entry.canonicalId, entry]));
      this.flowerIndex = {
        input: {
          repository: this.source.repository,
          commit: resolved.sha,
          committedAt: resolved.committedAt,
          subdir: this.source.subdir || null,
        },
        detection: prepared.detection,
      };
    }
    this.prepared = true;
    const persistedSource = {
      ...this.source,
      ref,
      format: prepared.detection.format,
      ...(prepared.detection.entryPath ? { entryPath: prepared.detection.entryPath } : {}),
    };
    if (!prepared.detection.entryPath) delete persistedSource.entryPath;
    return {
      source: persistedSource,
      resolvedCommit: resolved.sha,
      committedAt: resolved.committedAt,
      detection: prepared.detection,
      candidate: prepared.packages.length === 1 ? prepared.packages[0].candidate : null,
      candidates: prepared.packages.map(({ candidate }) => candidate),
      pluginCount: prepared.catalog?.length || prepared.packages.length,
      diagnostics: prepared.diagnostics,
    };
  }

  /**
   * 准备来源目录。
   *
   * @returns {Promise<object>} 当前候选
   */
  async prepareIndex() {
    if (!this.prepared) await this.inspect();
    return this.listPreparedCandidates();
  }

  /**
   * 准备指定 canonical Plugin。
   *
   * @param {string} canonicalId canonical Plugin ID
   * @returns {Promise<void>} 准备完成
   */
  async prepare(canonicalId) {
    const { sourceId } = parseCanonicalPluginId(canonicalId);
    if (sourceId !== this.id) return;
    if (!this.prepared) await this.inspect();
    if (!this.candidates.has(canonicalId) && this.flowerCatalog.has(canonicalId)) {
      const packages = await this.#prepareFlowerMarketplaceEntry(
        this.flowerCatalog.get(canonicalId),
        this.flowerIndex,
      );
      for (const entry of packages) this.#register(entry.candidate, entry.root);
    }
    if (!this.candidates.has(canonicalId)) {
      throw new PluginRuntimeError(`GitHub 来源中不存在 Plugin:${canonicalId}`, {
        code: PLUGIN_RUNTIME_ERROR_CODES.SOURCE_NOT_FOUND,
        path: canonicalId,
      });
    }
  }

  /**
   * 从 lock 恢复固定 GitHub 包。
   *
   * @param {import("../contracts.js").ResolvedPlugin} plugin 已锁定 Plugin
   * @returns {Promise<void>} 恢复完成
   */
  async prepareLocked(plugin) {
    if (this.packageRoots.has(this.#key(plugin))) return;
    const cached = this.#findCachedPackage(plugin);
    if (cached) {
      this.#register({
        id: plugin.id,
        version: plugin.version,
        source: plugin.source,
        commit: plugin.commit,
        integrity: plugin.integrity,
        manifest: cached.manifest,
        marketplaceMaxProfile: "standard",
        compatibilityReport: cached.metadata.compatibilityReport,
      }, cached.root);
      return;
    }
    const resolved = await this.client.resolveCommit(plugin.source.reference, plugin.commit);
    if (resolved.sha !== plugin.commit) {
      throw new PluginRuntimeError(`GitHub lock commit 已漂移:${plugin.id}`, {
        code: PLUGIN_RUNTIME_ERROR_CODES.TARGET_DRIFT,
        path: plugin.id,
      });
    }
    const prepared = await this.#preparePackage({
      repository: plugin.source.reference,
      commit: plugin.commit,
      committedAt: resolved.committedAt,
      subdir: plugin.source.subdir || null,
      format: plugin.source.format,
      entryPath: plugin.source.entryPath,
    });
    const restored = prepared.packages.find(({ candidate }) => (
      candidate.id === plugin.id &&
      candidate.version === plugin.version &&
      candidate.integrity === plugin.integrity
    ));
    if (!restored) {
      throw new PluginRuntimeError(`GitHub 固定包与 lock 不一致:${plugin.id}@${plugin.version}`, {
        code: PLUGIN_RUNTIME_ERROR_CODES.TARGET_DRIFT,
        path: plugin.id,
      });
    }
    this.#register({ ...restored.candidate, source: plugin.source }, restored.root);
  }

  /**
   * 搜索当前 GitHub 来源。
   *
   * @param {string} [query] 搜索词
   * @returns {Promise<object[]>} 搜索结果
   */
  async search(query = "") {
    await this.prepareIndex();
    const needle = query.trim().toLowerCase();
    if (this.flowerCatalog.size > 0) {
      return [...this.flowerCatalog.values()]
        .filter((entry) => !needle || [entry.canonicalId, entry.entry.description]
          .some((value) => value.toLowerCase().includes(needle)))
        .map((entry) => ({
          id: entry.canonicalId,
          description: entry.entry.description,
          versions: entry.entry.versions.map(({ version }) => version).sort(semver.rcompare),
          source: this.id,
          detectedFormat: "flower",
          entryPath: this.flowerIndex.detection.entryPath,
          resolvedCommit: this.flowerIndex.input.commit,
          compatibility: { status: "compatible", format: "flower", imported: [], omitted: [], diagnostics: [] },
        }));
    }
    const grouped = new Map();
    for (const candidate of this.listPreparedCandidates()) {
      const entry = grouped.get(candidate.id) || {
        id: candidate.id,
        description: candidate.compatibilityReport?.description || candidate.manifest.name,
        versions: [],
        source: this.id,
        detectedFormat: candidate.source.format,
        entryPath: candidate.source.entryPath,
        resolvedCommit: candidate.commit,
        compatibility: candidate.compatibilityReport,
      };
      entry.versions.push(candidate.version);
      grouped.set(candidate.id, entry);
    }
    return [...grouped.values()]
      .filter((entry) => !needle || [entry.id, entry.description]
        .some((value) => value.toLowerCase().includes(needle)))
      .map((entry) => ({ ...entry, versions: [...new Set(entry.versions)].sort(semver.rcompare) }));
  }

  /**
   * 返回已准备的候选。
   *
   * @param {string} canonicalId canonical Plugin ID
   * @returns {import("../contracts.js").PluginCandidate[]} 候选列表
   */
  listCandidates(canonicalId) {
    const candidates = this.candidates.get(canonicalId);
    if (!candidates) {
      throw new PluginRuntimeError(`GitHub Plugin 尚未准备:${canonicalId}`, {
        code: PLUGIN_RUNTIME_ERROR_CODES.SOURCE_NOT_FOUND,
        path: canonicalId,
      });
    }
    return candidates;
  }

  /**
   * 返回来源中全部已准备候选。
   *
   * @returns {import("../contracts.js").PluginCandidate[]} 候选列表
   */
  listPreparedCandidates() {
    return [...this.candidates.values()].flat().sort((left, right) => compareUtf8(left.id, right.id));
  }

  /**
   * 读取并复核固定包。
   *
   * @param {import("../contracts.js").PluginCandidate|import("../contracts.js").ResolvedPlugin} plugin Plugin 身份
   * @returns {{root:string,manifest:import("../contracts.js").PluginManifest,integrity:string}} 固定包
   */
  readPackage(plugin) {
    const root = this.packageRoots.get(this.#key(plugin));
    if (!root) {
      throw new PluginRuntimeError(`GitHub Plugin 缓存不存在:${plugin.id}@${plugin.version}`, {
        code: PLUGIN_RUNTIME_ERROR_CODES.SOURCE_NOT_FOUND,
        path: plugin.id,
      });
    }
    return verifyPluginPackage(plugin, root);
  }

  /** @param {object} input @returns {Promise<{detection:object,packages:Array<{root:string,candidate:object}>,diagnostics:object[],catalog?:object[]}>} */
  async #preparePackage(input) {
    const cached = this.#findCachedSelection(input);
    if (cached) return { detection: cached.detection, packages: [cached], diagnostics: [] };
    fs.mkdirSync(this.cacheRoot, { recursive: true });
    const staging = fs.mkdtempSync(path.join(this.cacheRoot, ".staging-"));
    const archiveFile = path.join(staging, "archive.tar.gz");
    const extractRoot = path.join(staging, "extract");
    const snapshotRoot = path.join(staging, "snapshot");
    try {
      fs.mkdirSync(extractRoot);
      fs.writeFileSync(archiveFile, await this.client.downloadArchive(input.repository, input.commit));
      const { selectedRoot } = await extractRemoteArchive({
        archiveFile,
        extractRoot,
        subdir: input.subdir,
        label: "GitHub Plugin",
        sourceId: this.id,
        extractArchive: this.extractArchive,
      });
      copyOrdinaryDirectory(selectedRoot, snapshotRoot, "GitHub Plugin");
      const detections = this.formatRegistry.detect(snapshotRoot, { format: input.format });
      let detection;
      if (detections.length === 0 && input.format === "auto" && !input.entryPath) {
        const collection = this.#discoverPluginCollection(snapshotRoot);
        detection = collection.length > 0 ? {
          format: "auto",
          kind: "collection",
          entryPath: null,
          displayName: path.basename(snapshotRoot),
          pluginRoot: snapshotRoot,
          members: collection,
        } : this.formatRegistry.selectSingle(detections);
      } else detection = this.#selectDetection(detections, input.entryPath);
      if (detection.kind === "collection") {
        const packages = detection.members.map((member, index) => this.#normalizeSnapshotPlugin({
          staging,
          sequence: index,
          pluginRoot: member.detection.pluginRoot,
          detection: member.detection,
          input,
          packageSubdir: [input.subdir, member.path].filter(Boolean).join("/"),
          index: null,
        }));
        return { detection, packages, diagnostics: [] };
      }
      if (detection.kind === "plugin") {
        const normalized = this.#normalizeSnapshotPlugin({
          staging,
          sequence: 0,
          pluginRoot: detection.pluginRoot,
          detection,
          input,
          packageSubdir: input.subdir,
          index: null,
        });
        return { detection, packages: [normalized], diagnostics: [] };
      }
      if (detection.format === "flower") {
        const catalog = this.#readFlowerMarketplaceCatalog(detection);
        return { detection, packages: [], diagnostics: [], catalog };
      }
      const marketplace = readExternalMarketplaceEntries(detection, input.repository);
      const packages = [];
      for (const [index, entry] of marketplace.entries.entries()) {
        if (entry.repository !== input.repository || entry.ref) {
          const targetRef = entry.ref || (await this.client.resolveRepository(entry.repository)).defaultBranch;
          const resolved = await this.client.resolveCommit(entry.repository, targetRef);
          const prepared = await this.#preparePackage({
            repository: entry.repository,
            commit: resolved.sha,
            committedAt: resolved.committedAt,
            subdir: entry.path,
            format: "auto",
            entryPath: null,
          });
          if (prepared.packages.length !== 1) {
            throw new PluginRuntimeError(`Marketplace 条目不是单一 Plugin:${entry.name}`, {
              code: PLUGIN_RUNTIME_ERROR_CODES.SOURCE_AMBIGUOUS,
              path: entry.name,
            });
          }
          const [preparedEntry] = prepared.packages;
          packages.push({
            root: preparedEntry.root,
            candidate: {
              ...preparedEntry.candidate,
              source: {
                ...preparedEntry.candidate.source,
                indexReference: input.repository,
                indexCommit: input.commit,
              },
              compatibilityReport: {
                ...preparedEntry.candidate.compatibilityReport,
                description: entry.description,
              },
            },
          });
          continue;
        }
        const pluginRoot = path.join(snapshotRoot, ...entry.path.split("/"));
        const pluginDetection = this.formatRegistry.selectSingle(
          this.formatRegistry.detect(pluginRoot).filter(({ kind }) => kind === "plugin"),
        );
        const packageSubdir = [input.subdir, entry.path].filter(Boolean).join("/");
        packages.push(this.#normalizeSnapshotPlugin({
          staging,
          sequence: index,
          pluginRoot: pluginDetection.pluginRoot,
          detection: pluginDetection,
          input,
          packageSubdir,
          index: { repository: input.repository, commit: input.commit, description: entry.description },
        }));
      }
      return { detection, packages, diagnostics: marketplace.diagnostics };
    } catch (error) {
      if (error instanceof PluginRuntimeError || error instanceof PluginError) throw error;
      throw new PluginIoError(`无法准备 GitHub Plugin:${this.id}`, { path: this.id, cause: error });
    } finally {
      fs.rmSync(staging, { recursive: true, force: true });
    }
  }

  /**
   * 读取 Flower Marketplace 目录，不下载任何 Plugin 包。
   *
   * @param {object} detection Marketplace 检测结果
   * @returns {Array<{canonicalId:string,entry:object}>} 目录条目
   */
  #readFlowerMarketplaceCatalog(detection) {
    const marketplace = validateMarketplaceManifest(detection.manifest);
    if (marketplace.id !== this.id) {
      throw new PluginRuntimeError(`Marketplace ID 与 source 不一致:${marketplace.id}`, {
        code: PLUGIN_RUNTIME_ERROR_CODES.SOURCE_CONFIG_INVALID,
        path: this.id,
      });
    }
    return marketplace.plugins.map((entry) => ({
      canonicalId: composeCanonicalPluginId(this.id, entry.id),
      entry,
    }));
  }

  /**
   * 按需准备 Flower Marketplace 中一个 Plugin 的全部固定版本。
   *
   * @param {{canonicalId:string,entry:object}} catalogEntry 目录条目
   * @param {{input:object,detection:object}} index 索引上下文
   * @returns {Promise<Array<{root:string,candidate:object}>>} 固定包列表
   */
  async #prepareFlowerMarketplaceEntry(catalogEntry, index) {
    const { entry } = catalogEntry;
    const input = index.input;
    const packages = [];
    for (const version of entry.versions) {
      if (entry.source.type === "gitlab") {
        throw new PluginRuntimeError(`GitHub 来源暂不跨接 GitLab Plugin:${entry.id}`, {
          code: PLUGIN_RUNTIME_ERROR_CODES.FORMAT_UNSUPPORTED,
          path: entry.id,
        });
      }
      const repository = entry.source.type === "github" ? entry.source.repository : input.repository;
      const subdir = entry.source.type === "github" ? (entry.source.subdir || null) : entry.source.path;
      const resolved = await this.client.resolveCommit(repository, version.commit);
      const prepared = await this.#preparePackage({
        repository,
        commit: resolved.sha,
        committedAt: resolved.committedAt,
        subdir,
        format: "flower",
        entryPath: null,
      });
      if (prepared.packages.length !== 1) {
        throw new PluginRuntimeError(`Flower Marketplace 条目不是单一 Plugin:${entry.id}`, {
          code: PLUGIN_RUNTIME_ERROR_CODES.SOURCE_AMBIGUOUS,
          path: entry.id,
        });
      }
      const item = prepared.packages[0];
      if (
        item.candidate.id !== composeCanonicalPluginId(this.id, entry.id) ||
        item.candidate.version !== version.version ||
        item.candidate.integrity !== version.integrity
      ) {
        throw new PluginRuntimeError(`Flower Marketplace 远程包身份不一致:${entry.id}@${version.version}`, {
          code: PLUGIN_RUNTIME_ERROR_CODES.TARGET_DRIFT,
          path: entry.id,
        });
      }
      if (item.candidate.manifest.capabilities.profile !== "standard") {
        throw new PluginRuntimeError(`GitHub 外部来源只允许 standard Plugin:${entry.id}`, {
          code: PLUGIN_RUNTIME_ERROR_CODES.SOURCE_CONFIG_INVALID,
          path: entry.id,
        });
      }
      packages.push({
        root: item.root,
        candidate: {
          ...item.candidate,
          source: {
            ...item.candidate.source,
            indexReference: input.repository,
            indexCommit: input.commit,
          },
          marketplaceMaxProfile: "standard",
          compatibilityReport: {
            ...item.candidate.compatibilityReport,
            description: entry.description,
          },
        },
      });
    }
    return packages;
  }

  /**
   * 发现没有 Marketplace 的 `plugins/*` 多 Plugin 仓库。
   *
   * @param {string} snapshotRoot 仓库快照根
   * @returns {Array<{path:string,detection:object}>} 稳定成员列表
   */
  #discoverPluginCollection(snapshotRoot) {
    const pluginsRoot = path.join(snapshotRoot, "plugins");
    if (!fs.existsSync(pluginsRoot)) return [];
    return listOrdinaryDirectories(pluginsRoot).flatMap((directory) => {
      const root = path.join(pluginsRoot, directory);
      const detections = this.formatRegistry.detect(root).filter(({ kind }) => kind === "plugin");
      if (detections.length === 0) return [];
      return [{ path: `plugins/${directory}`, detection: this.formatRegistry.selectSingle(detections) }];
    });
  }

  /**
   * 规范化快照中的单个 Plugin 并发布不可变缓存。
   *
   * @param {{staging:string,sequence:number,pluginRoot:string,detection:object,input:object,packageSubdir:string|null,index:object|null}} values 规范化上下文
   * @returns {{root:string,candidate:object}} 缓存包与候选
   */
  #normalizeSnapshotPlugin(values) {
    const normalizedRoot = path.join(values.staging, `package-${values.sequence}`);
    const normalized = this.formatRegistry.normalize(values.detection, {
      outputRoot: normalizedRoot,
      sourceId: this.id,
      commit: values.input.commit,
      committedAt: values.input.committedAt,
    });
    const packageInput = { ...values.input, subdir: values.packageSubdir };
    const source = {
      id: this.id,
      type: "github",
      reference: values.input.repository,
      ...(values.packageSubdir ? { subdir: values.packageSubdir } : {}),
      format: values.detection.format,
      entryPath: values.detection.entryPath,
      ...(values.index ? {
        indexReference: values.index.repository,
        indexCommit: values.index.commit,
      } : {}),
    };
    const candidate = {
      id: composeCanonicalPluginId(this.id, normalized.manifest.id),
      version: normalized.manifest.version,
      source,
      commit: values.input.commit,
      integrity: normalized.integrity,
      manifest: normalized.manifest,
      marketplaceMaxProfile: "standard",
      compatibilityReport: {
        ...normalized.compatibilityReport,
        description: values.index?.description || normalized.description,
        externalVersion: normalized.externalVersion,
      },
    };
    const target = this.#cacheTarget(packageInput, values.detection, normalized.integrity);
    this.#publish(normalizedRoot, target, normalized.integrity);
    this.#writeMetadata(target, { input: packageInput, detection: values.detection, candidate });
    return { root: target, candidate };
  }

  /** @param {object[]} detections @param {string|null} entryPath @returns {object} */
  #selectDetection(detections, entryPath) {
    if (!entryPath) return this.formatRegistry.selectSingle(detections);
    const matches = detections.filter((entry) => entry.entryPath === entryPath);
    if (matches.length !== 1) {
      throw new PluginRuntimeError(`GitHub 来源固定格式入口不存在:${entryPath}`, {
        code: PLUGIN_RUNTIME_ERROR_CODES.TARGET_DRIFT,
        path: entryPath,
      });
    }
    return matches[0];
  }

  /** @param {object} candidate @param {string} root @returns {void} */
  #register(candidate, root) {
    this.packageRoots.set(this.#key(candidate), root);
    const candidates = this.candidates.get(candidate.id) || [];
    if (!candidates.some((entry) => entry.version === candidate.version && entry.commit === candidate.commit)) {
      candidates.push(candidate);
      candidates.sort((left, right) => compareUtf8(left.version, right.version));
    }
    this.candidates.set(candidate.id, candidates);
  }

  /** @param {object} input @param {object} detection @param {string} integrity @returns {string} */
  #cacheTarget(input, detection, integrity) {
    const identity = JSON.stringify([
      this.id, input.repository, input.commit, input.subdir || "", detection.format, detection.entryPath, integrity,
    ]);
    return path.join(this.cacheRoot, crypto.createHash("sha256").update(identity).digest("hex"));
  }

  /** @param {string} source @param {string} target @param {string} integrity @returns {void} */
  #publish(source, target, integrity) {
    if (fs.existsSync(target)) {
      if (hashCanonicalTree(target) === integrity) return;
      fs.rmSync(target, { recursive: true, force: true });
      fs.rmSync(this.#metadataPath(target), { force: true });
    }
    fs.renameSync(source, target);
  }

  /** @param {object} input @returns {{root:string,detection:object,candidate:object}|null} */
  #findCachedSelection(input) {
    return this.#scanCache((metadata) => (
      metadata.repository === input.repository &&
      metadata.commit === input.commit &&
      (metadata.subdir || null) === (input.subdir || null) &&
      (input.format === "auto" || metadata.format === input.format) &&
      (!input.entryPath || metadata.entryPath === input.entryPath)
    ));
  }

  /** @param {import("../contracts.js").ResolvedPlugin} plugin @returns {{root:string,manifest:object,metadata:object}|null} */
  #findCachedPackage(plugin) {
    const found = this.#scanCache((metadata) => (
      metadata.repository === plugin.source.reference &&
      metadata.commit === plugin.commit &&
      metadata.integrity === plugin.integrity &&
      metadata.format === plugin.source.format &&
      metadata.entryPath === plugin.source.entryPath &&
      (metadata.subdir || null) === (plugin.source.subdir || null)
    ));
    if (!found || found.candidate.id !== plugin.id || found.candidate.version !== plugin.version) return null;
    return { root: found.root, manifest: found.candidate.manifest, metadata: found.metadata };
  }

  /** @param {(metadata:object)=>boolean} predicate @returns {{root:string,detection:object,candidate:object,metadata:object}|null} */
  #scanCache(predicate) {
    if (!fs.existsSync(this.cacheRoot)) return null;
    const entries = fs.readdirSync(this.cacheRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".staging-"))
      .sort((left, right) => compareUtf8(left.name, right.name));
    for (const entry of entries) {
      const root = path.join(this.cacheRoot, entry.name);
      try {
        const metadata = JSON.parse(fs.readFileSync(this.#metadataPath(root), "utf8"));
        if (metadata.schemaVersion !== 1 || metadata.sourceId !== this.id || !predicate(metadata)) continue;
        if (hashCanonicalTree(root) !== metadata.integrity) continue;
        const checked = verifyPluginPackage(metadata.candidate, root);
        return {
          root,
          detection: metadata.detection,
          candidate: { ...metadata.candidate, manifest: checked.manifest },
          metadata,
        };
      } catch {
        // 其它缓存项损坏不应阻断当前来源的查找。
      }
    }
    return null;
  }

  /** @param {string} root @returns {string} */
  #metadataPath(root) {
    return `${root}.metadata.json`;
  }

  /** @param {string} root @param {{input:object,detection:object,candidate:object}} values @returns {void} */
  #writeMetadata(root, values) {
    const metadataPath = this.#metadataPath(root);
    const temporary = `${metadataPath}.${process.pid}.tmp`;
    const value = {
      schemaVersion: 1,
      sourceId: this.id,
      repository: values.input.repository,
      commit: values.input.commit,
      subdir: values.input.subdir,
      format: values.detection.format,
      entryPath: values.detection.entryPath,
      integrity: values.candidate.integrity,
      detection: {
        format: values.detection.format,
        kind: values.detection.kind,
        entryPath: values.detection.entryPath,
        displayName: values.detection.displayName,
      },
      candidate: values.candidate,
      compatibilityReport: values.candidate.compatibilityReport,
    };
    try {
      fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
      fs.renameSync(temporary, metadataPath);
    } catch (error) {
      fs.rmSync(temporary, { force: true });
      throw new PluginIoError(`无法写入 GitHub Plugin 缓存元数据:${this.id}`, {
        path: this.id,
        cause: error,
      });
    }
  }

  /** @param {object} plugin @returns {string} */
  #key(plugin) {
    return `${plugin.id}@${plugin.version}:${plugin.commit || ""}:${plugin.integrity}`;
  }
}
