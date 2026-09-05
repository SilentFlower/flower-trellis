import { FLOWER_UPDATE_HOOK_REL, FLOWER_SESSION_HOOK_REL, FLOWER_TELEMETRY_HOOK_REL } from "./flower-assets.js";

const CODEX_WORKFLOW_HOOK = ".codex/hooks/inject-workflow-state.py";
const CODEX_SESSION_START = ".codex/hooks/session-start.py";
const CLAUDE_WORKFLOW_HOOK = ".claude/hooks/inject-workflow-state.py";
const SESSION_PARTS = ["state", "rules", "stages"];

function escapeRe(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function findHookCommand(config, event, needle) {
  const groups = Array.isArray(config?.hooks?.[event]) ? config.hooks[event] : [];
  for (const group of groups) {
    const hooks = Array.isArray(group?.hooks) ? group.hooks : [];
    for (const hook of hooks) {
      if (hook?.type === "command" && typeof hook.command === "string" && hook.command.includes(needle)) {
        return hook.command;
      }
    }
  }
  return null;
}

function resolveCommand(name, config, pythonCommand) {
  const codexBase = findHookCommand(config, "UserPromptSubmit", CODEX_WORKFLOW_HOOK) ||
    `${pythonCommand} -X utf8 ${CODEX_WORKFLOW_HOOK}`;
  if (name === "codex-session-start") {
    return codexBase.replace(CODEX_WORKFLOW_HOOK, CODEX_SESSION_START);
  }
  if (name === "codex-flower-telemetry") {
    return codexBase.replace(CODEX_WORKFLOW_HOOK, `${FLOWER_TELEMETRY_HOOK_REL} --platform codex`);
  }
  if (name === "codex-flower-update") {
    return codexBase.replace(CODEX_WORKFLOW_HOOK, FLOWER_UPDATE_HOOK_REL);
  }
  const claudeBase = findHookCommand(config, "UserPromptSubmit", CLAUDE_WORKFLOW_HOOK) ||
    `${pythonCommand} ${CLAUDE_WORKFLOW_HOOK}`;
  if (name === "claude-session-start") {
    return claudeBase.replace(CLAUDE_WORKFLOW_HOOK, ".claude/hooks/session-start.py");
  }
  if (name === "claude-flower-telemetry") {
    return claudeBase.replace(CLAUDE_WORKFLOW_HOOK, `${FLOWER_TELEMETRY_HOOK_REL} --platform claude`);
  }
  if (name === "claude-flower-update") {
    return claudeBase.replace(CLAUDE_WORKFLOW_HOOK, FLOWER_UPDATE_HOOK_REL);
  }
  throw new Error(`未知 Hook commandResolver:${name}`);
}

function applyJsonHookCommand({ value, operation, pythonCommand = "python3" }) {
  let config;
  try {
    config = value.trim() ? JSON.parse(value) : {};
  } catch {
    return { error: "JSON Hook 配置无法解析" };
  }
  if (!isPlainObject(config)) return { error: "JSON Hook 配置根必须是对象" };
  if (config.hooks === undefined) config.hooks = {};
  if (!isPlainObject(config.hooks)) return { error: "JSON Hook hooks 必须是对象" };

  const { event, commandNeedle } = operation.selector;
  if (typeof event !== "string" || !event || typeof commandNeedle !== "string" || !commandNeedle) {
    return { error: "json-hook-command 需要 event 和 commandNeedle" };
  }
  const existing = config.hooks[event];
  if (existing !== undefined && !Array.isArray(existing)) {
    return { error: `JSON Hook ${event} 必须是数组` };
  }
  const groups = existing ? structuredClone(existing) : [];
  const retainedLimits = new Map();
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const group = groups[index];
    if (!isPlainObject(group)) return { error: `JSON Hook ${event}[${index}] 必须是对象` };
    if (group.hooks === undefined) group.hooks = [];
    if (!Array.isArray(group.hooks)) return { error: `JSON Hook ${event}[${index}].hooks 必须是数组` };
    const matched = group.hooks.filter((hook) => hook?.type === "command" &&
      typeof hook.command === "string" && hook.command.includes(commandNeedle));
    for (const hook of matched) {
      const limit = hook.additionalContextLimit;
      if (limit === undefined) continue;
      if (!Number.isSafeInteger(limit) || limit < 0) {
        return { error: "已有 additionalContextLimit 必须是非负整数" };
      }
      const part = hook.command.match(/(?:^|\s)--part\s+(state|rules|stages)(?=\s|$)/)?.[1] || "legacy";
      if (retainedLimits.has(part) && retainedLimits.get(part) !== limit) {
        return { error: `同一 SessionStart 分段 ${part} 存在冲突的 additionalContextLimit` };
      }
      retainedLimits.set(part, limit);
    }
    group.hooks = group.hooks.filter((hook) => !matched.includes(hook));
    if (group.hooks.length === 0 && (matched.length > 0 || !group.matcher)) groups.splice(index, 1);
  }

  if (operation.operation !== "remove") {
    const content = operation.content;
    if (!isPlainObject(content)) return { error: "json-hook-command content.value 必须是对象" };
    if (typeof content.matcher !== "string" || !content.matcher) {
      return { error: "json-hook-command matcher 必须是非空字符串" };
    }
    if (!Number.isInteger(content.timeout) || content.timeout < 1) {
      return { error: "json-hook-command timeout 必须是正整数" };
    }
    let command;
    try {
      command = resolveCommand(content.commandResolver, config, pythonCommand);
    } catch (error) {
      return { error: error.message };
    }
    let group = groups.find((item) => item.matcher === content.matcher);
    if (!group) {
      group = { matcher: content.matcher, hooks: [] };
      if (content.prependGroup === true) groups.unshift(group);
      else groups.push(group);
    }
    if (!Array.isArray(group.hooks)) return { error: "目标 matcher hooks 必须是数组" };
    const parts = content.sessionParts;
    if (parts !== undefined && (
      event !== "SessionStart" ||
      !["codex-session-start", "claude-session-start"].includes(content.commandResolver) ||
      JSON.stringify(parts) !== JSON.stringify(SESSION_PARTS)
    )) {
      return { error: "sessionParts 只允许 Codex / Claude SessionStart 的 state、rules、stages" };
    }
    for (const part of parts || ["legacy"]) {
      // 保留原生路径参数，供现有 bootstrap 检测和下一次迁移识别同一组 handler。
      const nextCommand = parts
        ? command.replace(commandNeedle, `${FLOWER_SESSION_HOOK_REL} --hook ${commandNeedle} --part ${part}`)
        : command;
      const handler = { type: "command", command: nextCommand, timeout: content.timeout };
      const limit = retainedLimits.get(part) ?? retainedLimits.get("legacy");
      if (limit !== undefined) handler.additionalContextLimit = limit;
      group.hooks.push(handler);
    }
  }
  config.hooks[event] = groups;
  return { value: JSON.stringify(config, null, 2) + "\n", source: "structured" };
}

