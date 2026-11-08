import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { gunzipSync } from "node:zlib";
import { setTimeout as sleep } from "node:timers/promises";
import { spawn as spawnPty } from "node-pty";
import { sendClaudeMessage } from "./confirmation-mock.mjs";
import { createNativeWorkflow } from "./confirmation-native-workflow.mjs";

const [mode = "open", gate = "check", secondsText = "3", cli = "claude"] = process.argv.slice(2);
const seconds = Number(secondsText);
const repo = fileURLToPath(new URL("../..", import.meta.url));
const root = fs.mkdtempSync(path.join(os.tmpdir(), "flower-confirm-claude-"));
const project = path.join(root, "project");
const home = path.join(root, "home");
const config = path.join(root, "config");
const bin = path.join(root, "bin");
const runtime = path.join(project, ".trellis/.runtime/confirmations");
const start = "FLOWER_CONFIRM_STOCK_CLAUDE_START";
const marker = "TrellisStockClaudeReviewEnd";
const done = "FLOWER_CONFIRM_STOCK_CLAUDE_DONE";
const prompt = "FLOWER_CONFIRM_STOCK_CLAUDE_HUMAN";
const firstAt = Date.now();
const note = (event, data = {}) => console.log(JSON.stringify({ event, ms: Date.now() - firstAt, ...data }));
for (const dir of [project, home, config, bin]) fs.mkdirSync(dir);
fs.symlinkSync(path.join(repo, "bin/flower-trellis.js"), path.join(bin, "ftl"));
fs.writeFileSync(path.join(config, ".claude.json"), JSON.stringify({
  hasCompletedOnboarding: true, lastOnboardingVersion: "2.1.293", lastReleaseNotesSeen: "2.1.293",
  customApiKeyResponses: { approved: ["dummy"], rejected: [] }, projects: { [project]: { hasTrustDialogAccepted: true } },
}));
fs.writeFileSync(path.join(config, "settings.json"), JSON.stringify({ theme: "dark" }));

function audit() {
  try {
    return fs.readdirSync(runtime).filter(f => f.endsWith(".jsonl"))
      .flatMap(f => fs.readFileSync(path.join(runtime, f), "utf8").trim().split("\n").map(JSON.parse));
  } catch { return []; }
}

async function until(fn, message, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = fn();
    if (value) return value;
    await sleep(30);
  }
  throw new Error(message);
}

function output(messages, step) {
  const result = messages.flatMap(message => Array.isArray(message.content) ? message.content : [])
    .findLast(block => block.type === "tool_result" && block.tool_use_id === `toolu_flower_stock_${step}`);
  const text = (Array.isArray(result?.content) ? result.content.map(block => block.text || "").join("\n") : result?.content) || "";
  for (const line of text.split("\n")) {
    try { const value = JSON.parse(line); if (typeof value === "object" && value) return value; } catch { /* 跳过工具的展示前缀。 */ }
  }
  if (text) note("tool_diagnostic", { text: text.slice(-1200) });
  return null;
}

let step = 0;
let prepared;
let workflow;
let received;
let session;
let serverError;
let replayChecked = false;
const tools = command => ({ type: "tool_use", id: `toolu_flower_stock_${step}`, name: "Bash",
  input: { command, description: "校验项目确认", timeout: 600000, run_in_background: false } });
