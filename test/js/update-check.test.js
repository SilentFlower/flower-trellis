import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { updateCheck } from "../../src/commands/update-check.js";
import { buildSelfCheck } from "../../src/lib/self-check.js";
import {
  readUpdateCheck,
  settingsPath,
  updateCheckCachePath,
  writeManifest,
  writeUpdateCheck,
} from "../../src/lib/manifest.js";
import {
  checkForUpdate,
  getUpdateRecommendation,
  installFlowerVersion,
} from "../../src/lib/update-check.js";
import { flowerVersion, trellisVersion } from "../../src/lib/versions.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CLI = path.join(ROOT, "bin", "flower-trellis.js");

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

function writeCachedRemoteUpdate(target, version = "9.0.0") {
  writeUpdateCheck(target, {
    lastCheckedAt: new Date().toISOString(),
    lastRemote: { latest: version, beta: null },
    lastStatus: "update_available",
    lastErrorCode: null,
  });
}

function cleanCliEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  delete env.FLOWER_NO_UPDATE_CHECK;
  delete env.npm_command;
  return env;
}

function runFlowerCli(args) {
  return execFileSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: cleanCliEnv(),
  });
}

function runFlowerCliJson(args) {
  return JSON.parse(runFlowerCli(args));
}

async function createSnoozedProjectOutOfSyncTarget(t) {
  const target = createTarget(t);
  const oldFlower = "0.0.1";
  const currentFlower = flowerVersion();
  const channel = currentFlower.includes("-") ? "beta" : "latest";
  const remoteTags = channel === "beta"
    ? { latest: "0.0.0", beta: currentFlower }
    : { latest: currentFlower, beta: null };
  writeManifest(target, {
    flowerVersion: oldFlower,
    variant: "0.6",
    version: trellisVersion(),
    skills: [],
    paths: [],
    updateCheck: { enabled: true, policy: "ask", intervalHours: 8 },
  });
  writeUpdateCheck(target, {
    lastCheckedAt: new Date().toISOString(),
    lastRemote: remoteTags,
    lastStatus: "up_to_date",
    lastErrorCode: null,
    lastReleaseNotes: {
      source: "npm-metadata",
      range: {
        from: oldFlower,
        to: currentFlower,
        channel,
        reason: "project_out_of_sync",
      },
      versions: [
        { version: currentFlower, body: "测试用 Flower 更新摘要", truncated: false },
      ],
      truncated: false,
      moreVersions: false,
      unavailable: false,
    },
  });
  const actionable = await buildSelfCheck(target, {
    ignorePromptSuppression: true,
    fetchMetadata: async () => assert.fail("新鲜缓存已包含 release notes,不应请求 registry"),
  });
  assert.equal(actionable.status, "project_out_of_sync");
  writeUpdateCheck(target, {
    promptSuppressedKey: actionable.prompt.key,
    promptSuppressedUntil: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    promptSuppressionReason: "snooze",
  });
  return target;
}

