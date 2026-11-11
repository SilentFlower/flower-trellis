/** @module legacy-confirmation-config 按历史签名识别退役的项目确认配置。 */
import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { parse as parseToml } from "smol-toml";
import { scanTomlStatements, keyPath } from "./toml-default-adapter.js";

/** 早期前台确认分发、现已退役的项目脚本。 */
export const RETIRED_CONFIRMATION_SCRIPT = ".trellis/scripts/confirmation.py";

const SESSION_ENV = "FLOWER_CONFIRMATION_SESSION";
const MCP_NAME = /^flower_confirmation_[0-9a-f]{8}$/;
const MARKET_NAME = /^flower-trellis-confirm-[0-9a-f]{24}$/;
const RETIRED_HOOKS = {
  UserPromptSubmit: "*",
  PreToolUse: "Bash",
  PostToolUseFailure: "Bash",
  SessionEnd: "*",
};

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function knownKeys(value, allowed) {
  return isRecord(value) && Object.keys(value).every((key) => allowed.includes(key));
}

function legacyServer(entry, platform) {
  const commonKeys = ["command", "args", "env"];
  const extraKeys = platform === "codex"
    ? ["enabled", "enabled_tools", "tool_timeout_sec", "tools"]
    : ["type", "timeout"];
  if (!knownKeys(entry, [...commonKeys, ...extraKeys]) ||
      typeof entry.command !== "string" || !/(?:^|[/\\])node(?:\.exe)?$/i.test(entry.command) ||
      !Array.isArray(entry.args) || entry.args.length !== 1 ||
      typeof entry.args[0] !== "string" || !/(?:^|[/\\])confirmation-mcp\.js$/.test(entry.args[0]) ||
      !knownKeys(entry.env, [SESSION_ENV]) ||
      typeof entry.env[SESSION_ENV] !== "string" || !entry.env[SESSION_ENV]) return false;
  if (platform === "claude") {
    return (entry.type === undefined || entry.type === "stdio") &&
      (entry.timeout === undefined || Number.isSafeInteger(entry.timeout) && entry.timeout > 0);
  }
  return (entry.enabled === undefined || typeof entry.enabled === "boolean") &&
    (entry.enabled_tools === undefined || isDeepStrictEqual(entry.enabled_tools, ["wait"])) &&
    (entry.tool_timeout_sec === undefined || Number.isSafeInteger(entry.tool_timeout_sec) && entry.tool_timeout_sec > 0) &&
    (entry.tools === undefined || isDeepStrictEqual(entry.tools, { wait: { approval_mode: "approve" } }));
}

/**
 * 检查固定项目路径的各级组件，避免读取软链和设备文件。
 *
 * @param {string} root 项目根
 * @param {string} relative 已知的项目相对路径
 * @returns {boolean} 所有父目录及目标均为普通实体
 */
export function isRegularProjectFile(root, relative) {
  const parts = relative.split("/");
  let current = root;
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part);
    const stat = fs.lstatSync(current, { throwIfNoEntry: false });
    if (!stat || !(index === parts.length - 1 ? stat.isFile() : stat.isDirectory())) return false;
  }
  return true;
}

function removeClaudeHooks(config, removed) {
  if (!isRecord(config.hooks)) return;
  for (const [event, matcher] of Object.entries(RETIRED_HOOKS)) {
    const groups = config.hooks[event];
    if (!Array.isArray(groups)) continue;
    config.hooks[event] = groups.flatMap((group) => {
      if (!knownKeys(group, ["matcher", "hooks"]) ||
          group.matcher !== matcher || !Array.isArray(group.hooks)) return [group];
      const hooks = group.hooks.filter((hook) => !isDeepStrictEqual(hook, {
        type: "command", command: "ftl confirm hook", timeout: 2,
        ...(matcher === "Bash" ? { if: "Bash(ftl confirm *)" } : {}),
      }));
      if (hooks.length === group.hooks.length) return [group];
      removed.add(`hooks.${event}: ftl confirm hook`);
      return hooks.length > 0 ? [{ ...group, hooks }] : [];
    });
  }
}

function parseRewritableJson(value) {
  const config = JSON.parse(value);
  // JSON.parse 会合并重复键并舍入数字。用原始 token 核对这两处不可逆变化。
  const containers = [];
  const tokens = /"(?:[^"\\]|\\[\s\S])*"\s*:?|[{}\[\]]|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
  for (const [match] of value.matchAll(tokens)) {
    const token = match.trimEnd();
    if (token === "{") containers.push(new Set());
    else if (token === "[") containers.push(null);
    else if (token === "}" || token === "]") containers.pop();
    else if (token.startsWith('"')) {
      if (!token.endsWith(":")) continue;
      const key = JSON.parse(token.slice(0, -1));
      const keys = containers.at(-1);
      if (keys.has(key)) return null;
      keys.add(key);
    } else {
      const number = Number(token);
      if (JSON.stringify(number) !== token || (Number.isInteger(number) && !Number.isSafeInteger(number))) return null;
    }
  }
  return config;
}

