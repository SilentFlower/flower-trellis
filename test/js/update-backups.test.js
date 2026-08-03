import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { OWN_FLAGS } from "../../src/constants.js";
import { plugin } from "../../src/commands/plugin.js";
import { parseCliArgs, trellisUpdatePassthroughArgs } from "../../src/lib/cli-args.js";
import { projectUpdateForwardArgs } from "../../src/lib/self-check.js";
import { trellisVersion } from "../../src/lib/versions.js";
import {
  createUpdateCompensationError,
  replayPlugins,
  shouldUseUpdateSandbox,
} from "../../src/commands/update.js";
import { SKILL_GARDEN_PLUGIN_ID } from "../../src/builtin-plugins/skill-garden/provider.js";
import {
  normalizeUpdateBackupRetention,
  planUpdateBackupRetention,
  pruneUpdateBackups,
  snapshotUpdateBackups,
} from "../../src/lib/update-backups.js";
import {
  createUpdateSandbox,
  createUpdateSnapshot,
  disposeUpdateSandbox,
  disposeUpdateSnapshot,
  extendUpdateSnapshot,
  restoreUpdateSnapshot,
} from "../../src/lib/update-transaction.js";

const BACKUPS = [
  ".backup-2026-07-20T01-00-00",
  ".backup-2026-07-21T01-00-00",
  ".backup-2026-07-22T01-00-00",
  ".backup-2026-07-23T01-00-00",
  ".backup-2026-07-24T01-00-00",
];

function createTarget(t, prefix = "flower-update-backups-") {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  fs.mkdirSync(path.join(target, ".trellis"), { recursive: true });
  return target;
}

function createBackups(target, names) {
  for (const name of names) {
    const directory = path.join(target, ".trellis", name);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, "marker.txt"), name);
  }
}

function existingBackups(target, names) {
  return names.filter((name) => fs.existsSync(path.join(target, ".trellis", name)));
}

function snapshotTree(root) {
  const entries = [];

  function walk(directory, relativeDirectory = "") {
    const children = fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of children) {
      const relativePath = path.posix.join(relativeDirectory, entry.name);
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        entries.push([relativePath, "directory"]);
        walk(absolutePath, relativePath);
      } else {
        entries.push([relativePath, "file", fs.readFileSync(absolutePath, "base64")]);
      }
    }
  }

  walk(root);
  return entries;
}

function createFakeGlobalTrellis(t, version) {
  const prefix = fs.mkdtempSync(path.join(os.tmpdir(), "flower-global-prefix-"));
  t.after(() => fs.rmSync(prefix, { recursive: true, force: true }));

  if (process.platform === "win32") {
    fs.writeFileSync(path.join(prefix, "trellis.cmd"), `@echo off\r\necho ${version}\r\n`);
  } else {
    const binDirectory = path.join(prefix, "bin");
    fs.mkdirSync(binDirectory, { recursive: true });
    const executable = path.join(binDirectory, "trellis");
    fs.writeFileSync(executable, `#!/bin/sh\nprintf '${version}\\n'\n`);
    fs.chmodSync(executable, 0o755);
  }

  return prefix;
}

function writeTemplateHashes(target, paths) {
  fs.writeFileSync(
    path.join(target, ".trellis/.template-hashes.json"),
    `${JSON.stringify({
      __version: 2,
      hashes: Object.fromEntries(paths.map((entry) => [entry, "hash"])),
    }, null, 2)}\n`,
  );
}

