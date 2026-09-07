import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { projectFlowerMetadata } from "../../src/builtin-plugins/skill-garden/project-metadata.js";
import { applyEnhancements } from "../../src/lib/apply-enhancements.js";
import { readUpdateCheck, planLegacyManifestMigration } from "../../src/lib/manifest.js";
import { createUpdateSnapshot, disposeUpdateSnapshot, extendUpdateSnapshot, restoreUpdateSnapshot } from "../../src/lib/update-transaction.js";
import { createInstallPlan } from "../../src/plugin/install/install-planner.js";
import { TransactionWriter } from "../../src/plugin/install/transaction-writer.js";
import { ProjectStore } from "../../src/plugin/state/project-store.js";
import { mergeFlowerIgnoreRules } from "../../src/plugin/state/ignore-rules.js";
import { createPluginTestRoot, writeLegacyManifest } from "./plugin-test-helpers.js";

const OWNER = "flower/skill-garden";

/** 创建隔离的历史项目。 */
function fixture(t) {
  const root = createPluginTestRoot(t, "flower-project-metadata-");
  fs.mkdirSync(path.join(root, ".trellis"));
  fs.writeFileSync(path.join(root, ".trellis/.version"), "0.5.9\n");
  fs.writeFileSync(path.join(root, ".gitignore"), "# 用户规则\r\n.flower/\r\nnode_modules/\r\n");
  writeLegacyManifest(root, { flowerVersion: "0.1.0", paths: [], updateCheck: { enabled: false, policy: "off", intervalHours: 23, lastCheckedAt: "2026-09-01T00:00:00Z", lastStatus: "offline" } });
  return root;
}

/** 用真实规划器和写入器执行元数据计划。 */
function inputFor(root) {
  const metadata = projectFlowerMetadata(root, OWNER);
  return {
    plan: createInstallPlan({ roots: [], plugins: [] }, metadata.mutations, { projectRoot: root }),
    payloads: metadata.payloads,
    plugins: { schemaVersion: 1, plugins: [] },
    lock: { schemaVersion: 1, roots: [], plugins: [] },
    state: { schemaVersion: 1, transactionVersion: 1, plugins: [] },
  };
}

