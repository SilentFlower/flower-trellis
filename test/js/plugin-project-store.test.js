import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PluginIoError, PluginPathError, PluginStateError } from "../../src/plugin/errors.js";
import { ProjectStore } from "../../src/plugin/state/project-store.js";

const DIGEST = `sha256:${"e".repeat(64)}`;

function createTarget(t) {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "flower-project-store-"));
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  return target;
}

function validLock() {
  return {
    schemaVersion: 1,
    roots: ["flower/sample"],
    plugins: [
      {
        id: "flower/sample",
        version: "1.0.0",
        source: { id: "flower", type: "builtin", reference: "package:sample" },
        commit: null,
        integrity: DIGEST,
        dependencies: {},
        compatibility: { flower: ">=0.5.0 <1.0.0" },
        capabilities: {
          profile: "standard",
          granted: ["content.skills"],
          denied: [],
          approvalDigest: null,
        },
      },
    ],
  };
}

function validState() {
  return {
    schemaVersion: 1,
    transactionVersion: 1,
    plugins: [
      {
        id: "flower/sample",
        version: "1.0.0",
        platforms: ["codex"],
        paths: [
          { path: ".agents/skills/sample", kind: "directory", hash: DIGEST, ownership: "exclusive" },
        ],
        patches: [],
      },
    ],
  };
}

test("Project Store 在无 Trellis 项目初始化独立 .flower 边界", (t) => {
  const target = createTarget(t);
  const store = new ProjectStore(target);
  const first = store.ensureLayout();
  assert.equal(first.status, "written");
  assert.equal(fs.existsSync(path.join(target, ".trellis")), false);
  assert.equal(fs.existsSync(path.join(target, ".flower", "cache")), true);
  assert.equal(fs.existsSync(path.join(target, ".flower", "transactions")), true);
  assert.equal(
    fs.readFileSync(path.join(target, ".flower", ".gitignore"), "utf8"),
    "state.json\ncache/\ntransactions/\ntrellis-control.json\ntrellis-detached/\n*.tmp\n",
  );
  assert.equal(store.ensureLayout().status, "unchanged");
});

test("Project Store 保留自定义 ignore 并读写三类状态", (t) => {
  const target = createTarget(t);
  fs.mkdirSync(path.join(target, ".flower"));
  fs.writeFileSync(path.join(target, ".flower", ".gitignore"), "custom/\n");
  const store = new ProjectStore(target);
  store.ensureLayout();
  const ignore = fs.readFileSync(path.join(target, ".flower", ".gitignore"), "utf8");
  assert.equal(
    ignore,
    "custom/\nstate.json\ncache/\ntransactions/\ntrellis-control.json\ntrellis-detached/\n*.tmp\n",
  );

  assert.deepEqual(store.readPlugins(), { schemaVersion: 1, plugins: [] });
  assert.equal(store.readLock(), null);
  assert.equal(store.readState(), null);

  const plugins = {
    schemaVersion: 1,
    plugins: [{ id: "flower/sample", source: "flower", version: "^1.0.0" }],
  };
  assert.equal(store.writePlugins(plugins).status, "written");
  assert.equal(store.writeLock(validLock()).status, "written");
  assert.equal(store.writeState(validState()).status, "written");
  assert.deepEqual(store.readPlugins(), plugins);
  assert.deepEqual(store.readLock(), validLock());
  assert.deepEqual(store.readState(), validState());

  const control = {
    schemaVersion: 1,
    status: "disabled",
    transactionId: "a".repeat(24),
    disabledAt: "2026-08-05T00:00:00.000Z",
    configuredPlatforms: ["codex"],
    trellisVersion: "0.6.12",
    flowerVersion: "0.6.0-beta.5",
    manifestPath: `.flower/trellis-detached/${"a".repeat(24)}/manifest.json`,
    expectedDisabled: [],
  };
  assert.equal(store.writeTrellisControl(control).status, "written");
  assert.deepEqual(store.readTrellisControl(), control);
  assert.equal(store.removeTrellisControl().status, "removed");
  assert.equal(store.readTrellisControl(), null);
});

