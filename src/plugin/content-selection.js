import {
  PLUGIN_RUNTIME_ERROR_CODES,
  PluginRuntimeError,
} from "./runtime-errors.js";
import {
  CONTENT_SKILL_NAME_PATTERN,
  assertSafePosixRelativePath,
} from "./schemas/shared.js";
import { compareUtf8 } from "./stable-order.js";

const CONTENT_SKILL_NAME_RE = new RegExp(CONTENT_SKILL_NAME_PATTERN);

/**
 * 判断 Skill 选择名是否是单段安全名称。
 *
 * @param {unknown} value 待判断值
 * @returns {boolean} 是否安全
 */
export function isContentSkillSelectionName(value) {
  return typeof value === "string" && CONTENT_SKILL_NAME_RE.test(value);
}

/**
 * 归一化用户选择的 Skill 名称列表。
 *
 * @param {string[]} values 原始名称或逗号列表
 * @param {{code?:string,path?:string}} [options] 错误选项
 * @returns {string[]} 稳定去重后的名称
 */
export function normalizeContentSkillNames(values, options = {}) {
  const code = options.code || PLUGIN_RUNTIME_ERROR_CODES.CONTENT_SELECTION_INVALID;
  const names = [...new Set((values || [])
    .flatMap((value) => String(value).split(","))
    .map((value) => value.trim())
    .filter(Boolean))]
    .sort(compareUtf8);
  if (names.length === 0) {
    throw new PluginRuntimeError("Content Skill 选择不能为空", {
      code,
      path: options.path || "contentSelection.skills",
    });
  }
  const invalid = names.find((name) => !isContentSkillSelectionName(name));
  if (invalid) {
    throw new PluginRuntimeError(`Content Skill 名称非法:${invalid}`, {
      code,
      path: options.path || invalid,
    });
  }
  return names;
}

/**
 * 从 Skill 名称列表构造内容选择对象。
 *
 * @param {string[]} values 原始名称或逗号列表
 * @param {{code?:string,path?:string}} [options] 错误选项
 * @returns {import("./contracts.js").PluginContentSelection} 内容选择
 */
export function contentSelectionFromSkillNames(values, options = {}) {
  return { skills: normalizeContentSkillNames(values, options) };
}

/**
 * 归一化内容选择对象。
 *
 * @param {import("./contracts.js").PluginContentSelection|null|undefined} selection 内容选择
 * @param {{code?:string,path?:string}} [options] 错误选项
 * @returns {import("./contracts.js").PluginContentSelection|undefined} 归一化选择；缺失时为 undefined
 */
export function normalizeContentSelection(selection, options = {}) {
  if (!selection) return undefined;
  if (!Array.isArray(selection.skills)) {
    throw new PluginRuntimeError("contentSelection.skills 必须是数组", {
      code: options.code || PLUGIN_RUNTIME_ERROR_CODES.CONTENT_SELECTION_INVALID,
      path: options.path || "contentSelection.skills",
    });
  }
  return { skills: normalizeContentSkillNames(selection.skills, options) };
}

/**
 * 判断两个内容选择是否等价。
 *
 * @param {import("./contracts.js").PluginContentSelection|null|undefined} left 左侧选择
 * @param {import("./contracts.js").PluginContentSelection|null|undefined} right 右侧选择
 * @returns {boolean} 是否等价
 */
export function contentSelectionsEqual(left, right) {
  const normalizedLeft = normalizeContentSelection(left);
  const normalizedRight = normalizeContentSelection(right);
  if (!normalizedLeft && !normalizedRight) return true;
  if (!normalizedLeft || !normalizedRight) return false;
  if (normalizedLeft.skills.length !== normalizedRight.skills.length) return false;
  return normalizedLeft.skills.every((name, index) => name === normalizedRight.skills[index]);
}

/**
 * 列出 manifest `content.skills` 的可选 Skill。
 *
 * @param {import("./contracts.js").PluginContentSkillEntry[]} entries manifest 中的 Skill 内容条目
 * @param {string} owner 诊断中的 Plugin ID
 * @returns {Array<import("./contracts.js").PluginContentSkillEntry>} 稳定 Skill 清单
 */
export function listContentSkillChoices(entries, owner) {
  const choices = [];
  const byName = new Map();
  const byPath = new Map();
  const sorted = [...(entries || [])]
    .sort((left, right) => (
      compareUtf8(String(left?.name || ""), String(right?.name || "")) ||
      compareUtf8(String(left?.path || ""), String(right?.path || ""))
    ));
  for (const entry of sorted) {
    const name = entry?.name;
    const skillPath = entry?.path;
    if (!isContentSkillSelectionName(name)) {
      throw new PluginRuntimeError(`Content Skill 名称非法:${name}`, {
        code: PLUGIN_RUNTIME_ERROR_CODES.CONTENT_SELECTION_INVALID,
        path: `${owner}:${String(skillPath || name || "")}`,
      });
    }
    assertSafePosixRelativePath(skillPath, "Content Skill 路径");
    const previous = byName.get(name);
    if (previous) {
      throw new PluginRuntimeError(`Plugin content.skills 名称重复:${name}`, {
        code: PLUGIN_RUNTIME_ERROR_CODES.CONTENT_CONFLICT,
        path: owner,
        details: { entries: [previous, skillPath].sort(compareUtf8) },
      });
    }
    const previousPath = byPath.get(skillPath);
    if (previousPath) {
      throw new PluginRuntimeError(`Plugin content.skills 路径重复:${skillPath}`, {
        code: PLUGIN_RUNTIME_ERROR_CODES.CONTENT_CONFLICT,
        path: owner,
        details: { names: [previousPath, name].sort(compareUtf8) },
      });
    }
    byName.set(name, skillPath);
    byPath.set(skillPath, name);
    choices.push({
      name,
      path: skillPath,
      version: entry.version,
      ...(entry.description ? { description: entry.description } : {}),
    });
  }
  return choices.sort((left, right) => compareUtf8(left.name, right.name));
}

/**
 * 根据内容选择过滤 manifest `content.skills`。
 *
 * @param {import("./contracts.js").PluginContentSkillEntry[]} entries manifest 中的 Skill 内容条目
 * @param {import("./contracts.js").PluginContentSelection|null|undefined} selection 内容选择
 * @param {string} owner 诊断中的 Plugin ID
 * @returns {Array<import("./contracts.js").PluginContentSkillEntry>} 应投影的 Skill 内容条目
 */
export function selectContentSkillEntries(entries, selection, owner) {
  const choices = listContentSkillChoices(entries, owner);
  const normalized = normalizeContentSelection(selection);
  if (!normalized) return choices;
  const byName = new Map(choices.map((choice) => [choice.name, choice]));
  const missing = normalized.skills.filter((name) => !byName.has(name));
  if (missing.length > 0) {
    throw new PluginRuntimeError(`Content Skill 选择不存在:${missing.join(",")}`, {
      code: PLUGIN_RUNTIME_ERROR_CODES.CONTENT_SELECTION_INVALID,
      path: owner,
      details: {
        requested: normalized.skills,
        available: choices.map(({ name }) => name),
      },
    });
  }
  return normalized.skills.map((name) => byName.get(name));
}

/**
 * 把内容选择转换为 CLI 参数。
 *
 * @param {import("./contracts.js").PluginContentSelection|null|undefined} selection 内容选择
 * @returns {string[]} CLI 参数
 */
export function contentSelectionArgs(selection) {
  const normalized = normalizeContentSelection(selection);
  if (!normalized) return [];
  return normalized.skills.flatMap((name) => ["--content-skill", name]);
}
