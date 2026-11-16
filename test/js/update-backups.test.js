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
import { resolveTrellisBin } from "../../src/lib/trellis-runner.js";
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

/**
 * 创建运行时研究资料及同目录文件软链。
 *
 * @param {string} target 临时项目根目录
 * @returns {{root:string,state:string,link:string,linkTarget:string}} 运行时夹具路径
 */
function createRuntimeResearch(target) {
  const root = path.join(target, ".trellis", ".runtime");
  const research = path.join(root, "research", "criu");
  fs.mkdirSync(research, { recursive: true });
  fs.writeFileSync(path.join(research, "GEMINI.md"), "研究源码\n");
  const link = path.join(research, "CLAUDE.md");
  fs.symlinkSync("GEMINI.md", link, "file");
  const state = path.join(root, "worker.json");
  fs.writeFileSync(state, "准备中\n");
  return { root, state, link, linkTarget: fs.readlinkSync(link) };
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
  assert.equal(normalizeUpdateBackupRetention(undefined), 1);
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
  fs.writeFileSync(path.join(target, ".trellis/.version"), "0.6.14\n");
  fs.mkdirSync(path.join(target, ".claude/agents"), { recursive: true });
  fs.mkdirSync(path.join(target, ".claude/skills"), { recursive: true });
  fs.mkdirSync(path.join(target, ".agents/skills"), { recursive: true });
  fs.mkdirSync(path.join(target, ".codex/agents"), { recursive: true });
  fs.copyFileSync(
    path.resolve("vendor/skill-garden/compiled-targets/0.6.14/full/targets/.claude/agents/trellis-implement.md"),
    path.join(target, ".claude/agents/trellis-implement.md"),
  );
  fs.copyFileSync(
    path.resolve("vendor/skill-garden/compiled-targets/0.6.14/full/targets/.codex/agents/trellis-implement.toml"),
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

test("0.6.12 最小项目可零写入预览升级到 0.6.14 并重放 Plugin", (t) => {
  const target = createTarget(t, "flower-update-dry-run-0612-");
  fs.writeFileSync(path.join(target, ".trellis/.version"), "0.6.12\n");
  fs.writeFileSync(path.join(target, ".trellis/.developer"), "tester\n");
  fs.writeFileSync(path.join(target, ".trellis/config.yaml"), "# Trellis Configuration\n");
  createBackups(target, BACKUPS.slice(0, 3));
  const before = snapshotTree(target);
  const prefix = createFakeGlobalTrellis(t, trellisVersion());

  const result = spawnSync(process.execPath, [
    path.resolve("bin/flower-trellis.js"),
    "update",
    "--dry-run",
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
  assert.match(result.stdout, /跨版本 dry-run:在项目外沙箱预演 Trellis \+ Plugin \(0\.6\.12 → 0\.6\.14\)/);
  assert.match(result.stdout, /flower\/skill-garden/);
  assert.match(result.stdout, /保留策略:1 份;预计保留 1 份;预计删除 2 份/);
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
  // Windows 不支持 POSIX 组权限，恢复契约以文件系统实际保存的 mode 为准。
  const originalMode = fs.statSync(path.join(target, ".codex", "config.toml")).mode & 0o777;
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
  assert.equal(fs.statSync(path.join(target, ".codex", "config.toml")).mode & 0o777, originalMode);
  assert.equal(fs.existsSync(path.join(target, ".codex", "new.toml")), false);
  assert.equal(fs.readFileSync(path.join(target, "custom", "owned.txt"), "utf8"), "old owned\n");
  assert.equal(fs.readFileSync(path.join(target, ".trellis", "tasks", "task-a", "task.json"), "utf8"), "new task\n");
  assert.equal(fs.readFileSync(path.join(target, ".trellis", "spec", "guide.md"), "utf8"), "new spec\n");
  assert.equal(
    fs.existsSync(path.join(target, ".trellis", ".backup-2026-08-02T01-02-03", "evidence.txt")),
    true,
  );
});

test("运行时研究软链不进入默认快照和沙箱，回滚保留当前执行状态", (t) => {
  const target = createTarget(t, "flower-update-runtime-");
  const runtime = createRuntimeResearch(target);
  fs.mkdirSync(path.join(target, ".codex"));
  const managed = path.join(target, ".codex/config.toml");
  fs.writeFileSync(managed, "旧配置\n");
  fs.mkdirSync(path.join(target, ".trellis/.runtime-copy"));
  fs.writeFileSync(path.join(target, ".trellis/.runtime-copy/managed.txt"), "相似目录\n");

  const snapshot = createUpdateSnapshot(target);
  t.after(() => disposeUpdateSnapshot(snapshot));
  assert.equal(snapshot.manifest.entries.some(({ path: entry }) => entry === ".trellis/.runtime" || entry.startsWith(".trellis/.runtime/")), false);
  assert.ok(snapshot.manifest.entries.some(({ path: entry }) => entry === ".trellis/.runtime-copy/managed.txt"));
  const sandbox = createUpdateSandbox(target);
  t.after(() => disposeUpdateSandbox(sandbox));
  assert.equal(fs.existsSync(path.join(sandbox.root, ".trellis/.runtime")), false);

  fs.writeFileSync(managed, "新配置\n");
  fs.writeFileSync(runtime.state, "执行中\n");
  fs.writeFileSync(path.join(runtime.root, "new-receipt.json"), "新回执\n");
  const recovery = restoreUpdateSnapshot(snapshot);
  assert.equal(recovery.ok, true, JSON.stringify(recovery.failedPaths));
  assert.equal(fs.readFileSync(managed, "utf8"), "旧配置\n");
  assert.equal(fs.readFileSync(runtime.state, "utf8"), "执行中\n");
  assert.equal(fs.readFileSync(path.join(runtime.root, "new-receipt.json"), "utf8"), "新回执\n");
  assert.equal(fs.lstatSync(runtime.link).isSymbolicLink(), true);
  assert.equal(fs.readlinkSync(runtime.link), runtime.linkTarget);
});

test("默认运行时范围在读取文件属性前裁剪", (t) => {
  const target = createTarget(t, "flower-update-runtime-stat-");
  const runtime = path.join(fs.realpathSync(target), ".trellis/.runtime");
  fs.mkdirSync(runtime);
  const original = fs.lstatSync;
  let snapshot;
  fs.lstatSync = (file, ...args) => {
    if (path.resolve(file) === runtime) throw new Error("运行时属性不属于默认快照");
    return original(file, ...args);
  };
  try {
    snapshot = createUpdateSnapshot(target);
  } finally {
    fs.lstatSync = original;
  }
  t.after(() => disposeUpdateSnapshot(snapshot));
  assert.equal(snapshot.manifest.entries.some(({ path: entry }) => entry.startsWith(".trellis/.runtime")), false);
});

test("运行时根为软链时默认快照和恢复保留链接及外部资料", (t) => {
  const target = createTarget(t, "flower-update-runtime-root-");
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "flower-runtime-outside-"));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.writeFileSync(path.join(outside, "research.md"), "外部资料\n");
  const runtime = path.join(target, ".trellis/.runtime");
  fs.symlinkSync(outside, runtime, process.platform === "win32" ? "junction" : "dir");
  const linkTarget = fs.readlinkSync(runtime);
  const snapshot = createUpdateSnapshot(target);
  t.after(() => disposeUpdateSnapshot(snapshot));
  assert.equal(snapshot.manifest.entries.some(({ path: entry }) => entry.startsWith(".trellis/.runtime")), false);
  const recovery = restoreUpdateSnapshot(snapshot);
  assert.equal(recovery.ok, true, JSON.stringify(recovery.failedPaths));
  assert.equal(fs.readlinkSync(runtime), linkTarget);
  assert.equal(fs.readFileSync(path.join(outside, "research.md"), "utf8"), "外部资料\n");
});

test("上游已排除的 worktrees 链接同样不进入快照扫描", (t) => {
  const target = createTarget(t, "flower-update-excluded-link-");
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "flower-worktrees-outside-"));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.writeFileSync(path.join(outside, "work.md"), "本地工作树\n");
  const worktrees = path.join(target, ".trellis/worktrees");
  fs.symlinkSync(outside, worktrees, process.platform === "win32" ? "junction" : "dir");
  const snapshot = createUpdateSnapshot(target);
  t.after(() => disposeUpdateSnapshot(snapshot));
  assert.equal(snapshot.manifest.entries.some(({ path: entry }) => entry.startsWith(".trellis/worktrees")), false);
  assert.equal(restoreUpdateSnapshot(snapshot).ok, true);
  assert.equal(fs.readFileSync(path.join(outside, "work.md"), "utf8"), "本地工作树\n");
});

