import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { CONFIRMATION_ID, CONFIRMATION_NATIVE_ID, confirmationDigest, confirmationDirectory,
  confirmationOperation, confirmationRoot, readConfirmationFile, writeConfirmationFile } from "./confirmation-files.js";

const ID = /^[a-f0-9-]{36}$/i;
const TRANSCRIPT_LIMIT = 8 * 1024 * 1024;

/** 获取仍拥有真实终端的 Claude 祖先进程，含防止 PID 重用的启动时间。 */
function claudeTerminal() {
  if (process.platform !== "linux") throw new Error("当前系统不能核验 Claude 原终端");
  for (let pid = process.ppid, depth = 0; pid > 1 && depth < 24; depth += 1) {
    const data = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    const fields = data.slice(data.lastIndexOf(")") + 2).split(" ");
    let executable;
    try { executable = path.basename(fs.readlinkSync(`/proc/${pid}/exe`)); } catch { /* 继续检查上级进程。 */ }
    if ((executable === "claude" || executable === "claude.exe") && !["Z", "X"].includes(fields[0]) && Number(fields[4])) {
      return `${pid}-${fields[19]}-${fields[4]}`;
    }
    pid = Number(fields[1]);
  }
  throw new Error("当前调用不属于仍打开的 Claude Code 原终端");
}

