import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";
import { extract } from "tar";
import { isolatedGlobalTrellis } from "../test/helpers/update-performance.js";
import { writeLegacyManifest } from "../test/js/plugin-test-helpers.js";
import { writeUpdateCheck } from "../src/lib/manifest.js";
import { flowerVersion, trellisVersion } from "../src/lib/versions.js";

// 开发诊断脚本：固定 Git 基线与当前源码，只操作临时目录，不访问真实 registry 或全局安装。
const repo = fileURLToPath(new URL("../", import.meta.url));
const baselineRef = process.argv[2] || "HEAD";
const rounds = 5;
const root = fs.mkdtempSync(path.join(os.tmpdir(), "flower-benchmark-"));
const previousFetch = globalThis.fetch;
const previousLog = console.log;
const previousTelemetry = process.env.FLOWER_NO_TELEMETRY;
const previousUpdateCheck = process.env.FLOWER_NO_UPDATE_CHECK;
process.env.FLOWER_NO_TELEMETRY = "1";
delete process.env.FLOWER_NO_UPDATE_CHECK;

/** @param {number[]} values 样本 @returns {object} 中位数、范围与全部样本 */
function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return { median: sorted[Math.floor(sorted.length / 2)], min: sorted[0], max: sorted.at(-1), samples: values };
}

/** @param {string} executable 命令 @param {string[]} args 参数 @param {object} options 执行设置 @returns {object} 成功结果 */
function run(executable, args, options = {}) {
  const result = spawnSync(executable, args, { cwd: repo, encoding: "utf8", timeout: 60_000, maxBuffer: 10 * 1024 * 1024, ...options });
  assert.equal(result.status, 0, `${result.error || ""}\n${result.stdout}\n${result.stderr}`);
  return result;
}