async function silenceConsole(fn) {
  const original = console.log;
  console.log = () => {};
  try {
    return await fn();
  } finally {
    console.log = original;
  }
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

test("self-check 只在真实远程检查时触发遥测回调", async (t) => {
  const target = createTarget(t);
  writeUpdateCheck(target, {
    lastCheckedAt: new Date().toISOString(),
    lastRemote: { latest: flowerVersion(), beta: null },
    lastStatus: "up_to_date",
    lastErrorCode: null,
  });
  let callbacks = 0;
  let fetches = 0;

  await buildSelfCheck(target, {
    fetchMetadata: async () => {
      fetches += 1;
      return null;
    },
    onRemoteCheck: async () => {
      callbacks += 1;
    },
  });
  assert.equal(fetches, 0);
  assert.equal(callbacks, 0);

  await buildSelfCheck(target, {
    forceRemote: true,
    fetchMetadata: async () => {
      fetches += 1;
      return {
        tags: { latest: flowerVersion(), beta: null },
        releaseNotesByVersion: {},
      };
    },
    onRemoteCheck: async () => {
      callbacks += 1;
    },
  });
  assert.equal(fetches, 1);
  assert.equal(callbacks, 1);
});

test("init/update 版本检查把遥测与 registry 请求并行触发", async (t) => {
  const target = createTarget(t);
  let reports = 0;
  await checkForUpdate({ target, updateCheck: true, passthrough: ["--yes"] }, "update", {
    fetchMetadata: async () => ({
      tags: { latest: flowerVersion(), beta: null },
      releaseNotesByVersion: {},
    }),
    report: async (reportedTarget, event) => {
      assert.equal(reportedTarget, target);
      assert.equal(event, "version_check");
      reports += 1;
    },
  });
  assert.equal(reports, 1);
});

test("关闭版本检查时不触发遥测回调", async (t) => {
  const target = createTarget(t);
  let reports = 0;
  await checkForUpdate({ target, updateCheck: false, passthrough: [] }, "init", {
    fetchMetadata: async () => assert.fail("关闭后不应请求 registry"),
    report: async () => {
      reports += 1;
    },
  });
  assert.equal(reports, 0);
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

test("self-check 记录同一更新提示后进入冷却", async (t) => {
  const target = createTarget(t);
  writeCachedRemoteUpdate(target);

  const first = await buildSelfCheck(target, { recordPrompt: true });
  assert.equal(first.status, "update_available");
  assert.equal(first.prompt.key, "update:latest:9.0.0");
  assert.equal(first.prompt.suppressed, false);
  assert.equal(readUpdateCheck(target).lastPromptedKey, "update:latest:9.0.0");

  const second = await buildSelfCheck(target, { recordPrompt: true });
  assert.equal(second.status, "skipped");
  assert.equal(second.reason, "prompt_cooldown");
  assert.equal(second.prompt.suppressed, true);
  assert.equal(second.suppressedAction.status, "update_available");

  const ignored = await buildSelfCheck(target, { ignorePromptSuppression: true });
  assert.equal(ignored.status, "update_available");
});

test("提示跳过只抑制当前版本 key", async (t) => {
  const target = createTarget(t);
  writeCachedRemoteUpdate(target, "9.0.0");
  writeUpdateCheck(target, {
    promptSuppressedKey: "update:latest:9.0.0",
    promptSuppressedUntil: null,
    promptSuppressionReason: "skip",
  });

  const skipped = await buildSelfCheck(target);
  assert.equal(skipped.status, "skipped");
  assert.equal(skipped.reason, "prompt_skip");

  writeCachedRemoteUpdate(target, "9.1.0");
  const nextVersion = await buildSelfCheck(target);
  assert.equal(nextVersion.status, "update_available");
  assert.equal(nextVersion.prompt.key, "update:latest:9.1.0");
  assert.equal(nextVersion.prompt.suppressed, false);
});

test("update-check snooze、skip 和 reset 管理当前提示状态", async (t) => {
  const target = createTarget(t);
  writeCachedRemoteUpdate(target);

  await silenceConsole(() => updateCheck({
    target,
    passthrough: ["snooze", "--hours", "2"],
  }));
  const snoozed = readUpdateCheck(target);
  assert.equal(snoozed.promptSuppressedKey, "update:latest:9.0.0");
  assert.equal(snoozed.promptSuppressionReason, "snooze");
  assert.ok(Date.parse(snoozed.promptSuppressedUntil) > Date.now());
  assert.equal((await buildSelfCheck(target)).reason, "prompt_snooze");

  await silenceConsole(() => updateCheck({ target, passthrough: ["reset"] }));
  const reset = readUpdateCheck(target);
  assert.equal(reset.promptSuppressedKey, null);
  assert.equal(reset.promptSuppressionReason, null);

  await silenceConsole(() => updateCheck({ target, passthrough: ["skip"] }));
  const skipped = readUpdateCheck(target);
  assert.equal(skipped.promptSuppressedKey, "update:latest:9.0.0");
  assert.equal(skipped.promptSuppressionReason, "skip");
});

test("self-check manual 只绕过提示抑制且保留关闭开关", async (t) => {
  const target = await createSnoozedProjectOutOfSyncTarget(t);

  const automatic = runFlowerCliJson(["self-check", "--json", "--target", target]);
  assert.equal(automatic.status, "skipped");
  assert.equal(automatic.reason, "prompt_snooze");
  assert.equal(automatic.suppressedAction.status, "project_out_of_sync");

  const manual = runFlowerCliJson(["self-check", "--json", "--manual", "--target", target]);
  assert.equal(manual.status, "project_out_of_sync");
  assert.equal(manual.reason, "local_version_mismatch");
  assert.equal(manual.prompt.suppressed, false);
  assert.match(manual.commands.recommended, /self-update .* --yes --project-only/);
  assert.equal(readUpdateCheck(target).promptSuppressionReason, "snooze");

  const disabled = runFlowerCliJson([
    "self-check",
    "--json",
    "--manual",
    "--no-update-check",
    "--target",
    target,
  ]);
  assert.equal(disabled.status, "disabled");
  assert.equal(disabled.reason, "disabled");
});

test("self-update 显式入口绕过旧提示抑制做项目预演", async (t) => {
  const target = await createSnoozedProjectOutOfSyncTarget(t);

  const output = runFlowerCli([
    "self-update",
    "--target",
    target,
    "--yes",
    "--project-only",
    "--dry-run",
  ]);
  assert.match(output, /当前状态:project_out_of_sync/);
  assert.doesNotMatch(output, /当前状态:skipped/);
  assert.match(output, /post_action_preview: run_trellis_push_after_real_update/);
});
