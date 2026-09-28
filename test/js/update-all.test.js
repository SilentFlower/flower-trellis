import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { updateAll } from "../../src/commands/update-all.js";
import { parseCliArgs } from "../../src/lib/cli-args.js";
import { discoverFlowerProjects } from "../../src/lib/update-all-projects.js";
import { flowerVersion, trellisVersion } from "../../src/lib/versions.js";
import { writeLegacyManifest } from "./plugin-test-helpers.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CLI = path.join(ROOT, "bin", "flower-trellis.js");

function projectManifest(version) {
  return {
    flowerVersion: version,
    variant: "0.6",
    version: trellisVersion(),
    skills: [],
    paths: [],
    updateCheck: { enabled: true, policy: "ask", intervalHours: 8 },
  };
}

function createRoot(t, names, version = "0.0.1") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "flower-update-all-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const name of names) {
    const target = path.join(root, name);
    fs.mkdirSync(path.join(target, ".trellis"), { recursive: true });
    fs.writeFileSync(path.join(target, ".trellis", ".version"), `${trellisVersion()}\n`);
    writeLegacyManifest(target, projectManifest(version));
  }
  return root;
}

function commitRoot(root) {
  execFileSync("git", ["init", "-q", root]);
  execFileSync("git", ["add", "-A"], { cwd: root });
  execFileSync("git", ["-c", "user.name=Flower Test", "-c", "user.email=flower@example.test", "commit", "-qm", "fixture"], { cwd: root });
}

function setProjectVersion(target, version, trellis = trellisVersion()) {
  writeLegacyManifest(target, projectManifest(version));
  fs.writeFileSync(path.join(target, ".trellis", ".version"), `${trellis}\n`);
}

function commandContext(args) {
  return parseCliArgs(["update-all", ...args]).ctx;
}

