import fs from "node:fs";
import path from "node:path";
import { extract } from "tar";
import { PluginPathError } from "../errors.js";
import { PLUGIN_RUNTIME_ERROR_CODES, PluginRuntimeError } from "../runtime-errors.js";
import { assertSafePosixRelativePath } from "../schemas/shared.js";
import { compareUtf8 } from "../stable-order.js";

const ALLOWED_ARCHIVE_TYPES = new Set(["File", "Directory"]);

/** 远程 Plugin 包在 archive 与 API tree 回退路径共用的资源上限。 */
export const REMOTE_PACKAGE_LIMITS = Object.freeze({
  maxEntryBytes: 25 * 1024 * 1024,
  maxEntries: 10_000,
  maxExtractedBytes: 250 * 1024 * 1024,
});

/**
 * 判断 archive 条目是否落在调用方明确选中的子目录内。
 *
 * @param {string} normalizedEntryPath 已规范化的 archive 条目路径
 * @param {string|null|undefined} subdir 选中的仓库子目录
 * @returns {boolean} 是否位于选中子目录
 */
function isInsideSelectedSubdir(normalizedEntryPath, subdir) {
  if (!subdir) return false;
  const relative = normalizedEntryPath.split("/").slice(1).join("/");
  return relative === subdir || relative.startsWith(`${subdir}/`);
}

/**
 * 从远程仓库归档中找到唯一顶层目录。
 *
 * @param {string} root 提取根
 * @param {string} label 来源标签
 * @returns {string} 仓库根目录
 */
export function findRemoteRepositoryRoot(root, label) {
  const entries = fs.readdirSync(root, { withFileTypes: true });
  if (entries.length !== 1 || !entries[0].isDirectory()) {
    throw new PluginRuntimeError(`${label} archive 顶层结构无效`, {
      code: PLUGIN_RUNTIME_ERROR_CODES.REMOTE_ARCHIVE_INVALID,
    });
  }
  return path.join(root, entries[0].name);
}

/**
 * 安全复制普通文件目录树。
 *
 * @param {string} source 来源目录
 * @param {string} target 目标目录
 * @param {string} [label] 来源标签
 */
export function copyOrdinaryDirectory(source, target, label = "远程 Plugin") {
  const sourceStat = fs.lstatSync(source);
  if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) {
    throw new PluginPathError(`${label} 根必须是普通目录:${source}`);
  }
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true }).sort((left, right) => compareUtf8(left.name, right.name))) {
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    const stat = fs.lstatSync(from);
    if (stat.isSymbolicLink()) throw new PluginPathError(`${label} 不允许链接:${entry.name}`);
    if (stat.isDirectory()) copyOrdinaryDirectory(from, to, label);
    else if (stat.isFile()) fs.copyFileSync(from, to);
    else throw new PluginPathError(`${label} 不允许特殊文件:${entry.name}`);
  }
}

/**
 * 安全提取远程 tar archive 并选择仓库子目录。
 *
 * @param {{archiveFile:string,extractRoot:string,subdir?:string|null,label:string,sourceId:string,extractArchive?:Function}} options 提取参数
 * @returns {Promise<{repositoryRoot:string,selectedRoot:string}>} 仓库根与选中根
 */
export async function extractRemoteArchive(options) {
  const extractArchive = options.extractArchive || extract;
  let unsafeEntry = null;
  let archiveEntries = 0;
  let extractedBytes = 0;
  await extractArchive({
    file: options.archiveFile,
    cwd: options.extractRoot,
    strict: true,
    preservePaths: false,
    chmod: false,
    preserveOwner: false,
    filter: (entryPath, entry) => {
      const normalized = entryPath.replace(/\/$/, "");
      archiveEntries += 1;
      const entrySize = Number(entry.size || 0);
      const segments = normalized.split("/");
      if (
        path.posix.isAbsolute(normalized) ||
        path.win32.isAbsolute(normalized) ||
        normalized.includes("\\") ||
        segments.some((segment) => !segment || segment === "." || segment === "..") ||
        archiveEntries > REMOTE_PACKAGE_LIMITS.maxEntries
      ) {
        unsafeEntry ||= entryPath;
        return false;
      }
      if (!ALLOWED_ARCHIVE_TYPES.has(entry.type) || entrySize > REMOTE_PACKAGE_LIMITS.maxEntryBytes) {
        if (isInsideSelectedSubdir(normalized, options.subdir)) unsafeEntry ||= entryPath;
        return false;
      }
      extractedBytes += entrySize;
      if (extractedBytes > REMOTE_PACKAGE_LIMITS.maxExtractedBytes) {
        unsafeEntry ||= entryPath;
        return false;
      }
      return true;
    },
  });
  if (unsafeEntry) {
    throw new PluginRuntimeError(`${options.label} archive 包含不安全条目:${unsafeEntry}`, {
      code: PLUGIN_RUNTIME_ERROR_CODES.REMOTE_ARCHIVE_INVALID,
      path: options.sourceId,
    });
  }
  const repositoryRoot = findRemoteRepositoryRoot(options.extractRoot, options.label);
  const selectedRoot = options.subdir
    ? path.join(repositoryRoot, ...assertSafePosixRelativePath(options.subdir, `${options.label} subdir`).split("/"))
    : repositoryRoot;
  const relative = path.relative(repositoryRoot, selectedRoot);
  if (relative.startsWith("..") || path.isAbsolute(relative) || !fs.existsSync(selectedRoot)) {
    throw new PluginPathError(`${options.label} subdir 不存在:${options.subdir || "."}`, {
      path: options.sourceId,
    });
  }
  return { repositoryRoot, selectedRoot };
}