test("运行时精确目标可补偿且保留既有空父目录和非目标研究资料", (t) => {
  const target = createTarget(t, "flower-update-runtime-owned-");
  const runtimeRoot = path.join(target, ".trellis/.runtime");
  fs.mkdirSync(path.join(runtimeRoot, "existing"), { recursive: true });
  fs.mkdirSync(path.join(runtimeRoot, "owned-dir"));
  fs.writeFileSync(path.join(runtimeRoot, "owned-dir/old.txt"), "旧子树\n");
  const owned = path.join(runtimeRoot, "owned.json");
  fs.writeFileSync(owned, "旧受管状态\n", { mode: 0o640 });
  const originalMode = fs.statSync(owned).mode & 0o777;
  const snapshot = createUpdateSnapshot(target);
  t.after(() => disposeUpdateSnapshot(snapshot));
  assert.equal(snapshot.manifest.entries.some(({ path: entry }) => entry.startsWith(".trellis/.runtime")), false);
  const targets = [
    ".trellis/.runtime/owned.json",
    ".trellis/.runtime/owned-dir",
    ".trellis/.runtime/existing/generated/new.json",
    ".trellis/.runtime/created/nested/new.json",
  ];
  assert.deepEqual(new Set(extendUpdateSnapshot(snapshot, targets)), new Set([
    ".trellis/.runtime/owned.json", ".trellis/.runtime/owned-dir",
    ".trellis/.runtime/existing/generated", ".trellis/.runtime/created",
  ]));
  fs.writeFileSync(owned, "新受管状态\n");
  fs.chmodSync(owned, 0o600);
  fs.writeFileSync(path.join(runtimeRoot, "owned-dir/old.txt"), "新子树\n");
  fs.writeFileSync(path.join(runtimeRoot, "owned-dir/new.txt"), "新增受管文件\n");
  for (const relative of ["existing/generated/new.json", "created/nested/new.json"]) {
    const file = path.join(runtimeRoot, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "新增目标\n");
  }
  const runtime = createRuntimeResearch(target);
  fs.writeFileSync(runtime.state, "当前执行事实\n");

  const recovery = restoreUpdateSnapshot(snapshot);
  assert.equal(recovery.ok, true, JSON.stringify(recovery.failedPaths));
  assert.equal(fs.readFileSync(owned, "utf8"), "旧受管状态\n");
  assert.equal(fs.statSync(owned).mode & 0o777, originalMode);
  assert.equal(fs.readFileSync(path.join(runtimeRoot, "owned-dir/old.txt"), "utf8"), "旧子树\n");
  assert.equal(fs.existsSync(path.join(runtimeRoot, "owned-dir/new.txt")), false);
  assert.equal(fs.existsSync(path.join(runtimeRoot, "created")), false);
  assert.equal(fs.existsSync(path.join(runtimeRoot, "existing/generated")), false);
  assert.equal(fs.statSync(path.join(runtimeRoot, "existing")).isDirectory(), true);
  assert.equal(fs.readFileSync(runtime.state, "utf8"), "当前执行事实\n");
  assert.equal(fs.readlinkSync(runtime.link), runtime.linkTarget);
});