test("重复 root/target 可组合发现并按真实路径去重，跳过内部目录和目录链接", (t) => {
  const root = createRoot(t, ["group/a", "group/b", "outside"]);
  const group = path.join(root, "group");
  const outside = path.join(root, "outside");
  fs.mkdirSync(path.join(group, "node_modules", "hidden", ".trellis"), { recursive: true });
  writeLegacyManifest(path.join(group, "node_modules", "hidden"), projectManifest("0.0.1"));
  try {
    fs.symlinkSync(outside, path.join(group, "linked"), "junction");
  } catch (error) {
    if (!["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) throw error;
  }
  const found = discoverFlowerProjects([group, group], [outside, path.join(group, "a"), path.join(root, "missing")]);
  assert.deepEqual(found.projects, [path.join(group, "a"), path.join(group, "b"), outside].sort());
  assert.equal(found.errors.length, 1);
  assert.match(found.errors[0].reason, /无法读取目录/);
});

test("现代 Plugin lock 可被发现，损坏版本证据不会进入更新队列", async (t) => {
  const root = createRoot(t, ["modern"]);
  const target = path.join(root, "modern");
  fs.unlinkSync(path.join(target, ".trellis", ".flower-manifest.json"));
  fs.mkdirSync(path.join(target, ".flower"));
  fs.writeFileSync(path.join(target, ".flower", "plugin-lock.json"), "{}\n");
  commitRoot(root);
  assert.deepEqual(discoverFlowerProjects([root], []).projects, [target]);
  const logs = [];
  const code = await updateAll(commandContext(["--target", target, "--dry-run", "--no-update-check"]), {
    log: (line) => logs.push(line),
  });
  assert.equal(code, 1);
  assert.match(logs.join("\n"), /读取项目版本失败\(Plugin 状态 schema 无效:plugin-lock\.json\)/);
});

test("现代 lock 损坏但旧 manifest 有版本时只跳过该项目", async (t) => {
  const root = createRoot(t, ["a", "b"]);
  const broken = path.join(root, "a");
  fs.mkdirSync(path.join(broken, ".flower"));
  fs.writeFileSync(path.join(broken, ".flower", "plugin-lock.json"), "{}\n");
  commitRoot(root);
  const updated = [];
  const logs = [];
  const code = await updateAll(commandContext(["--root", root, "--yes", "--no-update-check"]), {
    inspectCli: () => ({ flower: flowerVersion(), trellis: trellisVersion() }),
    updateProject: (target) => { updated.push(path.basename(target)); setProjectVersion(target, flowerVersion()); return { status: 0 }; },
    log: (line) => logs.push(line),
  });
  assert.equal(code, 1);
  assert.deepEqual(updated, ["b"]);
  assert.match(logs.join("\n"), /读取项目版本失败/);
  assert.match(logs.join("\n"), /已更新 1，已是最新版 0，跳过 1，失败 0/);
});

test("更新后 lock 损坏时记失败并继续其它项目", async (t) => {
  const root = createRoot(t, ["a", "b"]);
  commitRoot(root);
  const updated = [];
  const logs = [];
  const code = await updateAll(commandContext(["--root", root, "--yes", "--no-update-check"]), {
    inspectCli: () => ({ flower: flowerVersion(), trellis: trellisVersion() }),
    updateProject: (target) => {
      updated.push(path.basename(target));
      setProjectVersion(target, flowerVersion());
      if (path.basename(target) === "a") {
        fs.mkdirSync(path.join(target, ".flower"));
        fs.writeFileSync(path.join(target, ".flower", "plugin-lock.json"), "{}\n");
      }
      return { status: 0 };
    },
    log: (line) => logs.push(line),
  });
  assert.equal(code, 1);
  assert.deepEqual(updated, ["a", "b"]);
  assert.match(logs.join("\n"), /项目更新失败\(Plugin 状态 schema 无效:plugin-lock\.json\)/);
  assert.match(logs.join("\n"), /已更新 1，已是最新版 0，跳过 0，失败 1/);
});

test("任务状态损坏或未知时保守跳过，健康项目仍继续", async (t) => {
  const root = createRoot(t, ["a", "b", "c", "d"]);
  for (const [name, content] of [["a", "{\n"], ["b", '{"status":"unexpected"}\n'], ["c", '{"status":"pending"}\n']]) {
    const directory = path.join(root, name, ".trellis", "tasks", "one");
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, "task.json"), content);
  }
  commitRoot(root);
  const updated = [];
  const logs = [];
  const code = await updateAll(commandContext(["--root", root, "--yes", "--no-update-check"]), {
    inspectCli: () => ({ flower: flowerVersion(), trellis: trellisVersion() }),
    updateProject: (target) => { updated.push(path.basename(target)); setProjectVersion(target, flowerVersion()); return { status: 0 }; },
    log: (line) => logs.push(line),
  });
  assert.equal(code, 1);
  assert.deepEqual(updated, ["d"]);
  assert.match(logs.join("\n"), /任务记录损坏或不可读/);
  assert.match(logs.join("\n"), /任务记录状态无法确认/);
  assert.match(logs.join("\n"), /已更新 1，已是最新版 0，跳过 3，失败 0/);
});