async function quietAsync(callback) {
  const originalLog = console.log;
  const originalError = console.error;
  console.log = () => {};
  console.error = () => {};
  try {
    return await callback();
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

test("升级备份保留数量只接受非负安全整数", () => {
  assert.equal(normalizeUpdateBackupRetention(undefined), 3);
  assert.equal(normalizeUpdateBackupRetention(0), 0);
  assert.equal(normalizeUpdateBackupRetention("5"), 5);
  assert.throws(() => normalizeUpdateBackupRetention(null), /需要非负整数/);
  assert.throws(() => normalizeUpdateBackupRetention("-1"), /需要非负整数/);
  assert.throws(() => normalizeUpdateBackupRetention("1.5"), /需要非负整数/);
  assert.throws(() => normalizeUpdateBackupRetention("many"), /需要非负整数/);
  assert.throws(
    () => normalizeUpdateBackupRetention("9007199254740992"),
    /超出安全整数范围/,
  );
});

test("只有跨版本普通 dry-run 进入项目外升级沙箱", () => {
  const targetVersion = trellisVersion();

  assert.equal(shouldUseUpdateSandbox({
    dryRun: true,
    enhanceOnly: false,
    currentVersion: "0.6.5",
    targetVersion,
  }), true);
  assert.equal(shouldUseUpdateSandbox({
    dryRun: true,
    enhanceOnly: false,
    currentVersion: targetVersion,
    targetVersion,
  }), false);
  assert.equal(shouldUseUpdateSandbox({
    dryRun: true,
    enhanceOnly: true,
    currentVersion: "0.6.5",
    targetVersion,
  }), false);
  assert.equal(shouldUseUpdateSandbox({
    dryRun: false,
    enhanceOnly: false,
    currentVersion: "0.6.5",
    targetVersion,
  }), false);
});

test("Update 重放 Skill-Garden 时按 Trellis 配置收窄污染平台 state", async (t) => {
  const target = createTarget(t, "flower-update-platform-state-");
  fs.writeFileSync(path.join(target, ".trellis/.version"), "0.6.12\n");
  fs.mkdirSync(path.join(target, ".claude/agents"), { recursive: true });
  fs.mkdirSync(path.join(target, ".claude/skills"), { recursive: true });
  fs.mkdirSync(path.join(target, ".agents/skills"), { recursive: true });
  fs.mkdirSync(path.join(target, ".codex/agents"), { recursive: true });
  fs.copyFileSync(
    path.resolve("vendor/skill-garden/compiled-targets/0.6.12/full/targets/.claude/agents/trellis-implement.md"),
    path.join(target, ".claude/agents/trellis-implement.md"),
  );
  fs.copyFileSync(
    path.resolve("vendor/skill-garden/compiled-targets/0.6.12/full/targets/.codex/agents/trellis-implement.toml"),
    path.join(target, ".codex/agents/trellis-implement.toml"),
  );
  writeTemplateHashes(target, [
    ".claude/agents/trellis-implement.md",
    ".codex/agents/trellis-implement.toml",
  ]);

  const addCode = await quietAsync(() => plugin({
    target,
    passthrough: [
      "add",
      SKILL_GARDEN_PLUGIN_ID,
      "--platform",
      "claude",
      "--platform",
      "codex",
      "--platform",
      "gemini",
      "--platform",
      "zcode",
      "--json",
    ],
  }, {
    skillGarden: { variant: "0.6", skills: ["trellis-route", "trellis-check-all"] },
    compact: true,
  }));
  assert.equal(addCode, 0);
  assert.equal(fs.existsSync(path.join(target, ".gemini/agents/trellis-check-all.md")), true);
  assert.equal(fs.existsSync(path.join(target, ".zcode/agents/trellis-check-all.md")), true);

  await quietAsync(() => replayPlugins({
    target,
    enhance: true,
    variant: "0.6",
    skills: ["trellis-route", "trellis-check-all"],
  }, target, false));

  const state = JSON.parse(fs.readFileSync(path.join(target, ".flower/state.json"), "utf8"));
  const skillGarden = state.plugins.find(({ id }) => id === SKILL_GARDEN_PLUGIN_ID);
  assert.deepEqual(skillGarden.platforms, ["claude", "codex"]);
  assert.equal(
    skillGarden.paths.some(({ path: managedPath }) => (
      managedPath.startsWith(".gemini/") || managedPath.startsWith(".zcode/")
    )),
    false,
  );
  assert.equal(fs.existsSync(path.join(target, ".gemini")), false);
  assert.equal(fs.existsSync(path.join(target, ".zcode")), false);
});

test("0.6.5 最小项目可零写入预览升级到捆绑版本", (t) => {
  const target = createTarget(t, "flower-update-dry-run-065-");
  fs.writeFileSync(path.join(target, ".trellis/.version"), "0.6.5\n");
  fs.writeFileSync(path.join(target, ".trellis/.developer"), "tester\n");
  fs.writeFileSync(path.join(target, ".trellis/config.yaml"), "# Trellis Configuration\n");
  const before = snapshotTree(target);
  const prefix = createFakeGlobalTrellis(t, trellisVersion());

  const result = spawnSync(process.execPath, [
    path.resolve("bin/flower-trellis.js"),
    "update",
    "--dry-run",
    "--no-enhance",
    "--no-update-check",
    "--target",
    target,
  ], {
    cwd: path.resolve("."),
    encoding: "utf8",
    env: {
      ...process.env,
      FLOWER_NO_TELEMETRY: "1",
      npm_config_prefix: prefix,
    },
    timeout: 20_000,
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /跨版本 dry-run:在项目外沙箱预演 Trellis \+ Plugin \(0\.6\.5 → 0\.6\.12\)/);
  assert.match(result.stdout, /--no-enhance:跳过 Skill-Garden/);
  assert.deepEqual(snapshotTree(target), before);
});

test("Update 补偿恢复旧内容、mode 和 Plugin-owned path，并保留用户数据与新备份", (t) => {
  const target = createTarget(t, "flower-update-transaction-");
  fs.mkdirSync(path.join(target, ".codex"));
  fs.mkdirSync(path.join(target, ".flower"));
  fs.mkdirSync(path.join(target, "custom"));
  fs.mkdirSync(path.join(target, ".trellis", "tasks", "task-a"), { recursive: true });
  fs.mkdirSync(path.join(target, ".trellis", "spec"), { recursive: true });
  fs.writeFileSync(path.join(target, ".codex", "config.toml"), "old\n", { mode: 0o640 });
  fs.writeFileSync(path.join(target, "AGENTS.md"), "old agents\n");
  fs.writeFileSync(path.join(target, "custom", "owned.txt"), "old owned\n");
  fs.writeFileSync(path.join(target, ".trellis", "tasks", "task-a", "task.json"), "old task\n");
  fs.writeFileSync(path.join(target, ".trellis", "spec", "guide.md"), "old spec\n");
  fs.writeFileSync(path.join(target, ".flower", "state.json"), `${JSON.stringify({
    schemaVersion: 1,
    transactionVersion: 1,
    plugins: [{
      id: "flower/sample",
      version: "1.0.0",
      platforms: ["codex"],
      paths: [{
        path: "custom/owned.txt",
        kind: "file",
        hash: `sha256:${"0".repeat(64)}`,
        ownership: "exclusive",
      }],
      patches: [],
    }],
  }, null, 2)}\n`);

  const snapshot = createUpdateSnapshot(target);
  t.after(() => disposeUpdateSnapshot(snapshot));
  fs.writeFileSync(path.join(target, ".codex", "config.toml"), "new\n");
  fs.chmodSync(path.join(target, ".codex", "config.toml"), 0o600);
  fs.writeFileSync(path.join(target, ".codex", "new.toml"), "new file\n");
  fs.writeFileSync(path.join(target, "custom", "owned.txt"), "new owned\n");
  fs.writeFileSync(path.join(target, ".trellis", "tasks", "task-a", "task.json"), "new task\n");
  fs.writeFileSync(path.join(target, ".trellis", "spec", "guide.md"), "new spec\n");
  fs.mkdirSync(path.join(target, ".trellis", ".backup-2026-08-02T01-02-03"));
  fs.writeFileSync(
    path.join(target, ".trellis", ".backup-2026-08-02T01-02-03", "evidence.txt"),
    "keep\n",
  );

  const result = restoreUpdateSnapshot(snapshot);
  assert.equal(result.ok, true, JSON.stringify(result.failedPaths));
  assert.equal(fs.readFileSync(path.join(target, ".codex", "config.toml"), "utf8"), "old\n");
  assert.equal(fs.statSync(path.join(target, ".codex", "config.toml")).mode & 0o777, 0o640);
  assert.equal(fs.existsSync(path.join(target, ".codex", "new.toml")), false);
  assert.equal(fs.readFileSync(path.join(target, "custom", "owned.txt"), "utf8"), "old owned\n");
  assert.equal(fs.readFileSync(path.join(target, ".trellis", "tasks", "task-a", "task.json"), "utf8"), "new task\n");
  assert.equal(fs.readFileSync(path.join(target, ".trellis", "spec", "guide.md"), "utf8"), "new spec\n");
  assert.equal(
    fs.existsSync(path.join(target, ".trellis", ".backup-2026-08-02T01-02-03", "evidence.txt")),
    true,
  );
});

test("Plugin 预检扩展快照后可恢复新增外部路径及其原内容", (t) => {
  const target = createTarget(t, "flower-update-plugin-plan-");
  fs.mkdirSync(path.join(target, "custom"));
  fs.writeFileSync(path.join(target, "custom", "owned.txt"), "old owned\n", { mode: 0o640 });
  const snapshot = createUpdateSnapshot(target);
  t.after(() => disposeUpdateSnapshot(snapshot));

  assert.deepEqual(extendUpdateSnapshot(snapshot, [
    "custom/owned.txt",
    "generated/nested/new-owned.txt",
  ]), ["custom/owned.txt", "generated"]);
  fs.writeFileSync(path.join(target, "custom", "owned.txt"), "new owned\n");
  fs.mkdirSync(path.join(target, "generated", "nested"), { recursive: true });
  fs.writeFileSync(path.join(target, "generated", "nested", "new-owned.txt"), "new file\n");

  const result = restoreUpdateSnapshot(snapshot);
  assert.equal(result.ok, true, JSON.stringify(result.failedPaths));
  assert.equal(fs.readFileSync(path.join(target, "custom", "owned.txt"), "utf8"), "old owned\n");
  assert.equal(fs.statSync(path.join(target, "custom", "owned.txt")).mode & 0o777, 0o640);
  assert.equal(fs.existsSync(path.join(target, "generated")), false);
});

test("真实 CLI 在 Plugin replay 失败后补偿恢复受管状态并保留备份", (t) => {
  const target = createTarget(t, "flower-update-cli-compensation-");
  fs.mkdirSync(path.join(target, ".codex"));
  fs.mkdirSync(path.join(target, ".flower"));
  fs.mkdirSync(path.join(target, ".trellis/tasks/task-a"), { recursive: true });
  fs.writeFileSync(path.join(target, ".trellis/.version"), "0.6.5\n");
  fs.writeFileSync(path.join(target, ".trellis/.developer"), "tester\n");
  fs.writeFileSync(path.join(target, ".trellis/config.yaml"), "old config\n");
  fs.writeFileSync(path.join(target, ".codex/config.toml"), "old codex\n", { mode: 0o640 });
  fs.writeFileSync(path.join(target, ".flower/plugins.json"), "{broken\n");
  fs.writeFileSync(path.join(target, ".trellis/tasks/task-a/task.json"), "user task\n");
  const prefix = createFakeGlobalTrellis(t, trellisVersion());

  const result = spawnSync(process.execPath, [
    path.resolve("bin/flower-trellis.js"),
    "update",
    "--force",
    "--no-update-check",
    "--target",
    target,
  ], {
    cwd: path.resolve("."),
    encoding: "utf8",
    env: {
      ...process.env,
      FLOWER_NO_TELEMETRY: "1",
      npm_config_prefix: prefix,
    },
    timeout: 20_000,
  });

  const output = `${result.stdout}\n${result.stderr}`;
  assert.notEqual(result.status, 0, output);
  assert.match(output, /Update 已补偿恢复/);
  assert.equal(fs.readFileSync(path.join(target, ".trellis/.version"), "utf8"), "0.6.5\n");
  assert.equal(fs.readFileSync(path.join(target, ".trellis/config.yaml"), "utf8"), "old config\n");
  assert.equal(fs.readFileSync(path.join(target, ".codex/config.toml"), "utf8"), "old codex\n");
  assert.equal(fs.statSync(path.join(target, ".codex/config.toml")).mode & 0o777, 0o640);
  assert.equal(fs.existsSync(path.join(target, ".codex/new.toml")), false);
  assert.equal(fs.readFileSync(path.join(target, ".flower/plugins.json"), "utf8"), "{broken\n");
  assert.equal(fs.readFileSync(path.join(target, ".trellis/tasks/task-a/task.json"), "utf8"), "user task\n");
  const backups = fs.readdirSync(path.join(target, ".trellis"))
    .filter((name) => /^\.backup-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/.test(name));
  assert.ok(backups.length > 0, "Trellis 本轮升级备份应作为补偿证据保留");
});

test("Update 补偿不完整时返回失败路径、manifest 和稳定错误码", {
  skip: process.platform === "win32",
}, (t) => {
  const target = createTarget(t, "flower-update-compensation-incomplete-");
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "flower-update-compensation-outside-"));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.mkdirSync(path.join(target, ".codex"));
  fs.writeFileSync(path.join(target, ".codex/config.toml"), "old codex\n");
  const snapshot = createUpdateSnapshot(target);
  t.after(() => disposeUpdateSnapshot(snapshot));
  fs.rmSync(path.join(target, ".codex"), { recursive: true });
  fs.symlinkSync(outside, path.join(target, ".codex"), "dir");

  const recovery = restoreUpdateSnapshot(snapshot);
  assert.equal(recovery.ok, false);
  assert.ok(recovery.failedPaths.length > 0);
  assert.equal(recovery.manifestPath, snapshot.manifestPath);
  const error = createUpdateCompensationError(new Error("plugin failed"), recovery);
  assert.equal(error.code, "UPDATE_COMPENSATION_INCOMPLETE");
  assert.equal(error.details, recovery);
  assert.match(error.message, /未恢复 \d+ 个路径/);
  assert.match(error.message, new RegExp(snapshot.manifestPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(fs.realpathSync(path.join(target, ".codex")), fs.realpathSync(outside));
});

test("Update 沙箱复制受管状态且不修改来源项目", (t) => {
  const target = createTarget(t, "flower-update-sandbox-source-");
  fs.mkdirSync(path.join(target, ".codex"));
  fs.writeFileSync(path.join(target, ".trellis", ".version"), "0.6.5\n");
  fs.writeFileSync(path.join(target, ".codex", "config.toml"), "source\n");
  const before = snapshotTree(target);

  const sandbox = createUpdateSandbox(target);
  t.after(() => disposeUpdateSandbox(sandbox));
  assert.notEqual(path.dirname(sandbox.root), target);
  assert.equal(fs.readFileSync(path.join(sandbox.root, ".codex", "config.toml"), "utf8"), "source\n");
  fs.writeFileSync(path.join(sandbox.root, ".codex", "config.toml"), "sandbox\n");
  assert.deepEqual(snapshotTree(target), before);
});

test("Update 快照遇到受管软链时 fail closed", (t) => {
  const target = createTarget(t, "flower-update-snapshot-symlink-");
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "flower-update-outside-"));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.symlinkSync(outside, path.join(target, ".codex"), "dir");
  assert.throws(() => createUpdateSnapshot(target), /包含软链/);
});

test("CLI 消费 backup-retention 并保留其它 Trellis 参数", () => {
  const base = path.join(os.tmpdir(), "flower-cli-base");
  const defaults = parseCliArgs(["update", "--force"], base);
  assert.equal(defaults.command, "update");
  assert.equal(defaults.ctx.backupRetention, 3);
  assert.deepEqual(defaults.ctx.passthrough, ["--force"]);

  const explicit = parseCliArgs([
    "update",
    "--backup-retention",
    "5",
    "--force",
    "--dry-run",
  ], base);
  assert.equal(explicit.ctx.backupRetention, "5");
  assert.deepEqual(explicit.ctx.passthrough, ["--force", "--dry-run"]);

  const missing = parseCliArgs(["update", "--backup-retention", "--force"], base);
  assert.equal(missing.ctx.backupRetention, null);
  assert.deepEqual(missing.ctx.passthrough, ["--force"]);

  const negative = parseCliArgs(["update", "--backup-retention", "-1", "--force"], base);
  assert.equal(negative.ctx.backupRetention, "-1");
  assert.deepEqual(negative.ctx.passthrough, ["--force"]);
  assert.equal(OWN_FLAGS["--backup-retention"], true);

  const nonInteractive = parseCliArgs(["update", "-y", "--yes", "--dry-run"], base);
  assert.deepEqual(nonInteractive.ctx.passthrough, ["-y", "--yes", "--dry-run"]);
  assert.deepEqual(
    trellisUpdatePassthroughArgs(nonInteractive.ctx.passthrough),
    ["--dry-run"],
  );
});

test("self-update 将 backup-retention 原样转发给项目 Flower update", () => {
  const parsed = parseCliArgs([
    "self-update",
    "--yes",
    "--",
    "--backup-retention",
    "5",
    "--skip-all",
  ]);
  assert.deepEqual(parsed.ctx.passthrough, ["--yes"]);
  assert.deepEqual(parsed.ctx.forwarded, ["--backup-retention", "5", "--skip-all"]);
  assert.deepEqual(
    projectUpdateForwardArgs(parsed.ctx.forwarded),
    ["--backup-retention", "5", "--skip-all"],
  );
});

test("保留计划默认淘汰最旧备份并优先保护本轮新备份", () => {
  assert.deepEqual(planUpdateBackupRetention(BACKUPS, 3), {
    retention: 3,
    retained: BACKUPS.slice(2).reverse(),
    removable: BACKUPS.slice(0, 2),
    protected: [],
  });

  const protectedName = BACKUPS[0];
  const protectedPlan = planUpdateBackupRetention(BACKUPS, 3, [protectedName]);
  assert.deepEqual(protectedPlan.retained, [BACKUPS[4], BACKUPS[3], protectedName]);
  assert.deepEqual(protectedPlan.removable, [BACKUPS[1], BACKUPS[2]]);
  assert.deepEqual(protectedPlan.protected, [protectedName]);
});

test("真实清理只删除合法旧目录并保留 Flower 基线与相似路径", (t) => {
  const target = createTarget(t);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "flower-backup-outside-"));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  createBackups(target, BACKUPS);

  const trellis = path.join(target, ".trellis");
  fs.mkdirSync(path.join(trellis, ".backup-flower"));
  fs.mkdirSync(path.join(trellis, ".backup-manual"));
  fs.writeFileSync(path.join(trellis, ".backup-2026-07-19T01-00-00"), "file");
  fs.symlinkSync(outside, path.join(trellis, ".backup-2026-07-18T01-00-00"), "dir");

  const beforeSnapshot = snapshotUpdateBackups(target);
  assert.equal(beforeSnapshot.ok, true);
  assert.deepEqual(beforeSnapshot.names, BACKUPS);
  assert.equal(beforeSnapshot.warnings.length, 2);

  const result = pruneUpdateBackups(target, { retention: 3, beforeSnapshot });
  assert.equal(result.status, "completed");
  assert.deepEqual(result.removed, BACKUPS.slice(0, 2));
  assert.deepEqual(existingBackups(target, BACKUPS), BACKUPS.slice(2));
  assert.equal(fs.existsSync(path.join(trellis, ".backup-flower")), true);
  assert.equal(fs.existsSync(path.join(trellis, ".backup-manual")), true);
  assert.equal(fs.existsSync(path.join(trellis, ".backup-2026-07-19T01-00-00")), true);
  assert.equal(fs.existsSync(path.join(trellis, ".backup-2026-07-18T01-00-00")), true);
  assert.equal(fs.existsSync(outside), true);
});

