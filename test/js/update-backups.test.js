import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { OWN_FLAGS } from "../../src/constants.js";
import { parseCliArgs, trellisUpdatePassthroughArgs } from "../../src/lib/cli-args.js";
import { projectUpdateForwardArgs } from "../../src/lib/self-check.js";
import {
  normalizeUpdateBackupRetention,
  planUpdateBackupRetention,
  pruneUpdateBackups,
  snapshotUpdateBackups,
} from "../../src/lib/update-backups.js";

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
  const completeIndex = source.indexOf("flower-trellis update 完成");

  assert.ok(finallyIndex >= 0);
  assert.ok(restoreIndex > finallyIndex);
  assert.ok(pruneIndex > restoreIndex);
  assert.ok(completeIndex > pruneIndex);
});