test(".trellis 软链接在发现阶段拒绝且仍扫描健康子项目", (t) => {
  const root = createRoot(t, ["a", "a/nested", "b"]);
  const linked = path.join(root, "a", ".trellis");
  const backing = path.join(root, "trellis-backing");
  fs.renameSync(linked, backing);
  try {
    fs.symlinkSync(backing, linked, "junction");
  } catch (error) {
    if (!["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) throw error;
    t.skip(`当前平台不允许创建目录链接:${error.code}`);
    return;
  }
  const found = discoverFlowerProjects([root], [path.join(root, "a")]);
  assert.deepEqual(found.projects, [path.join(root, "a", "nested"), path.join(root, "b")]);
  assert.ok(found.errors.some(({ target, reason }) => target === path.join(root, "a") && reason.includes(".trellis 是软链接")));
});

test("update-all 重复目标参数独立收集，单项目命令保留最后一个 target", () => {
  const batch = commandContext(["--root", "one", "--root", "two", "--target", "three", "--target", "four", "--dry-run"]);
  assert.deepEqual(batch.roots, [path.resolve("one"), path.resolve("two")]);
  assert.deepEqual(batch.targets, [path.resolve("three"), path.resolve("four")]);
  assert.equal(batch.target, path.resolve("four"));
  const single = parseCliArgs(["self-update", "--target", "one", "--target", "two"]).ctx;
  assert.equal(single.target, path.resolve("two"));
  assert.deepEqual(single.targets, []);
  assert.deepEqual(commandContext(["--target", "--dry-run"]).targets, [null]);
});

test("dry-run 只读预览，离线时展示本机目标版本且不写缓存", async (t) => {
  const root = createRoot(t, ["group/a", "outside"]);
  commitRoot(root);
  const logs = [];
  let installs = 0;
  let updates = 0;
  const code = await updateAll(commandContext(["--root", path.join(root, "group"), "--target", path.join(root, "outside"), "--no-update-check", "--dry-run"]), {
    fetchTags: () => assert.fail("已禁用远端检查"),
    install: () => { installs += 1; return { status: 0 }; },
    updateProject: () => { updates += 1; return { status: 0 }; },
    log: (line) => logs.push(line),
  });
  assert.equal(code, 0);
  assert.equal(installs, 0);
  assert.equal(updates, 0);
  assert.equal(logs.filter((line) => line.includes("待更新:")).length, 2);
  assert.match(logs.join("\n"), /远端版本: 未确认，仅使用本机版本/);
  assert.equal(fs.existsSync(path.join(root, "group", "a", ".flower")), false);
  assert.equal(fs.existsSync(path.join(root, "outside", ".flower")), false);
  assert.equal(execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }), "");
});

test("全局安装只执行一次，同仓多个项目失败后仍继续并逐项汇总", async (t) => {
  const root = createRoot(t, ["a", "b", "c"]);
  commitRoot(root);
  const logs = [];
  const calls = [];
  const code = await updateAll(commandContext(["--root", root, "--yes"]), {
    fetchTags: async () => ({ latest: "99.0.0", beta: null }),
    install: (version) => { calls.push(`install:${version}`); return { status: 0 }; },
    inspectCli: () => ({ flower: "99.0.0", trellis: trellisVersion() }),
    updateProject: (target) => {
      calls.push(path.basename(target));
      if (path.basename(target) === "b") return { status: 7 };
      setProjectVersion(target, "99.0.0");
      return { status: 0 };
    },
    log: (line) => logs.push(line),
  });
  assert.equal(code, 1);
  assert.deepEqual(calls, ["install:99.0.0", "a", "b", "c"]);
  assert.match(logs.join("\n"), /已更新 2，已是最新版 0，跳过 0，失败 1/);
  assert.match(logs.join("\n"), /post_action: run_trellis_push_confirmation/);
  assert.match(logs.join("\n"), /status: partial/);
});

test("远端失败仅追平本机版本，全局安装失败或版本核对失败均阻断项目写入", async (t) => {
  const root = createRoot(t, ["a", "b"]);
  commitRoot(root);
  const logs = [];
  const updated = [];
  const offlineCode = await updateAll(commandContext(["--root", root, "--yes"]), {
    fetchTags: async () => null,
    install: () => assert.fail("离线不应安装全局 CLI"),
    inspectCli: () => ({ flower: flowerVersion(), trellis: trellisVersion() }),
    updateProject: (target) => { updated.push(target); setProjectVersion(target, flowerVersion()); return { status: 0 }; },
    log: (line) => logs.push(line),
  });
  assert.equal(offlineCode, 0);
  assert.equal(updated.length, 2);
  assert.match(logs.join("\n"), /远端版本: 未确认/);

  setProjectVersion(path.join(root, "a"), "0.0.1");
  commitRoot(root);
  let updateCalls = 0;
  for (const options of [
    { install: () => ({ status: 5 }), inspectCli: () => assert.fail("安装失败后不能核对") },
    { install: () => ({ status: 0 }), inspectCli: () => ({ flower: "0.0.1", trellis: trellisVersion() }) },
  ]) {
    const result = await updateAll(commandContext(["--root", root, "--yes"]), {
      fetchTags: async () => ({ latest: "99.0.0", beta: null }),
      ...options,
      updateProject: () => { updateCalls += 1; return { status: 0 }; },
      log: () => {},
    });
    assert.equal(result, 1);
  }
  assert.equal(updateCalls, 0);
});

