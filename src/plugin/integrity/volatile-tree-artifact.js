/** Python 解释器在导入脚本时自动生成的字节码缓存目录名。 */
const BYTECODE_CACHE_DIRECTORY = "__pycache__";

/**
 * 判断 tree 相对路径是否为运行时自动生成的易变产物。
 *
 * @param {string} relativePath POSIX 相对路径
 * @returns {boolean} 是否属于易变产物
 */
export function isVolatileTreeArtifact(relativePath) {
  return relativePath.split("/").includes(BYTECODE_CACHE_DIRECTORY) ||
    relativePath.endsWith(".pyc");
}
