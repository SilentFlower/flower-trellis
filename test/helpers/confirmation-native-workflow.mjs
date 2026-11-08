import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ACTION = {
  brief: "implement",
  check: "repair_all_and_recheck",
  push: "execute_git_plan",
  "commit-only": "execute_git_plan",
};
const TARGET = "planned.txt";
const RETAINED = "retained.txt";

/**
 * 给两个真实终端提供相同的一次性任务和本地 Git 计划，只在真实领取后执行。
 * @param {object} options 独立目录、实际 Flower 入口、等待时长与终端证据。
 * @returns {object} 准备、领取后的动作及最终验证。
 */
export function createNativeWorkflow({ project, repo, env, platform, gate, seconds, marker, defaultPolicy = false }) {
  assert.ok(Object.hasOwn(ACTION, gate));
  const isolated = { ...env, FLOWER_NO_TELEMETRY: "1", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: path.join(project, ".no-git-config") };
  const run = (command, args, options = {}) => execFileSync(command, args, {
    cwd: project, env: isolated, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 15000, ...options,
  }).trim();
  run("git", ["init", "--quiet"]);
  run(process.execPath, [path.join(repo, "bin/flower-trellis.js"), "init", "-y", `--${platform}`,
    "-u", "native-test", "--no-update-check"]);
  // 避免原生 SessionStart 迁移全新项目的引导任务，干扰本夹具核对 Git 基线。
  fs.rmSync(path.join(project, ".trellis/tasks/00-bootstrap-guidelines"), { recursive: true, force: true });
  if (!defaultPolicy) fs.appendFileSync(path.join(project, ".trellis/config.yaml"),
    `\nconfirmation_timeout:\n  brief:\n    base_seconds: ${seconds}\n  check:\n    base_seconds: ${seconds}\n  push:\n    seconds: ${seconds}\n`);
  const kind = gate === "commit-only" ? "push" : gate;
  const mode = gate === "commit-only" ? "commit-only" : "push";
  const python = (script, args, options) => run("python3", ["-X", "utf8", `.trellis/scripts/${script}.py`, ...args], options);
  const git = (...args) => run("git", ["-c", "user.name=Native test", "-c", "user.email=native-test@example.invalid", ...args]);
  const file = relative => path.join(project, relative);
  let task;
  let context;
  let head;
  let remote;
  let calls = 0;

  /** 绑定实际终端的会话标识，并按现有 owner 的范围准备材料。 */
  function prepare(owner) {
    context = { ...isolated, TRELLIS_CONTEXT_ID: owner };
    if (kind === "brief") {
      python("task", ["create", "原生确认一次性任务", "--slug", "native-probe"], { env: context });
      const dir = fs.readdirSync(file(".trellis/tasks")).find(name => name.endsWith("-native-probe"));
      assert.ok(dir);
      task = `.trellis/tasks/${dir}`;
      fs.writeFileSync(file(`${task}/prd.md`), "# 需求\n\n核对终端的原生开工确认。\n");
      fs.writeFileSync(file(`${task}/brief.md`), `# Brief — 原生确认一次性任务\n\n## Goal\n\n验证本地开工。\n\n## Acceptance\n\n只改变当前任务状态。\n\n${marker}\n`);
      return { kind, file: `${task}/brief.md` };
    }
    if (kind === "check") {
      fs.writeFileSync(file(TARGET), "待修复\n");
      return { kind, body: `# 完整检查报告\n\nCHK-1 将计划内文件中的待修复改为已修复。\n\n### 下一步\n\n重检同一条问题。\n\n${marker}\n`,
        problem_ids: ["CHK-1"] };
    }
    git("branch", "-M", "main");
    remote = path.join(path.dirname(project), "native-confirmation-remote.git");
    run("git", ["init", "--quiet", "--bare", "--initial-branch=main", remote]);
    git("remote", "add", "origin", remote);
    fs.writeFileSync(file(TARGET), "基线\n");
    fs.writeFileSync(file(RETAINED), "保留基线\n");
    git("add", "--", TARGET, RETAINED);
    git("commit", "-m", "创建隔离基线");
    git("push", "--set-upstream", "origin", "main");
    head = git("rev-parse", "HEAD");
    fs.writeFileSync(file(TARGET), "本轮精确变更\n");
    fs.writeFileSync(file(RETAINED), "保留计划外 staged\n");
    git("add", "--", RETAINED);
    return { kind, mode, git_paths: [TARGET],
      body: `# Git 计划\n\n- 模式：${mode}\n- 分支：main\n- 提交：验证原生确认\n- 计划文件：${TARGET}\n- 保留未提交的变更（dirty）：${RETAINED}\n\n${marker}\n` };
  }

  /** 只接受真实原生工具交回的匹配领取，执行 owner 对应的隔离动作。 */
  function apply(decision) {
    assert.equal(calls, 0);
    assert.equal(decision.source, "policy_timeout");
    assert.equal(decision.kind, kind);
    assert.equal(decision.action, ACTION[gate]);
    if (kind === "brief") {
      assert.equal(JSON.parse(fs.readFileSync(file(`${task}/task.json`))).status, "planning");
      python("task", ["start", task], { env: context });
    } else if (kind === "check") {
      assert.equal(fs.readFileSync(file(TARGET), "utf8"), "待修复\n");
      fs.writeFileSync(file(TARGET), "已修复\n");
      assert.equal(fs.readFileSync(file(TARGET), "utf8"), "已修复\n");
    } else {
      assert.equal(git("rev-parse", "HEAD"), head);
      assert.equal(git("diff", "--cached", "--name-only"), RETAINED);
      git("add", "--", TARGET);
      git("commit", "--only", "-m", "验证原生确认", "--", TARGET);
      assert.equal(git("show", "--name-only", "--format=", "HEAD"), TARGET);
      if (mode === "push") git("push", "origin", "main");
    }
    calls++;
  }

  /** 跨过原截止后核对真实副作用、保留文件与 bare 仓库分支。 */
  function verify(expected) {
    assert.equal(calls, expected ? 1 : 0);
    if (kind === "brief") return JSON.parse(fs.readFileSync(file(`${task}/task.json`))).status === (expected ? "in_progress" : "planning");
    if (kind === "check") return fs.readFileSync(file(TARGET), "utf8") === (expected ? "已修复\n" : "待修复\n");
    const current = git("rev-parse", "HEAD");
    const upstream = run("git", ["--git-dir", remote, "rev-parse", "refs/heads/main"]);
    return (current !== head) === expected && upstream === (expected && mode === "push" ? current : head)
      && git("diff", "--cached", "--name-only") === RETAINED;
  }

  return { kind, prepare, apply, verify };
}
