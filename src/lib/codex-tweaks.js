import fs from "node:fs";
import path from "node:path";
import { FLOWER_UPDATE_HOOK_REL } from "./flower-assets.js";

/**
 * flower-trellis 对 Trellis 生成的 codex 配置的定制后处理。
 *
 * 仅当目标项目已配置 codex 平台(存在 .codex/)时生效;在 init / update 叠加阶段调用,幂等。
 * 做三件事:
 *   1. 兼容旧 Trellis:注释掉 .codex/config.toml 的 [features.multi_agent_v2] 段;
 *   2. 合并 .codex/hooks.json —— 保留 Trellis 上游 hook 设置,只补 flower 需要的 SessionStart。
 *   3. 强制 .trellis/config.yaml 的 codex.dispatch_mode 为 auto。
 */

const WORKFLOW_HOOK_SCRIPT = ".codex/hooks/inject-workflow-state.py";
const SESSION_START_SCRIPT = ".codex/hooks/session-start.py";
const CODEX_DISPATCH_MODE = "auto";
const SESSION_START_MATCHER = "startup|resume|clear|compact";
const FLOWER_UPDATE_MATCHER = "startup";
const SESSION_START_TIMEOUT = 30;

/** 返回一行开头的空白缩进。 */
function leadingWhitespace(line) {
  return line.match(/^\s*/)?.[0] || "";
}

