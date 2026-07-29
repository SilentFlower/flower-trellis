import fs from "node:fs";
import path from "node:path";
import { PluginError, PluginIoError, PluginPathError } from "../errors.js";
import { hashCanonicalTree } from "../integrity/canonical-tree.js";
import { validatePluginManifest } from "../schemas/plugin-manifest.js";
import {
  assertSafePosixRelativePath,
  composeCanonicalPluginId,
} from "../schemas/shared.js";
import {
  PLUGIN_RUNTIME_ERROR_CODES,
  PluginRuntimeError,
} from "../runtime-errors.js";
import { compareUtf8 } from "../stable-order.js";

/** Plugin 包根内固定 manifest 文件名。 */
export const PLUGIN_MANIFEST_FILE = "plugin.json";

/**
 * 判断 candidate 是否位于 root 内部或等于 root。
 *
 * @param {string} root 根目录
 * @param {string} candidate 候选目录
 * @returns {boolean} 是否位于边界内
 */
function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/**
 * 把系统路径转换为安全 POSIX 相对路径。
 *
 * @param {string} root 根目录
 * @param {string} target 目标目录
 * @param {string} label 诊断标签
 * @returns {string} POSIX 相对路径
 */
export function relativePosixPath(root, target, label) {
  const relative = path.relative(root, target).split(path.sep).join("/");
  return assertSafePosixRelativePath(relative, label);
}

/**
 * 校验来源根目录并返回真实路径。
 *
 * @param {string} sourceRoot 来源根目录
 * @param {string} label 诊断标签
 * @returns {string} 真实路径
 */
export function assertSourceRoot(sourceRoot, label) {
  const absoluteRoot = path.resolve(sourceRoot);
  try {
    const stat = fs.lstatSync(absoluteRoot);
    if (stat.isSymbolicLink()) throw new PluginPathError(`${label} 不能是软链`, { path: absoluteRoot });
    if (!stat.isDirectory()) throw new PluginPathError(`${label} 必须是目录`, { path: absoluteRoot });
    return fs.realpathSync(absoluteRoot);
  } catch (error) {
    if (error instanceof PluginPathError) throw error;
    throw new PluginIoError(`无法读取 ${label}:${absoluteRoot}`, { path: absoluteRoot, cause: error });
  }
}

/**
 * 在来源目录内发现 Plugin 包；遇到 manifest 后不再把其子目录解释为独立包。
 *
 * @param {string} sourceRoot 已校验的来源真实根目录
 * @returns {string[]} 稳定排序的 Plugin 包真实路径
 */
export function discoverPluginPackages(sourceRoot) {
  const packages = [];

  /**
   * 递归发现包根。
   *
   * @param {string} directory 当前目录
   */
  function visit(directory) {
    const manifestPath = path.join(directory, PLUGIN_MANIFEST_FILE);
    if (fs.existsSync(manifestPath)) {
      const stat = fs.lstatSync(manifestPath);
      if (stat.isSymbolicLink() || !stat.isFile()) {
        throw new PluginPathError(`Plugin manifest 必须是普通文件:${manifestPath}`, { path: manifestPath });
      }
      packages.push(directory);
      return;
    }
    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch (error) {
      throw new PluginIoError(`无法扫描 Plugin 来源:${directory}`, { path: directory, cause: error });
    }
    for (const entry of entries.sort((left, right) => compareUtf8(left.name, right.name))) {
      const target = path.join(directory, entry.name);
      const stat = fs.lstatSync(target);
      if (stat.isSymbolicLink()) {
        throw new PluginPathError(`Plugin 来源不允许软链:${target}`, { path: target });
      }
      if (stat.isDirectory()) visit(target);
      else if (!stat.isFile()) {
        throw new PluginPathError(`Plugin 来源不允许特殊文件:${target}`, { path: target });
      }
    }
  }

  visit(sourceRoot);
  return packages.sort(compareUtf8);
}

/**
 * 从固定包根读取并校验候选。
 *
 * @param {{sourceId:string,type:"builtin"|"local",packageRoot:string,reference:string}} options 来源信息
 * @returns {import("../contracts.js").PluginCandidate} 已校验候选
 */
export function readPluginCandidate(options) {
  let raw;
  const manifestPath = path.join(options.packageRoot, PLUGIN_MANIFEST_FILE);
  try {
    raw = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    throw new PluginIoError(`无法读取 Plugin manifest:${manifestPath}`, {
      path: manifestPath,
      cause: error,
    });
  }
  const manifest = validatePluginManifest(raw);
  const id = composeCanonicalPluginId(options.sourceId, manifest.id);
  const source = {
    id: options.sourceId,
    type: options.type,
    reference: options.reference,
  };
  return {
    id,
    version: manifest.version,
    source,
    commit: null,
    integrity: hashCanonicalTree(options.packageRoot),
    manifest,
  };
}

/**
 * 复核固定候选仍指向相同包字节与身份。
 *
 * @param {import("../contracts.js").PluginCandidate|import("../contracts.js").ResolvedPlugin} expected 锁定身份
 * @param {string} packageRoot Plugin 包根
 * @returns {{root:string,manifest:import("../contracts.js").PluginManifest,integrity:string}} 已复核包
 */
export function verifyPluginPackage(expected, packageRoot) {
  const root = assertSourceRoot(packageRoot, "Plugin 包根");
  const manifestPath = path.join(root, PLUGIN_MANIFEST_FILE);
  let manifest;
  try {
    manifest = validatePluginManifest(JSON.parse(fs.readFileSync(manifestPath, "utf8")));
  } catch (error) {
    if (error instanceof PluginError) throw error;
    throw new PluginIoError(`无法复核 Plugin manifest:${manifestPath}`, {
      path: manifestPath,
      cause: error,
    });
  }
  const actualId = composeCanonicalPluginId(expected.source.id, manifest.id);
  const integrity = hashCanonicalTree(root);
  if (actualId !== expected.id || manifest.version !== expected.version || integrity !== expected.integrity) {
    throw new PluginRuntimeError(`Plugin 固定包身份已漂移:${expected.id}@${expected.version}`, {
      code: PLUGIN_RUNTIME_ERROR_CODES.TARGET_DRIFT,
      path: expected.source.reference,
      details: {
        expected: { id: expected.id, version: expected.version, integrity: expected.integrity },
        actual: { id: actualId, version: manifest.version, integrity },
      },
    });
  }
  return { root, manifest, integrity };
}

/**
 * 校验 packageRoot 没有逃逸来源根。
 *
 * @param {string} sourceRoot 来源真实根目录
 * @param {string} packageRoot 包目录
 * @returns {string} 包真实路径
 */
export function assertPackageWithinSource(sourceRoot, packageRoot) {
  const realPackage = assertSourceRoot(packageRoot, "Plugin 包根");
  if (!isWithin(sourceRoot, realPackage)) {
    throw new PluginPathError(`Plugin 包逃逸来源根:${packageRoot}`, { path: packageRoot });
  }
  return realPackage;
}
