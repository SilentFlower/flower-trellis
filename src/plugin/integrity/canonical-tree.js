import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PluginIntegrityError, PluginIoError, PluginPathError } from "../errors.js";
import { assertSafePosixRelativePath } from "../schemas/shared.js";

/** Python 解释器在导入脚本时自动生成的字节码缓存目录名。 */
const BYTECODE_CACHE_DIRECTORY = "__pycache__";

/**
 * 判断 tree 相对路径是否为运行时自动生成的易变产物。
 *
 * 受管目录里的 Python 脚本(Hook、Skill scripts)一旦被解释器导入就会就地生成
 * `__pycache__/*.pyc`。这些字节码缓存不属于 Plugin 内容，也不由任何写链登记，
 * 若计入安装态目录摘要就会把「用户从未改过的目录」误判成漂移，
 * 进而硬阻断 Plugin Runtime 重放与 Trellis enable。
 *
 * @param {string} relativePath POSIX 相对路径
 * @returns {boolean} 是否属于易变产物
 */
export function isVolatileTreeArtifact(relativePath) {
  return relativePath.split("/").includes(BYTECODE_CACHE_DIRECTORY) ||
    relativePath.endsWith(".pyc");
}

/**
 * 比较 POSIX 路径的 UTF-8 字节。
 *
 * @param {{path:string}} left 左侧条目
 * @param {{path:string}} right 右侧条目
 * @returns {number} 排序结果
 */
function comparePathBytes(left, right) {
  return Buffer.compare(Buffer.from(left.path, "utf8"), Buffer.from(right.path, "utf8"));
}

/**
 * 编码无符号长度字段。
 *
 * @param {number|bigint} value 长度
 * @param {4|8} bytes 字段宽度
 * @returns {Buffer} 大端编码
 */
function encodeLength(value, bytes) {
  const buffer = Buffer.alloc(bytes);
  if (bytes === 4) buffer.writeUInt32BE(Number(value));
  else buffer.writeBigUInt64BE(BigInt(value));
  return buffer;
}

/**
 * 安全遍历目录并收集全部普通文件。
 *
 * @param {string} root Plugin 根目录
 * @param {{ignoreVolatile?:boolean}} [options] `ignoreVolatile` 为真时跳过运行时字节码缓存
 * @returns {Array<{path:string,absolutePath:string,size:number}>} 稳定排序前的文件条目
 */
export function listCanonicalTreeFiles(root, options = {}) {
  const ignoreVolatile = options.ignoreVolatile === true;
  const absoluteRoot = path.resolve(root);
  let rootStat;
  try {
    rootStat = fs.lstatSync(absoluteRoot);
  } catch (error) {
    throw new PluginIoError(`无法读取 Plugin 根目录:${absoluteRoot}`, { path: absoluteRoot, cause: error });
  }
  if (rootStat.isSymbolicLink()) {
    throw new PluginPathError(`Plugin 根目录不能是软链:${absoluteRoot}`, { path: absoluteRoot });
  }
  if (!rootStat.isDirectory()) {
    throw new PluginIntegrityError(`Plugin 根目录必须是目录:${absoluteRoot}`, { path: absoluteRoot });
  }

  /** @type {Array<{path:string,absolutePath:string,size:number}>} */
  const files = [];
  /**
   * 递归遍历目录。
   *
   * @param {string} directory 当前绝对目录
   * @param {string} relativeDirectory 当前 POSIX 相对目录
   */
  function visit(directory, relativeDirectory) {
    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch (error) {
      throw new PluginIoError(`无法读取 Plugin 目录:${directory}`, { path: directory, cause: error });
    }
    for (const entry of entries) {
      const relativePath = relativeDirectory
        ? `${relativeDirectory}/${entry.name}`
        : entry.name;
      assertSafePosixRelativePath(relativePath, "Plugin tree 路径");
      // 易变产物在此整枝剪掉:既不参与摘要，也不因缓存目录里的特殊文件而 fail closed。
      if (ignoreVolatile && isVolatileTreeArtifact(relativePath)) continue;
      const absolutePath = path.join(directory, entry.name);
      let stat;
      try {
        stat = fs.lstatSync(absolutePath);
      } catch (error) {
        throw new PluginIoError(`无法读取 Plugin 条目:${relativePath}`, { path: relativePath, cause: error });
      }
      if (stat.isSymbolicLink()) {
        throw new PluginPathError(`Plugin tree 不允许软链:${relativePath}`, { path: relativePath });
      }
      if (stat.isDirectory()) {
        visit(absolutePath, relativePath);
      } else if (stat.isFile()) {
        files.push({ path: relativePath, absolutePath, size: stat.size });
      } else {
        throw new PluginIntegrityError(`Plugin tree 不允许特殊文件:${relativePath}`, { path: relativePath });
      }
    }
  }

  visit(absoluteRoot, "");
  return files.sort(comparePathBytes);
}

/**
 * 计算 Plugin 文件树的 canonical SHA-256。
 *
 * 每个文件使用“路径长度 + 路径字节 + 内容长度 + 内容字节”编码，避免依赖分隔符。
 *
 * @param {string} root Plugin 根目录
 * @param {{ignoreVolatile?:boolean}} [options] `ignoreVolatile` 为真时跳过运行时字节码缓存
 * @returns {string} `sha256:<hex>` 摘要
 */
export function hashCanonicalTree(root, options = {}) {
  const hash = crypto.createHash("sha256");
  for (const entry of listCanonicalTreeFiles(root, options)) {
    const pathBytes = Buffer.from(entry.path, "utf8");
    let content;
    try {
      content = fs.readFileSync(entry.absolutePath);
    } catch (error) {
      throw new PluginIoError(`无法读取 Plugin 文件:${entry.path}`, { path: entry.path, cause: error });
    }
    hash.update(encodeLength(pathBytes.length, 4));
    hash.update(pathBytes);
    hash.update(encodeLength(content.length, 8));
    hash.update(content);
  }
  return `sha256:${hash.digest("hex")}`;
}

/**
 * 收集目录内运行时生成的易变产物入口，供删除受管目录前清场。
 *
 * 摘要既然已经忽略字节码缓存，删除受管目录时也必须一并清掉，
 * 否则非递归 `rmdir` 会因为残留的 `__pycache__` 报 `ENOTEMPTY`。
 * 只返回匹配到的最外层入口且跳过软链，保证调用方的递归删除不会越出项目边界。
 *
 * @param {string} root 目录绝对路径
 * @returns {string[]} 易变产物的绝对路径
 */
export function listVolatileTreeEntries(root) {
  const found = [];
  /**
   * 递归查找易变产物。
   *
   * @param {string} directory 当前绝对目录
   * @param {string} relativeDirectory 当前 POSIX 相对目录
   */
  function visit(directory, relativeDirectory) {
    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw new PluginIoError(`无法读取 Plugin 目录:${directory}`, { path: directory, cause: error });
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const relativePath = relativeDirectory
        ? `${relativeDirectory}/${entry.name}`
        : entry.name;
      const absolutePath = path.join(directory, entry.name);
      if (isVolatileTreeArtifact(relativePath)) {
        found.push(absolutePath);
        continue;
      }
      if (entry.isDirectory()) visit(absolutePath, relativePath);
    }
  }

  visit(path.resolve(root), "");
  return found.sort();
}
