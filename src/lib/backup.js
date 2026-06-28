import fs from "node:fs";
import path from "node:path";

const FLOWER_BACKUP_ROOT = path.join(".trellis", ".backup-flower");

function toDisplayPath(value) {
  return value.split(path.sep).join("/");
}

/**
 * 为 flower-trellis 修改过的目标文件保留首次备份。
 *
 * @param {string} target 目标项目根目录
 * @param {string} targetFile 需要备份的目标文件绝对路径或相对路径
 * @param {string[]} legacyBackupFiles 旧版本生成的散落备份路径
 * @returns {{created:boolean, backupPath:string, backupNote:string}} 备份状态与展示路径
 */
export function preserveFirstBackup(target, targetFile, legacyBackupFiles = []) {
  const targetRoot = path.resolve(target);
  const sourceFile = path.isAbsolute(targetFile)
    ? targetFile
    : path.resolve(targetRoot, targetFile);
  const rel = path.relative(targetRoot, sourceFile);
  if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new Error(`备份目标不在项目内:${targetFile}`);
  }

  const backupRel = path.join(FLOWER_BACKUP_ROOT, rel);
  const backupFile = path.join(targetRoot, backupRel);
  const displayPath = toDisplayPath(backupRel);
  const legacyFiles = legacyBackupFiles.map((p) =>
    path.isAbsolute(p) ? p : path.resolve(targetRoot, p),
  );

  // 旧版 flower 会把回滚文件散落在源文件旁边;迁到 .backup-* 目录后再删除旧路径,避免继续污染 git。
  const existingLegacyFile = legacyFiles.find((p) => fs.existsSync(p));

  if (!fs.existsSync(backupFile)) {
    fs.mkdirSync(path.dirname(backupFile), { recursive: true });
    fs.copyFileSync(existingLegacyFile || sourceFile, backupFile);
    for (const legacyFile of legacyFiles) {
      if (fs.existsSync(legacyFile)) fs.unlinkSync(legacyFile);
    }
    return {
      created: true,
      backupPath: displayPath,
      backupNote: `(已创建 ${displayPath})`,
    };
  }

  for (const legacyFile of legacyFiles) {
    if (fs.existsSync(legacyFile)) fs.unlinkSync(legacyFile);
  }

  return {
    created: false,
    backupPath: displayPath,
    backupNote: `(保留已有 ${displayPath})`,
  };
}
