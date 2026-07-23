import fs from "node:fs";
import path from "node:path";
import { DEFAULT_UPDATE_BACKUP_RETENTION } from "../constants.js";

const UPDATE_BACKUP_PATTERN = /^\.backup-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/;

function isPathInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function resolveBackupRoots(target) {
  const projectPath = path.resolve(target);
  const trellisPath = path.join(projectPath, ".trellis");
  const projectRoot = fs.realpathSync(projectPath);
  const trellisRoot = fs.realpathSync(trellisPath);
  if (!isPathInside(projectRoot, trellisRoot)) {
    throw new Error(`.trellis 目录通过软链逃逸项目:${trellisPath}`);
  }
  return { trellisPath, trellisRoot };
}

function resolveBackupDirectory(roots, name) {
  if (!UPDATE_BACKUP_PATTERN.test(name)) {
    throw new Error(`升级备份名称不合法:${name}`);
  }

  const candidate = path.join(roots.trellisPath, name);
  const stat = fs.lstatSync(candidate);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`升级备份不是普通目录:.trellis/${name}`);
  }

  const realCandidate = fs.realpathSync(candidate);
  if (!isPathInside(roots.trellisRoot, realCandidate)) {
    throw new Error(`升级备份通过软链逃逸 .trellis:${candidate}`);
  }
  return candidate;
}

function uniqueWarnings(values) {
  return [...new Set(values.filter(Boolean))];
}

/**
 * 把 CLI 传入的升级备份保留数量归一化为非负整数。
 *
 * @param {unknown} value CLI 原始值；未提供时使用默认值
 * @returns {number} 非负安全整数，0 表示关闭自动清理
 */
export function normalizeUpdateBackupRetention(value) {
  const candidate = value === undefined
    ? DEFAULT_UPDATE_BACKUP_RETENTION
    : value;
  const text = typeof candidate === "number" ? String(candidate) : String(candidate ?? "").trim();
  if (!/^\d+$/.test(text)) {
    throw new Error("--backup-retention 需要非负整数，0 表示不清理升级备份");
  }
  const retention = Number(text);
  if (!Number.isSafeInteger(retention)) {
    throw new Error("--backup-retention 超出安全整数范围");
  }
  return retention;
}

/**
 * 读取目标项目当前合法的 Trellis 时间戳升级备份。
 *
 * @param {string} target 目标项目根目录
 * @returns {{ok:boolean,names:string[],warnings:string[]}} 快照是否可靠、备份名称与非致命警告
 */
export function snapshotUpdateBackups(target) {
  let roots;
  try {
    roots = resolveBackupRoots(target);
  } catch (error) {
    return {
      ok: false,
      names: [],
      warnings: [`无法读取升级备份:${error.message}`],
    };
  }

  const names = [];
  const warnings = [];
  let entries;
  try {
    entries = fs.readdirSync(roots.trellisPath, { withFileTypes: true });
  } catch (error) {
    return {
      ok: false,
      names: [],
      warnings: [`无法列出升级备份:${error.message}`],
    };
  }

  for (const entry of entries) {
    if (!UPDATE_BACKUP_PATTERN.test(entry.name)) continue;
    if (!entry.isDirectory()) {
      warnings.push(`跳过非目录升级备份:.trellis/${entry.name}`);
      continue;
    }
    try {
      resolveBackupDirectory(roots, entry.name);
      names.push(entry.name);
    } catch (error) {
      warnings.push(error.message);
    }
  }

  return {
    ok: true,
    names: [...new Set(names)].sort(),
    warnings: uniqueWarnings(warnings),
  };
}

/**
 * 计算升级备份的保留和删除计划。
 *
 * @param {string[]} names 当前合法备份名称
 * @param {number} retention 目标保留数量
 * @param {string[]} protectedNames 本轮新建、必须保留的备份名称
 * @returns {{retention:number,retained:string[],removable:string[],protected:string[]}} 清理计划
 */
export function planUpdateBackupRetention(names, retention, protectedNames = []) {
  const normalizedRetention = normalizeUpdateBackupRetention(retention);
  const candidates = [...new Set(names.filter((name) => UPDATE_BACKUP_PATTERN.test(name)))]
    .sort()
    .reverse();
  const candidateSet = new Set(candidates);
  const protectedSet = new Set(
    protectedNames.filter((name) => candidateSet.has(name)),
  );
  const retainedSet = new Set(protectedSet);

  for (const name of candidates) {
    if (retainedSet.size >= normalizedRetention) break;
    retainedSet.add(name);
  }

  return {
    retention: normalizedRetention,
    retained: candidates.filter((name) => retainedSet.has(name)),
    removable: candidates.filter((name) => !retainedSet.has(name)).reverse(),
    protected: candidates.filter((name) => protectedSet.has(name)),
  };
}

/**
 * 按保留策略预览或清理目标项目的 Trellis 时间戳升级备份。
 *
 * @param {string} target 目标项目根目录
 * @param {{retention:number,beforeSnapshot:{ok:boolean,names:string[],warnings:string[]},dryRun?:boolean,remove?:(candidate:string)=>void}} options 清理选项
 * @returns {{status:string,retention:number,retained:string[],removable:string[],removed:string[],protected:string[],warnings:string[]}} 清理结果
 */
export function pruneUpdateBackups(target, options) {
  const retention = normalizeUpdateBackupRetention(options?.retention);
  if (retention === 0) {
    return {
      status: "disabled",
      retention,
      retained: [],
      removable: [],
      removed: [],
      protected: [],
      warnings: [],
    };
  }

  const beforeSnapshot = options?.beforeSnapshot;
  if (!beforeSnapshot?.ok) {
    return {
      status: "skipped",
      retention,
      retained: [],
      removable: [],
      removed: [],
      protected: [],
      warnings: uniqueWarnings([
        ...(beforeSnapshot?.warnings || []),
        "更新前备份快照不可靠，已跳过自动清理",
      ]),
    };
  }

  const currentSnapshot = snapshotUpdateBackups(target);
  if (!currentSnapshot.ok) {
    return {
      status: "skipped",
      retention,
      retained: [],
      removable: [],
      removed: [],
      protected: [],
      warnings: uniqueWarnings([
        ...beforeSnapshot.warnings,
        ...currentSnapshot.warnings,
        "更新后备份快照不可靠，已跳过自动清理",
      ]),
    };
  }

  const previousNames = new Set(beforeSnapshot.names);
  const protectedNames = currentSnapshot.names.filter((name) => !previousNames.has(name));
  const plan = planUpdateBackupRetention(
    currentSnapshot.names,
    retention,
    protectedNames,
  );
  const warnings = uniqueWarnings([
    ...beforeSnapshot.warnings,
    ...currentSnapshot.warnings,
  ]);
  const removed = [];

  if (!options?.dryRun) {
    const remove = options?.remove || ((candidate) => {
      fs.rmSync(candidate, { recursive: true, force: false });
    });
    for (const name of plan.removable) {
      try {
        // 删除前重新解析真实路径，避免扫描后目录被替换导致写穿项目边界。
        const candidate = resolveBackupDirectory(resolveBackupRoots(target), name);
        remove(candidate);
        removed.push(name);
      } catch (error) {
        warnings.push(`清理 .trellis/${name} 失败:${error.message}`);
      }
    }
  }

  return {
    status: options?.dryRun ? "preview" : "completed",
    retention,
    retained: plan.retained,
    removable: plan.removable,
    removed,
    protected: plan.protected,
    warnings: uniqueWarnings(warnings),
  };
}
