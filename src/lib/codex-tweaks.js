import fs from "node:fs";
import path from "node:path";

/**
 * flower-trellis 对 Trellis 生成的 codex 配置的定制后处理。
 *
 * 仅当目标项目已配置 codex 平台(存在 .codex/)时生效;在 init / update 叠加阶段调用,幂等。
 * 做两件事:
 *   1. 兼容旧 Trellis:注释掉 .codex/config.toml 的 [features.multi_agent_v2] 段;
 *   2. 合并 .codex/hooks.json —— 保留 Trellis 上游 hook 设置,只补 flower 需要的 SessionStart。
 */

const WORKFLOW_HOOK_SCRIPT = ".codex/hooks/inject-workflow-state.py";
const SESSION_START_SCRIPT = ".codex/hooks/session-start.py";

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

/**
 * 构造 flower 额外需要的 SessionStart hook。UserPromptSubmit 由 Trellis 上游维护,这里不覆盖。
 * @param {{hooks: object}} config hooks.json 配置
 * @returns {Array<object>} SessionStart hook 数组
 */
function sessionStartHook(config) {
  return [
    {
      hooks: [
        {
          type: "command",
          command: sessionStartCommand(config),
          timeout: 30,
        },
      ],
    },
  ];
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
  config.hooks.SessionStart = sessionStartHook(config);

  const desired = JSON.stringify(config, null, 2) + "\n";
  const current = fs.existsSync(hooksPath) ? fs.readFileSync(hooksPath, "utf8") : "";
  if (current === desired) return false;
  fs.writeFileSync(hooksPath, desired);
  return true;
}

/**
 * codex 平台后处理入口。仅当 .codex/ 存在时执行。
 * @param {string} target 目标项目根
 * @returns {{applied: boolean, tomlChanged?: boolean, hooksWritten?: boolean}}
 */
export function applyCodexTweaks(target) {
  const codexDir = path.join(target, ".codex");
  if (!fs.existsSync(codexDir)) return { applied: false };
  const tomlChanged = commentMultiAgentV2(path.join(codexDir, "config.toml"));
  const hooksWritten = mergeHooks(path.join(codexDir, "hooks.json"));
  return { applied: true, tomlChanged, hooksWritten };
}
