/** 产品入口实测：实际CLI和生产MCP，模型仅为回环mock，无业务Git动作。 */
import fs from "node:fs";
import path from "node:path";
import { spawn as spawnPty } from "node-pty";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { gunzipSync, inflateSync, brotliDecompressSync } from "node:zlib";
import { buildCodexResponseEvents, encodeCodexSse } from "./confirmation-mock.mjs";
import { sendClaudeMessage } from "./confirmation-mock.mjs";
import { resolveConfirmationHarness } from "../../src/lib/confirmation-harnesses.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
if (!args.includes("--run")) { process.stdout.write("--run --harness codex|claude --scenario timeout|human|kill --seconds 3\n"); process.exit(0); }
const harness = option("--harness", "codex");
const scenario = option("--scenario", "timeout");
const seconds = Number(option("--seconds", "3"));
if (!["codex", "claude"].includes(harness) || !["timeout", "human", "kill"].includes(scenario)
  || !Number.isInteger(seconds) || seconds < 1 || seconds > 200) throw new Error("产品实验参数无效");
const scratch = path.join(ROOT, ".trellis-tmp");
fs.mkdirSync(scratch, { recursive: true });
const root = fs.mkdtempSync(path.join(scratch, `confirmation-product-${harness}-`));
const resultFile = path.join(root, "result.json");
const started = Date.now();
const events = [];
const record = (event, extra = {}) => { const entry = { event, time_ms: Date.now() - started, ...extra };
  events.push(entry); fs.appendFileSync(path.join(root, "events.jsonl"), `${JSON.stringify(entry)}\n`); process.stdout.write(`${JSON.stringify(entry)}\n`); };
fs.cpSync(path.join(ROOT, ".trellis/scripts/common"), path.join(root, ".trellis/scripts/common"), { recursive: true, filter: file => !file.includes("__pycache__") });
fs.copyFileSync(path.join(ROOT, "enhancements/0.6/scripts/confirmation.py"), path.join(root, ".trellis/scripts/confirmation.py"));
fs.writeFileSync(path.join(root, ".trellis/config.yaml"), `confirmation_timeout:\n  check:\n    base_seconds: ${seconds}\n`);
fs.writeFileSync(path.join(root, "report.md"), "# 产品入口完整报告\n\nCHK-1 修复当前测试问题，再重新检查。\n");
// 独立验证真实SessionStart的测试另有覆盖；本探针用原生shell身份桥接绑定，避免改写Codex全局Hook批准。
const bindCode = `import json, os, sys\nfrom pathlib import Path\nsys.path.insert(0, str(Path.cwd()/'.trellis/scripts'))\nimport confirmation\nroot=Path.cwd().resolve()\nkey='CODEX_THREAD_ID' if '${harness}'=='codex' else 'CLAUDE_CODE_SESSION_ID'\nconfirmation.bind_session(root, {'session_id':os.environ[key]}, '${harness}')\nprint(json.dumps(confirmation.session_request({'method':'prepare','owner':confirmation._owner('${harness}'),'spec':{'kind':'check','file':'report.md','problem_ids':['CHK-1']}})))\n`;
fs.writeFileSync(path.join(root, ".trellis/scripts/probe-bind.py"), bindCode);
execFileSync("git", ["init", "--quiet", root]);
const resolved = resolveConfirmationHarness(harness);
const version = execFileSync(resolved.executable, [...resolved.args, "--version"], { encoding: "utf8" }).trim();
const env = {};
for (const key of ["PATH", "Path", "HOME", "home", "CODEX_HOME", "USER", "LOGNAME", "SHELL", "LANG", "LC_ALL", "TMPDIR", "TMP", "TEMP", "SystemRoot", "COMSPEC", "PATHEXT", "USERPROFILE", "APPDATA", "LOCALAPPDATA"])
  if (process.env[key] !== undefined) env[key] = process.env[key];
Object.assign(env, { FLOWER_NO_TELEMETRY: "1", FLOWER_NO_UPDATE_CHECK: "1", PYTHONUTF8: "1", TERM: "xterm-256color" });
let stage = "prepare";
let requestId;
let sequence = 0;
let requests = 0;
let waitingAt = null;
let stoppedAt = null;
let postExitRequests = 0;
let child;
let output = "";
let completed;
const done = new Promise(resolve => { completed = resolve; });
const sockets = new Set();
let catalogSeen = false;
let prompted = false;
let trustAnswered = false;
let toolBytes = null;

