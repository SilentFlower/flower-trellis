import fs from "node:fs";
import path from "node:path";
import { PluginIoError, PluginPathError } from "../errors.js";
import { listCanonicalTreeFiles } from "../integrity/canonical-tree.js";
import {
  PLUGIN_RUNTIME_ERROR_CODES,
  PluginRuntimeError,
} from "../runtime-errors.js";
import { assertSafePosixRelativePath } from "../schemas/shared.js";
import { compareUtf8 } from "../stable-order.js";
import { isRuntimeBuiltinProviderTrusted } from "../runtime-extensions.js";
import { hashContent, hashFileIfExists } from "./content-hash.js";

const CONTENT_KINDS = ["skills", "specs", "assets", "scripts", "tests"];

/**
 * 生成 mutation payload 的稳定键。
 *
 * @param {{owner:string,target:string}} mutation 内容 mutation
 * @returns {string} payload 键
 */
export function contentMutationKey(mutation) {
  return `${mutation.owner}\u0000${mutation.target}`;
}

/**
 * 判断 candidate 是否位于 root 内。
 *
 * @param {string} root 根目录
 * @param {string} candidate 候选路径
 * @returns {boolean} 是否位于边界内
 */
function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/**
 * 展开 manifest 内容条目为普通文件。
 *
 * @param {string} packageRoot Plugin 包根
 * @param {string} entry manifest 内容路径
 * @returns {{isDirectory:boolean,files:Array<{relative:string,absolutePath:string}>}} 普通文件
 */
function expandContentEntry(packageRoot, entry) {
  const safeEntry = assertSafePosixRelativePath(entry, "Plugin content 路径");
  const absolute = path.join(packageRoot, ...safeEntry.split("/"));
  let stat;
  try {
    stat = fs.lstatSync(absolute);
  } catch (error) {
    throw new PluginIoError(`Plugin content 不存在:${entry}`, { path: entry, cause: error });
  }
  if (stat.isSymbolicLink()) throw new PluginPathError(`Plugin content 不能是软链:${entry}`, { path: entry });
  if (stat.isFile()) return { isDirectory: false, files: [{ relative: "", absolutePath: absolute }] };
  if (!stat.isDirectory()) throw new PluginPathError(`Plugin content 必须是文件或目录:${entry}`, { path: entry });
  return {
    isDirectory: true,
    files: listCanonicalTreeFiles(absolute).map((file) => ({
      relative: file.path,
      absolutePath: file.absolutePath,
    })),
  };
}

/**
 * 读取单个平台的逐文件覆盖；缺失时返回 canonical 字节。
 *
 * @param {string} packageRoot Plugin 包根
 * @param {string} platform 逻辑平台
 * @param {string} entry canonical content 路径
 * @param {string} relative 文件在 content 目录内的相对路径
 * @param {Buffer} canonical canonical 字节
 * @returns {{content:Buffer,source:string}} 解析后的字节与来源
 */
function resolvePlatformContent(packageRoot, platform, entry, relative, canonical) {
  const override = ["platforms", platform, ...entry.split("/"), ...relative.split("/").filter(Boolean)];
  const overridePath = path.join(packageRoot, ...override);
  try {
    const stat = fs.lstatSync(overridePath);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new PluginPathError(`Platform override 必须是普通文件:${override.join("/")}`, {
        path: override.join("/"),
      });
    }
    return { content: fs.readFileSync(overridePath), source: override.join("/") };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { content: canonical, source: `${entry}${relative ? `/${relative}` : ""}` };
    }
    throw error;
  }
}

/**
 * 计算单个内容条目的目标前缀。
 *
 * @param {string} owner canonical Plugin ID
 * @param {string} kind 内容类型
 * @param {string} entry manifest 内容路径
 * @param {string|null} skillRoot 平台 Skill root
 * @returns {string} 项目内目标前缀
 */
