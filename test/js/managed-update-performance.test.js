import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { withoutTrellisUpdateNotice } from "../../src/lib/trellis-update-fetch.js";
import { trellisLaunchArgs, resolveTrellisBin } from "../../src/lib/trellis-runner.js";
import { trellisVersion } from "../../src/lib/versions.js";
import { isolatedGlobalTrellis } from "../helpers/update-performance.js";

const CLI = fileURLToPath(new URL("../../bin/flower-trellis.js", import.meta.url));
const NOTICE = "https://registry.npmjs.org/@mindfoldhq/trellis/latest";

test("只跳过独立版本提示的精确 GET，Request、其它方法和资源仍透传", async () => {
  const calls = [];
  const fetch = withoutTrellisUpdateNotice((...args) => { calls.push(args); return Promise.resolve("original"); });
  for (const input of [NOTICE, new URL(NOTICE), new Request(NOTICE)]) {
    await assert.rejects(fetch(input), /跳过独立版本查询/);
  }
  await assert.rejects(fetch(NOTICE, { method: "get" }), /跳过独立版本查询/);
  const request = new Request(NOTICE, { method: "POST" });
  for (const [input, options] of [[request], [NOTICE, { method: "POST" }], [`${NOTICE}?actual=1`], ["https://registry.npmjs.org/flower-trellis"]]) {
    assert.equal(await fetch(input, options), "original");
    assert.deepEqual(calls.at(-1), [input, options]);
  }
  assert.equal(calls.length, 4);
});

test("仅显式管理的 update 使用真实文件入口，独立命令参数保持原样", () => {
  const args = ["update", "--force", "--dry-run"];
  assert.deepEqual(trellisLaunchArgs(args), [resolveTrellisBin(), ...args]);
  assert.deepEqual(trellisLaunchArgs(["init"], { managedUpdate: true }), [resolveTrellisBin(), "init"]);
  const managed = trellisLaunchArgs(args, { managedUpdate: true });
  assert.equal(fs.existsSync(managed[0]), true);
  assert.deepEqual(managed.slice(1), [resolveTrellisBin(), ...args]);
});

test("真实 Flower CLI 的 PTY、重复更新和跨版本沙箱均不发起上游提示请求", { timeout: 180_000 }, (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "flower-update-perf-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const target = path.join(root, "项目 with spaces &ver");
  fs.mkdirSync(target);
  const prefix = path.join(root, "prefix");
  isolatedGlobalTrellis(prefix);
  const requests = path.join(root, "requests.jsonl");
  const preload = path.join(root, "network.cjs");
  // 捕获的是到达真实引导下层的请求；若上游换 URL，集成回归也会立即发现。
  fs.writeFileSync(preload, `
const fs = require('node:fs');
const cp = require('node:child_process');
const original = cp.spawnSync;
cp.spawnSync = function(command, args, options) {
  if (/npm(?:\\.cmd)?$/.test(command) && args.includes('install') && args.includes('-g')) throw new Error('测试禁止全局安装');
  return original(command, args, options);
};
require('node:module').syncBuiltinESMExports();
globalThis.fetch = async function(input) {
  const url = typeof input === 'string' ? input : input.url || input.href;
  fs.appendFileSync(${JSON.stringify(requests)}, JSON.stringify(url) + '\\n');
  return new Response(JSON.stringify({version: ${JSON.stringify(trellisVersion())}}), {status: 200});
};
`);
  const env = { ...process.env, FLOWER_NO_TELEMETRY: "1", FLOWER_NO_UPDATE_CHECK: "1", FLOWER_TIMING: "1",
    npm_config_prefix: prefix, NODE_OPTIONS: `--require=${JSON.stringify(preload)}`, PYTHONIOENCODING: "utf-8" };
  const run = (args, executable = CLI, cwd = root) => {
    const result = spawnSync(process.execPath, [executable, ...args], { cwd, env, encoding: "utf8", timeout: 60_000 });
    assert.equal(result.status, 0, `${result.error || ""}\n${result.stdout}\n${result.stderr}`);
    return result;
  };
  run(["init", "--target", target, "--codex", "--yes", "--no-monorepo", "--user", "performance-test"]);
  const config = path.join(target, ".trellis/config.yaml");
  const originalConfig = fs.readFileSync(config, "utf8");
  fs.writeFileSync(config, `${originalConfig}\n# 性能回归的用户配置\ndefault_package: performance-test\n`);
  const args = ["update", "--target", target, "--force"];
  for (const flags of [["--dry-run"], [], []]) {
    const result = run([...args, ...flags]);
    assert.match(result.stdout, /Trellis 版本由 Flower 固定，已跳过独立版本查询/);
    assert.match(result.stderr, /\[耗时 update\/总计（包含子阶段）\] 完成/);
    assert.match(fs.readFileSync(config, "utf8"), /default_package: performance-test/);
    assert.equal(fs.readFileSync(path.join(target, ".trellis/.version"), "utf8").trim(), trellisVersion());
  }
  fs.writeFileSync(path.join(target, ".trellis/.version"), "0.6.13\n");
  const sandbox = run([...args, "--dry-run"]);
  assert.match(sandbox.stdout, /跨版本 dry-run/);
  assert.match(sandbox.stderr, /沙箱上游更新\] 完成/);
  assert.equal(fs.readFileSync(path.join(target, ".trellis/.version"), "utf8"), "0.6.13\n");
  assert.equal(fs.existsSync(requests), false, fs.existsSync(requests) ? fs.readFileSync(requests, "utf8") : "");

  // 独立运行上游仍会检查，用于证明捕获器有效且隔离未泄漏到其它入口。
  run(["update", "--dry-run"], resolveTrellisBin(), target);
  assert.deepEqual(fs.readFileSync(requests, "utf8").trim().split("\n").map(JSON.parse), [NOTICE]);
  const downgrade = spawnSync(process.execPath, trellisLaunchArgs(["update", "--force"], { managedUpdate: true }), {
    cwd: target, env, encoding: "utf8", timeout: 60_000,
  });
  assert.equal(downgrade.status, 0);
  fs.writeFileSync(path.join(target, ".trellis/.version"), "99.0.0\n");
  const refused = spawnSync(process.execPath, trellisLaunchArgs(["update", "--force"], { managedUpdate: true }), {
    cwd: target, env, encoding: "utf8", timeout: 60_000,
  });
  // 上游当前以 0 返回降级拒绝；约束是版本和文件不变，不能把测试假设当退出码契约。
  assert.equal(refused.status, 0);
  assert.match(refused.stdout, /Cannot update: CLI version/);
  assert.equal(fs.readFileSync(path.join(target, ".trellis/.version"), "utf8"), "99.0.0\n");
  fs.writeFileSync(path.join(target, ".trellis/.version"), `${trellisVersion()}\n`);
  for (const command of ["update", "self-update", "self-check", "init"]) {
    const result = run([command, "--help"]);
    assert.equal(result.stderr, "");
  }
  assert.doesNotThrow(() => JSON.parse(run(["self-check", "--target", target, "--json"]).stdout));
  run(["--version"]);
  run(["uninstall", "--target", target, "--dry-run"]);
});
