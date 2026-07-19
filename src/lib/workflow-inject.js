import fs from "node:fs";
import path from "node:path";
import {
  LEGACY_NO_TASK_BLOCK,
  LEGACY_PLANNING_BLOCK,
  LEGACY_PUSH_PROGRESS_BLOCK,
  LEGACY_IN_PROGRESS_BLOCK,
  LEGACY_PUSH_SNAPSHOT_BLOCK,
} from "./legacy-blocks.js";
import { preserveFirstBackup } from "./backup.js";

/**
 * 0.5/old workflow.md 兼容注入。
 *
 * 纯 JS 移植 skill-garden install.sh 362-557 的内嵌 Python:
 *   1. 首次注入前备份到 .trellis/.backup-flower/(已存在则保留);
 *   2. 先清掉所有旧的 skill-garden 段(3 个 SECTION + 13 个 sentinel),保证可重复升级;
 *   3. 把 route 块注入到 `## Phase Index` 之后(找不到则顶部 fallback);
 *   4. 用 legacy 常量替换当前变体管理的 workflow-state 块;
 *   5. 处理后内容与原文件相同则不写盘(幂等)。
 *
 * Python re.DOTALL|re.MULTILINE → JS 用 `[\s\S]` 代替 `.`(免 s flag)+ `m` flag;
 * SECTION/SENTINEL 全局替换用 `g`,state 替换只替首个(对应 Python count=1)故不加 `g`。
 */

/** 等价 Python re.escape(用于把字面量安全嵌入正则)。 */
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// 3 个 SECTION 段(heading + BEGIN/END 注释包裹的整块)
const SECTION_PATTERNS = [
  "^#{2,4} HIGHEST PRIORITY: skill-garden overrides[^\\n]*\\n+" +
    "^<!-- BEGIN skill-garden overrides[^\\n]*-->\\n[\\s\\S]*?" +
    "^<!-- END skill-garden overrides[^\\n]*-->\\n*",
  "^#{2,4} (?:skill-garden Override: trellis-route routing|HIGHEST PRIORITY: skill-garden trellis-route routing gate)[^\\n]*\\n+" +
    "^<!-- BEGIN skill-garden enhancement[^\\n]*-->\\n[\\s\\S]*?" +
    "^<!-- END skill-garden enhancement[^\\n]*-->\\n*",
  "^#{2,4} HIGHEST PRIORITY: skill-garden finish-work bookkeeping guard[^\\n]*\\n+" +
    "^<!-- BEGIN skill-garden finish-work override[^\\n]*-->\\n[\\s\\S]*?" +
    "^<!-- END skill-garden finish-work override[^\\n]*-->\\n*",
];
const SECTION_RES = SECTION_PATTERNS.map((p) => new RegExp(p, "gm"));

// 13 个 sentinel 名(每个对应一对 BEGIN/END 注释块)
const SENTINEL_NAMES = [
  "skill-garden overrides",
  "skill-garden enhancement",
  "skill-garden finish-work override",
  "skill-garden workflow-state no-task-gate",
  "skill-garden workflow-state planning-handoff",
  "skill-garden workflow-state trellis-route",
  "skill-garden workflow-state push-progress-recovery",
  "skill-garden workflow-state in-progress-push-snapshot",
  "skill-garden workflow-state no_task",
  "skill-garden workflow-state planning",
  "skill-garden workflow-state planning_inline",
  "skill-garden workflow-state in_progress",
  "skill-garden workflow-state in_progress_inline",
];
const SENTINEL_RES = SENTINEL_NAMES.map(
  (name) =>
    new RegExp(
      "^<!-- BEGIN " +
        escapeRe(name) +
        "[^\\n]*-->\\n[\\s\\S]*?^<!-- END " +
        escapeRe(name) +
        "[^\\n]*-->\\n*",
      "gm",
    ),
);

