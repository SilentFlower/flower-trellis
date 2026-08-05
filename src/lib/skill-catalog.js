import fs from "node:fs";
import path from "node:path";
import { copyPath, ensureDir, listDirs, rmrf } from "./fs-utils.js";
import {
  isEnhancementSkillInstalled,
  listEnhancementSkillNames,
  resolveEnhancementSnapshot,
} from "./enhancement-catalog.js";
import { ENHANCEMENTS_ROOT } from "./paths.js";

const COMMON_SKILL_DIRS = [
  {
    source: ".common/.codex/skills",
    target: ".codex/skills",
    platformDir: ".codex",
    fallback: false,
  },
  {
    source: ".common/.claude/skills",
    target: ".claude/skills",
    platformDir: ".claude",
    fallback: true,
  },
];

const LEGACY_COMMON_SKILL_DIRS = [
  {
    source: ".common/.codex/skills",
    target: ".agents/skills",
  },
];

const SKILL_DESCRIPTION_OVERRIDES = {
  "analyze-task": "深度分析并细化任务",
  "check-all": "全维度检查任务与实现",
  "check-impl": "检查实现是否符合任务要求",
  "check-prd": "校验 PRD 准确性和覆盖度",
  "check-prd-impl": "对照 PRD 检查实现完整性",
  "create-prd": "从原始需求创建任务 PRD",
  "craft-rpa": "录制浏览器流程并生成 RPA 改造参考",
  "craft-slides": "用 Slidev 制作并导出演示文稿",
  "draw-uml": "绘制 UML 活动图梳理业务流程",
  "humanize-writing": "润色中文文本，去掉 AI 腔",
  "open-idea": "跨平台打开 IDEA 项目",
  "plan-version": "规划版本任务、波次和分工",
  push: "提交、推送并同步任务进度",
  "re-implement": "需求变更后重新实现",
  "sync-prd": "根据代码或需求变化同步 PRD",
  "torrent-analyze": "解析磁链或种子 hash 并整理信息",
  "trellis-analyze-task": "深度分析并细化任务",
  "trellis-auto-loop": "自动推进 Trellis 任务循环",
  "trellis-check-all": "提交前全面检查任务与代码",
  "trellis-create-command": "创建 Trellis 命令或技能",
  "trellis-create-prd": "从原始需求创建任务 PRD",
  "trellis-diff-brief": "快速总结当前 git 改动",
  "trellis-draw-uml": "绘制 UML 活动图梳理业务流程",
  "trellis-extract-prd": "从需求文档提取任务 PRD",
  "trellis-flower-update": "手动追平已安装 Flower 强化包",
  "trellis-migrate-skill": "迁移旧命令为 Trellis skill",
  "trellis-plan-version": "规划版本任务、波次和分工",
  "trellis-push": "提交、推送并同步任务进度",
  "trellis-re-implement": "需求变更后重新实现",
  "trellis-release": "整理上线事项和 release 清单",
  "trellis-route": "选择实现和检查的执行模式",
  "trellis-run-full-chain": "按场景做 UI、API、DB 全链路验证",
  "trellis-sync-prd": "根据代码或需求变化同步 PRD",
  "trellis-task-brief": "生成或刷新任务交接摘要",
  "trellis-verify-task": "校验任务文档是否覆盖需求",
  "trellis-verify-prd": "校验 PRD 准确性和覆盖度",
  "trellis-visualize": "生成架构、流程或状态图",
  "trellis-worktree": "管理分支本地化 Trellis worktree",
};

/**
 * 从简单 YAML frontmatter 中解析指定字段。
 *
 * 这里只解析 Trellis / skill-garden skill 文件实际使用的 `name` 与 `description`,
 * 避免为了两个字段引入完整 YAML 依赖。
 *
 * @param {string} content Markdown 文件内容
 * @returns {{name?: string, description?: string}} 解析出的元数据
 */
