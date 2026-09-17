import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createUpdateMetadataReader, checkForUpdate } from "../../src/lib/update-check.js";
import { buildSelfCheck } from "../../src/lib/self-check.js";
import { readUpdateCheck, writeUpdateCheck } from "../../src/lib/manifest.js";
import { flowerVersion, trellisVersion } from "../../src/lib/versions.js";
import { writeLegacyManifest } from "./plugin-test-helpers.js";

/** 创建有版本记录的隔离目标。
 * @param {object} t 测试上下文
 * @returns {string} 目标目录
 */
function target(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "flower-check-perf-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, ".trellis"));
  fs.writeFileSync(path.join(root, ".trellis/.version"), trellisVersion());
  writeLegacyManifest(root, { flowerVersion: flowerVersion(), variant: "0.6", version: trellisVersion(), skills: [], paths: [] });
  return root;
}

const CURRENT = { latest: "0.0.0", beta: flowerVersion() };
const NEW = { latest: "99.0.0", beta: null };

/** 创建按 URL 区分的 registry 替身。
 * @param {object} tags dist-tags
 * @param {object} versions 各版本 metadata
 * @returns {{calls:string[],fetchImpl:Function}} 请求记录与 fetch
 */
function registry(tags = CURRENT, versions = {}) {
  const calls = [];
  return {
    calls,
    fetchImpl: async (url) => {
      calls.push(url);
      return { ok: true, json: async () => url.endsWith("/dist-tags") ? tags : { "dist-tags": tags, versions } };
    },
  };
}

for (const entry of ["self-check", "update"]) {
  test(`${entry} 无更新只读轻量标签，新鲜缓存零请求`, async (t) => {
    const root = target(t);
    const remote = registry();
    const run = entry === "self-check"
      ? () => buildSelfCheck(root, remote)
      : () => checkForUpdate({ target: root, updateCheck: true, passthrough: ["--yes"] }, "update", { ...remote, report: async () => null });
    await run();
    assert.deepEqual(remote.calls, ["https://registry.npmjs.org/-/package/flower-trellis/dist-tags"]);
    assert.deepEqual(readUpdateCheck(root).lastRemote, CURRENT);
    await run();
    assert.equal(remote.calls.length, 1);
  });
}

test("强制刷新绕过缓存，新版才读取摘要；摘要失败不丢版本及旧摘要", async (t) => {
  const root = target(t);
  const remote = registry(NEW, { "99.0.0": { flowerReleaseNotes: { version: "99.0.0", body: "提速" } } });
  const first = await buildSelfCheck(root, { ...remote, forceRemote: true });
  assert.equal(first.status, "update_available");
  assert.equal(first.releaseNotes.versions[0].body, "提速");
  assert.equal(remote.calls.length, 2);
  const before = readUpdateCheck(root).lastReleaseNotes;
  const second = await buildSelfCheck(root, {
    forceRemote: true,
    fetchImpl: async (url) => ({ ok: url.endsWith("/dist-tags"), json: async () => ({ latest: "100.0.0" }) }),
  });
  assert.equal(second.status, "update_available");
  assert.equal(second.recommendation.version, "100.0.0");
  assert.equal(second.releaseNotes.unavailable, true);
  assert.deepEqual(readUpdateCheck(root).lastReleaseNotes, before);
  assert.equal(readUpdateCheck(root).lastStatus, "update_available");
});

test("离线缓存不能续期；过期与错误缓存均重新联网", async (t) => {
  const root = target(t);
  const checkedAt = "2020-01-01T00:00:00.000Z";
  writeUpdateCheck(root, { lastCheckedAt: checkedAt, lastRemote: CURRENT, lastStatus: "up_to_date" });
  const result = await buildSelfCheck(root, { fetchImpl: async () => { throw new Error("离线"); } });
  assert.equal(result.status, "offline");
  assert.equal(readUpdateCheck(root).lastCheckedAt, checkedAt);
  writeUpdateCheck(root, { lastCheckedAt: new Date().toISOString() });
  const remote = registry();
  await buildSelfCheck(root, remote);
  assert.equal(remote.calls.length, 1);
});

