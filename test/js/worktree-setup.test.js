import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { runFlower } from "./plugin-e2e-helpers.js";
import { createPluginTestRoot } from "./plugin-test-helpers.js";
import {
  prepareWorktreeFlower,
  inspectWorktreeFlower,
} from "../../src/lib/worktree-flower-state.js";

/**
 * 创建真实安装的来源及缺少本地配置、state 的 linked worktree。
 * @param {import("node:test").TestContext} t 测试上下文
 * @param {boolean} [projectConfig] 是否加入项目自有配置
 * @returns {object} 来源、目标、Git 调用与基线
 */
function fixture(t, projectConfig = false) {
  const root = createPluginTestRoot(t, "flower-target-setup-");
  const source = path.join(root, "source");
  const target = path.join(root, "target");
  fs.mkdirSync(source);
  const git = (...args) => execFileSync("git", ["-C", source, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git("init");
  git("config", "user.name", "Tester");
  git("config", "user.email", "tester@example.invalid");
  // 本项目的 Patch 和摘要使用 LF；目标检出也须继承相同的夹具属性。
  fs.writeFileSync(path.join(source, ".gitattributes"), "* text=auto eol=lf\n");
  const initialized = runFlower(source, ["init", "-y", "--codex", "--no-update-check"], { timeout: 60000 });
  assert.equal(initialized.status, 0, `${initialized.stdout}\n${initialized.stderr}`);
  if (projectConfig) fs.appendFileSync(path.join(source, ".trellis/config.yaml"), "\n# 项目自有配置\nbusiness: keep\n");
  fs.appendFileSync(path.join(source, ".gitignore"), "\n.codex/config.toml\n");
  git("add", "-A");
  git("commit", "-m", "fixture");
  const baseCommit = git("rev-parse", "HEAD").trim();
  git("worktree", "add", "-b", "feature/target", target);
  assert.equal(fs.existsSync(path.join(target, ".codex/config.toml")), false);
  return { source, target, git, baseCommit };
}

test("来源 Patch 摘要过期时，目标按固定包独立生成忽略配置与 state", async (t) => {
  const f = fixture(t, true);
  const sourceState = path.join(f.source, ".flower/state.json");
  const state = JSON.parse(fs.readFileSync(sourceState, "utf8"));
  for (const patch of state.plugins[0].patches) {
    if (patch.target === ".trellis/config.yaml") patch.resultHash = `sha256:${"0".repeat(64)}`;
  }
  fs.writeFileSync(sourceState, JSON.stringify(state));
  const sourceBefore = fs.readFileSync(sourceState);
  const targetConfig = fs.readFileSync(path.join(f.target, ".trellis/config.yaml"));
  const result = prepareWorktreeFlower(f.target);
  assert.ok(result.paths.includes(".codex/config.toml"));
  assert.equal(result.action, "initialized", JSON.stringify(result));
  assert.equal(inspectWorktreeFlower(f.target).installation, "complete");
  assert.deepEqual(fs.readFileSync(sourceState), sourceBefore);
  assert.deepEqual(fs.readFileSync(path.join(f.target, ".trellis/config.yaml")), targetConfig);
  assert.equal(execFileSync("git", ["-C", f.target, "status", "--porcelain"], { encoding: "utf8" }), "");
  assert.equal((prepareWorktreeFlower(f.target)).action, "preserved");
});

test("真实 CLI 在一次确认后完成目标配置准备且不修改来源", (t) => {
  const f = fixture(t);
  const destination = path.join(path.dirname(f.target), "cli-target");
  const stateFile = path.join(f.source, ".flower/state.json");
  const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  for (const patch of state.plugins[0].patches) patch.resultHash = `sha256:${"0".repeat(64)}`;
  fs.writeFileSync(stateFile, JSON.stringify(state));
  const createArgs = ["worktree", "create", "--target", destination, "--branch", "feature/cli-target", "--json"];
  const preview = runFlower(f.source, createArgs);
  assert.equal(preview.status, 0, `${preview.stdout}\n${preview.stderr}`);
  const plan = JSON.parse(preview.stdout);
  assert.equal(plan.localStateTransfer.flower.action, "pending");
  fs.appendFileSync(stateFile, "\n");
  const sourceAfterPreview = fs.readFileSync(stateFile);
  assert.equal(fs.existsSync(destination), false);
  const created = runFlower(f.source, [...createArgs, "--yes", "--plan-fingerprint", plan.confirmation.fingerprint]);
  assert.equal(created.status, 0, `${created.stdout}\n${created.stderr}`);
  const result = JSON.parse(created.stdout);
  assert.equal(result.status, "created", JSON.stringify(result.setup));
  assert.equal(result.setup.status, "ready");
  assert.equal(result.task, null);
  assert.equal(inspectWorktreeFlower(destination).installation, "complete");
  assert.deepEqual(fs.readFileSync(stateFile), sourceAfterPreview);
  assert.equal(f.git("status", "--porcelain"), "");
});

test("坏来源记录不影响目标按已有声明和锁文件独立准备", async (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.source, ".flower/state.json"), "{");
  const result = prepareWorktreeFlower(f.target);
  assert.equal(result.action, "initialized", JSON.stringify(result));
  assert.equal(inspectWorktreeFlower(f.target).installation, "complete");
  assert.equal(fs.readFileSync(path.join(f.source, ".flower/state.json"), "utf8"), "{");
});