export function parseSkillFrontmatter(content) {
  const lines = content.split(/\r?\n/);
  if (lines[0] !== "---") return {};

  const end = lines.findIndex((line, index) => index > 0 && line === "---");
  if (end < 0) return {};

  const meta = {};
  for (let i = 1; i < end; i++) {
    const m = lines[i].match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m) continue;

    const key = m[1];
    const rawValue = m[2].trim();
    if (rawValue === "|" || rawValue === ">") {
      const parts = [];
      for (let j = i + 1; j < end; j++) {
        if (/^[A-Za-z0-9_-]+:\s*/.test(lines[j])) break;
        parts.push(lines[j].trim());
        i = j;
      }
      meta[key] = parts.filter(Boolean).join(" ");
      continue;
    }

    meta[key] = unquoteFrontmatterValue(rawValue);
  }

  return meta;
}

/**
 * 去掉 Markdown 顶部的简单 YAML frontmatter。
 *
 * @param {string} content Markdown 文件内容
 * @returns {string} 正文内容
 */
export function stripSkillFrontmatter(content) {
  const lines = content.split(/\r?\n/);
  if (lines[0] !== "---") return content;
  const end = lines.findIndex((line, index) => index > 0 && line === "---");
  if (end < 0) return content;
  return lines.slice(end + 1).join("\n").replace(/^\n+/, "");
}

/**
 * 去掉 frontmatter 标量外层引号。
 *
 * @param {string} value frontmatter 原始值
 * @returns {string} 去引号后的值
 */
function unquoteFrontmatterValue(value) {
  if (!value) return "";
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\'/g, "'");
  }
  return value;
}

/**
 * 读取单个 SKILL.md 的基础元数据。
 *
 * @param {string} file SKILL.md 路径
 * @param {string} fallbackName 读取失败或缺少 name 时使用的名称
 * @returns {{name: string, description: string}} skill 元数据
 */
function readSkillMetadata(file, fallbackName) {
  try {
    const content = fs.readFileSync(file, "utf8");
    const meta = parseSkillFrontmatter(content);
    return {
      name: meta.name || fallbackName,
      description: meta.description || summarizeMarkdown(content),
    };
  } catch {
    return { name: fallbackName, description: "" };
  }
}

/**
 * 判断通用技能快照是否存在。
 *
 * @returns {boolean} 是否存在随包 common 快照
 */
function hasCommonSnapshot() {
  return fs.existsSync(path.join(ENHANCEMENTS_ROOT, "common", ".common"));
}

/**
 * 列出当前通用技能快照里的 skill 名称。
 *
 * @returns {string[]} 通用技能名称
 */
