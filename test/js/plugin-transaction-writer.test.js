import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { hashContent } from "../../src/plugin/install/content-hash.js";
import { contentMutationKey } from "../../src/plugin/install/content-projector.js";
import { createInstallPlan } from "../../src/plugin/install/install-planner.js";
import { TransactionWriter } from "../../src/plugin/install/transaction-writer.js";
import { buildPluginLock } from "../../src/plugin/resolver/lock-builder.js";
import { resolvePluginGraph } from "../../src/plugin/resolver/dependency-resolver.js";
import { PLUGIN_RUNTIME_ERROR_CODES } from "../../src/plugin/runtime-errors.js";
import { ProjectStore } from "../../src/plugin/state/project-store.js";
import { candidate, createPluginTestRoot } from "./plugin-test-helpers.js";

/**
 * 创建事务测试输入。
 *
 * @param {string} project 项目根
 * @param {string|null} beforeHash 写前摘要
 * @param {string} content 新内容
 * @param {import("../../src/plugin/contracts.js").PluginState|null} [currentState] 当前 state
 * @returns {object} 事务输入
 */
function transactionInput(project, beforeHash, content, currentState = null) {
  const pluginCandidate = candidate("flower/demo", "1.0.0");
  const resolution = resolvePluginGraph(
    [{ id: "flower/demo", source: "flower", version: "*" }],
    { listCandidates: () => [pluginCandidate] },
  );
  const mutation = {
    owner: "flower/demo",
    target: ".agents/skills/demo/SKILL.md",
    operation: "write",
    beforeHash,
    afterHash: hashContent(content),
    source: "flower/demo:skills:demo/SKILL.md",
  };
  const plan = createInstallPlan(resolution.graph, [mutation], {
    projectRoot: project,
    currentState,
  });
  const state = {
    schemaVersion: 1,
    transactionVersion: 1,
    plugins: [{
      id: "flower/demo",
      version: "1.0.0",
      platforms: ["codex"],
      paths: [{
        path: mutation.target,
        kind: "file",
        hash: mutation.afterHash,
        ownership: "exclusive",
      }],
      patches: [],
    }],
  };
  return {
    plan,
    payloads: new Map([[contentMutationKey(mutation), Buffer.from(content)]]),
    plugins: {
      schemaVersion: 1,
      plugins: [{ id: "flower/demo", source: "flower", version: "*" }],
    },
    lock: buildPluginLock(resolution.graph),
    state,
  };
}

test("Transaction Writer 在 before-hash 漂移时零写入", (t) => {
  const project = createPluginTestRoot(t);
  const input = transactionInput(project, null, "new\n");
  const target = path.join(project, ".agents/skills/demo/SKILL.md");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, "concurrent\n");
  const writer = new TransactionWriter(project, { store: new ProjectStore(project) });
  assert.throws(
    () => writer.apply(input),
    (error) => error.code === PLUGIN_RUNTIME_ERROR_CODES.TARGET_DRIFT,
  );
  assert.equal(fs.existsSync(path.join(project, ".flower")), false);
  assert.equal(fs.readFileSync(target, "utf8"), "concurrent\n");
});

test("Transaction Writer 拒绝计划后出现的父目录软链且项目外零写入", (t) => {
  const project = createPluginTestRoot(t);
  const outside = createPluginTestRoot(t, "flower-plugin-outside-");
  const input = transactionInput(project, null, "new\n");
  fs.symlinkSync(outside, path.join(project, ".agents"), "dir");
  const writer = new TransactionWriter(project, { store: new ProjectStore(project) });
  assert.throws(() => writer.apply(input));
  assert.equal(fs.existsSync(path.join(project, ".flower")), false);
  assert.equal(fs.existsSync(path.join(outside, "skills/demo/SKILL.md")), false);
});

test("Transaction Writer 按目标、plugins、lock、state 顺序写入且重复执行 changed-only", (t) => {
  const project = createPluginTestRoot(t);
  const events = [];
  const store = new ProjectStore(project);
  const firstInput = transactionInput(project, null, "new\n");
  const writer = new TransactionWriter(project, {
    store,
    onOperation(event) {
      if (event.phase === "before-write") events.push(event.kind);
    },
  });
  const first = writer.apply(firstInput);
  assert.equal(first.status, "applied");
  assert.deepEqual(events, ["target", "plugins", "lock", "state"]);

  const target = path.join(project, ".agents/skills/demo/SKILL.md");
  const lockPath = path.join(project, ".flower/plugin-lock.json");
  const statePath = path.join(project, ".flower/state.json");
  const mtimes = [target, lockPath, statePath].map((file) => fs.statSync(file, { bigint: true }).mtimeNs);
  const secondInput = transactionInput(project, hashContent("new\n"), "new\n", firstInput.state);
  const second = new TransactionWriter(project, { store }).apply(secondInput);
  assert.equal(second.status, "unchanged");
  assert.deepEqual(
    [target, lockPath, statePath].map((file) => fs.statSync(file, { bigint: true }).mtimeNs),
    mtimes,
  );
});

