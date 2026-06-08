import fs from "node:fs";
import path from "node:path";

/** 确保目录存在(等价 `mkdir -p`)。 */
export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

/** 递归删除(等价 `rm -rf`,目标不存在不报错)。 */
export function rmrf(target) {
  fs.rmSync(target, { recursive: true, force: true });
}

/**
 * 复制文件或目录到目标,已存在则无条件覆盖。
 *
 * 移植 skill-garden install.sh 的 install_one 语义:
 *   - 目标是软链时先删链,避免写穿到链接指向的真实文件;
 *   - 目标已存在时先整体 rm -rf 再复制,保证不残留被上游删掉的旧文件。
 *
 * @param {string} src 源文件/目录
 * @param {string} dst 目标路径
 */
export function copyPath(src, dst) {
  ensureDir(path.dirname(dst));
  // lstat 不跟随软链:软链需先删,否则 cpSync 可能写穿
  try {
    if (fs.lstatSync(dst).isSymbolicLink()) {
      fs.unlinkSync(dst);
    }
  } catch {
    // 目标不存在,无需处理
  }
  rmrf(dst);
  fs.cpSync(src, dst, { recursive: true });
}

/** 列出目录下的直接子目录名;目录不存在返回空数组。 */
export function listDirs(dir) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/** 列出目录下匹配后缀的文件名;目录不存在返回空数组。 */
export function listFiles(dir, ext) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && (!ext || e.name.endsWith(ext)))
      .map((e) => e.name);
  } catch {
    return [];
  }
}