test("相同状态重复写不修改文件 mtime", (t) => {
  const target = createTarget(t);
  const store = new ProjectStore(target);
  const lock = validLock();
  assert.equal(store.writeLock(lock).status, "written");
  const lockPath = path.join(target, ".flower", "plugin-lock.json");
  const before = fs.statSync(lockPath, { bigint: true }).mtimeNs;
  assert.equal(store.writeLock(structuredClone(lock)).status, "unchanged");
  assert.equal(fs.statSync(lockPath, { bigint: true }).mtimeNs, before);
});

test("损坏状态读取和普通写入都不会覆盖原文件", (t) => {
  const target = createTarget(t);
  const store = new ProjectStore(target);
  store.ensureLayout();
  const pluginsPath = path.join(target, ".flower", "plugins.json");
  fs.writeFileSync(pluginsPath, "{broken\n");
  assert.throws(() => store.readPlugins(), PluginStateError);
  assert.throws(() => store.writePlugins({ schemaVersion: 1, plugins: [] }), PluginStateError);
  assert.equal(fs.readFileSync(pluginsPath, "utf8"), "{broken\n");
});

test("rename 失败保留原文件并清理临时文件", (t) => {
  const target = createTarget(t);
  const store = new ProjectStore(target);
  store.writeLock(validLock());
  const lockPath = path.join(target, ".flower", "plugin-lock.json");
  const original = fs.readFileSync(lockPath, "utf8");
  const changed = validLock();
  changed.plugins[0].version = "1.1.0";

  const failingFs = Object.create(fs);
  failingFs.renameSync = () => {
    throw new Error("rename failed");
  };
  const failingStore = new ProjectStore(target, {
    fileSystem: failingFs,
    randomBytes: () => Buffer.alloc(8, 1),
  });
  assert.throws(() => failingStore.writeLock(changed), PluginIoError);
  assert.equal(fs.readFileSync(lockPath, "utf8"), original);
  assert.deepEqual(
    fs.readdirSync(path.join(target, ".flower")).filter((name) => name.endsWith(".tmp")),
    [],
  );
});

test("write 和 close 失败保留原文件并清理临时文件", (t) => {
  const target = createTarget(t);
  const store = new ProjectStore(target);
  store.writeLock(validLock());
  const lockPath = path.join(target, ".flower", "plugin-lock.json");
  const original = fs.readFileSync(lockPath, "utf8");
  const changed = validLock();
  changed.plugins[0].version = "1.1.0";

  for (const failure of ["write", "close"]) {
    const failingFs = Object.create(fs);
    if (failure === "write") {
      failingFs.writeFileSync = () => {
        throw new Error("write failed");
      };
    } else {
      let firstClose = true;
      failingFs.closeSync = (descriptor) => {
        if (firstClose) {
          firstClose = false;
          throw new Error("close failed");
        }
        return fs.closeSync(descriptor);
      };
    }
    const failingStore = new ProjectStore(target, {
      fileSystem: failingFs,
      randomBytes: () => Buffer.alloc(8, failure === "write" ? 2 : 3),
    });
    assert.throws(() => failingStore.writeLock(changed), PluginIoError);
    assert.equal(fs.readFileSync(lockPath, "utf8"), original);
    assert.deepEqual(
      fs.readdirSync(path.join(target, ".flower")).filter((name) => name.endsWith(".tmp")),
      [],
    );
  }
});

test("Project Store 拒绝项目根、.flower 和受管文件软链", (t) => {
  const outside = createTarget(t);
  const linkedRoot = path.join(os.tmpdir(), `flower-project-root-link-${process.pid}-${Date.now()}`);
  fs.symlinkSync(outside, linkedRoot, "dir");
  t.after(() => fs.rmSync(linkedRoot, { force: true }));
  assert.throws(() => new ProjectStore(linkedRoot).ensureLayout(), PluginPathError);

  const target = createTarget(t);
  fs.writeFileSync(path.join(outside, "plugins.json"), '{"schemaVersion":1,"plugins":[]}\n');
  fs.symlinkSync(outside, path.join(target, ".flower"), "dir");
  assert.throws(() => new ProjectStore(target).ensureLayout(), PluginPathError);
  assert.throws(() => new ProjectStore(target).readPlugins(), PluginPathError);

  fs.unlinkSync(path.join(target, ".flower"));
  const store = new ProjectStore(target);
  store.ensureLayout();
  fs.symlinkSync(path.join(outside, "plugins.json"), path.join(target, ".flower", "plugins.json"));
  assert.throws(() => store.readPlugins(), PluginPathError);
});
