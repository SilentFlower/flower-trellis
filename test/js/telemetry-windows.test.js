import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { queueTelemetryEvent, flushTelemetryQueue, telemetryQueueStatus } from "../../src/lib/telemetry-queue.js";

test("Windows 原生队列、后台进程断流和 Python 调用 npm cmd 入口", { skip: process.platform !== "win32" }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "flower-native-telemetry-"));
  try {
    const env = { ...process.env, XDG_CONFIG_HOME: path.join(root, "config"), FLOWER_NO_TELEMETRY: "" };
    const options = { env, launch: () => {} };
    assert.equal(queueTelemetryEvent(root, { event: "activity_daily", ai_platform: "codex" }, options).status, "queued");
    assert.equal(queueTelemetryEvent(root, { event: "activity_daily", ai_platform: "codex" }, options).status, "duplicate");
    await flushTelemetryQueue({ ...options, fetch: async (_url, request) => ({ ok: true, json: async () => ({ results: JSON.parse(request.body).events.map(event => ({ event_id: event.event_id, status: "accepted" })) }) }) });
    assert.equal(telemetryQueueStatus(options).pending, 0);
    const moduleUrl = new URL("../../src/lib/telemetry-queue.js", import.meta.url).href;
    const parent = path.join(root, "parent.mjs");
    fs.writeFileSync(parent, `import {launchTelemetrySender} from ${JSON.stringify(moduleUrl)}; launchTelemetrySender(); console.log('parent-ended');`);
    const started = Date.now();
    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [parent], { env: { ...env, XDG_CONFIG_HOME: path.join(root, "empty") }, stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "", stderr = "";
      const timer = setTimeout(() => { child.kill(); reject(new Error(`父进程标准流未及时关闭 stdout=${stdout} stderr=${stderr}`)); }, 5000);
      child.stdout.on("data", value => { stdout += value; }); child.stderr.on("data", value => { stderr += value; });
      child.on("error", reject);
      child.on("close", code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
    });
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /parent-ended/);
    assert.ok(Date.now() - started < 5000);

    const bin = path.join(root, "bin"); fs.mkdirSync(bin);
    const capture = path.join(root, "captured.json");
    fs.writeFileSync(path.join(bin, "capture.mjs"), `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(capture)},JSON.stringify(process.argv.slice(2)));`);
    fs.writeFileSync(path.join(bin, "flower-trellis.cmd"), `@"${process.execPath}" "%~dp0capture.mjs" %*\r\n`);
    const target = path.join(root, "项目 with spaces"); fs.mkdirSync(target);
    const python = process.env.FLOWER_TEST_PYTHON || "python";
    const hook = spawnSync(python, [fileURLToPath(new URL("../../src/assets/flower_telemetry_hook.py", import.meta.url)), "--platform", "claude"], {
      cwd: target, encoding: "utf8", timeout: 10000,
      env: { ...env, PATH: `${bin};${process.env.PATH}`, CLAUDE_PROJECT_DIR: target, TRELLIS_HOOKS: "1", TRELLIS_DISABLE_HOOKS: "0", CODEX_NON_INTERACTIVE: "0" },
      input: JSON.stringify({ hook_event_name: "SessionStart", cwd: target, prompt: "不得转发" }),
    });
    assert.equal(hook.status, 0, hook.stderr);
    assert.equal(hook.stdout, ""); assert.equal(hook.stderr, "");
    assert.deepEqual(JSON.parse(fs.readFileSync(capture)), ["telemetry", "record-activity", "claude", "--target", target]);
    queueTelemetryEvent(root, { event: "activity_daily", ai_platform: "claude" }, options);
    const preload = path.join(root, "offline.mjs");
    fs.writeFileSync(preload, "globalThis.fetch = () => new Promise(() => {});");
    const deadlineStarted = Date.now();
    const bounded = spawnSync(process.execPath, ["--import", pathToFileURL(preload).href, fileURLToPath(new URL("../../src/lib/telemetry-sender.js", import.meta.url))], {
      env, timeout: 20000, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    });
    assert.equal(bounded.status, 0, bounded.stderr);
    assert.equal(bounded.stdout, "");
    assert.ok(Date.now() - deadlineStarted >= 14000 && Date.now() - deadlineStarted < 20000);
    assert.equal(telemetryQueueStatus(options).pending, 1);
    // 空队列 sender 启动后即结束；给独立进程释放目录的机会，再清测试目录。
    await new Promise(resolve => setTimeout(resolve, 1000));
  } finally { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});
