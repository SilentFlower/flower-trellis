import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ENHANCEMENTS_ROOT } from "../lib/paths.js";
import {
  resolveTrellisPythonCommand,
  trellisPythonInvocation,
} from "../lib/trellis-python-command.js";

const SUPPORTED_COMMANDS = new Set(["status", "prepare", "migrate", "create", "remove"]);
const VALUE_OPTIONS = new Set([
  "--branch",
  "--base",
  "--task-title",
  "--task-slug",
  "--task-description",
  "--developer",
  "--plan-fingerprint",
]);
const BOOLEAN_OPTIONS = new Set(["--json", "--dry-run", "--yes", "--inherit-route-prefs"]);

/**
 * 解析 Flower worktree 子命令参数。
 *
 * @param {string[]} args `worktree` 之后的参数
 * @returns {{command:string,options:Map<string,string|boolean>,json:boolean}} 规范化参数
 */
export function parseWorktreeArgs(args) {
  const command = args[0];
  if (!SUPPORTED_COMMANDS.has(command)) {
    throw new Error("worktree 需要 status、prepare、migrate、create 或 remove 子命令");
  }
  const options = new Map();
  for (let index = 1; index < args.length; index += 1) {
    const token = args[index];
    if (BOOLEAN_OPTIONS.has(token)) {
      options.set(token, true);
      continue;
    }
    if (!VALUE_OPTIONS.has(token)) {
      throw new Error(`worktree 不支持参数: ${token}`);
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${token} 需要取值`);
    }
    options.set(token, value);
    index += 1;
  }

  if (command === "create") {
    for (const required of ["--branch", "--task-title", "--task-slug"]) {
      if (!options.has(required)) throw new Error(`worktree create 缺少 ${required}`);
    }
    if (options.has("--yes") && !options.has("--plan-fingerprint")) {
      throw new Error("worktree create --yes 需要 --plan-fingerprint");
    }
    if (!options.has("--yes") && options.has("--plan-fingerprint")) {
      throw new Error("--plan-fingerprint 只用于已确认的 worktree create --yes");
    }
  }
  if (command !== "migrate" && options.has("--dry-run")) {
    throw new Error("--dry-run 只用于 worktree migrate");
  }
  if (command !== "create" && options.has("--yes")) {
    throw new Error("--yes 只用于 worktree create");
  }
  if (command !== "prepare" && options.has("--inherit-route-prefs")) {
    throw new Error("--inherit-route-prefs 只用于 worktree prepare");
  }
  return { command, options, json: options.has("--json") };
}

/**
 * 构造传给随包 Python engine 的参数。
 *
 * @param {{command:string,options:Map<string,string|boolean>}} parsed 已解析参数
 * @param {string} target Flower 全局目标路径
 * @param {string} source 当前外部控制 worktree
 * @returns {string[]} Python engine 参数
 */
export function worktreeEngineArgs(parsed, target, source) {
  const args = [parsed.command];
  if (parsed.command === "create") {
    args.push("--source", source, "--target", target);
  } else {
    args.push("--target", target);
    if (parsed.command === "prepare" && parsed.options.has("--inherit-route-prefs")) {
      args.push("--source", source);
    }
  }
  for (const [name, value] of parsed.options) {
    if (name === "--json") continue;
    args.push(name);
    if (value !== true) args.push(value);
  }
  args.push("--json");
  return args;
}

/**
 * 打印适合交互终端的 worktree 结果摘要。
 *
 * @param {Record<string,unknown>} payload Python engine 结构化结果
 * @returns {void}
 */
export function printWorktreeResult(payload) {
  console.log(`worktree: ${payload.status}`);
  if (payload.targetRoot) console.log(`target: ${payload.targetRoot}`);
  if (payload.branch) console.log(`branch: ${payload.branch}`);
  if (payload.source?.root) {
    console.log(`source: ${payload.source.root}`);
    console.log(`source branch: ${payload.source.branch || "(detached HEAD)"}`);
    console.log(`source HEAD: ${payload.source.head}`);
  }
  if (payload.base?.ref) {
    console.log(`base: ${payload.base.ref}`);
    console.log(`base commit: ${payload.base.resolvedCommit}`);
  }
  if (payload.source?.workingTree && !payload.source.workingTree.clean) {
    const count = payload.source.workingTree.entries?.length || 0;
    console.log(`warning: 来源 worktree 有 ${count} 项未提交状态，不包含在 base 中`);
  }
  if (Array.isArray(payload.repositories)) {
    for (const repository of payload.repositories) {
      const local = repository.initialized
        ? `source ${repository.sourceBranch || "detached"}@${repository.sourceHead}`
        : "source 未初始化";
      const selection = repository.selected
        ? `本次创建根分支 ${repository.targetBranch || payload.branch}`
        : "仅展示，不自动创建子仓分支";
      console.log(`repository: ${repository.path} ${repository.baseCommit} (${selection}; ${local})`);
    }
  }
  if (payload.localStateTransfer?.routePreferences?.action) {
    console.log(`route preferences: ${payload.localStateTransfer.routePreferences.action}`);
  }
  if (payload.requiresConfirmation && payload.confirmation?.fingerprint) {
    console.log(`confirmation: 使用 --yes --plan-fingerprint ${payload.confirmation.fingerprint}`);
  }
  if (payload.task) console.log(`task: ${payload.task}`);
  if (payload.reason) console.log(`reason: ${payload.reason}`);
  if (payload.message) console.log(`message: ${payload.message}`);
  if (payload.handoff?.cwd) {
    console.log(`handoff: 在 ${payload.handoff.cwd} 启动新会话继续任务规划`);
    if (payload.handoff.reason) console.log(`handoff reason: ${payload.handoff.reason}`);
  }
}

/**
 * 运行 Flower 自有 worktree facade。
 *
 * @param {{target:string,targetExplicit?:boolean,passthrough:string[]}} ctx CLI 上下文
 * @returns {Promise<number>} 进程退出码
 */
export async function worktree(ctx) {
  const parsed = parseWorktreeArgs(ctx.passthrough);
  if (parsed.command === "create" && !ctx.targetExplicit) {
    throw new Error("worktree create 必须显式传入 --target");
  }
  const script = path.join(ENHANCEMENTS_ROOT, "0.6", "scripts", "worktree_setup.py");
  if (!fs.existsSync(script)) throw new Error(`缺少随包 worktree engine: ${script}`);

  const source = process.cwd();
  // worktree facade 是项目外 bootstrap，不能通过 legacy 目录 symlink 读取目标或其它分支配置。
  const resolved = resolveTrellisPythonCommand(ctx.target, { generatedEvidence: false });
  const invocation = trellisPythonInvocation(resolved.command);
  const result = spawnSync(
    invocation.executable,
    [...invocation.args, script, ...worktreeEngineArgs(parsed, ctx.target, source)],
    {
      cwd: source,
      env: process.env,
      encoding: "utf8",
      windowsHide: true,
    },
  );
  if (result.error) throw result.error;

  let payload;
  try {
    payload = JSON.parse(result.stdout || "");
  } catch {
    throw new Error(`worktree engine 未返回合法 JSON${result.stderr ? `: ${result.stderr.trim()}` : ""}`);
  }
  if (parsed.json) console.log(JSON.stringify(payload));
  else printWorktreeResult(payload);
  if (result.status !== 0 && process.env.FLOWER_DEBUG && result.stderr) {
    console.error(result.stderr.trim());
  }
  return result.status ?? 1;
}