const PHASE_INDEX_RE = /^(## Phase Index[^\n]*\n)/m;

/** 构造某 workflow-state 块的匹配正则(只替首个,不加 g)。 */
function stateRe(state) {
  return new RegExp(
    "^(\\[workflow-state:" +
      escapeRe(state) +
      "\\]\\n)([\\s\\S]*?)(^\\[/workflow-state:" +
      escapeRe(state) +
      "\\])",
    "m",
  );
}

/** 删除所有旧的 skill-garden 段(SECTION + sentinel)。 */
function stripBlocks(value) {
  for (const re of SECTION_RES) value = value.replace(re, "");
  for (const re of SENTINEL_RES) value = value.replace(re, "");
  return value;
}

/** 把 block 注入到 `## Phase Index` 锚点之后;找不到锚点则注入顶部。 */
function injectAfterPhaseIndex(value, block) {
  const b = block.replace(/\s+$/, ""); // rstrip
  const m = PHASE_INDEX_RE.exec(value);
  if (m) {
    const end = m.index + m[0].length;
    const after = value.slice(end).replace(/^\n+/, ""); // lstrip("\n")
    return {
      value: value.slice(0, end) + "\n" + b + "\n\n" + after,
      action: "插入到 ## Phase Index 顶部",
    };
  }
  return {
    value: b + "\n\n" + value,
    action: "注入顶部 (fallback: 未找到 Phase Index 锚点)",
  };
}

/** 替换某 workflow-state 块:open + 新 block + 原 body(去首换行/尾空白) + close。 */
function replaceState(value, re, block) {
  let replaced = false;
  const out = value.replace(re, (_full, open, body, close) => {
    replaced = true;
    const t = body.replace(/^\n+/, "").replace(/\s+$/, "");
    const bodyPart = t ? t + "\n" : "";
    return open + block + bodyPart + close;
  });
  return [out, replaced];
}

/**
 * 对目标项目的 .trellis/workflow.md 执行 0.5/old 兼容注入。
 *
 * @param {string} target 目标项目根
 * @param {string} variantDir 该变体在 enhancements/ 下的目录
 * @param {string} variant "old" | "0.5"
 * @returns {{skipped?:boolean, reason?:string, changed?:boolean, action?:string, backupNote?:string}}
 */
export function injectWorkflow(target, variantDir, variant) {
  const dst = path.join(target, ".trellis", "workflow.md");
  if (!fs.existsSync(dst)) {
    return { skipped: true, reason: "目标无 .trellis/workflow.md" };
  }

  const routeSrc = path.join(variantDir, "overrides", "trellis-route.md");
  if (!fs.existsSync(routeSrc)) {
    return { skipped: true, reason: `变体 ${variant} 无 overrides` };
  }

  const text = fs.readFileSync(dst, "utf8");

  // 备份只建一次,保持“首次注入前原文”的回滚语义;目录沿用 Trellis 的 .backup-* 忽略规则。
  const { backupNote } = preserveFirstBackup(target, dst, [`${dst}.bak`]);

  const clean = stripBlocks(text);
  const block = fs.readFileSync(routeSrc, "utf8").replace(/\s+$/, "");
  const { value: phaseNew, action } = injectAfterPhaseIndex(clean, block);

  const stateSpecs = [
    ["no_task", LEGACY_NO_TASK_BLOCK + LEGACY_PUSH_PROGRESS_BLOCK],
    ["planning", LEGACY_PLANNING_BLOCK],
    ["in_progress", LEGACY_IN_PROGRESS_BLOCK + LEGACY_PUSH_SNAPSHOT_BLOCK],
    ["in_progress-inline", LEGACY_PUSH_SNAPSHOT_BLOCK],
  ];

  let newText = phaseNew;
  for (const [state, blk] of stateSpecs) {
    [newText] = replaceState(newText, stateRe(state), blk);
  }
  newText = newText.replace(/\s+$/, "") + "\n";

  if (newText === text) {
    return { changed: false, backupNote };
  }
  fs.writeFileSync(dst, newText);
  return { changed: true, action, backupNote };
}
