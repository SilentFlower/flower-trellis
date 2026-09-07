import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { ProjectStore } from "../../src/plugin/state/project-store.js";
import { hashDirectoryIfExists, hashFileIfExists } from "../../src/plugin/install/content-hash.js";
import { flowerVersion } from "../../src/lib/versions.js";
import { buildSelfCheck } from "../../src/lib/self-check.js";
import {
  applyFlowerTransfer,
  inspectWorktreeFlower,
  planFlowerTransfer,
  rollbackFlowerTransfer,
} from "../../src/lib/worktree-flower-state.js";
import { createPluginTestRoot } from "./plugin-test-helpers.js";

/** 创建安装内容已提交、安装记录被忽略的真实 linked worktree。 */
function fixture(t) {
  const root = createPluginTestRoot(t, "flower-worktree-state-");
  const source = path.join(root, "main");
  const target = path.join(root, "linked");
  fs.mkdirSync(source);
  const git = (...args) => execFileSync("git", ["-C", source, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git("init");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "Test");
  fs.mkdirSync(path.join(source, ".trellis"));
  fs.writeFileSync(path.join(source, ".gitignore"), ".flower/\n");
  fs.writeFileSync(path.join(source, ".trellis/.version"), "0.6.14\n");
  fs.writeFileSync(path.join(source, "managed.md"), "已安装内容\n");
  git("add", ".");
  git("commit", "-m", "fixture");
  git("worktree", "add", "-b", "linked", target);
  const store = new ProjectStore(source);
  store.writePlugins({ schemaVersion: 1, plugins: [{ id: "flower/skill-garden", source: "flower", version: flowerVersion(), platforms: ["codex"] }] });
  store.writeLock({
    schemaVersion: 1,
    roots: ["flower/skill-garden"],
    plugins: [{
      id: "flower/skill-garden", version: flowerVersion(),
      source: { id: "flower", type: "builtin", reference: "package:skill-garden" },
      commit: null, integrity: `sha256:${"a".repeat(64)}`, dependencies: {},
      compatibility: { flower: ">=0.5.0" },
      capabilities: { profile: "standard", granted: ["content.skills"], denied: [], approvalDigest: null },
    }],
  });
  store.writeState({
    schemaVersion: 1, transactionVersion: 1,
    plugins: [{
      id: "flower/skill-garden", version: flowerVersion(), platforms: ["codex"],
      paths: [{ path: "managed.md", kind: "file", hash: hashFileIfExists(path.join(source, "managed.md")), ownership: "exclusive" }], patches: [],
    }],
  });
  return { root, source, target, store, git, sourceDeveloper: "tester", targetDeveloper: "tester" };
}

test("忽略 .flower 的 linked worktree 可以离线继承，记录独立且重复执行无变化", async (t) => {
  const f = fixture(t);
  const plan = planFlowerTransfer(f);
  assert.equal(plan.action, "inherited");
  assert.equal(fs.existsSync(path.join(f.target, ".flower")), false);
  const applied = applyFlowerTransfer({ ...f, expectedDigest: plan.digest });
  assert.equal(applied.action, "inherited");
  assert.equal(inspectWorktreeFlower(f.target).installation, "complete");
  assert.equal(planFlowerTransfer(f).action, "preserved");
  const result = await buildSelfCheck(f.target, {
    writeCache: false, forceRemote: true,
    fetchMetadata: async () => ({ tags: { latest: flowerVersion(), beta: null }, releaseNotesByVersion: {} }),
  });
  assert.equal(result.project.flowerVersion, flowerVersion());
  assert.equal(result.status, "up_to_date");
  fs.writeFileSync(path.join(f.target, ".flower/state.json"), "目标修改\n");
  assert.equal(f.store.readState().plugins[0].version, flowerVersion());
  assert.equal(fs.existsSync(path.join(f.target, ".flower/transactions")), false);
});

test("目标内容漂移或已有 lock 冲突时，继承不留下部分记录", (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.target, "managed.md"), "目标分支内容\n");
  assert.throws(() => planFlowerTransfer(f), /摘要漂移/);
  assert.equal(fs.existsSync(path.join(f.target, ".flower")), false);
  fs.copyFileSync(path.join(f.source, "managed.md"), path.join(f.target, "managed.md"));
  const targetStore = new ProjectStore(f.target);
  const lock = f.store.readLock();
  lock.plugins[0].version = "0.1.0";
  targetStore.writeLock(lock);
  const before = fs.readFileSync(path.join(f.target, ".flower/plugin-lock.json"));
  assert.throws(() => planFlowerTransfer(f), /冲突/);
  assert.deepEqual(fs.readFileSync(path.join(f.target, ".flower/plugin-lock.json")), before);
  assert.equal(fs.existsSync(path.join(f.target, ".flower/state.json")), false);
});