const server = createServer(async (req, res) => {
  if (req.method !== "POST" || !req.url.startsWith("/v1/messages")) return res.writeHead(403).end();
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    let body = Buffer.concat(chunks);
    if (req.headers["content-encoding"] === "gzip") body = gunzipSync(body);
    const request = JSON.parse(body);
    if (JSON.stringify(request.messages).includes(prompt)) {
      note("human_received");
      return sendClaudeMessage(res, request, [{ type: "text", text: "已收到人工回复" }]);
    }
    if (!JSON.stringify(request.messages).includes(start) || !request.tools?.some(tool => tool.name === "Bash")) {
      return sendClaudeMessage(res, request, [{ type: "text", text: "夹具就绪" }]);
    }
    assert.ok(!request.tools.some(tool => /flower_confirmation|trellis_confirmation/.test(tool.name)));
    const result = output(request.messages, step);
    if (step === 0) {
      step++;
      return sendClaudeMessage(res, request, [tools("ftl confirm status")]);
    }
    if (step === 1 && result?.ready) {
      assert.equal(result.platform, "claude");
      assert.ok(result.enabled);
      const source = fs.readdirSync(path.join(runtime, "claude")).find(file => file.endsWith(".prompt"));
      session = source.slice(0, 36);
      const spec = workflow.prepare(`claude_${session}`);
      step++;
      return sendClaudeMessage(res, request, [tools(`ftl confirm prepare <<'FTL_CONFIRM_SPEC'\n${JSON.stringify(spec)}\nFTL_CONFIRM_SPEC`)]);
    }
    if (step === 2 && result?.review) {
      prepared = result;
      assert.equal(prepared.seconds, seconds);
      step++;
      const review = mode === "partial" ? prepared.review.split("\n").slice(-3).join("\n") : prepared.review;
      return sendClaudeMessage(res, request, [{ type: "text", text: review }, tools(`ftl confirm ${prepared.request_id}`)]);
    }
    if (step === 3 && result?.source === "policy_timeout") {
      assert.equal(result.request_id, prepared.request_id);
      assert.equal(mode, "open");
      workflow.apply(result);
      received = result;
      step++;
      return sendClaudeMessage(res, request, [tools(`ftl confirm finish ${prepared.request_id} completed`)]);
    }
    if (step === 4) {
      assert.equal(result?.outcome, "completed");
      if (gate === "check") {
        step++;
        return sendClaudeMessage(res, request, [{ type: "text", text: prepared.review }, tools(`ftl confirm ${prepared.request_id}`)]);
      }
    } else if (step === 5) {
      assert.equal(result?.manual, true);
      assert.match(result.error, /已等待/);
      replayChecked = true;
    } else if (mode === "partial") assert.equal(result?.manual, true);
    else if (mode === "open") note("unexpected", { step, result });
    return sendClaudeMessage(res, request, [{ type: "text", text: done }]);
  } catch (error) {
    serverError = error;
    note("error", { message: error.message });
    res.writeHead(500).end();
  }
});
server.on("connect", (_req, socket) => socket.destroy());