function targetPrefix(owner, kind, entry, skillRoot) {
  const name = path.posix.basename(entry);
  if (kind === "skills") return `${skillRoot}/${name}`;
  return `.flower/content/${owner}/${kind}/${name}`;
}

/**
 * 登记内容目录及文件相对路径中的全部父目录。
 *
 * @param {Map<string,{owner:string,path:string}>} claims 目录 claim 集合
 * @param {string} owner canonical Plugin ID
 * @param {string} prefix 内容目标根
 * @param {string} relative 文件在内容根内的相对路径
 */
function addDirectoryClaims(claims, owner, prefix, relative) {
  const directories = [prefix];
  let parent = path.posix.dirname(relative);
  while (parent !== ".") {
    directories.push(`${prefix}/${parent}`);
    parent = path.posix.dirname(parent);
  }
  for (const directory of directories) {
    claims.set(`${owner}\u0000${directory}`, { owner, path: directory });
  }
}

/**
 * 把 resolved Plugin 内容投影为 P1 ContentMutation 与本机 state。
 *
 * @param {{projectRoot:string,graph:import("../contracts.js").ResolvedGraph,selected:import("../contracts.js").PluginCandidate[],registry:{readPackage:(plugin:object)=>{root:string,manifest:import("../contracts.js").PluginManifest}},platformSelection:{platforms:string[],targets:Array<{root:string,source:string,platforms:string[]}>},previousState?:import("../contracts.js").PluginState|null}} options 投影输入
 * @returns {{mutations:import("../contracts.js").ContentMutation[],payloads:Map<string,Buffer>,directoryClaims:Array<{owner:string,path:string}>,directoryRemovals:Array<{owner:string,path:string,beforeHash:string}>,state:import("../contracts.js").PluginState}} 投影结果
 */