test("运行时精确目标的软链祖先在读取外部文件前拒绝", (t) => {
  const target = createTarget(t, "flower-update-runtime-owned-link-");
  const snapshot = createUpdateSnapshot(target);
  t.after(() => disposeUpdateSnapshot(snapshot));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "flower-runtime-owned-outside-"));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.writeFileSync(path.join(outside, "owned.json"), "外部资料\n");
  fs.symlinkSync(outside, path.join(target, ".trellis/.runtime"), process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => extendUpdateSnapshot(snapshot, [".trellis/.runtime/owned.json"]), /软链|不是普通目录/);
  assert.equal(fs.existsSync(path.join(snapshot.dataRoot, ".trellis/.runtime/owned.json")), false);
  assert.equal(fs.readFileSync(path.join(outside, "owned.json"), "utf8"), "外部资料\n");
});

test("Plugin 预检扩展快照后可恢复新增外部路径及其原内容", (t) => {
  const target = createTarget(t, "flower-update-plugin-plan-");
  fs.mkdirSync(path.join(target, "custom"));
  fs.writeFileSync(path.join(target, "custom", "owned.txt"), "old owned\n", { mode: 0o640 });
  // Windows 不支持 POSIX 组权限，恢复契约以文件系统实际保存的 mode 为准。
  const originalMode = fs.statSync(path.join(target, "custom", "owned.txt")).mode & 0o777;
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
  assert.equal(fs.statSync(path.join(target, "custom", "owned.txt")).mode & 0o777, originalMode);
  assert.equal(fs.existsSync(path.join(target, "generated")), false);
});