/** 仅从真实工具输出提取结构化结果，不能把助手自述当作已领取。 */
function find(value, predicate, depth = 0) {
  if (depth > 18 || value === null || value === undefined) return null;
  if (typeof value === "string") { try { return find(JSON.parse(value), predicate, depth + 1); } catch { return null; } }
  if (typeof value !== "object") return null;
  if (predicate(value)) return value;
  for (const item of Object.values(value)) { const hit = find(item, predicate, depth + 1); if (hit) return hit; }
  return null;
}

const server = createServer(async (request, response) => {
  if (request.method !== "POST" || !request.url?.startsWith(harness === "codex" ? "/v1/responses" : "/v1/messages")) return response.writeHead(403).end();
  try {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    let raw = Buffer.concat(chunks);
    if (request.headers["content-encoding"] === "gzip") raw = gunzipSync(raw);
    if (request.headers["content-encoding"] === "deflate") raw = inflateSync(raw);
    if (request.headers["content-encoding"] === "br") raw = brotliDecompressSync(raw);
    const body = JSON.parse(raw.toString("utf8"));
    const tools = [...(body.tools || []), ...(body.input || []).filter(item => item.type === "additional_tools").flatMap(item => item.tools || [])];
    const candidates = tools.flatMap(tool => tool.type === "namespace" ? tool.tools.map(item => ({ ...item, namespace: tool.name })) : [tool]);
    const code = candidates.find(tool => tool.namespace === "functions" && tool.name === "exec" && tool.type === "custom");
    const wait = tools.find(tool => /flower_confirmation_[a-f0-9]{8}__wait$/.test(tool.name || ""));
    const main = harness === "codex" ? Boolean(code) : Boolean(wait);
    if (!main) {
      if (harness === "claude") return sendClaudeMessage(response, body, [{ type: "text", text: "FLOWER_AUXILIARY" }]);
      response.writeHead(200, { "content-type": "text/event-stream" });
      return response.end(encodeCodexSse(buildCodexResponseEvents({ sequence: ++sequence, text: "FLOWER_AUXILIARY" })));
    }
    requests++;
    if (stoppedAt !== null) postExitRequests++;
    const invoke = command => harness === "codex"
      ? { toolCall: { type: "custom", namespace: code.namespace, name: code.name,
        input: `const r = await tools.exec_command({cmd:${JSON.stringify(command)}}); text(r.output);` } }
      : { blocks: [{ type: "tool_use", id: `toolu_product_${requests}`, name: "Bash", input: { command } }] };
    let reply;
    if (stage === "prepare") {
      reply = invoke(`${process.platform === "win32" ? "python" : "python3"} .trellis/scripts/probe-bind.py`);
      stage = "wait";
    } else if (stage === "wait") {
      const prepared = find(body, value => typeof value.request_id === "string" && value.source === "project_policy");
      if (!prepared) throw new Error("未取得真实prepare结果");
      requestId = prepared.request_id;
      if (harness === "codex") reply = { toolCall: { type: "custom", namespace: code.namespace, name: code.name,
        input: `// @exec: {"yield_time_ms":260000,"max_output_tokens":1000}\nconst matches=ALL_TOOLS.filter(t=>/flower_confirmation_[a-f0-9]{8}__wait$/.test(t.name)); if(matches.length!==1) throw new Error("等待工具不唯一"); text(await tools[matches[0].name]({request_id:${JSON.stringify(requestId)}}));` } };
      else { toolBytes = Buffer.byteLength(JSON.stringify(wait)); reply = { blocks: [{ type: "tool_use", id: "toolu_product_wait", name: wait.name, input: { request_id: requestId } }] }; }
      stage = "claim";
    } else if (stage === "claim") {
      const decision = find(body, value => value.request_id === requestId && ["cancelled", "policy_timeout"].includes(value.source));
      if (!decision) throw new Error("未取得真实wait结果");
      record("wait_returned_to_model", { source: decision.source, requests });
      if (decision.source === "cancelled") { stage = "done"; reply = { text: "FLOWER_PRODUCT_CANCELLED" }; }
      else { reply = invoke(`${process.platform === "win32" ? "python" : "python3"} .trellis/scripts/confirmation.py claim --request-id ${requestId}`); stage = "finish"; }
    } else if (stage === "finish") {
      const claim = find(body, value => value.request_id === requestId && value.source === "policy_timeout" && value.action === "repair_all_and_recheck" && typeof value.revision === "string");
      if (!claim) throw new Error("未取得真实claim结果");
      record("claim_returned_to_model", { action: claim.action, requests });
      reply = { text: "FLOWER_PRODUCT_CONFIRMED" }; stage = "done";
    } else reply = { text: "FLOWER_PRODUCT_DONE" };
    record("model_request", { number: requests, next: stage });
    if (harness === "claude") sendClaudeMessage(response, body, reply.blocks || [{ type: "text", text: reply.text }]);
    else {
      const events = buildCodexResponseEvents({ sequence: ++sequence, ...reply });
      const unique = JSON.parse(JSON.stringify(events).replaceAll('"call_id":"call_flower_confirmation_wait"', `"call_id":"call_product_${sequence}"`));
      response.writeHead(200, { "content-type": "text/event-stream" }); response.end(encodeCodexSse(unique));
    }
  } catch (error) { record("probe_error", { reason: error.message }); response.writeHead(422).end(); completed(false); }
});
server.on("connection", socket => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); socket.on("error", () => socket.destroy()); });
server.on("connect", (_request, socket) => socket.end("HTTP/1.1 403 Forbidden\r\n\r\n"));
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const address = `http://127.0.0.1:${server.address().port}`;
Object.assign(env, { HTTP_PROXY: address, HTTPS_PROXY: address, ALL_PROXY: address,
  http_proxy: address, https_proxy: address, all_proxy: address, NO_PROXY: "127.0.0.1,localhost,::1", no_proxy: "127.0.0.1,localhost,::1" });