test("本机版本较旧时不降级，子命令未追平版本则记失败并继续", async (t) => {
  const newerRoot = createRoot(t, ["newer"], "99.0.0");
  commitRoot(newerRoot);
  const root = createRoot(t, ["a", "b"]);
  commitRoot(root);
  const logs = [];
  const updated = [];
  const code = await updateAll(commandContext(["--target", path.join(newerRoot, "newer"), "--root", root, "--yes", "--no-update-check"]), {
    inspectCli: () => ({ flower: flowerVersion(), trellis: trellisVersion() }),
    updateProject: (target) => {
      updated.push(path.basename(target));
      if (path.basename(target) === "b") setProjectVersion(target, flowerVersion());
      return { status: 0 };
    },
    log: (line) => logs.push(line),
  });
  assert.equal(code, 1);
  assert.deepEqual(updated, ["a", "b"]);
  assert.match(logs.join("\n"), /flower 项目版本高于目标版本/);
  assert.match(logs.join("\n"), /更新后版本未追平/);
  assert.match(logs.join("\n"), /已更新 1，已是最新版 0，跳过 1，失败 1/);
});

test("脏工作区、活动任务、无效目标和空扫描分别报告原因", async (t) => {
  const dirtyRoot = createRoot(t, ["dirty"]);
  commitRoot(dirtyRoot);
  fs.writeFileSync(path.join(dirtyRoot, "dirty", ".trellis", ".version"), "0.0.1\n");
  const activeRoot = createRoot(t, ["active"]);
  fs.mkdirSync(path.join(activeRoot, "active", ".trellis", "tasks", "one"), { recursive: true });
  fs.writeFileSync(path.join(activeRoot, "active", ".trellis", "tasks", "one", "task.json"), '{"status":"in_progress"}\n');
  commitRoot(activeRoot);
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "flower-update-all-empty-"));
  t.after(() => fs.rmSync(empty, { recursive: true, force: true }));
  const logs = [];
  const code = await updateAll(commandContext(["--target", path.join(dirtyRoot, "dirty"), "--target", path.join(activeRoot, "active"), "--target", path.join(empty, "missing"), "--dry-run", "--no-update-check"]), {
    log: (line) => logs.push(line),
  });
  assert.equal(code, 1);
  assert.match(logs.join("\n"), /Git 工作区有 1 项变动/);
  assert.match(logs.join("\n"), /存在活动 Trellis 任务/);
  assert.match(logs.join("\n"), /无法读取目录/);
  const emptyLogs = [];
  assert.equal(await updateAll(commandContext(["--root", empty, "--dry-run", "--no-update-check"]), { log: (line) => emptyLogs.push(line) }), 1);
  assert.match(emptyLogs.join("\n"), /未发现已安装 Flower 的项目/);
});

test("真实执行缺少 --yes 立即拒绝，CLI dry-run 在项目外运行且不写入", async (t) => {
  const root = createRoot(t, ["project"]);
  commitRoot(root);
  await assert.rejects(updateAll(commandContext(["--target", path.join(root, "project")]), {
    fetchTags: () => assert.fail("缺少确认时不得查询远端"),
  }), /需要 --yes/);
  const result = spawnSync(process.execPath, [CLI, "update-all", "--target", path.join(root, "project"), "--dry-run", "--no-update-check"], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, FLOWER_NO_TELEMETRY: "1" },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /待更新:/);
  assert.equal(execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }), "");
});