test("Transaction Writer 中途失败恢复目标和项目文件", (t) => {
  const project = createPluginTestRoot(t);
  const target = path.join(project, ".agents/skills/demo/SKILL.md");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, "old\n");
  const oldHash = hashContent("old\n");
  const oldState = {
    schemaVersion: 1,
    transactionVersion: 1,
    plugins: [{
      id: "flower/demo",
      version: "1.0.0",
      platforms: ["codex"],
      paths: [{ path: ".agents/skills/demo/SKILL.md", kind: "file", hash: oldHash, ownership: "exclusive" }],
      patches: [],
    }],
  };
  const store = new ProjectStore(project);
  store.writePlugins({ schemaVersion: 1, plugins: [] });
  store.writeLock({ schemaVersion: 1, roots: [], plugins: [] });
  store.writeState({ schemaVersion: 1, transactionVersion: 1, plugins: [] });
  const originalPlugins = fs.readFileSync(path.join(project, ".flower/plugins.json"), "utf8");
  const input = transactionInput(project, oldHash, "new\n", oldState);
  const writer = new TransactionWriter(project, {
    store,
    onOperation(event) {
      if (event.phase === "before-write" && event.kind === "lock") throw new Error("lock failed");
    },
  });
  assert.throws(
    () => writer.apply(input),
    (error) => error.code === PLUGIN_RUNTIME_ERROR_CODES.TRANSACTION_FAILED,
  );
  assert.equal(fs.readFileSync(target, "utf8"), "old\n");
  assert.equal(fs.readFileSync(path.join(project, ".flower/plugins.json"), "utf8"), originalPlugins);
});

test("Transaction Writer 回滚失败时保留事务证据", (t) => {
  const project = createPluginTestRoot(t);
  const target = path.join(project, ".agents/skills/demo/SKILL.md");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, "old\n");
  const oldHash = hashContent("old\n");
  const oldState = {
    schemaVersion: 1,
    transactionVersion: 1,
    plugins: [{
      id: "flower/demo",
      version: "1.0.0",
      platforms: ["codex"],
      paths: [{ path: ".agents/skills/demo/SKILL.md", kind: "file", hash: oldHash, ownership: "exclusive" }],
      patches: [],
    }],
  };
  const store = new ProjectStore(project);
  const input = transactionInput(project, oldHash, "new\n", oldState);
  const writer = new TransactionWriter(project, {
    store,
    randomBytes: () => Buffer.alloc(12, 7),
    onOperation(event) {
      if (event.phase === "before-write" && event.kind === "lock") throw new Error("lock failed");
      if (event.phase === "rollback" && event.kind === "target") throw new Error("rollback failed");
    },
  });
  assert.throws(
    () => writer.apply(input),
    (error) => error.code === PLUGIN_RUNTIME_ERROR_CODES.TRANSACTION_REPAIR_REQUIRED,
  );
  const transactions = fs.readdirSync(path.join(project, ".flower/transactions"));
  assert.equal(transactions.length, 1);
  assert.equal(fs.existsSync(path.join(project, ".flower/transactions", transactions[0], "transaction.json")), true);
});

test("Transaction Writer 初始化失败时清理局部事务并返回稳定错误码", (t) => {
  const project = createPluginTestRoot(t);
  const input = transactionInput(project, null, "new\n");
  const fileSystem = new Proxy(fs, {
    get(target, property) {
      if (property !== "mkdirSync") return Reflect.get(target, property);
      return (directory, options) => {
        if (directory.includes(`${path.sep}transactions${path.sep}`)) throw new Error("setup failed");
        return fs.mkdirSync(directory, options);
      };
    },
  });
  const writer = new TransactionWriter(project, { store: new ProjectStore(project), fileSystem });
  assert.throws(
    () => writer.apply(input),
    (error) => error.code === PLUGIN_RUNTIME_ERROR_CODES.TRANSACTION_FAILED,
  );
  assert.deepEqual(fs.readdirSync(path.join(project, ".flower/transactions")), []);
});

test("Transaction Writer 初始化后清理失败时保留证据并要求修复", (t) => {
  const project = createPluginTestRoot(t);
  const input = transactionInput(project, null, "new\n");
  const transactionId = Buffer.alloc(12, 9).toString("hex");
  const transactionRoot = path.join(project, ".flower", "transactions", transactionId);
  const fileSystem = new Proxy(fs, {
    get(target, property) {
      if (property === "mkdirSync") {
        return (directory, options) => {
          if (directory === path.join(transactionRoot, "staging")) throw new Error("staging failed");
          return fs.mkdirSync(directory, options);
        };
      }
      if (property === "rmSync") {
        return (directory, options) => {
          if (directory === transactionRoot) throw new Error("cleanup failed");
          return fs.rmSync(directory, options);
        };
      }
      return Reflect.get(target, property);
    },
  });
  const writer = new TransactionWriter(project, {
    store: new ProjectStore(project),
    fileSystem,
    randomBytes: () => Buffer.alloc(12, 9),
  });
  assert.throws(
    () => writer.apply(input),
    (error) => error.code === PLUGIN_RUNTIME_ERROR_CODES.TRANSACTION_REPAIR_REQUIRED,
  );
  assert.equal(fs.existsSync(transactionRoot), true);
});

test("Transaction Writer 成功后清理失败时返回显式保留状态", (t) => {
  const project = createPluginTestRoot(t);
  const input = transactionInput(project, null, "new\n");
  const transactionId = Buffer.alloc(12, 11).toString("hex");
  const transactionRoot = path.join(project, ".flower", "transactions", transactionId);
  const fileSystem = new Proxy(fs, {
    get(target, property) {
      if (property !== "rmSync") return Reflect.get(target, property);
      return (directory, options) => {
        if (directory === transactionRoot) throw new Error("cleanup failed");
        return fs.rmSync(directory, options);
      };
    },
  });
  const writer = new TransactionWriter(project, {
    store: new ProjectStore(project),
    fileSystem,
    randomBytes: () => Buffer.alloc(12, 11),
  });
  const result = writer.apply(input);
  assert.deepEqual(result.cleanup, {
    status: "retained",
    path: `.flower/transactions/${transactionId}`,
  });
  assert.equal(fs.existsSync(path.join(project, ".flower/state.json")), true);
  assert.equal(fs.existsSync(transactionRoot), true);
});
