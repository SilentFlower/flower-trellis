import fs from "node:fs";
import path from "node:path";
import { listFiles } from "./fs-utils.js";
import { preserveFirstBackup } from "./backup.js";

const SHARED_HOOK_TARGETS = {
  "inject-workflow-state.py": [
    ".codex/hooks/inject-workflow-state.py",
    ".claude/hooks/inject-workflow-state.py",
  ],
};

function toDisplayPath(value) {
  return value.split(path.sep).join("/");
}

/** 对单个目标 hook 文件应用 shared hook override。 */
function applyHookOverride(target, sourceFile, targetRel) {
  const targetFile = path.join(target, ...targetRel.split("/"));
  if (!fs.existsSync(targetFile)) {
    return { status: "missing", target: targetRel };
  }

  const current = fs.readFileSync(targetFile, "utf8");
  const next = fs.readFileSync(sourceFile, "utf8");
  if (current === next) {
    return { status: "unchanged", target: targetRel };
  }

  const { backupNote } = preserveFirstBackup(target, targetFile);
  fs.writeFileSync(targetFile, next);
  return { status: "changed", target: targetRel, backupNote };
}

/**
 * 注入 skill-garden 的 shared hook override。
 *
 * override 源放在 `overrides/hooks/shared/<file>`,只覆盖目标项目已有的平台 hook 文件,
 * 不创建未启用的平台目录。hook override 是对 Trellis 原生 hook 的覆盖,不写入
 * `.flower-manifest.json` 的 paths,避免升级清理误删上游 hook。
 *
 * @param {string} target 目标项目根
 * @param {string} variantDir 该变体在 enhancements/ 下的目录
 * @returns {{skipped?:boolean,reason?:string,changed:number,unchanged:number,missing:number,unmapped:number,targets:string[],backupNotes:string[]}}
 */
export function injectHookOverrides(target, variantDir) {
  const srcDir = path.join(variantDir, "overrides", "hooks", "shared");
  const files = listFiles(srcDir);
  if (files.length === 0) {
    return {
      skipped: true,
      reason: "该变体无 hook override",
      changed: 0,
      unchanged: 0,
      missing: 0,
      unmapped: 0,
      targets: [],
      backupNotes: [],
    };
  }

  let changed = 0;
  let unchanged = 0;
  let missing = 0;
  let unmapped = 0;
  const targets = [];
  const backupNotes = new Set();

  for (const file of files) {
    const targetRels = SHARED_HOOK_TARGETS[file];
    if (!targetRels) {
      unmapped++;
      continue;
    }
    const sourceFile = path.join(srcDir, file);
    for (const targetRel of targetRels) {
      const result = applyHookOverride(target, sourceFile, targetRel);
      if (result.status === "changed") changed++;
      else if (result.status === "unchanged") unchanged++;
      else missing++;
      if (result.status !== "missing") targets.push(toDisplayPath(result.target));
      if (result.backupNote) backupNotes.add(result.backupNote);
    }
  }

  return {
    changed,
    unchanged,
    missing,
    unmapped,
    targets,
    backupNotes: [...backupNotes],
  };
}