function migrateJson(value, original, target, claudeMcpEntries) {
  // 同一计划可能已应用当前平台 Patch。先核对原文，避免将早先合并掉的歧义视为迁移许可。
  if (original && original !== value && !isRecord(parseRewritableJson(original))) return { unchanged: true };
  const config = parseRewritableJson(value);
  if (!isRecord(config)) return { unchanged: true };
  const removed = new Set();
  if (target === ".mcp.json") {
    if (!isRecord(config.mcpServers)) return { unchanged: true };
    for (const [name, entry] of Object.entries(config.mcpServers)) {
      if (!MCP_NAME.test(name) || !legacyServer(entry, "claude")) continue;
      delete config.mcpServers[name];
      removed.add(`mcpServers.${name}`);
    }
  } else {
    removeClaudeHooks(config, removed);
    if (Array.isArray(config.permissions?.allow)) {
      const obsolete = new Set(claudeMcpEntries.map((name) => `mcp__${name}__wait`));
      config.permissions.allow = config.permissions.allow.filter((rule) => {
        if (!obsolete.has(rule)) return true;
        removed.add(`permissions.allow: ${rule}`);
        return false;
      });
    }
    if (isRecord(config.extraKnownMarketplaces) && isRecord(config.enabledPlugins)) {
      for (const [name, entry] of Object.entries(config.extraKnownMarketplaces)) {
        const plugin = `flower-confirmation@${name}`;
        if (!MARKET_NAME.test(name) || typeof config.enabledPlugins[plugin] !== "boolean" ||
            !knownKeys(entry, ["source"]) || !knownKeys(entry.source, ["source", "path"]) ||
            entry.source.source !== "directory" || typeof entry.source.path !== "string" ||
            !/(?:^|[/\\])native-confirmation[/\\]claude[/\\]?$/.test(entry.source.path)) continue;
        delete config.extraKnownMarketplaces[name];
        delete config.enabledPlugins[plugin];
        removed.add(`enabledPlugins.${plugin}`);
        removed.add(`extraKnownMarketplaces.${name}`);
      }
    }
  }
  return removed.size > 0
    ? { value: JSON.stringify(config, null, 2) + "\n", entries: [...removed] }
    : { unchanged: true };
}

function withoutEmptyParent(expected, actual, parts) {
  for (let length = parts.length; length > 0; length--) {
    const parent = parts.slice(0, length - 1).reduce((value, key) => value?.[key], expected);
    const actualParent = parts.slice(0, length - 1).reduce((value, key) => value?.[key], actual);
    const key = parts[length - 1];
    if (isRecord(parent?.[key]) && Object.keys(parent[key]).length === 0 && actualParent?.[key] === undefined) {
      delete parent[key];
    }
  }
}

function migrateToml(value) {
  const expected = parseToml(value);
  const servers = expected.mcp_servers;
  const names = Object.entries(servers || {})
    .filter(([name, entry]) => MCP_NAME.test(name) && legacyServer(entry, "codex"))
    .map(([name]) => name);
  if (names.length === 0) return { unchanged: true };
  const envPath = ["shell_environment_policy", "set", SESSION_ENV];
  const session = expected.shell_environment_policy?.set?.[SESSION_ENV];
  const retainedSessions = Object.entries(servers)
    .some(([name, entry]) => !names.includes(name) && entry?.env?.[SESSION_ENV] === session);
  const removeSession = !retainedSessions && names.some((name) => servers[name].env[SESSION_ENV] === session);
  const targets = names.map((name) => ["mcp_servers", name]);
  if (removeSession) targets.push(envPath);

  // 按 TOML 语句边界移除旧内容，再比较完整语义，防止删掉同一段中的用户键或后续表。
  let section = [];
  const ranges = [];
  for (const statement of scanTomlStatements(value)) {
    const code = statement.code.trim();
    let candidate;
    if (code.startsWith("[")) {
      const array = code.startsWith("[[");
      section = keyPath(code.slice(array ? 2 : 1, array ? -2 : -1));
      candidate = section;
    } else if (statement.equals >= 0) {
      candidate = [...section, ...keyPath(value.slice(statement.start, statement.start + statement.equals))];
    }
    if (candidate && targets.some((parts) => parts.every((key, index) => candidate[index] === key))) {
      ranges.push([statement.start, Math.min(statement.end + 1, value.length)]);
    }
  }
  let next = value;
  for (const [start, end] of ranges.reverse()) next = next.slice(0, start) + next.slice(end);
  const actual = parseToml(next);
  for (const name of names) delete servers[name];
  if (removeSession) delete expected.shell_environment_policy.set[SESSION_ENV];
  for (const parts of targets) withoutEmptyParent(expected, actual, parts.slice(0, -1));
  return isDeepStrictEqual(expected, actual)
    ? { value: next, entries: targets.map((parts) => parts.join(".")) }
    : { unchanged: true };
}

/**
 * 计算旧确认配置的精确删除，任何无法验证的表示保持原样。
 *
 * @param {{value:string,original?:string,operation?:object,targetSpec:{path:string,kind:string},priorResults?:object[]}} context Patch 文件与当前内容
 * @returns {{value?:string,entries?:string[],unchanged?:boolean}} 无写入的迁移结果
 */
export function migrateLegacyConfirmationConfig({ value, original, operation, targetSpec, priorResults = [] }) {
  try {
    if (targetSpec.kind === "toml") return migrateToml(value);
    // Claude 的 MCP 注册和权限分属两个文件。只有同一计划已匹配注册时才清理权限。
    const claudeMcpEntries = priorResults.find((result) => (
      result.qualifiedId === operation?.qualifiedId && result.target === ".mcp.json"
    ))?.entries?.map((entry) => entry.slice("mcpServers.".length)) || [];
    return migrateJson(value, original, targetSpec.path, claudeMcpEntries);
  } catch {
    // 配置可能包含旧会话材料。跳过时不回显解析错误中的正文。
    return { unchanged: true };
  }
}