function leadingWhitespace(line) {
  return line.match(/^\s*/)?.[0] || "";
}

function isTopLevelKey(line) {
  const trimmed = line.trim();
  return Boolean(trimmed && !trimmed.startsWith("#") && !leadingWhitespace(line) && /^[^:#]+:/.test(trimmed));
}

function findTopLevelBlockEnd(lines, start) {
  for (let index = start + 1; index < lines.length; index += 1) {
    if (isTopLevelKey(lines[index])) return index;
  }
  return lines.length;
}

function splitInlineMapItems(content) {
  const items = [];
  let quote = "";
  let token = "";
  for (const character of content) {
    if (quote) {
      token += character;
      if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      token += character;
      continue;
    }
    if (character === ",") {
      if (token.trim()) items.push(token.trim());
      token = "";
      continue;
    }
    token += character;
  }
  if (token.trim()) items.push(token.trim());
  return items;
}

function parseInlineMapEntries(value) {
  if (!value.startsWith("{") || !value.endsWith("}")) return null;
  const body = value.slice(1, -1).trim();
  if (!body) return [];
  const entries = [];
  for (const item of splitInlineMapItems(body)) {
    const [key, ...rest] = item.split(":");
    if (!key || rest.length === 0) return null;
    entries.push({ key: key.trim(), value: rest.join(":").trim() });
  }
  return entries;
}

function parseYamlKeyContent(content) {
  if (typeof content !== "string" || !content) {
    return { error: "yaml-key content.value 必须是非空字符串" };
  }
  if (!content.trimStart().startsWith("{")) return { desiredValue: content };
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { error: "yaml-key structured content 必须是合法 JSON" };
  }
  if (!isPlainObject(parsed) || typeof parsed.value !== "string" || !parsed.value) {
    return { error: "yaml-key structured content.value 必须是非空字符串" };
  }
  const commentSection = parsed.commentSection;
  if (commentSection !== undefined) {
    if (
      !isPlainObject(commentSection) ||
      typeof commentSection.heading !== "string" ||
      !commentSection.heading ||
      !Array.isArray(commentSection.lines) ||
      !commentSection.lines.every((line) => typeof line === "string") ||
      !["skip", "error"].includes(commentSection.missing || "error")
    ) {
      return { error: "yaml-key commentSection 配置无效" };
    }
  }
  return { desiredValue: parsed.value, commentSection };
}

function replaceYamlCommentSection(lines, section) {
  if (!section) return { lines };
  const heading = `# ${section.heading}`;
  const headings = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.trim() === heading);
  if (headings.length === 0) {
    if ((section.missing || "error") === "skip") return { lines };
    return { error: `YAML 注释段不存在:${section.heading}` };
  }
  if (headings.length > 1) return { error: `YAML 注释段重复:${section.heading}` };

  const headingIndex = headings[0].index;
  // 上游注释段用“分隔线 + 标题 + 分隔线 + 正文 + 分隔线”包裹，替换时必须保留下一段的起始分隔线。
  let start = headingIndex - 1;
  while (start >= 0 && !/^#-+$/.test(lines[start].trim())) start -= 1;
  if (start < 0) return { error: `YAML 注释段缺少起始分隔线:${section.heading}` };

  let dividerCount = 0;
  let end = -1;
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    if (!/^#-+$/.test(lines[index].trim())) continue;
    dividerCount += 1;
    if (dividerCount === 2) {
      end = index;
      break;
    }
  }
  if (end < 0) return { error: `YAML 注释段缺少结束分隔线:${section.heading}` };
  lines.splice(start, end - start, ...section.lines);
  return { lines };
}

function applyYamlKey({ value, operation }) {
  if (operation.operation === "remove") return { error: "yaml-key 暂不支持 remove" };
  const dottedPath = operation.selector.path;
  const parts = typeof dottedPath === "string" ? dottedPath.split(".") : [];
  if (parts.length !== 2 || parts.some((item) => !item)) {
    return { error: "yaml-key path 目前只支持两级 key" };
  }
  const parsedContent = parseYamlKeyContent(operation.content);
  if (parsedContent.error) return { error: parsedContent.error };
  const { desiredValue, commentSection } = parsedContent;
  const normalized = value.replace(/\r\n/g, "\n");
  const hadFinalNewline = normalized.endsWith("\n");
  const lines = normalized ? normalized.replace(/\n$/, "").split("\n") : [];
  const commentResult = replaceYamlCommentSection(lines, commentSection);
  if (commentResult.error) return { error: commentResult.error };
  const [topKey, childKey] = parts;
  const topKeyRe = new RegExp(`^${escapeRe(topKey)}\\s*:`);
  const topMatches = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => isTopLevelKey(line) && topKeyRe.test(line.trim()));
  if (topMatches.length > 1) return { error: `YAML 顶层 key 重复:${topKey}` };
  const start = topMatches[0]?.index ?? -1;
  if (start === -1) {
    if (lines.length > 0 && lines.at(-1).trim()) lines.push("");
    lines.push(`${topKey}:`, `  ${childKey}: ${desiredValue}`);
  } else {
    const topMatch = lines[start].match(
      new RegExp(`^(\\s*)${escapeRe(topKey)}\\s*:\\s*(.*)$`),
    );
    const indent = topMatch?.[1] || "";
    const topValue = (topMatch?.[2] || "").trim();
    const inlineEntries = parseInlineMapEntries(topValue);
    if (inlineEntries) {
      const inlineKeys = inlineEntries.map((entry) => entry.key);
      if (new Set(inlineKeys).size !== inlineKeys.length) {
        return { error: `YAML inline map key 重复:${topKey}` };
      }
      const replacement = [`${indent}${topKey}:`];
      let found = false;
      for (const entry of inlineEntries) {
        if (entry.key === childKey) {
          found = true;
          replacement.push(`${indent}  ${childKey}: ${desiredValue}`);
        } else {
          replacement.push(`${indent}  ${entry.key}: ${entry.value}`);
        }
      }
      if (!found) replacement.splice(1, 0, `${indent}  ${childKey}: ${desiredValue}`);
      lines.splice(start, 1, ...replacement);
    } else if (topValue && !topValue.startsWith("#")) {
      return { error: `YAML 无法安全解析 ${topKey} 的 inline value` };
    }
    const end = findTopLevelBlockEnd(lines, start);
    const childKeyRe = new RegExp(`^${escapeRe(childKey)}\\s*:`);
    const children = lines
      .map((line, index) => ({ line, index }))
      .filter(({ line, index }) => {
        if (index <= start || index >= end) return false;
        const trimmed = line.trim();
        return Boolean(trimmed && !trimmed.startsWith("#") && childKeyRe.test(trimmed));
      });
    if (children.length > 1) return { error: `YAML key 重复:${dottedPath}` };
    const child = children[0]?.index ?? -1;
    if (child === -1) lines.splice(start + 1, 0, `${indent}  ${childKey}: ${desiredValue}`);
    else lines[child] = `${leadingWhitespace(lines[child])}${childKey}: ${desiredValue}`;
  }
  const desired = lines.join("\n") + (hadFinalNewline || lines.length > 0 ? "\n" : "");
  return { value: desired, source: "structured" };
}

