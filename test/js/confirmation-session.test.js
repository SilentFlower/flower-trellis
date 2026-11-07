import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolvePythonExecutable } from "../../scripts/python-runtime.mjs";
import { isConfirmationTerminalReply } from "../../src/lib/confirmation-session.js";
import { createConfirmationSnapshot } from "../../src/lib/confirmation-snapshot.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PYTHON = resolvePythonExecutable();
const FIXTURE = path.join(ROOT, "test/js/fixtures/confirmation-harness.mjs");

/** 在期限内等待可观察事实，超时提供实际输出便于诊断。 */
async function until(check, detail, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.fail(detail());
}

/** 判断进程是否仍能执行；Linux僵尸只等待其父回收，不再有执行能力。 */
function alive(pid) {
  try {
    process.kill(pid, 0);
    if (process.platform === "linux" && /\) Z /.test(fs.readFileSync(`/proc/${pid}/stat`, "utf8"))) return false;
    return true;
  } catch { return false; }
}

/** 创建带真实PTY、守护器、MCP及独立后代的会话。 */
async function fixture(t, seconds) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "flower-session-中文 & "));
  fs.cpSync(path.join(ROOT, ".trellis/scripts/common"), path.join(root, ".trellis/scripts/common"),
    { recursive: true, filter: file => !file.includes("__pycache__") });
  fs.writeFileSync(path.join(root, ".trellis/config.yaml"), `confirmation_timeout:\n  check:\n    base_seconds: ${seconds}\n`);
  fs.writeFileSync(path.join(root, "报告.md"), "CHK-1 当前完整方案，中文 & % ! ^\n");
  const child = spawn(process.execPath, [FIXTURE, "runner"], { env: { ...process.env,
    FLOWER_TEST_PYTHON: PYTHON, CONFIRMATION_FIXTURE_ROOT: root,
    CONFIRMATION_FIXTURE_HELPER: path.join(ROOT, "vendor/skill-garden/.trellis/0.6/scripts/confirmation.py") },
  stdio: ["pipe", "pipe", "pipe"] });
  let output = "";
  child.stdout.setEncoding("utf8").on("data", chunk => { output += chunk; });
  child.stderr.setEncoding("utf8").on("data", chunk => { output += chunk; });
  const exited = new Promise(resolve => child.once("exit", (code, signal) => resolve({ code, signal })));
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await exited;
    // Windows进程已停止后，ConPTY的目录句柄仍可能短暂占用；仅为清理做有界重试。
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  await until(() => output.includes("输入任意按键取消自动默认"), () => `会话未进入等待：${output}`);
  const pids = JSON.parse(fs.readFileSync(path.join(root, "processes.json"), "utf8"));
  return { root, child, exited, pids, output: () => output };
}

test("真实PTY完整展示后超时领取，正常退出保留CLI退出码并清理MCP和后代", { timeout: 20000 }, async t => {
  const f = await fixture(t, 1);
  const result = await f.exited;
  assert.equal(result.code, 7, f.output());
  const outcome = JSON.parse(fs.readFileSync(path.join(f.root, "outcome.json"), "utf8"));
  assert.equal(outcome.result.source, "policy_timeout");
  assert.equal(outcome.claim.action, "repair_all_and_recheck");
  const bodyAt = f.output().indexOf("CHK-1 当前完整方案");
  assert.ok(bodyAt > 0);
  assert.ok(f.output().lastIndexOf("\x1b[?1049l", bodyAt) > 0, "完整方案应进入主屏回滚区");
  assert.ok(f.output().indexOf("\x1b[?1049h", bodyAt) > bodyAt, "等待结束应恢复原生界面");
  await until(() => f.pids.every(pid => !alive(pid)), () => `退出后仍存活：${f.pids.filter(alive)}`);
});

test("真实PTY人工输入先撤销再透传，不产生执行许可", { timeout: 20000 }, async t => {
  const f = await fixture(t, 30);
  f.child.stdin.write("不同意\n");
  assert.equal((await f.exited).code, 7, f.output());
  const outcome = JSON.parse(fs.readFileSync(path.join(f.root, "outcome.json"), "utf8"));
  assert.equal(outcome.result.source, "cancelled");
  assert.equal(outcome.claim, null);
  assert.match(outcome.input, /不同意/);
  await until(() => f.pids.every(pid => !alive(pid)), () => `退出后仍存活：${f.pids.filter(alive)}`);
});