const windows = [];
try {
  await new Promise((ok, no) => { server.once("error", no); server.listen(0, "127.0.0.1", ok); });
  const mock = `http://127.0.0.1:${server.address().port}`;
  const env = {
    PATH: `${bin}:${process.env.PATH}`, HOME: home, CLAUDE_CONFIG_DIR: config, TERM: "xterm-256color",
    ANTHROPIC_BASE_URL: mock, ANTHROPIC_API_KEY: "dummy", ENABLE_TOOL_SEARCH: "false",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1", DISABLE_TELEMETRY: "1", DISABLE_ERROR_REPORTING: "1", DISABLE_AUTOUPDATER: "1",
    DISABLE_GROWTHBOOK: "1", CLAUDE_CODE_MAX_RETRIES: "0", HTTP_PROXY: mock, HTTPS_PROXY: mock, NO_PROXY: "127.0.0.1,localhost,::1",
    FLOWER_TEST_PYTHON: process.env.FLOWER_TEST_PYTHON,
  };
  if (!env.FLOWER_TEST_PYTHON) delete env.FLOWER_TEST_PYTHON;
  assert.equal(execFileSync(cli, ["--version"], { cwd: project, env, encoding: "utf8" }).trim(), "2.1.293 (Claude Code)");
  workflow = createNativeWorkflow({ project, repo, env, platform: "claude", gate, seconds, marker, defaultPolicy: seconds >= 100 });
  if (mode === "denied") fs.writeFileSync(path.join(project, ".claude/settings.local.json"),
    JSON.stringify({ permissions: { deny: ["Bash(ftl confirm status)"] } }));
  function open(extra = []) {
    const win = { screen: "", reviewAt: null, exited: false };
    win.pty = spawnPty(cli, ["--no-chrome", "--model", "sonnet", "--permission-mode", "default", ...extra],
      { cwd: project, env, cols: 105, rows: 50, name: "xterm-256color" });
    windows.push(win);
    win.pty.onExit(() => { win.exited = true; });
    win.pty.onData(data => {
      if (data.includes("\x1b[6n")) win.pty.write("\x1b[1;1R");
      if (data.includes("\x1b[c")) win.pty.write("\x1b[?1;2c");
      win.screen = (win.screen + data.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")).slice(-14000);
      if (!win.reviewAt && win.screen.includes(marker)) win.reviewAt = Date.now();
    });
    return win;
  }
  const win = open();
  await sleep(1550);
  win.pty.write(start);
  await sleep(130);
  win.pty.write("\r");
  if (mode === "denied") {
    await until(() => win.screen.includes(done), "Claude 未返回显式权限拒绝");
    assert.equal(step, 1);
    assert.ok(!fs.existsSync(path.join(runtime, "requests")));
  } else if (mode === "partial") {
    await until(() => win.screen.includes(done), "未收到正文裁剪的人工回退");
    assert.ok(!audit().some(event => event.event === "waiting"));
  } else {
    const waiting = await until(() => audit().find(event => event.event === "waiting"), "正式命令未开始等待");
    assert.ok(win.reviewAt && win.reviewAt <= Date.parse(waiting.at), "真实终端先显示正文再开始等待");
    note("waiting", { seconds, gate });
    if (mode === "open") {
      await until(() => audit().some(event => event.event === "finished") && (gate !== "check" || replayChecked),
        "未收到真实领取、完成或拒绝重复的记录", (seconds + 15) * 1000);
      assert.ok(Date.parse(audit().find(event => event.event === "claimed").at) >= Date.parse(waiting.at) + seconds * 1000);
    }
    else {
      if (mode === "edge") await sleep(Math.max(0, Date.parse(waiting.at) + seconds * 1000 - 220 - Date.now()));
      if (["kill", "resume"].includes(mode)) {
        win.pty.kill(mode === "kill" ? "SIGKILL" : "SIGHUP");
        await until(() => win.exited, "原 Claude 窗口未关闭");
        if (mode === "resume") {
          const other = open(["--resume", session]);
          await until(() => other.screen.includes(start), "新窗口未恢复原历史");
        }
      } else if (["escape", "edge"].includes(mode)) win.pty.write("\x1b");
      else if (mode === "reply") {
        win.pty.write(prompt);
        await sleep(130);
        win.pty.write("\r");
      } else if (mode === "changed") fs.appendFileSync(path.join(project, ".trellis/config.yaml"), "\nconfirmation_timeout: false\n");
      await sleep(Math.max(0, Date.parse(waiting.at) + seconds * 1000 + 850 - Date.now()));
    }
  }
  if (serverError) throw serverError;
  assert.equal(Boolean(received), mode === "open");
  assert.equal(audit().filter(event => event.event === "claimed").length, mode === "open" ? 1 : 0);
  if (mode !== "denied") assert.ok(workflow.verify(mode === "open"), "隔离任务或 Git 范围不符合计划");
  note("passed", { mode, gate, seconds, audit: audit().map(event => event.event) });
} catch (error) {
  note("failed", { error: error.message, root, step, terminal: windows.map(win => win.screen.slice(-1050)), audit: audit() });
  process.exitCode = 2;
} finally {
  for (const win of windows) if (!win.exited) win.pty.kill("SIGKILL");
  server.closeAllConnections();
  await new Promise(ok => server.close(ok));
  if (!process.exitCode) fs.rmSync(root, { recursive: true, force: true });
}
