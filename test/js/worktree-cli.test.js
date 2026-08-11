import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseCliArgs } from "../../src/lib/cli-args.js";
import {
  parseWorktreeArgs,
  printWorktreeResult,
  worktreeEngineArgs,
} from "../../src/commands/worktree.js";
import {
  resolveTrellisPythonCommand,
  trellisPythonInvocation,
} from "../../src/lib/trellis-python-command.js";

const CLI = path.resolve("bin/flower-trellis.js");

test("worktree 参数由 Flower 自有 facade 消费", () => {
  const parsedCli = parseCliArgs([
    "worktree",
    "create",
    "--target",
    "../parallel",
    "--branch",
    "feature/parallel",
    "--base",
    "beta",
    "--task-title",
    "并行任务",
    "--task-slug",
    "parallel-task",
    "--json",
  ], "/tmp/project");
  assert.equal(parsedCli.command, "worktree");
  assert.equal(parsedCli.ctx.target, "/tmp/parallel");
  assert.equal(parsedCli.ctx.targetExplicit, true);

  const parsed = parseWorktreeArgs(parsedCli.ctx.passthrough);
  assert.equal(parsed.command, "create");
  assert.equal(parsed.options.get("--branch"), "feature/parallel");
  assert.equal(parsed.json, true);
  assert.deepEqual(
    worktreeEngineArgs(parsed, parsedCli.ctx.target, "/tmp/project"),
    [
      "create",
      "--source",
      "/tmp/project",
      "--target",
      "/tmp/parallel",
      "--branch",
      "feature/parallel",
      "--base",
      "beta",
      "--task-title",
      "并行任务",
      "--task-slug",
      "parallel-task",
      "--json",
    ],
  );
});

test("worktree 参数拒绝缺失字段和无关 dry-run", () => {
  assert.throws(
    () => parseWorktreeArgs(["create", "--branch", "feature/test"]),
    /--task-title/,
  );
  assert.throws(
    () => parseWorktreeArgs(["status", "--dry-run"]),
    /只用于 worktree migrate/,
  );
  assert.throws(
    () => parseWorktreeArgs(["status", "--force"]),
    /不支持参数/,
  );
  assert.throws(
    () => parseWorktreeArgs([
      "create",
      "--branch",
      "feature/test",
      "--task-title",
      "测试",
      "--task-slug",
      "test",
      "--yes",
    ]),
    /--plan-fingerprint/,
  );
  assert.throws(
    () => parseWorktreeArgs(["status", "--inherit-route-prefs"]),
    /只用于 worktree prepare/,
  );
});

test("worktree 确认参数和 prepare 偏好来源按边界转发", () => {
  const confirmed = parseWorktreeArgs([
    "create",
    "--branch",
    "feature/confirmed",
    "--task-title",
    "确认任务",
    "--task-slug",
    "confirmed",
    "--yes",
    "--plan-fingerprint",
    "abc123",
  ]);
  assert.deepEqual(
    worktreeEngineArgs(confirmed, "/tmp/confirmed", "/tmp/source"),
    [
      "create",
      "--source",
      "/tmp/source",
      "--target",
      "/tmp/confirmed",
      "--branch",
      "feature/confirmed",
      "--task-title",
      "确认任务",
      "--task-slug",
      "confirmed",
      "--yes",
      "--plan-fingerprint",
      "abc123",
      "--json",
    ],
  );

  const prepared = parseWorktreeArgs([
    "prepare",
    "--developer",
    "tester",
    "--inherit-route-prefs",
  ]);
  assert.deepEqual(
    worktreeEngineArgs(prepared, "/tmp/target", "/tmp/source"),
    [
      "prepare",
      "--target",
      "/tmp/target",
      "--source",
      "/tmp/source",
      "--developer",
      "tester",
      "--inherit-route-prefs",
      "--json",
    ],
  );
});

test("worktree 人类输出区分选中根仓和只展示子仓", () => {
  const lines = [];
  const originalLog = console.log;
  console.log = (line) => lines.push(line);
  try {
    printWorktreeResult({
      status: "confirmation-required",
      branch: "feature/example",
      repositories: [
        {
          path: ".",
          baseCommit: "root-sha",
          selected: true,
          targetBranch: "feature/example",
          initialized: true,
          sourceBranch: "beta",
          sourceHead: "root-sha",
        },
        {
          path: "vendor/example",
          baseCommit: "child-sha",
          selected: false,
          initialized: true,
          sourceBranch: "main",
          sourceHead: "child-sha",
        },
      ],
    });
  } finally {
    console.log = originalLog;
  }

  assert.match(lines.join("\n"), /本次创建根分支 feature\/example/);
  assert.match(lines.join("\n"), /仅展示，不自动创建子仓分支/);
});

test("trellis-worktree Skill 读取 package context 并要求子仓独立确认", () => {
  const skill = fs.readFileSync(
    path.resolve("vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-worktree/SKILL.md"),
    "utf8",
  );

  assert.match(skill, /get_context\.py --mode packages/);
  assert.match(skill, /independent Git package/);
  assert.match(skill, /never infer a child repository base from the root branch/);
});

test("Python 命令拆分不经过 shell", () => {
  assert.deepEqual(trellisPythonInvocation("python3"), { executable: "python3", args: [] });
  assert.deepEqual(trellisPythonInvocation("py -3"), { executable: "py", args: ["-3"] });
  assert.deepEqual(
    trellisPythonInvocation("\"/opt/Python 3/python\" -X utf8"),
    { executable: "/opt/Python 3/python", args: ["-X", "utf8"] },
  );
});

test("worktree bootstrap 可禁用 legacy symlink 中的 Python 命令证据", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "flower-worktree-python-evidence-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, "source");
  const target = path.join(root, "target");
  fs.mkdirSync(path.join(source, ".trellis"), { recursive: true });
  fs.mkdirSync(target);
  fs.writeFileSync(
    path.join(source, ".trellis/workflow.md"),
    "py -3 .trellis/scripts/task.py current\n",
  );
  fs.symlinkSync(path.join(source, ".trellis"), path.join(target, ".trellis"), "dir");

  assert.equal(resolveTrellisPythonCommand(target).command, "py -3");
  assert.equal(
    resolveTrellisPythonCommand(target, {
      generatedEvidence: false,
      env: {},
      platform: "linux",
    }).command,
    "python3",
  );
});

test("真实 CLI status 返回 branch-local 状态", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "flower-worktree-cli-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, ".trellis/.runtime/sessions"), { recursive: true });
  fs.writeFileSync(path.join(root, ".trellis/.version"), "0.6.14\n");
  fs.writeFileSync(path.join(root, ".trellis/.developer"), "name=tester\n");
  const git = spawnSync("git", ["init"], { cwd: root, encoding: "utf8" });
  assert.equal(git.status, 0, git.stderr);

  const result = spawnSync(
    process.execPath,
    [CLI, "worktree", "status", "--target", root, "--json"],
    { cwd: path.resolve("."), encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, "ready-local");
  assert.equal(payload.targetRoot, root);
  assert.equal(payload.sourceRoot, undefined);
});