test("目标真实内容需要变更时，保留用户文件和待准备状态", async (t) => {
  const f = fixture(t);
  const target = path.join(f.target, ".trellis/scripts/auto_loop.py");
  fs.writeFileSync(target, "用户自有内容\n");
  const result = prepareWorktreeFlower(f.target);
  assert.equal(result.action, "pending");
  assert.equal(fs.readFileSync(target, "utf8"), "用户自有内容\n");
  assert.equal(fs.existsSync(path.join(f.target, ".flower/state.json")), false);
  assert.equal(fs.existsSync(path.join(f.target, ".codex/config.toml")), false);
});

test("目标固定版本不可用时，不继承来源新版或伪造完整安装", async (t) => {
  const f = fixture(t);
  for (const name of ["plugins.json", "plugin-lock.json"]) {
    const file = path.join(f.target, ".flower", name);
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    value.plugins[0].version = "0.6.11";
    fs.writeFileSync(file, JSON.stringify(value));
  }
  const lockBefore = fs.readFileSync(path.join(f.target, ".flower/plugin-lock.json"));
  const result = prepareWorktreeFlower(f.target);
  assert.equal(result.action, "pending");
  assert.equal(result.reason, "flower-package-unavailable");
  assert.deepEqual(fs.readFileSync(path.join(f.target, ".flower/plugin-lock.json")), lockBefore);
  assert.equal(fs.existsSync(path.join(f.target, ".flower/state.json")), false);
  execFileSync("git", ["-C", f.target, "add", ".flower/plugins.json", ".flower/plugin-lock.json"]);
  execFileSync("git", ["-C", f.target, "commit", "-m", "old fixed version fixture"], { stdio: "ignore" });
  const destination = path.join(path.dirname(f.target), "old-base-target");
  const args = ["worktree", "create", "--target", destination, "--branch", "feature/old-base", "--base", "feature/target", "--json"];
  const plan = JSON.parse(runFlower(f.source, args).stdout);
  const created = runFlower(f.source, [...args, "--yes", "--plan-fingerprint", plan.confirmation.fingerprint]);
  assert.equal(created.status, 0, created.stdout + created.stderr);
  const payload = JSON.parse(created.stdout);
  assert.equal(payload.status, "created-needs-prepare");
  assert.ok(payload.setup.issues.some((issue) => issue.reason === "flower-package-unavailable"));
  assert.ok(fs.existsSync(path.join(destination, ".git")));
  assert.deepEqual(fs.readFileSync(path.join(destination, ".flower/plugin-lock.json")), lockBefore);
});