function parseTomlSectionHeader(line) {
  const value = line.trim();
  if (!value.startsWith("[")) return { header: null };
  // section 名可包含带引号的 `]`，闭合后也可跟注释，因此不能用单个正则截断。
  const array = value.startsWith("[[");
  const openLength = array ? 2 : 1;
  const closeLength = array ? 2 : 1;
  let quote = "";
  let escaped = false;
  let end = -1;
  for (let index = openLength; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (quote === '"' && escaped) {
        escaped = false;
      } else if (quote === '"' && character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = "";
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (array && value.slice(index, index + 2) === "]]") {
      end = index + 2;
      break;
    }
    if (!array && character === "]") {
      end = index + 1;
      break;
    }
  }
  if (end === -1 || quote) return { error: `TOML section header 无法解析:${value}` };
  const rest = value.slice(end).trim();
  if (rest && !rest.startsWith("#")) {
    return { error: `TOML section header 无法解析:${value}` };
  }
  const name = value.slice(openLength, end - closeLength).trim();
  if (!name) return { error: `TOML section header 无法解析:${value}` };
  return { header: { array, name } };
}

function applyTomlSection({ value, operation }) {
  if (operation.operation !== "remove") return { error: "toml-section 只支持 remove" };
  const name = operation.selector.name;
  if (typeof name !== "string" || !name) return { error: "toml-section name 必须是非空字符串" };
  const lines = value.split("\n");
  const headers = [];
  for (const line of lines) {
    const parsed = parseTomlSectionHeader(line);
    if (parsed.error) return parsed;
    headers.push(parsed.header);
  }
  const matches = headers
    .map((header, index) => ({ header, index }))
    .filter(({ header }) => header && !header.array && header.name === name);
  if (matches.length > 1) return { error: `TOML section 重复:[${name}]` };
  const start = matches[0]?.index ?? -1;
  if (start === -1) return { value, source: "structured-absence" };
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (headers[index]) {
      end = index;
      break;
    }
  }
  lines.splice(start, end - start);
  while (start > 0 && lines[start - 1] === "" && lines[start] === "") lines.splice(start, 1);
  return { value: lines.join("\n"), source: "structured" };
}

/**
 * Flower 自有 Patch Adapter 注册表。
 *
 * @param {string} [pythonCommand] 目标 Trellis 项目实际使用的 Python 命令
 * @returns {Record<string, Function>} selector type 到受控 Adapter 的映射
 */
export function flowerPatchAdapters(pythonCommand = "python3") {
  return {
    "json-hook-command": (context) => applyJsonHookCommand({ ...context, pythonCommand }),
    "yaml-key": applyYamlKey,
    "toml-section": applyTomlSection,
  };
}
