/** Codex 内置 TUI 服务的前台窗口绑定与退出观测。 */
import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import path from "node:path";
import { PKG_ROOT } from "./paths.js";
import { resolveTrellisPythonCommand, trellisPythonInvocation } from "./trellis-python-command.js";

const HELPER = path.join(PKG_ROOT, "src", "assets", "flower_tui_lifetime.py");

/** 创建仅属于当前确认请求的辅助进程。
 * @param {string} command 绑定、检查或观察命令
 * @param {object} value JSON 输入
 * @param {string} project 项目根目录
 * @returns {import('node:child_process').ChildProcess} 子进程
 */
function launch(command, value, project) {
  const python = trellisPythonInvocation(resolveTrellisPythonCommand(project).command);
  const child = spawn(python.executable, [...python.args, "-X", "utf8", HELPER, command], {
    cwd: project, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin.on("error", () => {});
  child.stdin.write(`${JSON.stringify(value)}\n`);
  if (command !== "watch") child.stdin.end();
  return child;
}

/** 执行有明确时间预算的单次本机身份核验。
 * @param {string} command bind 或 check
 * @param {object} value JSON 输入
 * @param {string} project 项目根目录
 * @returns {Promise<object>} 辅助程序结果
 */
function runHelper(command, value, project) {
  return new Promise((resolve, reject) => {
    const child = launch(command, value, project);
    let output = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error("前台窗口核验超时")); }, 5000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", chunk => {
      output += chunk;
      if (output.length > 65536) { child.kill(); reject(new Error("前台窗口核验输出过大")); }
    });
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("close", code => {
      clearTimeout(timer);
      try {
        const result = JSON.parse(output);
        if (code !== 0) throw new Error(result.reason || "前台窗口无法核验");
        resolve(result);
      } catch (error) { reject(error); }
    });
  });
}

/** 查询精确根会话当前的内置服务地址，读取不会附加新的会话订阅。
 * @param {object} client 提供 rpc(method, params) 的原生客户端
 * @param {string} sessionId 精确根会话编号
 * @returns {Promise<string>} 本机服务 origin
 */
async function currentOrigin(client, sessionId) {
  const result = await client.rpc("mcpServerStatus/list", {
    threadId: sessionId, serverName: "codex_tui", detail: "toolsAndAuthOnly", limit: 5,
  });
  const servers = result.data?.filter(value => value.name === "codex_tui") || [];
  if (result.nextCursor || servers.length !== 1 || servers[0].runtimeStatus !== "connected"
      || !/^http:\/\/(127\.0\.0\.1|\[::1\]):[1-9][0-9]{0,4}$/.test(servers[0].httpOrigin || "")) {
    throw new Error("当前会话缺少唯一可核验的原生 TUI 服务，保持人工确认");
  }
  return servers[0].httpOrigin;
}

/** 从实际监听者冻结当前会话的前台进程身份。
 * @param {object} options 原生客户端、会话、项目及可替换的身份核验器
 * @returns {Promise<object>} 可持久化的窗口绑定
 */
export async function captureCodexTui({ client, sessionId, project, inspect = runHelper }) {
  const origin = await currentOrigin(client, sessionId);
  const { binding } = await inspect("bind", { origin }, project);
  if (!binding || binding.origin !== origin) throw new Error("前台窗口绑定结果不符");
  // 查询期间可能被另一个 TUI 恢复或重绑；不能把新窗口默认为原窗口。
  if (await currentOrigin(client, sessionId) !== origin) throw new Error("准备期间前台窗口绑定已改变");
  return binding;
}

/** 复核冻结窗口，禁止恢复时将旧请求迁移到新窗口。
 * @param {object} options 原生客户端、会话、项目、原始绑定及核验器
 * @returns {Promise<void>} 核验失败时抛错
 */
export async function verifyCodexTui({ client, sessionId, project, binding, inspect = runHelper }) {
  if (await currentOrigin(client, sessionId) !== binding?.origin) throw new Error("原前台窗口绑定已改变");
  const result = await inspect("check", binding, project);
  if (result.valid !== true) throw new Error("原前台窗口已经失效");
  if (await currentOrigin(client, sessionId) !== binding.origin) throw new Error("核验期间前台窗口绑定已改变");
}

/** 核对额外原生前台是否都有独立会话归属；同会话第二窗口不能借用第一窗口。
 * @param {object} options 被动客户端、项目和身份核验器
 * @returns {Promise<void>} 有歧义时保持人工
 */
export async function verifyCodexTuiCoverage({ client, project, inspect = runHelper }) {
  const loaded = await client.rpc("thread/loaded/list", { limit: 1000 });
  if (loaded.nextCursor || !Array.isArray(loaded.data) || !loaded.data.length) throw new Error("无法核验全部已加载原生会话");
  const origins = new Set();
  // 逐个读取只观察现有会话，不恢复或订阅；并限制同时连接的请求数量。
  for (let index = 0; index < loaded.data.length; index += 8) {
    const results = await Promise.all(loaded.data.slice(index, index + 8).map(threadId => client.rpc("mcpServerStatus/list", {
      threadId, serverName: "codex_tui", detail: "toolsAndAuthOnly", limit: 5,
    })));
    for (const result of results) {
      if (result.nextCursor) throw new Error("原生 TUI 来源超出核验预算");
      for (const server of result.data || []) {
        if (server.name === "codex_tui" && server.runtimeStatus === "connected" && server.httpOrigin) origins.add(server.httpOrigin);
      }
    }
  }
  const result = await inspect("coverage", { origins: [...origins] }, project);
  if (result.valid !== true) throw new Error("存在无法核验归属的原生前台");
}

/** 观察当前请求的前台退出，辅助进程不会脱离确认 worker 常驻。
 * @param {object} binding 已冻结的窗口身份
 * @param {object} options 项目目录
 * @returns {EventEmitter & {ready:Promise<void>,close:Function}} 就绪状态及 exited/invalid 事件
 */
export function watchCodexTui(binding, { project }) {
  const events = new EventEmitter();
  const child = launch("watch", binding, project);
  let buffer = "";
  let finished = false;
  let resolveReady;
  let rejectReady;
  events.ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const timer = setTimeout(() => fail("前台退出观测启动超时"), 5000);
  /** 终止本请求的失败观察，绝不操作被观察的前台进程。 */
  function fail(reason) {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    child.stdin.end();
    child.kill();
    rejectReady(new Error(reason));
    events.emit("invalid", new Error(reason));
  }
  events.close = () => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    rejectReady(new Error("本次前台观察已关闭"));
    child.stdin.end();
    child.kill();
  };
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", chunk => {
    buffer += chunk;
    if (buffer.length > 65536) { fail("前台退出观测输出过大"); return; }
    while (buffer.includes("\n")) {
      const index = buffer.indexOf("\n");
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      try {
        const value = JSON.parse(line);
        if (value.event === "watching") { clearTimeout(timer); resolveReady(); }
        else if (value.event === "exited") { clearTimeout(timer); finished = true; events.emit("exited"); }
        else fail(value.reason || "原前台窗口已经失效");
      } catch (error) { fail(error.message); }
    }
  });
  child.on("error", error => fail(error.message));
  child.on("close", () => { if (!finished) fail("前台退出观察已中断"); });
  return events;
}