try {
  const base = path.join(root, "baseline");
  fs.mkdirSync(base);
  const archive = path.join(root, "baseline.tar");
  fs.writeFileSync(archive, run("git", ["archive", baselineRef, "src", "bin", "package.json"], { encoding: "buffer" }).stdout);
  await extract({ file: archive, cwd: base });
  for (const name of ["node_modules", "enhancements"]) {
    fs.symlinkSync(path.join(repo, name), path.join(base, name), process.platform === "win32" ? "junction" : "dir");
  }
  const baselineSha = run("git", ["rev-parse", baselineRef]).stdout.trim();
  const versions = { before: base, after: repo };
  const report = { environment: { node: process.version, platform: process.platform, arch: process.arch, baselineSha, flower: flowerVersion(), trellis: trellisVersion() }, rounds, network: "受控延迟，每次请求固定；没有真实 registry/下载/安装", checks: [], update: {} };
  const currentTags = { latest: "0.0.0", beta: flowerVersion() };
  for (const [label, source] of Object.entries(versions)) {
    const { checkForUpdate } = await import(pathToFileURL(path.join(source, "src/lib/update-check.js")));
    const { buildSelfCheck } = await import(pathToFileURL(path.join(source, "src/lib/self-check.js")));
    for (const delay of [0, 200, 1000]) {
      for (const scenario of ["cold-current", "warm-current", "new-version", "project-out-of-sync"]) {
        const samples = [];
        const requests = [];
        const bodies = [];
        for (let round = 0; round < rounds; round++) {
          const target = path.join(root, `check-${label}-${delay}-${scenario}-${round}`);
          fs.mkdirSync(path.join(target, ".trellis"), { recursive: true });
          fs.writeFileSync(path.join(target, ".trellis/.version"), trellisVersion());
          writeLegacyManifest(target, { flowerVersion: scenario === "project-out-of-sync" ? "0.0.1" : flowerVersion(), variant: "0.6", version: trellisVersion(), skills: [], paths: [] });
          if (scenario === "warm-current") writeUpdateCheck(target, { lastCheckedAt: new Date().toISOString(), lastRemote: currentTags, lastStatus: "up_to_date" });
          const tags = scenario === "new-version" ? { latest: "99.0.0", beta: null } : currentTags;
          const notesVersion = scenario === "new-version" ? "99.0.0" : flowerVersion();
          let count = 0;
          let bytes = 0;
          globalThis.fetch = async (url) => {
            count++;
            if (delay) await new Promise(resolve => setTimeout(resolve, delay));
            const body = url.endsWith("/dist-tags") ? tags : {
              "dist-tags": tags,
              versions: { [notesVersion]: { flowerReleaseNotes: { version: notesVersion, body: "性能夹具摘要" } } },
              // 固定体积仅用于展示工作量，不能冒充真实网络字节基准。
              fixture: "x".repeat(314000),
            };
            const text = JSON.stringify(body);
            bytes += Buffer.byteLength(text);
            return new Response(text);
          };
          console.log = () => {};
          const start = performance.now();
          if (scenario === "project-out-of-sync") {
            const result = await buildSelfCheck(target);
            assert.equal(result.status, "project_out_of_sync");
            assert.equal(result.releaseNotes.versions.length, 1);
          } else {
            await checkForUpdate({ target, updateCheck: true, passthrough: ["--yes"] }, "update", { report: async () => null });
          }
          samples.push(Math.round(performance.now() - start));
          console.log = previousLog;
          requests.push(count);
          bodies.push(bytes);
        }
        report.checks.push({ version: label, delay, scenario, elapsedMs: summarize(samples), requests, fixtureBytes: bodies });
      }
    }
    process.stderr.write(`已完成 ${label} 版本检查对照\n`);
  }
  globalThis.fetch = previousFetch;
  const prefix = path.join(root, "prefix");
  isolatedGlobalTrellis(prefix);
  const target = path.join(root, "project");
  fs.mkdirSync(target);
  const events = path.join(root, "events.jsonl");
  const preload = path.join(root, "preload.cjs");
  fs.writeFileSync(preload, `
const fs = require('node:fs');
const cp = require('node:child_process');
const record = event => fs.appendFileSync(${JSON.stringify(events)}, JSON.stringify(event) + '\\n');
for (const method of ['spawn', 'spawnSync']) {
  const original = cp[method];
  cp[method] = function(command, args, options) {
    if (/npm(?:\\.cmd)?$/.test(command) && args.includes('-g') && (args.includes('install') || args.includes('i'))) throw new Error('基准禁止全局安装');
    record({kind: method, versionProbe: args.includes('--version')});
    return original(command, args, options);
  };
}
require('node:module').syncBuiltinESMExports();
globalThis.fetch = async url => {
  record({kind: 'fetch', url: String(url)});
  await new Promise(resolve => setTimeout(resolve, 200));
  return new Response(JSON.stringify({version: ${JSON.stringify(trellisVersion())}}));
};
`);
  const env = { ...process.env, FLOWER_NO_UPDATE_CHECK: "1", FLOWER_TIMING: "1", npm_config_prefix: prefix, NODE_OPTIONS: `--require=${JSON.stringify(preload)}` };
  run(process.execPath, [path.join(repo, "bin/flower-trellis.js"), "init", "--target", target, "--codex", "--yes", "--no-monorepo", "--user", "benchmark"], { env });
  for (const [label, source] of Object.entries(versions)) {
    const samples = [];
    const work = [];
    const phaseTimings = [];
    for (let round = 0; round < rounds; round++) {
      fs.writeFileSync(events, "");
      const start = performance.now();
      const result = run(process.execPath, [path.join(source, "bin/flower-trellis.js"), "update", "--target", target, "--force", "--dry-run"], { env });
      samples.push(Math.round(performance.now() - start));
      assert.match(result.stdout, /Plugin/);
      const rows = fs.readFileSync(events, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
      work.push({ requests: rows.filter(row => row.kind === "fetch").length, versionProbes: rows.filter(row => row.versionProbe).length });
      phaseTimings.push(result.stderr.split(/\r?\n/).filter(line => line.includes("[耗时")));
    }
    report.update[label] = { elapsedMs: summarize(samples), work, phaseTimings, exitCodes: Array(rounds).fill(0), completion: "完整 Flower update --dry-run / Plugin 预演通过" };
  }
  console.log(JSON.stringify(report, null, 2));
} finally {
  globalThis.fetch = previousFetch;
  console.log = previousLog;
  if (previousTelemetry === undefined) delete process.env.FLOWER_NO_TELEMETRY;
  else process.env.FLOWER_NO_TELEMETRY = previousTelemetry;
  if (previousUpdateCheck === undefined) delete process.env.FLOWER_NO_UPDATE_CHECK;
  else process.env.FLOWER_NO_UPDATE_CHECK = previousUpdateCheck;
  fs.rmSync(root, { recursive: true, force: true });
}