test("来源改变后拒绝旧摘要，写入失败按回执清理", (t) => {
  const f = fixture(t);
  const plan = planFlowerTransfer(f);
  fs.appendFileSync(path.join(f.source, ".flower/plugin-lock.json"), "\n");
  assert.throws(() => applyFlowerTransfer({ ...f, expectedDigest: plan.digest }), /计划已变化/);
  assert.equal(fs.existsSync(path.join(f.target, ".flower")), false);
  assert.throws(() => applyFlowerTransfer({ ...f, onWrite: () => { throw new Error("注入失败"); } }), /注入失败/);
  assert.equal(fs.existsSync(path.join(f.target, ".flower")), false);
  const applied = applyFlowerTransfer(f);
  rollbackFlowerTransfer(f.target, applied.receipt);
  assert.equal(fs.existsSync(path.join(f.target, ".flower")), false);
});

test("跨仓、受管祖先软链接和损坏 state 被拒绝", (t) => {
  const f = fixture(t);
  const other = fixture(t);
  assert.throws(() => planFlowerTransfer({ ...f, source: other.source }), /同一 Git/);
  const state = f.store.readState();
  fs.mkdirSync(path.join(f.source, "content"));
  fs.copyFileSync(path.join(f.source, "managed.md"), path.join(f.source, "content/managed.md"));
  state.plugins[0].paths[0].path = "content/managed.md";
  f.store.writeState(state);
  fs.symlinkSync(path.join(f.source, "content"), path.join(f.target, "content"), "dir");
  assert.throws(() => planFlowerTransfer(f), /软链/);
  fs.writeFileSync(path.join(f.source, ".flower/state.json"), "{");
  assert.throws(() => planFlowerTransfer(f), /JSON|状态/);
});

test("同开发者只继承规范化设置，缓存、事务和备份不被复制", (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.source, ".flower/settings.json"), JSON.stringify({ schemaVersion: 1, updateCheck: { enabled: false, policy: "off", intervalHours: 12, lastRemote: { latest: "99.0.0" } } }));
  fs.writeFileSync(path.join(f.source, ".flower/update-check.tmp"), "来源缓存\n");
  fs.writeFileSync(path.join(f.source, ".flower/transactions/source.json"), "来源事务\n");
  applyFlowerTransfer(f);
  const settings = JSON.parse(fs.readFileSync(path.join(f.target, ".flower/settings.json"), "utf8"));
  assert.deepEqual(settings, { schemaVersion: 1, updateCheck: { enabled: false, policy: "off", intervalHours: 12 } });
  assert.equal(fs.existsSync(path.join(f.target, ".flower/update-check.tmp")), false);
  assert.equal(fs.existsSync(path.join(f.target, ".flower/transactions")), false);
  const other = fixture(t);
  fs.copyFileSync(path.join(f.source, ".flower/settings.json"), path.join(other.source, ".flower/settings.json"));
  applyFlowerTransfer({ ...other, targetDeveloper: "another" });
  assert.equal(fs.existsSync(path.join(other.target, ".flower/settings.json")), false);
});

