import fs from "node:fs";
import path from "node:path";

/**
 * flower-trellis 对 Trellis 生成的 codex 配置的定制后处理。
 *
 * 仅当目标项目已配置 codex 平台(存在 .codex/)时生效;在 init / update 叠加阶段调用,幂等。
 * 做两件事:
 *   1. 注释掉 .codex/config.toml 的 [features.multi_agent_v2] 段;
 *   2. 用指定内容覆盖 .codex/hooks.json —— 在 Trellis 默认(仅 UserPromptSubmit)基础上挂 SessionStart。
 */

// 期望的 .codex/hooks.json。两个脚本均由 Trellis codex configurator 写入 .codex/hooks/。
const CODEX_HOOKS = {
  hooks: {
    SessionStart: [
      {
        hooks: [
          {
            type: "command",
            command: "python3 .codex/hooks/session-start.py",
            timeout: 5,
          },
        ],
      },
    ],
    UserPromptSubmit: [
      {
        hooks: [
          {
            type: "command",
            command: "python3 .codex/hooks/inject-workflow-state.py",
            timeout: 5,
          },
        ],
      },
    ],
  },
};

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
 * 用 flower 指定内容覆盖 .codex/hooks.json。幂等:内容一致则不写。
 * @returns {boolean} 是否写入
 */
function rewriteHooks(hooksPath) {
  const desired = JSON.stringify(CODEX_HOOKS, null, 2) + "\n";
  let current = null;
  try {
    current = fs.readFileSync(hooksPath, "utf8");
  } catch {
    // 文件不存在,视为需要写
  }
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
  const hooksWritten = rewriteHooks(path.join(codexDir, "hooks.json"));
  return { applied: true, tomlChanged, hooksWritten };
}