export function projectPluginContent(options) {
  const selectedById = new Map(options.selected.map((candidate) => [candidate.id, candidate]));
  const payloads = new Map();
  const mutations = [];
  const directoryClaims = new Map();
  const directoryRemovals = new Map();
  const stateEntries = [];
  let migration;

  for (const resolved of options.graph.plugins) {
    const candidate = selectedById.get(resolved.id);
    if (!candidate) throw new Error(`Resolved Plugin 缺少候选:${resolved.id}`);
    const pluginPackage = options.registry.readPackage(candidate);
    const provider = typeof options.registry.get === "function"
      ? options.registry.get(candidate.source.id)
      : null;
    if (typeof provider?.projectContent === "function") {
      if (!isRuntimeBuiltinProviderTrusted(provider)) {
        throw new PluginRuntimeError(`外部 Plugin 不得注册自定义内容投影:${resolved.id}`, {
          code: PLUGIN_RUNTIME_ERROR_CODES.CONTENT_CONFLICT,
          path: resolved.id,
        });
      }
      const custom = provider.projectContent({
        projectRoot: options.projectRoot,
        resolved,
        candidate,
        pluginPackage,
        platformSelection: options.platformSelection,
        previousState: options.previousState,
      });
      if (custom) {
        custom.mutations.forEach((mutation) => mutations.push(mutation));
        for (const [key, value] of custom.payloads) {
          const previous = payloads.get(key);
          if (previous && !previous.equals(value)) throw new Error(`Plugin 投影 payload 冲突:${key}`);
          payloads.set(key, value);
        }
        for (const claim of custom.directoryClaims || []) {
          directoryClaims.set(`${claim.owner}\u0000${claim.path}`, claim);
        }
        for (const removal of custom.directoryRemovals || []) {
          directoryRemovals.set(`${removal.owner}\u0000${removal.path}`, removal);
        }
        stateEntries.push(custom.stateEntry);
        if (custom.migration) migration = custom.migration;
        continue;
      }
    }
    const paths = new Map();
    for (const kind of CONTENT_KINDS) {
      for (const entry of [...(pluginPackage.manifest.content[kind] || [])].sort(compareUtf8)) {
        const expanded = expandContentEntry(pluginPackage.root, entry);
        const targets = kind === "skills" ? options.platformSelection.targets : [{ root: null }];
        for (const platformTarget of targets) {
          const prefix = targetPrefix(resolved.id, kind, entry, platformTarget.root);
          if (kind !== "skills") {
            addDirectoryClaims(directoryClaims, resolved.id, `.flower/content/${resolved.id}`, "");
            addDirectoryClaims(directoryClaims, resolved.id, `.flower/content/${resolved.id}/${kind}`, "");
          }
          if (expanded.isDirectory) {
            addDirectoryClaims(directoryClaims, resolved.id, prefix, "");
          }
          for (const file of expanded.files) {
            const target = file.relative ? `${prefix}/${file.relative}` : prefix;
            if (expanded.isDirectory) {
              addDirectoryClaims(directoryClaims, resolved.id, prefix, file.relative);
            }
            assertSafePosixRelativePath(target, "Plugin 投影目标");
            const absoluteTarget = path.join(options.projectRoot, ...target.split("/"));
            const realParent = fs.existsSync(path.dirname(absoluteTarget))
              ? fs.realpathSync(path.dirname(absoluteTarget))
              : null;
            if (realParent && !isWithin(fs.realpathSync(options.projectRoot), realParent)) {
              throw new PluginPathError(`Plugin 投影父目录逃逸项目:${target}`, { path: target });
            }
            const canonical = fs.readFileSync(file.absolutePath);
            const platformContents = kind === "skills"
              ? platformTarget.platforms.map((platform) => (
                resolvePlatformContent(pluginPackage.root, platform, entry, file.relative, canonical)
              ))
              : [{ content: canonical, source: `${entry}${file.relative ? `/${file.relative}` : ""}` }];
            const contentHashes = new Set(platformContents.map(({ content }) => hashContent(content)));
            if (contentHashes.size > 1) {
              throw new PluginRuntimeError(`共享 Skill root 的 platform override 内容不一致:${target}`, {
                code: PLUGIN_RUNTIME_ERROR_CODES.CONTENT_CONFLICT,
                path: target,
                details: { platforms: platformTarget.platforms },
              });
            }
            const { content, source: contentSource } = platformContents[0];
            const mutation = {
              owner: resolved.id,
              target,
              operation: "write",
              beforeHash: hashFileIfExists(absoluteTarget),
              afterHash: hashContent(content),
              source: `${resolved.id}:${kind}:${contentSource}`,
            };
            const key = contentMutationKey(mutation);
            const previous = payloads.get(key);
            if (previous && !previous.equals(content)) {
              throw new Error(`Plugin 投影 payload 冲突:${target}`);
            }
            payloads.set(key, content);
            mutations.push(mutation);
            const previousPath = paths.get(target);
            if (previousPath && previousPath.hash !== mutation.afterHash) {
              throw new Error(`Plugin state 路径内容冲突:${target}`);
            }
            paths.set(target, {
              path: target,
              kind: "file",
              hash: mutation.afterHash,
              ownership: "exclusive",
            });
          }
        }
      }
    }
    stateEntries.push({
      id: resolved.id,
      version: resolved.version,
      platforms: [...options.platformSelection.platforms],
      paths: [...paths.values()].sort((left, right) => compareUtf8(left.path, right.path)),
      patches: [],
    });
  }

  return {
    mutations: mutations.sort((left, right) => compareUtf8(left.target, right.target)),
    payloads,
    directoryClaims: [...directoryClaims.values()]
      .sort((left, right) => compareUtf8(left.path, right.path) || compareUtf8(left.owner, right.owner)),
    directoryRemovals: [...directoryRemovals.values()]
      .sort((left, right) => compareUtf8(left.path, right.path) || compareUtf8(left.owner, right.owner)),
    state: {
      schemaVersion: 1,
      transactionVersion: 1,
      plugins: stateEntries,
      ...(migration ? { migration } : {}),
    },
  };
}
