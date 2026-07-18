import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildSelfCheck } from "../../src/lib/self-check.js";
import { readUpdateCheck, writeManifest, writeUpdateCheck } from "../../src/lib/manifest.js";
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