test("Plugin 精确快照可覆盖通常排除的 Trellis spec 目标", (t) => {
  const target = createTarget(t, "flower-update-plugin-spec-plan-");
  const specPath = path.join(target, ".trellis/spec/guide.md");
  fs.mkdirSync(path.dirname(specPath), { recursive: true });
  fs.writeFileSync(specPath, "old spec\n", { mode: 0o640 });
  // Windows 不支持 POSIX 组权限，恢复契约以文件系统实际保存的 mode 为准。
  const originalMode = fs.statSync(specPath).mode & 0o777;
  const snapshot = createUpdateSnapshot(target);
  t.after(() => disposeUpdateSnapshot(snapshot));

  assert.deepEqual(extendUpdateSnapshot(snapshot, [
    ".trellis/spec/guide.md",
    ".trellis/spec/generated/new.md",
  ]), [".trellis/spec/generated", ".trellis/spec/guide.md"]);
  fs.writeFileSync(specPath, "new spec\n");
  fs.mkdirSync(path.join(target, ".trellis/spec/generated"), { recursive: true });
  fs.writeFileSync(path.join(target, ".trellis/spec/generated/new.md"), "new file\n");

  const result = restoreUpdateSnapshot(snapshot);
  assert.equal(result.ok, true, JSON.stringify(result.failedPaths));
  assert.equal(fs.readFileSync(specPath, "utf8"), "old spec\n");
  assert.equal(fs.statSync(specPath).mode & 0o777, originalMode);
  assert.equal(fs.existsSync(path.join(target, ".trellis/spec/generated")), false);
});

test("真实 CLI 在 Plugin replay 失败后补偿恢复受管状态并保留备份", (t) => {
  const target = createTarget(t, "flower-update-cli-compensation-");
  const runtime = createRuntimeResearch(target);
  const runtimeBefore = snapshotTree(runtime.root);
  fs.mkdirSync(path.join(target, ".codex"));
  fs.mkdirSync(path.join(target, ".flower"));
  fs.mkdirSync(path.join(target, ".trellis/tasks/task-a"), { recursive: true });
  fs.writeFileSync(path.join(target, ".trellis/.version"), "0.6.5\n");
  fs.writeFileSync(path.join(target, ".trellis/.developer"), "tester\n");
  fs.writeFileSync(path.join(target, ".trellis/config.yaml"), "old config\n");
  fs.writeFileSync(path.join(target, ".codex/config.toml"), "old codex\n", { mode: 0o640 });
  // Windows 不支持 POSIX 组权限，恢复契约以文件系统实际保存的 mode 为准。
  const originalMode = fs.statSync(path.join(target, ".codex/config.toml")).mode & 0o777;
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
  assert.equal(fs.statSync(path.join(target, ".codex/config.toml")).mode & 0o777, originalMode);
  assert.equal(fs.existsSync(path.join(target, ".codex/new.toml")), false);
  assert.equal(fs.readFileSync(path.join(target, ".flower/plugins.json"), "utf8"), "{broken\n");
  assert.equal(fs.readFileSync(path.join(target, ".trellis/tasks/task-a/task.json"), "utf8"), "user task\n");
  assert.deepEqual(snapshotTree(runtime.root), runtimeBefore);
  assert.equal(fs.readlinkSync(runtime.link), runtime.linkTarget);
  const backups = fs.readdirSync(path.join(target, ".trellis"))
    .filter((name) => /^\.backup-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/.test(name));
  assert.ok(backups.length > 0, "Trellis 本轮升级备份应作为补偿证据保留");
});