/** 判断一行是否是未注释的顶层 YAML key。 */
function isTopLevelKey(line) {
  const trimmed = line.trim();
  return Boolean(trimmed && !trimmed.startsWith("#") && !leadingWhitespace(line) && /^[^:#]+:/.test(trimmed));
}

/** 找到未注释的顶层 `codex:` 块行号。 */
function findCodexBlockStart(lines) {
  return lines.findIndex((line) => {
    const trimmed = line.trim();
    return isTopLevelKey(line) && /^codex\s*:/.test(trimmed);
  });
}

/** 找到 YAML 顶层块结束位置,注释和空行不结束当前块。 */
function findTopLevelBlockEnd(lines, start) {
  for (let i = start + 1; i < lines.length; i += 1) {
    if (isTopLevelKey(lines[i])) return i;
  }
  return lines.length;
}

/** 按逗号拆分 YAML inline map 内容,保留引号内逗号。 */
function splitInlineMapItems(content) {
  const items = [];
  let quote = "";
  let token = "";
  for (const ch of content) {
    if (quote) {
      token += ch;
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === "\"" || ch === "'") {
      quote = ch;
      token += ch;
      continue;
    }
    if (ch === ",") {
      if (token.trim()) items.push(token.trim());
      token = "";
      continue;
    }
    token += ch;
  }
  if (token.trim()) items.push(token.trim());
  return items;
}

/** 解析简单 YAML inline map,失败时返回 null。 */
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

/**
 * 强制目标项目 `.trellis/config.yaml` 启用 Codex 原生 subagent 能力。
 *
 * `auto` 只声明平台能力可用，单次任务实际采用 inline 还是 subagent 仍由
 * `trellis-route` 决定。显式 `inline` 和兼容旧值 `sub-agent` 都归一化为正式值，
 * 避免关闭 JSONL readiness 后仍允许 route 选择 subagent。
 *
 * @param {string} configPath 目标项目 `.trellis/config.yaml` 路径
 * @returns {boolean} 是否写入
 */
function forceCodexDispatchMode(configPath) {
  const current = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8") : "";
  const normalized = current.replace(/\r\n/g, "\n");
  const hadFinalNewline = normalized.endsWith("\n");
  const lines = normalized.length === 0
    ? []
    : normalized.replace(/\n$/, "").split("\n");

  const codexStart = findCodexBlockStart(lines);
  if (codexStart === -1) {
    if (lines.length > 0 && lines[lines.length - 1].trim()) lines.push("");
    lines.push("codex:", `  dispatch_mode: ${CODEX_DISPATCH_MODE}`);
  } else {
    const blockEnd = findTopLevelBlockEnd(lines, codexStart);
    const codexMatch = lines[codexStart].match(/^(\s*)codex\s*:\s*(.*)$/);
    const codexIndent = codexMatch?.[1] || "";
    const codexValue = (codexMatch?.[2] || "").trim();
    const inlineEntries = parseInlineMapEntries(codexValue);
    if (inlineEntries) {
      const nextLines = [`${codexIndent}codex:`];
      let hasDispatchMode = false;
      for (const entry of inlineEntries) {
        if (entry.key === "dispatch_mode") {
          hasDispatchMode = true;
          nextLines.push(`${codexIndent}  dispatch_mode: ${CODEX_DISPATCH_MODE}`);
        } else {
          nextLines.push(`${codexIndent}  ${entry.key}: ${entry.value}`);
        }
      }
      if (!hasDispatchMode) {
        nextLines.splice(1, 0, `${codexIndent}  dispatch_mode: ${CODEX_DISPATCH_MODE}`);
      }
      lines.splice(codexStart, 1, ...nextLines);
    } else if (codexValue && !codexValue.startsWith("#")) {
      lines[codexStart] = `${codexIndent}codex:`;
    }

    const nextBlockEnd = inlineEntries
      ? findTopLevelBlockEnd(lines, codexStart)
      : blockEnd;
    const dispatchIndex = lines.findIndex((line, index) => {
      if (index <= codexStart || index >= nextBlockEnd) return false;
      const trimmed = line.trim();
      return Boolean(trimmed && !trimmed.startsWith("#") && /^dispatch_mode\s*:/.test(trimmed));
    });

    if (dispatchIndex === -1) {
      lines.splice(codexStart + 1, 0, `${codexIndent}  dispatch_mode: ${CODEX_DISPATCH_MODE}`);
    } else {
      const indent = leadingWhitespace(lines[dispatchIndex]);
      lines[dispatchIndex] = `${indent}dispatch_mode: ${CODEX_DISPATCH_MODE}`;
    }
  }

  const desired = lines.join("\n") + (hadFinalNewline || lines.length > 0 ? "\n" : "");
  if (current === desired) return false;
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, desired);
  return true;
}

/**
 * 注释掉 config.toml 里的 [features.multi_agent_v2] 段(段头 + 段内键,直到下一个 section)。
 * 幂等:段头已被注释则不再处理。
 * @returns {boolean} 是否发生改动
 */
function commentMultiAgentV2(tomlPath) {
  if (!fs.existsSync(tomlPath)) return false;
  const lines = fs.readFileSync(tomlPath, "utf8").split("\n");
  const out = [];
  let inSection = false;
  let changed = false;

  for (const line of lines) {
    const t = line.trim();
    if (inSection) {
      // 段结束:遇到下一个未注释的 section 头
      if (t.startsWith("[") && !t.startsWith("#")) {
        inSection = false;
        out.push(line);
        continue;
      }
      // 段内非空、未注释行 → 注释
      if (t && !t.startsWith("#")) {
        out.push("# " + line);
        changed = true;
      } else {
        out.push(line);
      }
      continue;
    }
    if (t === "[features.multi_agent_v2]") {
      out.push("# " + line);
      inSection = true;
      changed = true;
      continue;
    }
    out.push(line);
  }

  if (changed) fs.writeFileSync(tomlPath, out.join("\n"));
  return changed;
}

/**
 * 容错读取 JSON 文件;缺失或格式异常时返回空 hooks 壳。
 * @param {string} hooksPath .codex/hooks.json 路径
 * @returns {{hooks: object}}
 */
function readHooksConfig(hooksPath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(hooksPath, "utf8"));
    if (parsed && typeof parsed === "object") {
      const hooks = parsed.hooks && typeof parsed.hooks === "object" ? parsed.hooks : {};
      return { ...parsed, hooks };
    }
  } catch {
    // 缺失或损坏时用空壳重建,避免 init/update 后处理失败中断主流程
  }
  return { hooks: {} };
}

/**
 * 从上游 UserPromptSubmit hook 推导 SessionStart 命令。
 *
 * Trellis 会按平台写入 Python 命令前缀和 UTF-8 参数;复用该命令能避免 flower
 * 在 Windows / Linux / 未来模板之间写死不同的 Python 调用方式。
 *
 * @param {{hooks: object}} config hooks.json 配置
 * @returns {string} SessionStart command
 */
function sessionStartCommand(config) {
  const groups = Array.isArray(config.hooks.UserPromptSubmit)
    ? config.hooks.UserPromptSubmit
    : [];
  for (const group of groups) {
    const hooks = Array.isArray(group?.hooks) ? group.hooks : [];
    for (const hook of hooks) {
      if (hook?.type !== "command" || typeof hook.command !== "string") continue;
      if (hook.command.includes(WORKFLOW_HOOK_SCRIPT)) {
        return hook.command.replace(WORKFLOW_HOOK_SCRIPT, SESSION_START_SCRIPT);
      }
    }
  }
  return `python3 -X utf8 ${SESSION_START_SCRIPT}`;
}

