import fs from "node:fs";
import path from "node:path";
import { listFiles } from "./fs-utils.js";
import { shouldInstallName } from "./skill-filter.js";
import { preserveFirstBackup } from "./backup.js";

/** 等价 Python re.escape(用于把字面量安全嵌入正则)。 */
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 删除目标文本里同一个 skill 的旧 skill-garden override 块。
 *
 * @param {string} value 目标文件原文
 * @param {string} name skill 名称
 * @returns {string} 已清理旧块的文本
 */
function stripSkillOverride(value, name) {
  const re = new RegExp(
    "^#{2,4} HIGHEST PRIORITY: skill-garden .*\\n+" +
      "^<!-- BEGIN skill-garden skill override " +
      escapeRe(name) +
      "[^\\n]*-->\\n[\\s\\S]*?" +
      "^<!-- END skill-garden skill override " +
      escapeRe(name) +
      "[^\\n]*-->\\n*",
    "gm",
  );
  return value.replace(re, "");
}

/**
 * 把 override 块插入到 frontmatter 后、正文前;无 frontmatter 时优先插到首个 H1 后,
 * 都没有才插到文件顶部。
 *
 * @param {string} value 已清理旧块的目标文本
 * @param {string} block override 块
 * @returns {string} 注入后的文本
 */
function injectAfterFrontmatter(value, block) {
  const b = block.replace(/\s+$/, "");
  const m = /^---\n[\s\S]*?\n---\n/.exec(value);
  if (m) {
    const after = value.slice(m[0].length).replace(/^\n+/, "");
    return value.slice(0, m[0].length) + "\n" + b + "\n\n" + after;
  }
  // 无 frontmatter 的 command 文件首行标题常被平台当作命令描述来源;
  // override 放到标题后,避免把高优先级 override 标题暴露成命令名。
  const h1 = /^# [^\n]*\n/.exec(value);
  if (h1) {
    const after = value.slice(h1[0].length).replace(/^\n+/, "");
    return value.slice(0, h1[0].length) + "\n" + b + "\n\n" + after;
  }
  return b + "\n\n" + value.replace(/^\n+/, "");
}

/**
 * 对单个目标 Markdown 文件注入 skill override。
 *
 * @param {string} target 目标项目根
 * @param {string} targetFile 目标 SKILL.md 或 command markdown
 * @param {string} name skill 名称
 * @param {string} block override 块
 * @returns {{changed:boolean, target:string, backupNote?:string}}
 */
function injectOne(target, targetFile, name, block) {
  const text = fs.readFileSync(targetFile, "utf8");
  const clean = stripSkillOverride(text, name);
  const next = injectAfterFrontmatter(clean, block).replace(/\s+$/, "") + "\n";
  const legacyBackupFile = `${targetFile}.flower-skill-garden.bak`;

  if (next === text) {
    if (fs.existsSync(legacyBackupFile)) {
      const { backupNote } = preserveFirstBackup(target, targetFile, [
        legacyBackupFile,
      ]);
      return { changed: false, target: targetFile, backupNote };
    }
    return { changed: false, target: targetFile };
  }

  const { backupNote } = preserveFirstBackup(target, targetFile, [
    legacyBackupFile,
  ]);
  fs.writeFileSync(targetFile, next);
  return { changed: true, target: targetFile, backupNote };
}

/**
 * 注入 skill-garden 的 skill override 块。
 *
 * override 源放在 `overrides/skills/<skill>.md`,只向目标项目已有的上游 skill / command
 * 注入 BEGIN/END 包裹的增量块,不复制或维护整份 Trellis 原生 skill。
 *
 * @param {string} target 目标项目根
 * @param {string} variantDir 该变体在 enhancements/ 下的目录
 * @param {string[]} skills 用户通过 --skills 指定的过滤名
 * @returns {{skipped?:boolean, reason?:string, changed:number, unchanged:number, missing:number, targets:string[], backupNotes:string[]}}
 */
export function injectSkillOverrides(target, variantDir, skills = []) {
  const srcDir = path.join(variantDir, "overrides", "skills");
  const files = listFiles(srcDir, ".md");
  if (files.length === 0) {
    return {
      skipped: true,
      reason: "该变体无 skill override",
      changed: 0,
      unchanged: 0,
      missing: 0,
      targets: [],
      backupNotes: [],
    };
  }

  let changed = 0;
  let unchanged = 0;
  let missing = 0;
  const targets = [];
  const backupNotes = new Set();

  for (const file of files) {
    const name = file.replace(/\.md$/, "");
    const aliases = name === "trellis-finish-work"
      ? ["finish-work-enhancement"]
      : name === "trellis-update-spec"
        ? ["update-spec-enhancement"]
        : [];
    if (!shouldInstallName(name, skills, aliases)) continue;
    const block = fs.readFileSync(path.join(srcDir, file), "utf8").replace(/\s+$/, "");
    const targetFiles = [
      path.join(target, ".agents", "skills", name, "SKILL.md"),
      path.join(target, ".claude", "skills", name, "SKILL.md"),
      path.join(target, ".claude", "commands", "trellis", `${name.replace(/^trellis-/, "")}.md`),
    ].filter((p) => fs.existsSync(p));

    if (targetFiles.length === 0) {
      missing++;
      continue;
    }

    for (const targetFile of targetFiles) {
      const r = injectOne(target, targetFile, name, block);
      targets.push(path.relative(target, r.target).split(path.sep).join("/"));
      if (r.changed) changed++;
      else unchanged++;
      if (r.backupNote) backupNotes.add(r.backupNote);
    }
  }

  return {
    changed,
    unchanged,
    missing,
    targets,
    backupNotes: [...backupNotes],
  };
}