/** 获取 Git 视角下未被忽略的文件。 */
function visibleFiles(root) {
  return execFileSync("git", ["-c", "core.excludesFile=/dev/null", "ls-files", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8" }).trim().split("\n");
}

test("真实 Git 的根/局部通配规则只放开共享三文件，且重复更新保持字节", (t) => {
  for (const ignore of [".flower/", "/.flower/", ".flower/*", ".*"]) {
    for (const eol of ["\n", "\r\n"]) {
      const root = fixture(t);
      execFileSync("git", ["init", "-q"], { cwd: root });
      const original = ["# 用户规则", ignore, "node_modules/", ""].join(eol);
      fs.writeFileSync(path.join(root, ".gitignore"), original);
      fs.mkdirSync(path.join(root, ".flower"));
      fs.writeFileSync(path.join(root, ".flower/.gitignore"), `# 局部规则${eol}*${eol}`);
      const writer = new TransactionWriter(root, { store: new ProjectStore(root) });
      writer.apply(inputFor(root));
      fs.writeFileSync(path.join(root, ".flower/private-secret.txt"), "local\n");
      const visible = visibleFiles(root).filter((file) => file.startsWith(".flower/"));
      assert.deepEqual(visible.sort(), [".flower/.gitignore", ".flower/plugin-lock.json", ".flower/plugins.json"]);
      const rootText = fs.readFileSync(path.join(root, ".gitignore"), "utf8");
      const localText = fs.readFileSync(path.join(root, ".flower/.gitignore"), "utf8");
      assert.ok(rootText.startsWith(original));
      assert.equal(rootText.replaceAll(eol, "").includes("\n"), false);
      assert.equal(writer.apply(inputFor(root)).status, "unchanged");
      assert.equal(fs.readFileSync(path.join(root, ".gitignore"), "utf8"), rootText);
      assert.equal(fs.readFileSync(path.join(root, ".flower/.gitignore"), "utf8"), localText);
    }
  }
});

test("无根 gitignore 不新建，原标记后追加的规则可重排且歧义标记拒绝", (t) => {
  const root = fixture(t);
  fs.unlinkSync(path.join(root, ".gitignore"));
  new TransactionWriter(root, { store: new ProjectStore(root) }).apply(inputFor(root));
  assert.equal(fs.existsSync(path.join(root, ".gitignore")), false);
  const first = mergeFlowerIgnoreRules("# 前言\n", { root: true });
  const moved = mergeFlowerIgnoreRules(`${first}.flower/\n`, { root: true });
  assert.ok(moved.startsWith("# 前言\n.flower/\n"));
  assert.equal(mergeFlowerIgnoreRules(moved, { root: true }), moved);
  for (const invalid of ["# BEGIN Flower shared records\n", first + first, "# END Flower shared records\n"]) {
    assert.throws(() => mergeFlowerIgnoreRules(invalid), /标记/);
  }
});

test("真实 Skill-Garden 迁移保存配置、删除旧文件且不独占用户元数据", (t) => {
  const root = fixture(t);
  fs.mkdirSync(path.join(root, ".claude/skills"), { recursive: true });
  const originalLog = console.log;
  console.log = () => {};
  try {
    const result = applyEnhancements(root, { variant: "0.5", skills: ["trellis-route"] });
    assert.equal(result.runtime.transaction.status, "applied");
  } finally {
    console.log = originalLog;
  }
  const config = readUpdateCheck(root);
  assert.equal(config.policy, "off");
  assert.equal(config.enabled, false);
  assert.equal(config.intervalHours, 23);
  assert.equal(config.lastStatus, "offline");
  assert.equal(fs.existsSync(path.join(root, ".trellis/.flower-manifest.json")), false);
  const state = new ProjectStore(root).readState();
  assert.equal(state.migration.source, "legacy-flower-manifest");
  assert.ok(state.plugins.every((plugin) => plugin.paths.every((entry) => !entry.path.startsWith(".flower/") && entry.path !== ".gitignore")));
});

test("现代设置与缓存原字节优先，旧 tmp 缓存也可迁入", (t) => {
  const root = fixture(t);
  fs.mkdirSync(path.join(root, ".flower"));
  const settings = '{"schemaVersion":1,"updateCheck":{"policy":"notify","enabled":true,"intervalHours":2},"other":"保留"}\n';
  const cache = '{"lastStatus":"up_to_date"}\n';
  fs.writeFileSync(path.join(root, ".flower/settings.json"), settings);
  fs.writeFileSync(path.join(root, ".flower/update-check.tmp"), cache);
  new TransactionWriter(root, { store: new ProjectStore(root) }).apply(inputFor(root));
  assert.equal(fs.readFileSync(path.join(root, ".flower/settings.json"), "utf8"), settings);
  assert.equal(fs.readFileSync(path.join(root, ".flower/update-check.tmp"), "utf8"), cache);
  const old = fixture(t);
  fs.writeFileSync(path.join(old, ".trellis/.flower-update-check.tmp"), '{"lastStatus":"skipped"}');
  new TransactionWriter(old, { store: new ProjectStore(old) }).apply(inputFor(old));
  assert.equal(readUpdateCheck(old).lastStatus, "skipped");
});

test("损坏配置或软链在迁移前失败，保留旧清单", (t) => {
  for (const name of ["settings.json", "update-check.tmp"]) {
    const root = fixture(t);
    fs.mkdirSync(path.join(root, ".flower"));
    fs.writeFileSync(path.join(root, ".flower", name), "{broken");
    assert.throws(() => inputFor(root), /损坏/);
    assert.ok(fs.existsSync(path.join(root, ".trellis/.flower-manifest.json")));
  }
  const root = fixture(t);
  const outside = fixture(t);
  fs.unlinkSync(path.join(root, ".trellis/.flower-manifest.json"));
  fs.symlinkSync(path.join(outside, ".trellis/.flower-manifest.json"), path.join(root, ".trellis/.flower-manifest.json"));
  assert.throws(() => planLegacyManifestMigration(root), /损坏/);
});

test("dry-run 零写入，目标/lock/state 失败恢复忽略规则与旧配置", (t) => {
  for (const failAt of ["target", "lock", "state"]) {
    const root = fixture(t);
    fs.mkdirSync(path.join(root, ".flower"));
    const ignore = "# 本机规则\r\n*.local\r\n";
    fs.writeFileSync(path.join(root, ".flower/.gitignore"), ignore);
    const beforeRoot = fs.readFileSync(path.join(root, ".gitignore"), "utf8");
    const beforeLegacy = fs.readFileSync(path.join(root, ".trellis/.flower-manifest.json"), "utf8");
    const writer = new TransactionWriter(root, { store: new ProjectStore(root), onOperation(event) {
      if (event.phase === "before-write" && event.kind === failAt) throw new Error("注入失败");
    } });
    assert.equal(writer.apply({ ...inputFor(root), dryRun: true }).status, "dry-run");
    assert.equal(fs.readdirSync(path.join(root, ".flower")).length, 1);
    assert.throws(() => writer.apply(inputFor(root)), /已恢复原状态/);
    assert.equal(fs.readFileSync(path.join(root, ".gitignore"), "utf8"), beforeRoot);
    assert.equal(fs.readFileSync(path.join(root, ".flower/.gitignore"), "utf8"), ignore);
    assert.equal(fs.readFileSync(path.join(root, ".trellis/.flower-manifest.json"), "utf8"), beforeLegacy);
    for (const file of ["settings.json", "update-check.tmp", "plugins.json", "plugin-lock.json", "state.json"]) {
      assert.equal(fs.existsSync(path.join(root, ".flower", file)), false, file);
    }
  }
});

test("局部忽略回滚失败时留存原始字节证据", (t) => {
  const root = fixture(t);
  fs.mkdirSync(path.join(root, ".flower"));
  fs.writeFileSync(path.join(root, ".flower/.gitignore"), "# original\n");
  const writer = new TransactionWriter(root, { store: new ProjectStore(root), onOperation(event) {
    if ((event.phase === "before-write" && event.kind === "state") || (event.phase === "rollback" && event.kind === "layout")) throw new Error("注入失败");
  } });
  assert.throws(() => writer.apply(inputFor(root)), (error) => {
    assert.equal(error.code, "PLUGIN_TRANSACTION_REPAIR_REQUIRED");
    assert.equal(fs.readFileSync(path.join(error.path, "backup/layout-ignore.bin"), "utf8"), "# original\n");
    return true;
  });
});

test("上游 update 补偿覆盖计划新增根规则和迁移删除", (t) => {
  const root = fixture(t);
  const snapshot = createUpdateSnapshot(root);
  t.after(() => disposeUpdateSnapshot(snapshot));
  const before = fs.readFileSync(path.join(root, ".gitignore"), "utf8");
  const input = inputFor(root);
  extendUpdateSnapshot(snapshot, input.plan.contentMutations.map(({ target }) => target));
  new TransactionWriter(root, { store: new ProjectStore(root) }).apply(input);
  const recovery = restoreUpdateSnapshot(snapshot);
  assert.equal(recovery.ok, true, JSON.stringify(recovery));
  assert.equal(fs.readFileSync(path.join(root, ".gitignore"), "utf8"), before);
  assert.ok(fs.existsSync(path.join(root, ".trellis/.flower-manifest.json")));
  assert.equal(fs.existsSync(path.join(root, ".flower")), false);
});