test("dry-run 复用保留计划但不删除文件", (t) => {
  const target = createTarget(t);
  createBackups(target, BACKUPS.slice(0, 4));
  const beforeSnapshot = snapshotUpdateBackups(target);

  const result = pruneUpdateBackups(target, {
    retention: 2,
    beforeSnapshot,
    dryRun: true,
  });

  assert.equal(result.status, "preview");
  assert.deepEqual(result.removable, BACKUPS.slice(0, 2));
  assert.deepEqual(existingBackups(target, BACKUPS), BACKUPS.slice(0, 4));
});

test("更新前后差值保护时间排序更旧的本轮备份", (t) => {
  const target = createTarget(t);
  createBackups(target, BACKUPS.slice(1, 4));
  const beforeSnapshot = snapshotUpdateBackups(target);
  const clockRollbackBackup = ".backup-2020-01-01T00-00-00";
  createBackups(target, [clockRollbackBackup]);

  const result = pruneUpdateBackups(target, { retention: 3, beforeSnapshot });

  assert.deepEqual(result.protected, [clockRollbackBackup]);
  assert.equal(fs.existsSync(path.join(target, ".trellis", clockRollbackBackup)), true);
  assert.equal(fs.existsSync(path.join(target, ".trellis", BACKUPS[1])), false);
  assert.equal(fs.existsSync(path.join(target, ".trellis", BACKUPS[2])), true);
  assert.equal(fs.existsSync(path.join(target, ".trellis", BACKUPS[3])), true);
});