test("真实PTY取消审计不可写时，按键仍透传，退出完成且不发放自动许可", { timeout: 20000 }, async t => {
  const f = await fixture(t, 30);
  const directory = path.join(f.root, ".trellis/.runtime/confirmations");
  fs.rmSync(directory, { recursive: true });
  fs.writeFileSync(directory, "模拟审计路径不可写");
  f.child.stdin.write("取消并继续人工\n");
  assert.equal((await f.exited).code, 7, f.output());
  const outcome = JSON.parse(fs.readFileSync(path.join(f.root, "outcome.json"), "utf8"));
  assert.equal(outcome.result.source, "cancelled");
  assert.equal(outcome.claim, null);
  assert.match(outcome.input, /取消并继续人工/);
  assert.match(f.output(), /确认审计不可用/);
  await until(() => f.pids.every(pid => !alive(pid)), () => `审计失败后仍存活：${f.pids.filter(alive)}`);
});

test("未绑定前台能力时不启动独立材料检查", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "flower-inspect-unbound-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  await assert.rejects(createConfirmationSnapshot(root, { python: PYTHON })({}, "codex_inspector"), /确认入口信息无效/);
});

for (const reason of ["normal", "timeout", "close", "SIGKILL"]) {
  test(`实际异步材料检查${reason}受前台生命周期约束且不覆盖CLI退出码`, { timeout: 20000 }, async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "flower-inspect-中文 & "));
    const helper = path.join(root, "检查器.py");
    const script = reason === "normal"
      ? 'import json, os, pathlib\n'
        + 'pathlib.Path("processes.tmp").write_text(json.dumps([os.getppid(), os.getpid()]))\n'
        + 'pathlib.Path("processes.tmp").replace("processes.json")\n'
        + 'print(json.dumps(dict(enabled=True, seconds=1, revision="v1", display="完整方案", contextKey="codex_inspector")))\n'
      : 'import json, os, pathlib, subprocess, sys, time\n'
        + 'child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"])\n'
        + 'pathlib.Path("processes.tmp").write_text(json.dumps([os.getppid(), os.getpid(), child.pid]))\n'
        + 'pathlib.Path("processes.tmp").replace("processes.json")\n'
        + 'time.sleep(60)\n';
    fs.writeFileSync(helper, script);
    const child = spawn(process.execPath, [FIXTURE, "inspector-runner"], { env: { ...process.env,
      FLOWER_TEST_PYTHON: PYTHON, CONFIRMATION_FIXTURE_ROOT: root, CONFIRMATION_FIXTURE_HELPER: helper,
      CONFIRMATION_INSPECT_CLOSE: reason === "close" ? "1" : "0" }, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", chunk => { output += chunk; });
    child.stderr.on("data", chunk => { output += chunk; });
    const exited = new Promise(resolve => child.once("exit", code => resolve(code)));
    let pids = [];
    t.after(async () => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await exited;
      for (const pid of pids.filter(alive)) try { process.kill(pid, "SIGKILL"); } catch { /* 退出竞争。 */ }
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    });
    if (reason !== "normal") {
      await until(() => fs.existsSync(path.join(root, "processes.json")), () => `检查器未启动：${output}`);
      pids = JSON.parse(fs.readFileSync(path.join(root, "processes.json"), "utf8"));
      if (reason === "SIGKILL") child.kill("SIGKILL");
    }
    await exited;
    if (reason === "normal") pids = JSON.parse(fs.readFileSync(path.join(root, "processes.json"), "utf8"));
    await until(() => pids.every(pid => !alive(pid)), () => `检查器或后代仍存活：${pids.filter(alive)}\n${output}`);
    if (reason === "SIGKILL") assert.equal(fs.existsSync(path.join(root, "inspect-result.json")), false);
    else {
      const result = JSON.parse(fs.readFileSync(path.join(root, "inspect-result.json"), "utf8"));
      assert.equal(result.ok, reason === "normal", output);
      assert.deepEqual(result.exits, []);
    }
  });
}

for (const reason of ["EOF", "SIGKILL", "SIGHUP"]) {
  if (reason === "SIGHUP" && process.platform === "win32") continue;
  test(`真实入口${reason}取消等待并结束自有CLI、MCP与后代`, { timeout: 20000 }, async t => {
    const f = await fixture(t, 30);
    if (reason === "EOF") f.child.stdin.end();
    else f.child.kill(reason);
    await f.exited;
    await until(() => f.pids.every(pid => !alive(pid)), () => `入口退出后仍存活：${f.pids.filter(alive)}\n${f.output()}`);
    assert.equal(fs.existsSync(path.join(f.root, "outcome.json")), false);
  });
}

test("设备应答与真实按键可区分，混入按键不能作为设备帧放行", () => {
  assert.equal(isConfirmationTerminalReply("\x1b[20;40R"), true);
  assert.equal(isConfirmationTerminalReply("\x1b[?1;2c"), true);
  assert.equal(isConfirmationTerminalReply("\x1b[20;40Rx"), false);
  assert.equal(isConfirmationTerminalReply("\r"), false);
});
