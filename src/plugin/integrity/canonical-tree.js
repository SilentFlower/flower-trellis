import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PluginIntegrityError, PluginIoError, PluginPathError } from "../errors.js";
import { assertSafePosixRelativePath } from "../schemas/shared.js";

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
 * @returns {Array<{path:string,absolutePath:string,size:number}>} 稳定排序前的文件条目
 */
export function listCanonicalTreeFiles(root) {
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
 * @returns {string} `sha256:<hex>` 摘要
 */
export function hashCanonicalTree(root) {
  const hash = crypto.createHash("sha256");
  for (const entry of listCanonicalTreeFiles(root)) {
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