function listCommonSnapshotNames() {
  if (!hasCommonSnapshot()) return [];
  const names = new Set();
  for (const dir of COMMON_SKILL_DIRS) {
    for (const name of listDirs(path.join(ENHANCEMENTS_ROOT, "common", dir.source))) {
      names.add(name);
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

/**
 * 汇总 common skill 的 canonical 与历史目标映射。
 *
 * 历史 `.agents/skills` 使用 Codex 快照原地刷新，避免升级时迁移到
 * `.codex/skills` 后产生双副本。
 *
 * @returns {Array<{source:string,target:string}>} common skill 目标映射
 */
function allCommonSkillDirs() {
  return [...COMMON_SKILL_DIRS, ...LEGACY_COMMON_SKILL_DIRS];
}

/**
 * 判断 manifest 中的 skill 名称能否安全拼接到固定目标目录。
 *
 * @param {unknown} name 待校验名称
 * @returns {name is string} 是否为单一路径段
 */
function isSafeSkillName(name) {
  return typeof name === "string" &&
    name.length > 0 &&
    name !== "." &&
    name !== ".." &&
    !name.includes("/") &&
    !name.includes("\\");
}

/**
 * 读取随包 manifest 中累计的已移除 common skill 名称。
 *
 * manifest 属于发布快照元数据，读取失败时按空列表降级，不能阻断其它强化更新。
 *
 * @returns {string[]} 排序去重后的 tombstone 名称
 */
function listRemovedCommonSkillNames() {
  try {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(ENHANCEMENTS_ROOT, "MANIFEST.json"), "utf8"),
    );
    const names = Array.isArray(manifest?.common?.removedSkills)
      ? manifest.common.removedSkills
      : [];
    return [...new Set(names.filter(isSafeSkillName))].sort((a, b) =>
      a.localeCompare(b)
    );
  } catch {
    return [];
  }
}

/**
 * 描述当前项目中已启用 common skill 的无写入同步输入。
 *
 * @param {string} target 目标项目根目录
 * @returns {{refreshes:Array<{source:string,target:string,name:string}>,removedTargets:string[]}} 快照来源与 tombstone 目标
 */
export function describeInstalledCommonSkillSync(target) {
  const refreshes = [];
  const currentNames = new Set(listCommonSnapshotNames());
  for (const name of currentNames) {
    for (const dir of allCommonSkillDirs()) {
      const targetPath = `${dir.target}/${name}`;
      if (!fs.existsSync(path.join(target, ...targetPath.split("/")))) continue;
      const source = path.join(ENHANCEMENTS_ROOT, "common", dir.source, name);
      if (!fs.existsSync(source)) continue;
      refreshes.push({ source, target: targetPath, name });
    }
  }
  const removedTargets = [];
  for (const name of listRemovedCommonSkillNames()) {
    if (currentNames.has(name)) continue;
    for (const dir of allCommonSkillDirs()) {
      const targetPath = `${dir.target}/${name}`;
      if (fs.existsSync(path.join(target, ...targetPath.split("/")))) {
        removedTargets.push(targetPath);
      }
    }
  }
  return { refreshes, removedTargets };
}

/**
 * 查找通用技能的源 SKILL.md。
 *
 * @param {string} name skill 名称
 * @returns {string|null} SKILL.md 路径
 */
function findCommonSkillMetadataFile(name) {
  for (const dir of COMMON_SKILL_DIRS) {
    const file = path.join(
      ENHANCEMENTS_ROOT,
      "common",
      dir.source,
      name,
      "SKILL.md",
    );
    if (fs.existsSync(file)) return file;
  }
  return null;
}

/**
 * 查找 skill-garden 工作流强化 skill 的源 SKILL.md。
 *
 * @param {string} variantDir 增强包变体目录
 * @param {string} name skill 名称
 * @returns {string|null} SKILL.md 路径
 */
function findEnhancementSkillMetadataFile(variantDir, name) {
  const candidates = [
    path.join(variantDir, ".agents", "skills", name, "SKILL.md"),
    path.join(variantDir, ".claude", "skills", name, "SKILL.md"),
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

/**
 * 从普通 Markdown 模板中提取一个兜底简介。
 *
 * @param {string} content Markdown 内容
 * @returns {string} 兜底简介
 */
function summarizeMarkdown(content) {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.replace(/^#+\s*/, "").trim())
    .filter(Boolean);
  return lines.find((line) => !line.startsWith("```")) || "";
}

/**
 * 判断文本是否包含中文字符。
 *
 * @param {string} text 待检查文本
 * @returns {boolean} 是否包含中文字符
 */
function hasChineseText(text) {
  return /[\u3400-\u9fff]/.test(text);
}

/**
 * 把长描述压成适合菜单展示的一行。
 *
 * @param {string} description 原始描述
 * @param {number} maxLength 最大长度
 * @returns {string} 简短描述
 */
export function summarizeSkillDescription(description, maxLength = 72) {
  const normalized = String(description || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "暂无用途简介";

  const sentence = normalized.split(/[。.!?]/)[0] || normalized;
  const text = sentence.trim() || normalized;
  if (!hasChineseText(text) && /[A-Za-z]/.test(text)) return "查看技能说明";
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

/**
 * 选择菜单里展示的中文短描述。
 *
 * @param {string} name skill 名称
 * @param {string} description 从 SKILL.md 读取到的描述
 * @returns {string} 中文短描述
 */
function preferredSkillDescription(name, description) {
  if (SKILL_DESCRIPTION_OVERRIDES[name]) return SKILL_DESCRIPTION_OVERRIDES[name];
  return summarizeSkillDescription(description);
}

/**
 * 判断目标项目是否已安装通用技能。
 *
 * @param {string} target 目标项目根目录
 * @param {string} name skill 名称
 * @returns {boolean} 是否已安装
 */
function isCommonSkillInstalled(target, name) {
  return allCommonSkillDirs().some((dir) =>
    fs.existsSync(path.join(target, ...dir.target.split("/"), name))
  );
}

/**
 * 读取当前可管理的通用技能元数据。
 *
 * @param {string} target 目标项目根目录
 * @returns {{name: string, description: string, installed: boolean}[]} 通用技能清单
 */
function listCommonSkills(target) {
  const rows = [];

  for (const name of listCommonSnapshotNames()) {
    const file = findCommonSkillMetadataFile(name);
    const meta = readSkillMetadata(file || "", name);
    rows.push({
      name,
      description: preferredSkillDescription(name, meta.description),
      installed: isCommonSkillInstalled(target, name),
    });
  }

  return rows.sort((a, b) => {
    if (a.installed !== b.installed) return a.installed ? 1 : -1;
    return a.name.localeCompare(b.name);
  });
}

/**
 * 读取当前变体的 skill-garden 工作流强化 skill 元数据。
 *
 * 这些条目随 `init` / `update` 自动维护,只在菜单中只读展示,不允许勾选停用。
 *
 * @param {string} target 目标项目根目录
 * @param {string} variantDir 增强包变体目录
 * @returns {{name: string, description: string, installed: boolean}[]} 强化 skill 清单
 */
function listWorkflowEnhancementSkills(target, variantDir) {
  const commonNames = new Set(listCommonSnapshotNames());
  return listEnhancementSkillNames(variantDir)
    .filter((name) => !commonNames.has(name))
    .map((name) => {
      const file = findEnhancementSkillMetadataFile(variantDir, name);
      const meta = readSkillMetadata(file || "", name);
      return {
        name,
        description: preferredSkillDescription(name, meta.description),
        installed: isEnhancementSkillInstalled(target, name),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * 汇总 `flower-trellis skill` 菜单所需的通用技能。
 *
 * @param {string} target 目标项目根目录
 * @param {string|null|undefined} variantOverride 用户指定的增强包变体
 * @returns {{variant: string, version: string, commonSkills: object[], enhancementSkills: object[]}} 菜单清单
 */
export function listSkillCatalog(target, variantOverride) {
  const { variant, version, variantDir } = resolveEnhancementSnapshot(
    target,
    variantOverride,
  );
  return {
    variant,
    version,
    commonSkills: listCommonSkills(target),
    enhancementSkills: listWorkflowEnhancementSkills(target, variantDir),
  };
}

/**
 * 计算目标项目应安装通用技能的平台目录。
 *
 * @param {string} target 目标项目根目录
 * @returns {typeof COMMON_SKILL_DIRS} 平台目录配置
 */
function activeCommonTargets(target) {
  const active = COMMON_SKILL_DIRS.filter((dir) =>
    fs.existsSync(path.join(target, ...dir.platformDir.split("/"))),
  );
  if (active.length > 0) return active;
  return COMMON_SKILL_DIRS.filter((dir) => dir.fallback);
}

/**
 * 安装指定通用技能,只从通用技能快照复制精确匹配的 skill。
 *
 * @param {string} target 目标项目根目录
 * @param {string[]} names 要启用的通用技能名称
 * @returns {{installed: string[], paths: string[], skipped: string[]}} 安装结果
 */
export function installCommonSkills(target, names) {
  const available = new Set(listCommonSnapshotNames());
  const installed = new Set();
  const paths = [];
  const skipped = [];

  for (const name of names) {
    if (!available.has(name)) {
      skipped.push(name);
      continue;
    }

    let installedOne = false;
    for (const dir of activeCommonTargets(target)) {
      const src = path.join(ENHANCEMENTS_ROOT, "common", dir.source, name);
      if (!fs.existsSync(src)) continue;

      const dst = path.join(target, ...dir.target.split("/"), name);
      ensureDir(path.dirname(dst));
      copyPath(src, dst);
      installed.add(name);
      paths.push(`${dir.target}/${name}`);
      installedOne = true;
    }

    if (!installedOne) skipped.push(name);
  }

  return { installed: [...installed], paths, skipped };
}

/**
 * 用当前随包快照同步目标仓库中已经启用的 common skill。
 *
 * 当前快照只覆盖已经存在的精确目标目录，因此不会安装用户未启用的新 skill；
 * tombstone 只删除固定 common 根目录中的历史名称，避免扫描或误删其它用户内容。
 *
 * @param {string} target 目标项目根目录
 * @returns {{refreshed:string[],removed:string[],refreshedPaths:string[],removedPaths:string[]}} 同步结果
 */
export function syncInstalledCommonSkills(target) {
  const refreshed = new Set();
  const removed = new Set();
  const refreshedPaths = [];
  const removedPaths = [];
  const currentNames = new Set(listCommonSnapshotNames());

  for (const name of currentNames) {
    for (const dir of allCommonSkillDirs()) {
      const rel = `${dir.target}/${name}`;
      const dst = path.join(target, ...dir.target.split("/"), name);
      if (!fs.existsSync(dst)) continue;

      const src = path.join(ENHANCEMENTS_ROOT, "common", dir.source, name);
      if (!fs.existsSync(src)) continue;

      copyPath(src, dst);
      refreshed.add(name);
      refreshedPaths.push(rel);
    }
  }

  for (const name of listRemovedCommonSkillNames()) {
    // 防御旧 manifest 漂移：重新进入当前快照的名称绝不能被 tombstone 删除。
    if (currentNames.has(name)) continue;

    for (const dir of allCommonSkillDirs()) {
      const rel = `${dir.target}/${name}`;
      const dst = path.join(target, ...dir.target.split("/"), name);
      if (!fs.existsSync(dst)) continue;

      rmrf(dst);
      removed.add(name);
      removedPaths.push(rel);
    }
  }

  return {
    refreshed: [...refreshed],
    removed: [...removed],
    refreshedPaths,
    removedPaths,
  };
}

/**
 * 停用指定通用技能,只删除通用技能清单声明过的精确 skill 路径。
 *
 * @param {string} target 目标项目根目录
 * @param {string|null|undefined} variantOverride 用户指定的增强包变体
 * @param {string[]} names 要停用的通用技能名称
 * @returns {{removed: string[], skipped: string[]}} 已删除与未发现的路径
 */
export function removeCommonSkills(target, variantOverride, names) {
  resolveEnhancementSnapshot(target, variantOverride);
  const available = new Set(listCommonSnapshotNames());
  const removed = [];
  const skipped = [];

  for (const name of names) {
    if (!available.has(name)) {
      skipped.push(name);
      continue;
    }

    let removedOne = false;
    for (const { target: base } of allCommonSkillDirs()) {
      const rel = `${base}/${name}`;
      const abs = path.join(target, ...base.split("/"), name);
      if (fs.existsSync(abs)) {
        rmrf(abs);
        removed.push(rel);
        removedOne = true;
      }
    }
    if (!removedOne) skipped.push(name);
  }

  for (const { target: base } of allCommonSkillDirs()) {
    const abs = path.join(target, ...base.split("/"));
    try {
      if (fs.readdirSync(abs).length === 0) fs.rmdirSync(abs);
    } catch {
      // 不存在或非空,忽略
    }
  }

  return { removed, skipped };
}