test(".trellis 真实路径逃逸项目时跳过清理", (t) => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "flower-backup-project-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "flower-backup-trellis-"));
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.symlinkSync(outside, path.join(target, ".trellis"), "dir");
  createBackups(outside, []);
  const backup = path.join(outside, BACKUPS[0]);
  fs.mkdirSync(backup);

  const beforeSnapshot = snapshotUpdateBackups(target);
  const result = pruneUpdateBackups(target, { retention: 1, beforeSnapshot });

  assert.equal(beforeSnapshot.ok, false);
  assert.equal(result.status, "skipped");
  assert.match(result.warnings.join("\n"), /软链逃逸项目/);
  assert.equal(fs.existsSync(backup), true);
});

test("单项删除失败时继续清理其它旧备份", (t) => {
  const target = createTarget(t);
  createBackups(target, BACKUPS);
  const beforeSnapshot = snapshotUpdateBackups(target);
  const failedPath = path.join(target, ".trellis", BACKUPS[0]);

  const result = pruneUpdateBackups(target, {
    retention: 3,
    beforeSnapshot,
    remove(candidate) {
      if (candidate === failedPath) throw new Error("permission denied");
      fs.rmSync(candidate, { recursive: true, force: false });
    },
  });

  assert.deepEqual(result.removed, [BACKUPS[1]]);
  assert.match(result.warnings.join("\n"), /permission denied/);
  assert.equal(fs.existsSync(failedPath), true);
  assert.equal(fs.existsSync(path.join(target, ".trellis", BACKUPS[1])), false);
});

test("retention=0 不读取目标目录并直接关闭清理", () => {
  const result = pruneUpdateBackups("/definitely/missing/flower-target", {
    retention: 0,
    beforeSnapshot: null,
  });
  assert.equal(result.status, "disabled");
  assert.deepEqual(result.warnings, []);
});

test("update 编排只在配置恢复 finally 之后调用清理", () => {
  const source = fs.readFileSync(
    path.resolve("src/commands/update.js"),
    "utf8",
  );
  const finallyIndex = source.indexOf("} finally {");
  const restoreIndex = source.indexOf("restoreConfigPreserveSnapshot", finallyIndex);
  const pruneIndex = source.lastIndexOf("pruneUpdateBackups(");
  const completeIndex = source.indexOf("showCommandCompletion(");

  assert.ok(finallyIndex >= 0);
  assert.ok(restoreIndex > finallyIndex);
  assert.ok(pruneIndex > restoreIndex);
  assert.ok(completeIndex > pruneIndex);
  assert.match(source, /outcome: dryRun \? "preview" : "success"/);
});