test("源记录缺失不写半套，控制状态和安装集合冲突明确阻断", (t) => {
  const f = fixture(t);
  const statePath = path.join(f.source, ".flower/state.json");
  const state = fs.readFileSync(statePath);
  fs.unlinkSync(statePath);
  assert.equal(planFlowerTransfer(f).action, "unavailable");
  assert.equal(applyFlowerTransfer(f).action, "unavailable");
  assert.equal(fs.existsSync(path.join(f.target, ".flower")), false);
  fs.writeFileSync(statePath, state);
  fs.writeFileSync(path.join(f.source, ".flower/trellis-control.json"), "{}");
  assert.throws(() => planFlowerTransfer(f), /禁用/);
  fs.unlinkSync(path.join(f.source, ".flower/trellis-control.json"));
  const value = f.store.readState();
  value.plugins = [];
  f.store.writeState(value);
  assert.throws(() => planFlowerTransfer(f), /插件集合冲突/);
});

test("回滚保留用户随后修改的目标状态并报告冲突", (t) => {
  const f = fixture(t);
  const applied = applyFlowerTransfer(f);
  const file = path.join(f.target, ".flower/state.json");
  fs.writeFileSync(file, "用户新内容\n");
  assert.throws(() => rollbackFlowerTransfer(f.target, applied.receipt), /其它操作修改/);
  assert.equal(fs.readFileSync(file, "utf8"), "用户新内容\n");
});

test("目录和 Patch 摘要必须匹配，Python 缓存不构成安装漂移", (t) => {
  const f = fixture(t);
  for (const root of [f.source, f.target]) {
    fs.mkdirSync(path.join(root, "content"));
    fs.writeFileSync(path.join(root, "content/skill.md"), "相同内容\n");
  }
  fs.mkdirSync(path.join(f.source, "content/__pycache__"));
  fs.writeFileSync(path.join(f.source, "content/__pycache__/runtime.pyc"), "缓存\n");
  const state = f.store.readState();
  state.plugins[0].paths = [{ path: "content", kind: "directory", hash: hashDirectoryIfExists(path.join(f.source, "content")), ownership: "exclusive" }];
  state.plugins[0].patches = [{ operation: "sample-patch", target: "managed.md", resultHash: hashFileIfExists(path.join(f.source, "managed.md")) }];
  f.store.writeState(state);
  assert.equal(planFlowerTransfer(f).action, "inherited");
  fs.writeFileSync(path.join(f.target, "managed.md"), "Patch 漂移\n");
  assert.throws(() => planFlowerTransfer(f), /Patch 目标摘要漂移/);
  fs.copyFileSync(path.join(f.source, "managed.md"), path.join(f.target, "managed.md"));
  fs.writeFileSync(path.join(f.target, "content/skill.md"), "目录漂移\n");
  assert.throws(() => planFlowerTransfer(f), /目标摘要漂移/);
});

test("目标 Trellis 兼容范围、本地来源及既有忽略策略必须有效", (t) => {
  const f = fixture(t);
  const lock = f.store.readLock();
  lock.plugins[0].compatibility.trellis = ">=0.6.0";
  f.store.writeLock(lock);
  fs.writeFileSync(path.join(f.target, ".trellis/.version"), "0.5.0\n");
  assert.throws(() => planFlowerTransfer(f), /兼容范围/);
  fs.writeFileSync(path.join(f.target, ".trellis/.version"), "0.6.14\n");
  lock.plugins[0].source = { id: "flower", type: "local", reference: "local-plugin" };
  f.store.writeLock(lock);
  for (const root of [f.source, f.target]) {
    fs.mkdirSync(path.join(root, "local-plugin"));
    fs.writeFileSync(path.join(root, "local-plugin/content.md"), "来源内容\n");
  }
  assert.equal(planFlowerTransfer(f).action, "inherited");
  fs.writeFileSync(path.join(f.target, "local-plugin/content.md"), "其它来源\n");
  assert.throws(() => planFlowerTransfer(f), /来源内容冲突/);
  fs.copyFileSync(path.join(f.source, "local-plugin/content.md"), path.join(f.target, "local-plugin/content.md"));
  fs.mkdirSync(path.join(f.target, ".flower"));
  fs.writeFileSync(path.join(f.target, ".flower/.gitignore"), "cache/\n");
  fs.writeFileSync(path.join(f.target, ".gitignore"), "");
  assert.throws(() => planFlowerTransfer(f), /忽略规则/);
});