test("只有旧版安装标记或部分空记录时，准备状态不会误报完整", async (t) => {
  const f = fixture(t);
  for (const name of ["plugins.json", "plugin-lock.json"]) fs.unlinkSync(path.join(f.target, ".flower", name));
  fs.writeFileSync(path.join(f.target, ".trellis/.flower-manifest.json"), JSON.stringify({ flowerVersion: "0.6.11" }));
  let result = prepareWorktreeFlower(f.target);
  assert.equal(result.action, "pending");
  assert.equal(result.reason, "flower-records-missing");
  let status = JSON.parse(runFlower(f.target, ["worktree", "status", "--json"]).stdout);
  assert.ok(status.setup.issues.some((issue) => issue.step === "flower"));
  fs.unlinkSync(path.join(f.target, ".trellis/.flower-manifest.json"));
  fs.writeFileSync(path.join(f.target, ".flower/plugins.json"), JSON.stringify({ schemaVersion: 1, plugins: [] }));
  fs.writeFileSync(path.join(f.target, ".flower/plugin-lock.json"), JSON.stringify({ schemaVersion: 1, roots: [], plugins: [] }));
  result = prepareWorktreeFlower(f.target);
  assert.equal(result.action, "pending");
  status = JSON.parse(runFlower(f.target, ["worktree", "status", "--json"]).stdout);
  assert.ok(status.setup.issues.some((issue) => issue.step === "flower"));
  assert.equal(fs.existsSync(path.join(f.target, ".flower/state.json")), false);
});

test("已入库后删除的忽略配置和安装记录不会被自动补写", async (t) => {
  const f = fixture(t);
  const git = (...args) => execFileSync("git", ["-C", f.target, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  for (const relative of [".codex/config.toml", ".flower/state.json"]) {
    fs.copyFileSync(path.join(f.source, relative), path.join(f.target, relative));
    git("add", "-f", relative);
  }
  git("commit", "-m", "tracked local files fixture");
  fs.unlinkSync(path.join(f.target, ".codex/config.toml"));
  let result = prepareWorktreeFlower(f.target);
  assert.equal(result.action, "pending");
  assert.equal(fs.existsSync(path.join(f.target, ".codex/config.toml")), false);
  fs.copyFileSync(path.join(f.source, ".codex/config.toml"), path.join(f.target, ".codex/config.toml"));
  fs.unlinkSync(path.join(f.target, ".flower/state.json"));
  result = prepareWorktreeFlower(f.target);
  assert.equal(result.action, "pending");
  assert.equal(fs.existsSync(path.join(f.target, ".flower/state.json")), false);
});

test("目标坏记录或遗留事务保持原证据，不自动刷新安装事实", async (t) => {
  const f = fixture(t);
  const stateFile = path.join(f.target, ".flower/state.json");
  fs.writeFileSync(stateFile, "{坏记录");
  assert.equal((prepareWorktreeFlower(f.target)).action, "pending");
  assert.equal(fs.readFileSync(stateFile, "utf8"), "{坏记录");
  fs.unlinkSync(stateFile);
  const transactions = path.join(f.target, ".flower/transactions");
  fs.mkdirSync(transactions);
  fs.writeFileSync(path.join(transactions, "evidence.json"), "恢复证据\n");
  assert.equal(inspectWorktreeFlower(f.target).reason, "flower-repair-required");
  assert.throws(() => prepareWorktreeFlower(f.target), { reason: "flower-repair-required" });
  const prepared = runFlower(f.target, ["worktree", "prepare", "--target", f.target, "--developer", "tester", "--json"]);
  assert.notEqual(prepared.status, 0);
  assert.equal(JSON.parse(prepared.stdout).reason, "flower-repair-required");
  assert.equal(fs.readFileSync(path.join(transactions, "evidence.json"), "utf8"), "恢复证据\n");
  assert.equal(fs.existsSync(stateFile), false);
});
