import fs from "node:fs";
import path from "node:path";
import { FLOWER_UPDATE_HOOK_REL } from "./flower-assets.js";

const WORKFLOW_HOOK_SCRIPT = ".claude/hooks/inject-workflow-state.py";
const DEFAULT_COMMAND = `python3 ${FLOWER_UPDATE_HOOK_REL}`;

/** 容错读取 Claude settings JSON。 */
function readSettings(settingsPath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    if (parsed && typeof parsed === "object") {
      const hooks = parsed.hooks && typeof parsed.hooks === "object" ? parsed.hooks : {};
      return { ...parsed, hooks };
    }
  } catch {
    // 缺失或损坏时用空配置重建,避免后处理阻断 init/update。
  }
  return { hooks: {} };
}

/** 从 Claude UserPromptSubmit hook 推导 Python 命令前缀。 */
function flowerUpdateCommand(config) {
  const groups = Array.isArray(config.hooks.UserPromptSubmit)
    ? config.hooks.UserPromptSubmit
    : [];
  for (const group of groups) {
    const hooks = Array.isArray(group?.hooks) ? group.hooks : [];
    for (const hook of hooks) {
      if (hook?.type !== "command" || typeof hook.command !== "string") continue;
      if (hook.command.includes(WORKFLOW_HOOK_SCRIPT)) {
        return hook.command.replace(WORKFLOW_HOOK_SCRIPT, FLOWER_UPDATE_HOOK_REL);
      }
    }
  }
  return DEFAULT_COMMAND;
}

/** 判断 hook 列表里是否已有 flower update hook。 */
function hasFlowerHook(hooks) {
  return hooks.some(
    (hook) => hook?.type === "command" &&
      typeof hook.command === "string" &&
      hook.command.includes(FLOWER_UPDATE_HOOK_REL),
  );
}

/** 合并 Claude startup hook,并确保 clear / compact 不运行 update hook。 */
function mergeClaudeHooks(settingsPath) {
  const config = readSettings(settingsPath);
  const groups = Array.isArray(config.hooks.SessionStart)
    ? config.hooks.SessionStart
    : [];
  const command = flowerUpdateCommand(config);
  let startup = groups.find((group) => group?.matcher === "startup");
  if (!startup) {
    startup = { matcher: "startup", hooks: [] };
    groups.unshift(startup);
  }
  if (!Array.isArray(startup.hooks)) startup.hooks = [];

  let changed = false;
  for (const group of groups) {
    if (group === startup || !Array.isArray(group?.hooks)) continue;
    const before = group.hooks.length;
    group.hooks = group.hooks.filter(
      (hook) => !(hook?.type === "command" &&
        typeof hook.command === "string" &&
        hook.command.includes(FLOWER_UPDATE_HOOK_REL)),
    );
    if (group.hooks.length !== before) changed = true;
  }

  if (!hasFlowerHook(startup.hooks)) {
    startup.hooks.push({ type: "command", command, timeout: 8 });
    changed = true;
  }

  config.hooks.SessionStart = groups;
  const desired = JSON.stringify(config, null, 2) + "\n";
  const current = fs.existsSync(settingsPath) ? fs.readFileSync(settingsPath, "utf8") : "";
  if (current === desired) return changed;
  fs.writeFileSync(settingsPath, desired);
  return true;
}

/**
 * Claude Code 平台后处理入口。仅当 `.claude/` 存在时执行。
 *
 * @param {string} target 目标项目根
 * @returns {{applied:boolean,settingsWritten?:boolean}}
 */
export function applyClaudeTweaks(target) {
  const claudeDir = path.join(target, ".claude");
  if (!fs.existsSync(claudeDir)) return { applied: false };
  const settingsWritten = mergeClaudeHooks(path.join(claudeDir, "settings.json"));
  return { applied: true, settingsWritten };
}
