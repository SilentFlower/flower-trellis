import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isStandardNpmNodeShim, isStandardNpmNativeShim } from "./npm-node-shim.js";
import { CONFIRMATION_SESSION_ENV, CONFIRMATION_MCP_SERVER, CONFIRMATION_TOOL_BUDGET_SECONDS } from "../constants.js";

/**
 * 定位真实可执行文件；Windows npm shim只有全文及bin归属均核验后才直接启动Node。
 * @param {string} command 用户指定的Codex或Claude程序。
 * @param {object} options 平台与环境。
 * @returns {{executable:string,args:string[],platform:string}} 无shell调用及平台。
 */
export function resolveConfirmationHarness(command, { env = process.env, platform = process.platform } = {}) {
  const basename = path.basename(command).replace(/\.(?:exe|cmd)$/i, "").toLowerCase();
  if (!["codex", "claude"].includes(basename)) throw new Error("当前自动确认只适配codex与claude；其他Harness请使用原入口人工确认");
  const extensions = platform === "win32" ? [".exe", ".cmd", ""] : [""];
  const candidates = path.isAbsolute(command) || command.includes(path.sep)
    ? [path.resolve(command)]
    : (env.PATH || env.Path || "").split(path.delimiter).filter(Boolean)
      .flatMap(directory => extensions.map(extension => path.join(directory, command + extension)));
  for (const candidate of candidates) {
    if (platform === "win32" && !/\.(?:exe|cmd)$/i.test(candidate)) continue;
    try { fs.accessSync(candidate, platform === "win32" ? fs.constants.F_OK : fs.constants.X_OK); } catch { continue; }
    if (!fs.statSync(candidate).isFile()) continue;
    if (platform === "win32" && candidate.toLowerCase().endsWith(".cmd")) {
      const packageName = basename === "codex" ? "@openai/codex" : "@anthropic-ai/claude-code";
      const packageRoot = path.join(path.dirname(candidate), "node_modules", packageName);
      let metadata;
      try { metadata = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8")); } catch { continue; }
      const bin = typeof metadata.bin === "string" ? metadata.bin : metadata.bin?.[basename];
      if (metadata.name !== packageName || typeof bin !== "string") continue;
      const target = path.resolve(packageRoot, bin);
      if (!target.startsWith(packageRoot + path.sep) || !fs.existsSync(target)) continue;
      if (target.toLowerCase().endsWith(".exe") && isStandardNpmNativeShim(candidate, target)) {
        return { executable: fs.realpathSync.native(target), args: [], platform: basename };
      }
      if (!isStandardNpmNodeShim(candidate, target)) continue;
      return { executable: process.execPath, args: [target], platform: basename };
    }
    return { executable: fs.realpathSync.native(candidate), args: [], platform: basename };
  }
  throw new Error("未找到可核验的Harness程序，请检查PATH或使用原生可执行文件路径");
}

/**
 * 判断原参数是否要求不受本入口控制的模式；保留原参数并回到人工。
 * @param {string} platform Harness名称。
 * @param {string[]} args 原参数。
 * @returns {string|null} 不兼容原因或null。
 */
export function confirmationManualReason(platform, args) {
  if (platform === "codex" && args.some(arg => ["exec", "e", "agents", "app-server", "--remote", "--worktree", "--cd", "-C"].includes(arg)
    || arg.startsWith("--remote=") || arg.startsWith("--cd="))) return "当前Codex参数使用其他会话或工作目录";
  if (platform === "claude" && args.some(arg => ["--print", "-p", "--worktree", "-w", "--mcp-config", "--settings", "--strict-mcp-config"].includes(arg)
    || /^(?:--mcp-config|--settings|--worktree)=/.test(arg))) return "当前Claude参数需要保留独立配置或非交互模式";
  return null;
}

/**
 * 仅为当前进程叠加一个随机命名的等待服务，不修改全局配置或其它工具权限。
 * @param {object} options 真实程序、原参数、本次描述符及当前环境。
 * @returns {object} 可直接交给进程守护器的程序、参数和环境。
 */
export function createConfirmationHarnessLaunch({ resolved, args, descriptor, env = process.env }) {
  const serialized = JSON.stringify(descriptor);
  const serverName = descriptor.server_name || `${CONFIRMATION_MCP_SERVER}_${descriptor.instance_id.split("-")[0]}`;
  const mcp = fileURLToPath(new URL("./confirmation-mcp.js", import.meta.url));
  const environment = { ...env, [CONFIRMATION_SESSION_ENV]: serialized };
  let extra;
  if (resolved.platform === "codex") {
    const config = `{command=${JSON.stringify(process.execPath)},args=[${JSON.stringify(mcp)}],`
      + `env={${CONFIRMATION_SESSION_ENV}=${JSON.stringify(serialized)}},enabled=true,enabled_tools=["wait"],`
      + `tool_timeout_sec=${CONFIRMATION_TOOL_BUDGET_SECONDS + 30},tools={wait={approval_mode="approve"}}}`;
    extra = [
      ...(args.includes("--no-daemon") ? [] : ["--no-daemon"]),
      "-c", `mcp_servers.${serverName}=${config}`,
      "-c", `shell_environment_policy.set.${CONFIRMATION_SESSION_ENV}=${JSON.stringify(serialized)}`,
    ];
  } else {
    const configuration = { mcpServers: { [serverName]: { type: "stdio", command: process.execPath, args: [mcp],
      env: { [CONFIRMATION_SESSION_ENV]: serialized }, timeout: (CONFIRMATION_TOOL_BUDGET_SECONDS + 30) * 1000 } } };
    // 单次settings只增加精确wait规则；已有用户/项目配置继续由原生宿主合并。
    extra = ["--mcp-config", JSON.stringify(configuration), "--settings",
      JSON.stringify({ permissions: { allow: [`mcp__${serverName}__wait`] }, env: { CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS: "0" } })];
    environment.CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS = "0";
  }
  return { executable: resolved.executable, args: [...resolved.args, ...extra, ...args], env: environment, serverName };
}

/**
 * 在注册前核对已安装版本；旧版本保持人工，不猜测不存在的接口。
 * @param {object} resolved 已核实的程序调用。
 * @param {object} options 环境及可替换的只读执行器。
 * @returns {boolean} 是否达到本功能已验证的接口基线。
 */
export function supportsConfirmationHarness(resolved, { env = process.env, execute = execFileSync } = {}) {
  try {
    const output = execute(resolved.executable, [...resolved.args, "--version"], { env, encoding: "utf8", timeout: 10000, windowsHide: true });
    const match = /(\d+)\.(\d+)\.(\d+)/.exec(output);
    if (!match) return false;
    const version = match.slice(1).map(Number);
    const minimum = resolved.platform === "codex" ? [0, 167, 0] : [2, 1, 293];
    for (let i = 0; i < 3; i++) if (version[i] !== minimum[i]) return version[i] > minimum[i];
    return true;
  } catch { return false; }
}