let nativeArgs;
if (harness === "codex") {
  env.FLOWER_PRODUCT_DUMMY = "product-probe-dummy-not-a-key";
  nativeArgs = ["--sandbox", "danger-full-access", "--ask-for-approval", "on-request", "-c", 'model="gpt-6.1-sol"',
    "-c", 'model_provider="flower_product_probe"', "-c", `model_providers.flower_product_probe={name="回环产品测试",base_url="${address}/v1",wire_api="responses",env_key="FLOWER_PRODUCT_DUMMY",requires_openai_auth=false,supports_websockets=false}`,
    "-c", `projects={${JSON.stringify(root)}={trust_level="trusted"}}`, "-c", `log_dir=${JSON.stringify(path.join(root, "native-logs"))}`,
    ...["features.hooks=false", "features.apps=false", "features.plugins=false", "features.memories=false", "features.shell_snapshot=false", "features.api_key_model_discovery=false", "check_for_update_on_startup=false", "mcp_servers.mysql.enabled=false", "mcp_servers.openaiDeveloperDocs.enabled=false"].flatMap(value => ["-c", value]),
    "FLOWER_PRODUCT_PROBE_START"];
} else {
  const config = path.join(root, "claude-config"); fs.mkdirSync(config);
  // 仅实验目录的非凭据设置。工作区信任通过实际菜单处理，不写入真实用户配置。
  fs.writeFileSync(path.join(config, ".claude.json"), JSON.stringify({ hasCompletedOnboarding: true, lastOnboardingVersion: "2.1.293", lastReleaseNotesSeen: "2.1.293", customApiKeyResponses: { approved: ["dummy"], rejected: [] } }));
  fs.writeFileSync(path.join(config, "settings.json"), JSON.stringify({ theme: "dark" }));
  fs.mkdirSync(path.join(root, ".claude"));
  fs.writeFileSync(path.join(root, ".claude/settings.local.json"), JSON.stringify({ permissions: { allow: [`Bash(${process.platform === "win32" ? "python" : "python3"} .trellis/scripts/probe-bind.py)`, `Bash(${process.platform === "win32" ? "python" : "python3"} .trellis/scripts/confirmation.py claim:*)`] } }));
  Object.assign(env, { CLAUDE_CONFIG_DIR: config, ANTHROPIC_BASE_URL: address, ANTHROPIC_API_KEY: "dummy", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1", DISABLE_TELEMETRY: "1", DISABLE_ERROR_REPORTING: "1", DISABLE_AUTOUPDATER: "1", DISABLE_GROWTHBOOK: "1", ENABLE_TOOL_SEARCH: "false", CLAUDE_CODE_MAX_RETRIES: "0" });
  nativeArgs = ["--no-chrome", "--model", "sonnet"];
}
let timeout;
let monitor;
try {
  child = spawnPty(process.execPath, [path.join(ROOT, "bin/flower-trellis.js"), "session", "--target", root, "--", harness, ...nativeArgs], { cwd: root, env, cols: 160, rows: 50, name: "xterm-256color" });
  record("started", { harness, version, scenario, seconds, root, controller_pid: child.pid });
  child.onData(data => {
    output = (output + data).slice(-262144);
    if (data.includes("\x1b[6n")) child.write("\x1b[1;1R");
    if (data.includes("\x1b[c")) child.write("\x1b[?1;2c");
    const text = output.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
    const compact = text.replace(/\s/g, "");
    if (harness === "claude" && !trustAnswered && compact.includes("Accessingworkspace:")
      && compact.includes(root.replace(/\s/g, "")) && compact.includes("Yes,Itrustthisfolder") && compact.includes("No,exit")) {
      trustAnswered = true;
      // 已核对菜单默认选择No；仅为此脚本新建的临时目录选择下一项，不修改真实用户trust。
      setTimeout(() => { child.write("\x1b[B"); setTimeout(() => child.write("\r"), 300); }, 1500);
      record("fixture_trust_menu");
    }
    if (text.includes("FLOWER_PRODUCT_CONFIRMED")) completed(scenario === "timeout");
    if (text.includes("FLOWER_PRODUCT_CANCELLED")) completed(scenario === "human");
  });
  child.onExit(() => { stoppedAt ??= Date.now(); record("entry_exited"); if (scenario !== "kill") completed(false); });
  monitor = setInterval(() => {
    const directory = path.join(root, ".trellis/.runtime/confirmations");
    if (!fs.existsSync(directory)) return;
    const audit = fs.readdirSync(directory).filter(file => file.endsWith(".jsonl")).flatMap(file => fs.readFileSync(path.join(directory, file), "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)));
    catalogSeen ||= audit.some(entry => entry.event === "tool_ready");
    if (harness === "claude" && catalogSeen && !prompted) { prompted = true; setTimeout(() => child.write("FLOWER_PRODUCT_PROBE_START\r"), 300); }
    if (!waitingAt && audit.some(entry => entry.event === "waiting")) {
      waitingAt = Date.now(); record("waiting", { requests });
      if (scenario === "human") setTimeout(() => child.write("取消本次默认决定\r"), 500);
      if (scenario === "kill") setTimeout(() => { stoppedAt = Date.now(); process.kill(child.pid, "SIGKILL"); setTimeout(() => completed(postExitRequests === 0), seconds * 1000 + 1000); }, 300);
    }
  }, 40);
  timeout = setTimeout(() => { record("deadline", { stage, catalogSeen, prompted, trustAnswered }); fs.writeFileSync(path.join(root, "terminal.txt"), output); completed(false); }, seconds * 1000 + 60000);
  const passed = await done;
  fs.writeFileSync(path.join(root, "terminal.txt"), output);
  const result = { passed, harness, version, scenario, seconds, requests, postExitRequests, toolBytes, waiting_ms: waitingAt ? Date.now() - waitingAt : null, events };
  fs.writeFileSync(resultFile, JSON.stringify(result, null, 2)); record("result", { passed, result_file: resultFile }); process.exitCode = passed ? 0 : 2;
} finally {
  clearInterval(monitor); clearTimeout(timeout);
  if (child) try { child.kill("SIGTERM"); } catch { /* 入口可能已退出。 */ }
  await new Promise(resolve => setTimeout(resolve, 800));
  for (const socket of sockets) socket.destroy();
  await new Promise(resolve => server.close(resolve));
}
