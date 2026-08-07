import crypto from "node:crypto";
import fs from "node:fs";
import { PluginIoError, PluginPathError } from "../errors.js";
import { hashCanonicalTree } from "../integrity/canonical-tree.js";

/**
 * 计算单个普通文件或字节内容的 SHA-256。
 *
 * @param {Buffer|string} content 文件字节
 * @returns {string} `sha256:<hex>` 摘要
 */
export function hashContent(content) {
  return `sha256:${crypto.createHash("sha256").update(content).digest("hex")}`;
}

/**
 * 读取目标普通文件摘要；缺失返回 null，软链或非普通文件直接失败。
 *
 * @param {string} target 目标绝对路径
 * @returns {string|null} 当前摘要
 */
export function hashFileIfExists(target) {
  try {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink()) throw new PluginPathError(`Plugin 目标不能是软链:${target}`, { path: target });
    if (!stat.isFile()) throw new PluginPathError(`Plugin 目标必须是普通文件:${target}`, { path: target });
    return hashContent(fs.readFileSync(target));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    if (error instanceof PluginPathError) throw error;
    throw new PluginIoError(`无法读取 Plugin 目标:${target}`, { path: target, cause: error });
  }
}

/**
 * 读取目录 canonical tree 摘要；缺失返回 null，软链或非目录直接失败。
 *
 * 这是「安装态漂移判定」而非「包完整性校验」：受管目录里的 Python 脚本被执行后
 * 会就地生成 `__pycache__/*.pyc`，这类运行时产物不计入摘要，
 * 否则会把未经用户修改的目录误判为漂移。包来源的 `integrity` 仍走严格 canonical tree。
 *
 * @param {string} target 目录绝对路径
 * @returns {string|null} 当前目录摘要
 */
export function hashDirectoryIfExists(target) {
  try {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink()) throw new PluginPathError(`Plugin 目录不能是软链:${target}`, { path: target });
    if (!stat.isDirectory()) throw new PluginPathError(`Plugin 路径必须是目录:${target}`, { path: target });
    return hashCanonicalTree(target, { ignoreVolatile: true });
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    if (error instanceof PluginPathError) throw error;
    throw new PluginIoError(`无法读取 Plugin 目录:${target}`, { path: target, cause: error });
  }
}