/** 只接受当前真实会话的原生转录，排除工作区内可替换的路径。 */
function transcriptFile(session, input, root, env) {
  const projects = fs.realpathSync(path.join(env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"), "projects"));
  const file = fs.realpathSync(input);
  if (file !== input || !file.startsWith(projects + path.sep) || path.dirname(path.dirname(file)) !== projects
    || path.basename(file) !== `${session}.jsonl` || file.startsWith(root + path.sep)) {
    throw new Error("Claude 主会话转录路径不可核验");
  }
  return file;
}

function context(root, session) {
  const terminal = claudeTerminal();
  const directory = confirmationDirectory(root, "claude");
  const scope = path.join(directory, `${session}-${terminal}`);
  return { terminal, prompt: `${scope}.prompt`, tool: `${scope}.tool` };
}

/**
 * 记录原版 Claude 项目 Hook 的最少身份信息，不阻断用户输入或工具。
 * @param {object} data Claude 原生 Hook 的 stdin 事件。
 * @param {object} env 原生会话环境。
 * @returns {object|undefined} 仅对规范的确认命令返回原生辅助工具许可。
 */
export function recordClaudeConfirmationHook(data, env) {
  const session = env.CLAUDE_CODE_SESSION_ID;
  if (!session || !ID.test(session) || data?.session_id !== session) return;
  const event = data.hook_event_name;
  const operation = event === "PreToolUse" && data.tool_name === "Bash" && confirmationOperation(data.tool_input?.command);
  if (event === "PreToolUse" && (!operation || data.tool_input.run_in_background || data.tool_input.dangerouslyDisableSandbox
    || !CONFIRMATION_NATIVE_ID.test(data.tool_use_id || ""))) return;
  if (event === "PostToolUseFailure" && !confirmationOperation(data.tool_input?.command)) return;
  if (!["SessionEnd", "UserPromptSubmit", "PreToolUse", "PostToolUseFailure"].includes(event)) return;
  const root = confirmationRoot(data.cwd);
  const scope = context(root, session);
  if (event === "SessionEnd" || event === "UserPromptSubmit") {
    writeConfirmationFile(scope.prompt, { binding: randomUUID() });
    fs.rmSync(scope.tool, { force: true });
    return;
  }
  if (event === "PostToolUseFailure") {
    const current = JSON.parse(readConfirmationFile(scope.tool, 4096));
    if (current.tool === data.tool_use_id) fs.rmSync(scope.tool, { force: true });
    return;
  }
  const command = data.tool_input.command.trim();
  const raw = /^(?:ftl|ft|flower-trellis)[ \t]+confirm[ \t]+/.exec(command);
  if (!raw) return;
  const rest = command.slice(raw[0].length);
  if (operation === "prepare") {
    // 单引号固定分隔符和单行 JSON 禁止展开、重定向到文件或接续其它命令。
    const heredoc = /^prepare <<'FTL_CONFIRM_SPEC'\n(\{[^\r\n]*\})\nFTL_CONFIRM_SPEC$/.exec(rest);
    if (!heredoc) return;
    JSON.parse(heredoc[1]);
  } else if (rest.replace(/[ \t]+/g, " ") !== operation) return;
  const prompt = JSON.parse(readConfirmationFile(scope.prompt, 512));
  const file = transcriptFile(session, data.transcript_path, root, env);
  const timeout = data.tool_input.timeout ?? 120000;
  if (!Number.isSafeInteger(timeout) || timeout < 1) return;
  writeConfirmationFile(scope.tool, { binding: prompt.binding, file, operation, tool: data.tool_use_id, timeout });
  // 只允许启动本项目的确认辅助命令；用户的 ask/deny 和后续实际动作的权限仍由 Claude 处理。
  return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" } };
}

/** 只取本次 Bash 工具之前、同一条助手消息的正文；工具结果或新用户输入会使旧工具失效。 */
function checkTranscript(file, session, tool) {
  const body = readConfirmationFile(file, TRANSCRIPT_LIMIT, true);
  const text = new Map();
  let found = false;
  let review;
  let prompt;
  for (const line of body.split("\n")) {
    let record;
    try { record = JSON.parse(line); } catch { continue; }
    if (record.sessionId !== session || record.isSidechain !== false) continue;
    const blocks = record.message?.content;
    if (record.type === "user") {
      if (found && (record.promptId || (Array.isArray(blocks)
        && blocks.some(block => block.type === "tool_result" && block.tool_use_id === tool)))) return { invalid: true };
      if (record.promptId) {
        text.clear();
        prompt = record.promptId;
      }
    }
    if (record.type !== "assistant" || !record.message?.id || !Array.isArray(blocks)) continue;
    for (const block of blocks) {
      if (block.type === "text" && typeof block.text === "string") {
        text.set(record.message.id, (text.get(record.message.id) || "") + block.text);
        if (text.size > 16) text.delete(text.keys().next().value);
      }
      if (block.type === "tool_use" && block.id === tool && block.name === "Bash") {
        found = true;
        review = confirmationDigest(text.get(record.message.id) || "");
      }
    }
  }
  return { found, review, prompt };
}

/**
 * 校验前台 Bash 与原 Claude 终端、用户输入版本及真实助手正文的绑定。
 * @param {string} root 项目根。
 * @param {string} operation 当前 CLI 操作。
 * @param {object} env 原生 Bash 环境。
 * @returns {object} 会话、实际工具预算及异步复核函数。
 */
export function claudeConfirmationOrigin(root, operation, env) {
  const session = env.CLAUDE_CODE_SESSION_ID;
  if (!session || !ID.test(session)) throw new Error("当前调用缺少原版 Claude Code 会话身份");
  const scope = context(root, session);
  const command = JSON.parse(readConfirmationFile(scope.tool, 4096));
  if (command.operation !== operation) throw new Error("本次 Bash 工具与确认操作不匹配");
  let stamp;
  let observed;
  return {
    owner: `claude_${session}`,
    // Bash 的最大 600 秒需给命令启动、三次材料复核和工具回传留余量。
    maxWaitSeconds: CONFIRMATION_ID.test(operation) ? Math.min(570, Math.floor(command.timeout / 1000) - 30) : 570,
    async verify(review) {
      if (claudeTerminal() !== scope.terminal) throw new Error("Claude 原终端已关闭");
      const prompt = JSON.parse(readConfirmationFile(scope.prompt, 512));
      const current = JSON.parse(readConfirmationFile(scope.tool, 4096));
      if (prompt.binding !== command.binding || current.tool !== command.tool || !ID.test(prompt.binding)) {
        throw new Error("Claude 原回合已中断或已收到人工输入");
      }
      const file = transcriptFile(session, command.file, root, env);
      const stat = fs.statSync(file);
      const next = `${stat.ino}/${stat.size}/${stat.mtimeMs}`;
      if (next !== stamp) {
        observed = checkTranscript(file, session, command.tool);
        stamp = next;
      }
      if (!observed.found || !ID.test(observed.prompt || "") || observed.invalid || (review && observed.review !== review)) {
        throw new Error(review ? "Claude 未在本次 Bash 工具前展示完整确认正文，或已中断" : "Claude 未记录本次前台 Bash 工具");
      }
      return confirmationDigest(`${scope.terminal}\n${prompt.binding}\n${observed.prompt}`);
    },
  };
}