test("缓存项目追平只补摘要，不重写远端检查时间和状态", async (t) => {
  const root = target(t);
  writeLegacyManifest(root, { flowerVersion: "0.0.1", version: trellisVersion(), variant: "0.6", paths: [], skills: [] });
  const checkedAt = new Date().toISOString();
  writeUpdateCheck(root, { lastCheckedAt: checkedAt, lastRemote: CURRENT, lastStatus: "up_to_date" });
  const remote = registry(CURRENT, { [flowerVersion()]: { flowerReleaseNotes: { version: flowerVersion(), body: "当前版本摘要" } } });
  const result = await buildSelfCheck(root, remote);
  assert.equal(result.status, "project_out_of_sync");
  assert.equal(result.releaseNotes.versions[0].body, "当前版本摘要");
  assert.deepEqual(remote.calls, ["https://registry.npmjs.org/flower-trellis"]);
  assert.equal(readUpdateCheck(root).lastCheckedAt, checkedAt);
  assert.equal(readUpdateCheck(root).lastStatus, "up_to_date");
});

test("标签与摘要共用截止时间，metadata 重复读取合并", async () => {
  const deadlines = [];
  const reader = createUpdateMetadataReader({
    timeoutMs: 100,
    fetchTags: async (options) => { deadlines.push(options.deadline); return NEW; },
    fetchMetadata: async (options) => { deadlines.push(options.deadline); return { tags: NEW, releaseNotesByVersion: {} }; },
  });
  await reader.readTags();
  await reader.readMetadata();
  await reader.readMetadata();
  assert.equal(deadlines.length, 2);
  assert.equal(deadlines[0], deadlines[1]);
});

test("超时覆盖响应体，并在标签用尽预算后不再启动摘要请求", async () => {
  let calls = 0;
  const reader = createUpdateMetadataReader({
    timeoutMs: 25,
    fetchImpl: async (_url, { signal }) => {
      calls++;
      return { ok: true, json: () => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("超时")), { once: true })) };
    },
  });
  assert.equal(await reader.readTags(), null);
  assert.equal(await reader.readMetadata(), null);
  assert.equal(calls, 1);
});

test("关闭自动检查不联网且不触发遥测", async (t) => {
  const root = target(t);
  writeUpdateCheck(root, { policy: "off" });
  await checkForUpdate({ target: root, updateCheck: true, passthrough: [] }, "init", {
    fetchImpl: () => assert.fail("关闭后不能联网"),
    report: () => assert.fail("关闭后不能上报"),
  });
});

test("交互升级直接退出前，安装、检查和父总计均有完成记录", (t) => {
  const root = target(t);
  const entry = path.join(root, "confirm-upgrade.mjs");
  fs.writeFileSync(entry, `
import { checkForUpdate } from ${JSON.stringify(new URL("../../src/lib/update-check.js", import.meta.url).href)};
import { beginOperationTiming } from ${JSON.stringify(new URL("../../src/lib/operation-timing.js", import.meta.url).href)};
Object.defineProperty(process.stdin, 'isTTY', { value: true });
const finish = beginOperationTiming('update', '总计（包含子阶段）');
await checkForUpdate({target: ${JSON.stringify(root)}, passthrough: [], finishUpdateTiming: finish}, 'update', {
  fetchMetadata: async () => ({tags: {latest: '99.0.0'}, releaseNotesByVersion: {}}),
  report: async () => null,
  confirm: async () => true,
  install: () => ({status: Number(process.env.FLOWER_TEST_INSTALL_STATUS)}),
});
console.log('CONTINUED_AFTER_FAILED_INSTALL');
`);
  for (const status of [0, 1]) {
    const env = { ...process.env, FLOWER_TIMING: "1", FLOWER_NO_TELEMETRY: "1", FLOWER_TEST_INSTALL_STATUS: String(status) };
    delete env.FLOWER_NO_UPDATE_CHECK;
    const result = spawnSync(process.execPath, [entry], { env, encoding: "utf8", timeout: 10_000 });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, new RegExp(`全局安装（含依赖与postinstall）\\] ${status === 0 ? "完成" : "失败"}`));
    assert.match(result.stderr, /版本检查（含确认等待）\] 完成/);
    if (status === 0) {
      assert.match(result.stderr, /总计（包含子阶段）\] 完成/);
      assert.doesNotMatch(result.stdout, /CONTINUED_AFTER_FAILED_INSTALL/);
    } else {
      assert.match(result.stdout, /CONTINUED_AFTER_FAILED_INSTALL/);
    }
  }
});