test("真实 CLI 同版本预演和更新均保留运行时研究软链", (t) => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "flower-update-runtime-cli-"));
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  const prefix = createFakeGlobalTrellis(t, trellisVersion());
  const env = { ...process.env, FLOWER_NO_TELEMETRY: "1", npm_config_prefix: prefix };
  const initialized = spawnSync(process.execPath, [
    resolveTrellisBin(), "init", "--claude", "--codex", "--no-monorepo", "-y", "-u", "probe",
  ], { cwd: target, env, encoding: "utf8", timeout: 60_000 });
  assert.equal(initialized.status, 0, `${initialized.stdout}\n${initialized.stderr}`);
  const runtime = createRuntimeResearch(target);
  const before = snapshotTree(runtime.root);
  for (const extra of [["--dry-run"], []]) {
    const result = spawnSync(process.execPath, [
      path.resolve("bin/flower-trellis.js"), "update", "--target", target,
      "--force", "--no-update-check", "-y", ...extra,
    ], { cwd: path.resolve("."), env, encoding: "utf8", timeout: 60_000 });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.deepEqual(snapshotTree(runtime.root), before);
    assert.equal(fs.readlinkSync(runtime.link), runtime.linkTarget);
    assert.equal(fs.readFileSync(path.join(target, ".trellis/.version"), "utf8").trim(), trellisVersion());
  }
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
  assert.equal(defaults.ctx.backupRetention, 1);
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
  assert.deepEqual(planUpdateBackupRetention(BACKUPS, normalizeUpdateBackupRetention(undefined)), {
    retention: 1,
    retained: [BACKUPS[4]],
    removable: BACKUPS.slice(0, 4),
    protected: [],
  });

  const protectedName = BACKUPS[0];
  const protectedPlan = planUpdateBackupRetention(BACKUPS, 3, [protectedName]);
  assert.deepEqual(protectedPlan.retained, [BACKUPS[4], BACKUPS[3], protectedName]);
  assert.deepEqual(protectedPlan.removable, [BACKUPS[1], BACKUPS[2]]);
  assert.deepEqual(protectedPlan.protected, [protectedName]);

  const multipleProtected = planUpdateBackupRetention(BACKUPS, 1, BACKUPS.slice(0, 2));
  assert.deepEqual(multipleProtected.retained, BACKUPS.slice(0, 2).reverse());
  assert.deepEqual(multipleProtected.removable, BACKUPS.slice(2));
});

test("未传保留数量时实际只保留最新一份升级备份", (t) => {
  const target = createTarget(t);
  createBackups(target, BACKUPS);
  const beforeSnapshot = snapshotUpdateBackups(target);

  const result = pruneUpdateBackups(target, { beforeSnapshot });

  assert.equal(result.retention, 1);
  assert.deepEqual(result.removed, BACKUPS.slice(0, 4));
  assert.deepEqual(existingBackups(target, BACKUPS), [BACKUPS[4]]);
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
  const completeIndex = source.lastIndexOf("showCommandCompletion(");

  assert.ok(finallyIndex >= 0);
  assert.ok(restoreIndex > finallyIndex);
  assert.ok(pruneIndex > restoreIndex);
  assert.ok(completeIndex > pruneIndex);
  assert.match(source, /outcome: dryRun \? "preview" : "success"/);
});
