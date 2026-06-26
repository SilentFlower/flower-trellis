import fs from "node:fs";
import path from "node:path";

/**
 * flower-trellis 在 update 前后需要保留的项目本地配置 key。
 *
 * 这些字段描述目标项目自身结构,不是 Trellis 模板默认值;用户在上游冲突菜单里选择
 * "Apply Overwrite to all" 时,它们最容易被整文件模板覆盖。
 */
const PRESERVED_TOP_LEVEL_KEYS = ["packages", "default_package"];

/** 返回目标项目 `.trellis/config.yaml` 路径。 */
function configPath(target) {
  return path.join(target, ".trellis", "config.yaml");
}

/** 返回一行开头的空白缩进。 */
function leadingWhitespace(line) {
  return line.match(/^\s*/)?.[0] || "";
}

/** 判断一行是否是未注释的顶层 YAML key。 */
function isTopLevelKey(line) {
  const trimmed = line.trim();
  return Boolean(trimmed && !trimmed.startsWith("#") && !leadingWhitespace(line) && /^[^:#]+:/.test(trimmed));
}

/** 转义正则中的特殊字符。 */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 判断一行是否是指定的未注释顶层 YAML key。 */
function isNamedTopLevelKey(line, key) {
  const trimmed = line.trim();
  return isTopLevelKey(line) && new RegExp(`^${escapeRegExp(key)}\\s*:`).test(trimmed);
}

/** 找到指定顶层 key 的行号。 */
function findBlockStart(lines, key) {
  return lines.findIndex((line) => isNamedTopLevelKey(line, key));
}

/** 找到紧贴顶层 key 的注释块起点,只向上吸收连续顶层注释。 */
function findAttachedBlockStart(lines, start) {
  for (let i = start - 1; i >= 0; i -= 1) {
    const trimmed = lines[i].trim();
    if (trimmed === "") return i + 1;
    if (leadingWhitespace(lines[i]) || !trimmed.startsWith("#")) return i + 1;
  }
  return 0;
}

/** 找到 YAML 顶层块结束位置。 */
function findTopLevelBlockEnd(lines, start) {
  for (let i = start + 1; i < lines.length; i += 1) {
    if (isTopLevelKey(lines[i])) return i;
  }
  return lines.length;
}

/** 判断一行是否是块末尾可留给后续模板段落的分隔注释或空行。 */
function isDetachedTrailingLine(line) {
  const trimmed = line.trim();
  return trimmed === "" || (!leadingWhitespace(line) && trimmed.startsWith("#"));
}

/** 去掉块末尾的顶层分隔注释/空行,避免替换时吃掉下一个模板段落的说明。 */
function trimDetachedTrailingLines(lines, start, end) {
  let nextEnd = end;
  while (nextEnd > start + 1 && isDetachedTrailingLine(lines[nextEnd - 1])) {
    nextEnd -= 1;
  }
  return nextEnd;
}

/** 把文件内容拆成统一换行的行数组。 */
function splitYamlLines(content) {
  const normalized = content.replace(/\r\n/g, "\n");
  return normalized.length === 0
    ? []
    : normalized.replace(/\n$/, "").split("\n");
}

/** 从 YAML 文本中提取指定顶层块。 */
function extractTopLevelBlock(content, key) {
  const lines = splitYamlLines(content);
  const start = findBlockStart(lines, key);
  if (start === -1) return null;

  const attachedStart = findAttachedBlockStart(lines, start);
  const rawEnd = findTopLevelBlockEnd(lines, start);
  const end = trimDetachedTrailingLines(lines, start, rawEnd);
  const text = lines.slice(attachedStart, end).join("\n");
  return text ? { key, text } : null;
}

/** 在行数组中替换或追加指定顶层块。 */
function replaceOrAppendTopLevelBlock(lines, key, text) {
  const blockLines = text.split("\n");
  const start = findBlockStart(lines, key);

  if (start === -1) {
    if (lines.length > 0 && lines[lines.length - 1].trim() !== "") lines.push("");
    lines.push(...blockLines);
    return true;
  }

  const attachedStart = findAttachedBlockStart(lines, start);
  const rawEnd = findTopLevelBlockEnd(lines, start);
  const end = trimDetachedTrailingLines(lines, start, rawEnd);
  const current = lines.slice(attachedStart, end).join("\n");
  if (current === text) return false;

  lines.splice(attachedStart, end - attachedStart, ...blockLines);
  return true;
}

/**
 * 捕获目标项目 `.trellis/config.yaml` 中需要在 update 后保留的本地配置块。
 *
 * @param {string} target 目标项目根目录
 * @returns {{entries: Array<{key: string, text: string}>}} 配置保护快照
 */
export function captureConfigPreserveSnapshot(target) {
  const file = configPath(target);
  if (!fs.existsSync(file)) return { entries: [] };

  try {
    const content = fs.readFileSync(file, "utf8");
    const entries = PRESERVED_TOP_LEVEL_KEYS
      .map((key) => extractTopLevelBlock(content, key))
      .filter(Boolean);
    return { entries };
  } catch {
    return { entries: [] };
  }
}

/**
 * 把 update 前捕获的本地配置块恢复到当前 `.trellis/config.yaml`。
 *
 * 只替换或追加白名单顶层块,避免用旧配置整文件覆盖上游新增模板段落。
 *
 * @param {string} target 目标项目根目录
 * @param {{entries?: Array<{key: string, text: string}>}|null} snapshot 配置保护快照
 * @returns {{restored: boolean, keys: string[]}} 是否写入以及被恢复的 key
 */
export function restoreConfigPreserveSnapshot(target, snapshot) {
  const entries = Array.isArray(snapshot?.entries) ? snapshot.entries : [];
  if (entries.length === 0) return { restored: false, keys: [] };

  const file = configPath(target);
  if (!fs.existsSync(file)) return { restored: false, keys: [] };

  try {
    const current = fs.readFileSync(file, "utf8");
    const lines = splitYamlLines(current);
    const restoredKeys = [];

    for (const entry of entries) {
      if (!entry || !PRESERVED_TOP_LEVEL_KEYS.includes(entry.key) || typeof entry.text !== "string") {
        continue;
      }
      if (replaceOrAppendTopLevelBlock(lines, entry.key, entry.text)) {
        restoredKeys.push(entry.key);
      }
    }

    if (restoredKeys.length === 0) return { restored: false, keys: [] };

    const desired = lines.join("\n") + (lines.length > 0 ? "\n" : "");
    if (desired === current) return { restored: false, keys: [] };

    fs.writeFileSync(file, desired);
    return { restored: true, keys: restoredKeys };
  } catch {
    return { restored: false, keys: [] };
  }
}
