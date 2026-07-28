import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildSelfCheck } from "../../src/lib/self-check.js";
import {
  readUpdateCheck,
  settingsPath,
  updateCheckCachePath,
  writeManifest,
  writeUpdateCheck,
} from "../../src/lib/manifest.js";
import {
  getUpdateRecommendation,
  installFlowerVersion,
} from "../../src/lib/update-check.js";
import { flowerVersion, trellisVersion } from "../../src/lib/versions.js";

function createTarget(t) {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "flower-update-check-"));
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  fs.mkdirSync(path.join(target, ".trellis"), { recursive: true });
  fs.writeFileSync(path.join(target, ".trellis", ".version"), `${trellisVersion()}\n`);
  writeManifest(target, {
    flowerVersion: flowerVersion(),
    variant: "0.6",
    version: trellisVersion(),
    skills: [],
    paths: [],
    updateCheck: { enabled: true, policy: "ask", intervalHours: 8 },
  });
  return target;
}

test("升级推荐锁定精确版本并优先在线读取", () => {
  assert.deepEqual(
    getUpdateRecommendation("0.4.11", {
      latest: "0.5.0",
      beta: "0.5.1-beta.0",
    }),
    {
      version: "0.5.0",
      tag: "latest",
      command: "npm i -g flower-trellis@0.5.0 --prefer-online",
    },
  );
  assert.deepEqual(
    getUpdateRecommendation("0.4.12-beta.2", {
      latest: "0.4.11",
      beta: "0.5.0-beta.0",
    }),
    {
      version: "0.5.0-beta.0",
      tag: "beta",
      command: "npm i -g flower-trellis@0.5.0-beta.0 --prefer-online",
    },
  );
});

test("精确版本安装仅对 ETARGET 等待并重试一次", () => {
  const calls = [];
  const waits = [];
  const logs = [];
  const errors = [];
  const results = [
    { status: 1, stderr: "npm error code ETARGET\n" },
    { status: 0, stderr: "" },
  ];
  const result = installFlowerVersion("0.5.0-beta.0", {
    cwd: "/tmp/project",
    platform: "linux",
    spawn(command, args, options) {
      calls.push({ command, args, options });
      return results.shift();
    },
    wait(ms) {
      waits.push(ms);
    },
    stderr: { write(value) { errors.push(value); } },
    log(value) {
      logs.push(value);
    },
  });

  assert.equal(result.status, 0);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].args, [
    "i",
    "-g",
    "flower-trellis@0.5.0-beta.0",
    "--prefer-online",
  ]);
  assert.equal(calls[0].options.cwd, "/tmp/project");
  assert.deepEqual(waits, [1000]);
  assert.equal(logs.length, 1);
  assert.deepEqual(errors, []);
});

test("非 ETARGET 安装错误不重试并保留错误输出", () => {
  let calls = 0;
  const errors = [];
  const result = installFlowerVersion("0.5.0-beta.0", {
    spawn() {
      calls += 1;
      return { status: 1, stderr: "npm error code EACCES\n" };
    },
    wait() {
      assert.fail("非 ETARGET 不应等待重试");
    },
    stderr: { write(value) { errors.push(value); } },
    log() {},
  });

  assert.equal(result.status, 1);
  assert.equal(calls, 1);
  assert.deepEqual(errors, ["npm error code EACCES\n"]);
});

test("强制远端检查返回成功写入后的缓存视图", async (t) => {
  const target = createTarget(t);
  writeUpdateCheck(target, {
    lastCheckedAt: "2026-07-18T00:00:00.000Z",
    lastRemote: { latest: "0.4.11", beta: "0.4.12-beta.2" },
    lastStatus: "update_available",
    lastErrorCode: null,
  });

  const result = await buildSelfCheck(target, {
    forceRemote: true,
    fetchMetadata: async () => ({
      tags: { latest: "0.4.11", beta: flowerVersion() },
      releaseNotesByVersion: {},
    }),
  });

  assert.equal(result.status, "up_to_date");
  assert.equal(result.updateCheck.lastStatus, "up_to_date");
  assert.equal(result.updateCheck.lastErrorCode, null);
  assert.deepEqual(result.updateCheck.lastRemote, {
    latest: "0.4.11",
    beta: flowerVersion(),
  });
  assert.deepEqual(result.updateCheck, readUpdateCheck(target));
});

test("强制远端检查返回离线写入后的缓存视图", async (t) => {
  const target = createTarget(t);
  const result = await buildSelfCheck(target, {
    forceRemote: true,
    fetchMetadata: async () => null,
  });

  assert.equal(result.status, "offline");
  assert.equal(result.updateCheck.lastStatus, "offline");
  assert.equal(result.updateCheck.lastErrorCode, "fetch_failed");
  assert.deepEqual(result.updateCheck, readUpdateCheck(target));
});

test("update-check 单向迁移到 .flower 并保留旧 manifest 证据", (t) => {
  const target = createTarget(t);
  const legacyPath = path.join(target, ".trellis/.flower-manifest.json");
  const legacyBefore = fs.readFileSync(legacyPath, "utf8");

  writeUpdateCheck(target, {
    policy: "notify",
    enabled: true,
    lastCheckedAt: "2026-07-28T00:00:00.000Z",
    lastStatus: "up_to_date",
  });

  assert.equal(fs.existsSync(settingsPath(target)), true);
  assert.equal(fs.existsSync(updateCheckCachePath(target)), true);
  assert.equal(fs.readFileSync(legacyPath, "utf8"), legacyBefore);
  assert.equal(readUpdateCheck(target).policy, "notify");
  assert.equal(readUpdateCheck(target).lastStatus, "up_to_date");
  assert.match(fs.readFileSync(path.join(target, ".flower/.gitignore"), "utf8"), /\*\.tmp/);
});

test("update-check 拒绝覆盖损坏的 settings 证据", (t) => {
  const target = createTarget(t);
  fs.mkdirSync(path.dirname(settingsPath(target)), { recursive: true });
  fs.writeFileSync(settingsPath(target), "{broken\n");

  assert.throws(
    () => writeUpdateCheck(target, { policy: "off", lastStatus: "offline" }),
    /settings 损坏，拒绝覆盖/,
  );
  assert.equal(fs.readFileSync(settingsPath(target), "utf8"), "{broken\n");
  assert.equal(fs.existsSync(updateCheckCachePath(target)), false);
});

test("update-check cache 拒绝软链且项目外零写入", (t) => {
  if (process.platform === "win32") {
    t.skip("Windows 普通用户默认不能创建文件软链");
    return;
  }
  const target = createTarget(t);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "flower-update-check-outside-"));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  const outsideFile = path.join(outside, "cache.json");
  fs.writeFileSync(outsideFile, "outside\n");
  fs.mkdirSync(path.dirname(updateCheckCachePath(target)), { recursive: true });
  fs.symlinkSync(outsideFile, updateCheckCachePath(target));

  assert.throws(
    () => writeUpdateCheck(target, { lastStatus: "offline" }),
    /状态必须是普通文件/,
  );
  assert.equal(fs.readFileSync(outsideFile, "utf8"), "outside\n");
  assert.equal(fs.lstatSync(updateCheckCachePath(target)).isSymbolicLink(), true);
});