/** 从 Trellis SessionStart 命令推导 flower update hook 命令。 */
function flowerUpdateCommand(config) {
  const command = sessionStartCommand(config);
  if (command.includes(SESSION_START_SCRIPT)) {
    return command.replace(SESSION_START_SCRIPT, FLOWER_UPDATE_HOOK_REL);
  }
  return `python3 -X utf8 ${FLOWER_UPDATE_HOOK_REL}`;
}

/** 判断 hooks 数组里是否已有指定命令。 */
function hasCommand(hooks, commandNeedle) {
  return hooks.some(
    (hook) => hook?.type === "command" &&
      typeof hook.command === "string" &&
      hook.command.includes(commandNeedle),
  );
}

/** 从所有 SessionStart group 移除目标命令,避免 matcher 迁移后重复触发。 */
function removeSessionStartCommand(groups, needle) {
  let changed = false;
  for (let i = groups.length - 1; i >= 0; i -= 1) {
    const group = groups[i];
    if (!Array.isArray(group?.hooks)) continue;
    const before = group.hooks.length;
    group.hooks = group.hooks.filter(
      (hook) => !(hook?.type === "command" &&
        typeof hook.command === "string" &&
        hook.command.includes(needle)),
    );
    if (group.hooks.length !== before) {
      changed = true;
      if (group.hooks.length === 0 && !group.matcher) {
        groups.splice(i, 1);
      }
    }
  }
  return changed;
}

/** 查找或创建指定 matcher 的 SessionStart group。 */
function ensureSessionStartGroup(groups, matcher) {
  let group = groups.find((item) => item && item.matcher === matcher);
  if (!group) {
    group = { matcher, hooks: [] };
    groups.push(group);
  }
  if (!Array.isArray(group.hooks)) group.hooks = [];
  return group;
}

/** 向指定 matcher 的 SessionStart group 归位单个 command hook。 */
function ensureSessionStartCommand(groups, command, timeout, needle, matcher) {
  const removed = removeSessionStartCommand(groups, needle);
  const group = ensureSessionStartGroup(groups, matcher);
  if (hasCommand(group.hooks, needle)) return removed;
  group.hooks.push({
    type: "command",
    command,
    timeout,
  });
  return true;
}

/**
 * 合并 flower 需要的 SessionStart hook,保留 Trellis 上游 UserPromptSubmit 设置。
 *
 * Trellis 0.6.0 已把 UserPromptSubmit 的 UTF-8 与 timeout 策略写进模板;flower 只负责
 * 补上 SessionStart,否则整文件覆盖会让上游模板改进在 update 后丢失。
 *
 * @param {string} hooksPath .codex/hooks.json 路径
 * @returns {boolean} 是否写入
 */
function mergeHooks(hooksPath) {
  const config = readHooksConfig(hooksPath);
  const groups = Array.isArray(config.hooks.SessionStart)
    ? config.hooks.SessionStart
    : [];
  ensureSessionStartCommand(
    groups,
    sessionStartCommand(config),
    SESSION_START_TIMEOUT,
    SESSION_START_SCRIPT,
    SESSION_START_MATCHER,
  );
  ensureSessionStartCommand(
    groups,
    flowerUpdateCommand(config),
    SESSION_START_TIMEOUT,
    FLOWER_UPDATE_HOOK_REL,
    FLOWER_UPDATE_MATCHER,
  );
  config.hooks.SessionStart = groups;

  const desired = JSON.stringify(config, null, 2) + "\n";
  const current = fs.existsSync(hooksPath) ? fs.readFileSync(hooksPath, "utf8") : "";
  if (current === desired) return false;
  fs.writeFileSync(hooksPath, desired);
  return true;
}

/**
 * codex 平台后处理入口。仅当 .codex/ 存在时执行。
 * @param {string} target 目标项目根
 * @returns {{applied: boolean, tomlChanged?: boolean, hooksWritten?: boolean, dispatchModeChanged?: boolean}}
 */
export function applyCodexTweaks(target) {
  const codexDir = path.join(target, ".codex");
  if (!fs.existsSync(codexDir)) return { applied: false };
  const tomlChanged = commentMultiAgentV2(path.join(codexDir, "config.toml"));
  const hooksWritten = mergeHooks(path.join(codexDir, "hooks.json"));
  const dispatchModeChanged = forceCodexDispatchMode(path.join(target, ".trellis", "config.yaml"));
  return { applied: true, tomlChanged, hooksWritten, dispatchModeChanged };
}
