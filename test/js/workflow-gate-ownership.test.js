import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SOURCE = path.join(ROOT, "vendor/skill-garden/.trellis/0.6");

function readRoot(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function readSource(relativePath) {
  return fs.readFileSync(path.join(SOURCE, relativePath), "utf8");
}

function assertOrdered(value, first, second, scenario) {
  const firstIndex = value.indexOf(first);
  const secondIndex = value.indexOf(second);
  assert.notEqual(firstIndex, -1, `${scenario}: 缺少 ${first}`);
  assert.notEqual(secondIndex, -1, `${scenario}: 缺少 ${second}`);
  assert.ok(firstIndex < secondIndex, `${scenario}: ${first} 必须先于 ${second}`);
}

const GATES = [
  "Request Intent Routing",
  "Brainstorm Gate",
  "Task Brief Handoff",
  "Project Knowledge Discovery",
  "Flower Update Confirmation",
  "Active Task Scope Guard",
  "Routing Gate",
  "Auto-Loop Return Gate",
  "Interactive Post-Check Stop Gate",
  "Code Commit Confirmation Gate",
  "Auto-loop Commit-only Preauthorization",
  "Bookkeeping Auto-commit Scope",
  "Task Progress Recovery",
];

test("Workflow Hub 只保留 13 项 owner 索引和跨阶段顺序", () => {
  const hub = readSource("overrides/patches/workflow/hub/content.md");

  assert.match(hub, /### Skill-Garden Workflow Owner Index/);
  assert.ok(Buffer.byteLength(hub, "utf8") < 5000);
  for (const gate of GATES) {
    assert.match(hub, new RegExp(`\\| ${gate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\|`));
    assert.doesNotMatch(hub, new RegExp(`#### ${gate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  }
  assert.ok(
    hub.indexOf("blocking `<flower-update>`")
      < hub.indexOf("Request intent and active-task scope"),
  );
  assert.ok(
    hub.indexOf("matching `record` + `next`")
      < hub.indexOf("Interactive completion proceeds Check-All"),
  );
  for (const forbidden of [
    "`direct_edit` requires known",
    "record --result failed",
    "git commit --only",
    "session_auto_commit: false",
    "--progress-json",
  ]) {
    assert.doesNotMatch(hub, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("13 个 Gate 的完整契约位于原生 owner", () => {
  const requestTriage = readSource(
    "overrides/patches/workflow/intent-routing/request-triage/content.md",
  );
  const brainstorm = readSource(
    "overrides/patches/skills/trellis-brainstorm/planning-handoff/content.md",
  );
  const brainstormQualityBar = readSource(
    "overrides/patches/skills/trellis-brainstorm/planning-handoff/quality-bar-baseline.md",
  );
  const taskBrief = readSource(".agents/skills/trellis-task-brief/SKILL.md");
  const beforeDev = readSource(
    "overrides/patches/skills/trellis-before-dev/project-knowledge-discovery/content.md",
  );
  const updateHook = readRoot("src/assets/flower_update_hook.py");
  const selfUpdate = readRoot("src/commands/self-update.js");
  const planningState = readSource(
    "overrides/patches/workflow/states-planning/common-content.md",
  );
  const activeState = readSource(
    "overrides/patches/workflow/states-in-progress/common-content.md",
  );
  const continueRecovery = readSource(
    "overrides/patches/skills/trellis-continue/task-progress-recovery/content.md",
  );
  const route = readSource(".agents/skills/trellis-route/SKILL.md");
  const checkAll = readSource(".agents/skills/trellis-check-all/SKILL.md");
  const checkAllReporting = readSource(
    ".agents/skills/trellis-check-all/references/reporting-and-disposition.md",
  );
  const push = readSource(".agents/skills/trellis-push/SKILL.md");
  const autoLoop = readSource(".agents/skills/trellis-auto-loop/SKILL.md");
  const finish = readSource(
    "overrides/patches/skills/trellis-finish-work/exact-bookkeeping/content.md",
  );
  const progress = readSource("scripts/task_progress.py");

  assert.match(requestTriage, /Asking for an opinion, expressing discomfort, rejecting a proposal/);
  assert.match(requestTriage, /Asking to inspect, explain, verify, or locate a cause is `inspect`/);
  assert.match(requestTriage, /`direct_edit` requires known, bounded, low-risk, reversible scope/);
  assert.match(requestTriage, /risk signals, not automatic `task_plan` outcomes/);
  assert.match(requestTriage, /exact rollback or mechanically synchronized known change/);
  assert.match(requestTriage, /task_intent\.py discard --task <current-task>/);
  assert.match(requestTriage, /python3 \.\/\.trellis\/scripts\/spec_router\.py/);
  assert.match(requestTriage, /apply the Active Task Scope Guard before artifact ownership, task routing, or file edits/);
  assert.match(brainstorm, /Wait for the user's planning review confirmation/);
  assert.match(brainstormQualityBar, /contains testable acceptance criteria/);
  assert.match(brainstormQualityBar, /Repository-answerable questions have already been answered/);
  assert.match(taskBrief, /默认等待用户确认后再运行 `task\.py start`/);
  assert.match(taskBrief, /免除第二次确认/);
  assert.match(beforeDev, /Follow the workflow `Request Triage` Project Knowledge Discovery contract/);
  assert.doesNotMatch(beforeDev, /python3 \.\/\.trellis\/scripts\/spec_router\.py/);
  assert.match(updateHook, /priority: blocking_confirmation_required/);
  assert.match(selfUpdate, /post_action: "run_trellis_push_confirmation"/);
  assert.match(planningState, /apply the `Request Triage` Active Task Scope Guard/);
  assert.match(activeState, /apply the `Request Triage` Active Task Scope Guard/);
  assert.match(route, /合法 route 决策必须能追溯到/);
  assert.match(route, /回到 Phase 2\.1 completion contract 解析 Pre-Check/);
  assert.ok(
    checkAllReporting.indexOf("## Auto-Loop Return Gate")
      < checkAllReporting.indexOf("## Interactive Post-Check Stop Gate"),
  );
  assert.equal((checkAllReporting.match(/## Interactive Post-Check Stop Gate/g) || []).length, 1);
  assert.match(checkAll, /本 skill 是 \*\*薄入口\*\*/);
  assert.match(checkAllReporting, /不新增 direct Git 专用摘要/);
  assert.match(activeState, /follow the `Interactive Post-Check Stop Gate`/);
  assert.doesNotMatch(activeState, /no-op.*written|partial verification|material residual risk/);
  assert.match(push, /Phase 3\.4 唯一的代码提交入口/);
  assert.match(push, /## Step 0：记录完成链证据/);
  assert.match(push, /根据当前 `spec_update_result` 与实际 diff 标记/);
  assert.match(push, /本步骤不得返回 Phase 2\.2/);
  assert.match(push, /不得加载 `trellis-check-all` 或 `trellis-update-spec`/);
  assert.match(push, /auto-loop 内部 `commit-only`/);
  assert.match(push, /git commit --only/);
  assert.match(autoLoop, /## Commit-Only/);
  assert.match(autoLoop, /`review_planning_readiness`/);
  assert.match(autoLoop, /`resolve_open_questions`/);
  assert.match(autoLoop, /不逐任务执行 `confirm_brief`/);
  assert.match(autoLoop, /Check record 中其它变化进入有限自纠/);
  assert.match(autoLoop, /其它 action 仍按 `artifact-drift` 阻塞/);
  assert.match(finish, /This skill owns only the current task's release audit, archive bookkeeping/);
  assert.match(finish, /### 1\. Decision Audit/);
  assert.match(finish, /decision_log\.py status --task <task-name> --json/);
  assert.match(finish, /`task\.py archive` repeats this guard before any status write/);
  assert.match(continueRecovery, /task_progress\.py status --json/);
  assert.match(continueRecovery, /Never rebind the session or task automatically/);
  assert.match(progress, /def _validate_progress/);
  assert.match(progress, /os\.replace\(temp_path, path\)/);
});

test("Workflow Gate 可达性场景覆盖真实入口顺序", () => {
  const requestTriage = readSource(
    "overrides/patches/workflow/intent-routing/request-triage/content.md",
  );
  const noTask = readSource("overrides/patches/workflow/state-no-task/content.md");
  const planning = readSource(
    "overrides/patches/workflow/states-planning/common-content.md",
  );
  const inProgress = readSource(
    "overrides/patches/workflow/states-in-progress/common-content.md",
  );
  const continueRecovery = readSource(
    "overrides/patches/skills/trellis-continue/task-progress-recovery/content.md",
  );
  const route = readSource(".agents/skills/trellis-route/SKILL.md");
  const push = readSource(".agents/skills/trellis-push/SKILL.md");
  const autoLoop = readSource(".agents/skills/trellis-auto-loop/SKILL.md");

  const noTaskPath = `${requestTriage}\n${noTask}`;
  assertOrdered(
    noTask,
    "follow the `Request Triage` Project Knowledge Discovery contract",
    "Load a Trellis capability directly only when",
    "无任务 beta release",
  );
  assert.match(noTask, /project-specific workflow actions through the matched SOP/);
  assert.match(noTask, /instead of keyword-mapping a general release\/publish request to `trellis-release`/);
  assertOrdered(
    noTaskPath,
    "spec_router.py",
    "For non-destructive `direct_edit`",
    "无任务非平凡 inspect/direct_edit",
  );
  assert.match(requestTriage, /follow `load_strategy`/);
  assert.match(requestTriage, /`sections` reads the listed ranges/);
  assert.doesNotMatch(noTask, /load_strategy/);
  assert.doesNotMatch(planning, /load_strategy/);
  assert.doesNotMatch(inProgress, /load_strategy/);

  for (const [name, value, downstream] of [
    ["planning", planning, "Before `task.py start`"],
    ["in_progress", inProgress, "Enter Phase 2.1/2.2"],
  ]) {
    assertOrdered(
      value,
      "apply the `Request Triage` Active Task Scope Guard",
      downstream,
      `${name} 无关实现隔离`,
    );
    assert.match(value, /outside the active task title\/brief stops here/);
    assert.match(value, /without reusing its progress/);
  }

  assertOrdered(
    continueRecovery,
    "task_progress.py status --json",
    "Progress never overrides the task `status`",
    "continue progress 恢复",
  );
  assert.match(continueRecovery, /summary\.partialStep/);
  assert.match(continueRecovery, /summary\.nextStep/);
  assert.match(continueRecovery, /status=candidates/);
  assert.match(continueRecovery, /suggest an explicit rebind/);
  assert.match(continueRecovery, /Never rebind the session or task automatically/);
  assert.match(continueRecovery, /Do not infer a Phase from progress/);
  assert.match(continueRecovery, /or resume Git\/commit orchestration from it/);
  assert.match(continueRecovery, /### Planning Resume Gate/);
  assert.match(continueRecovery, /enter `trellis-brainstorm` before using artifact presence/);
  assert.match(continueRecovery, /files exist; they do not prove that acceptance criteria are testable/);
  assert.match(continueRecovery, /wait for a current explicit user confirmation before `task\.py start`/);

  assertOrdered(
    inProgress,
    "Enter Phase 2.1/2.2 through the target-matched `trellis-route`",
    "return to the Phase 2.1 completion contract",
    "implement route 返回 Pre-Check owner",
  );
  assert.match(route, /focused validation 完成后都必须返回 workflow Phase 2\.1/);
  assertOrdered(
    push,
    "## Step 0：记录完成链证据",
    "## Step 1：发现仓库与任务",
    "direct push 先记录完成链证据",
  );
  assert.match(push, /普通 push 或用户 `commit-only` 已经构成明确 Git 意图/);
  assert.match(push, /不会阻止读取 Git 状态或生成提交计划/);
  assert.match(push, /### 完成链证据/);
  assert.match(push, /Check-All：<通过 \/ 未运行 \/ 已失效 \/ 存在 findings \/ blocked \/ 部分验证>/);
  assert.match(push, /Update-Spec：<no-op \/ written \/ needs-review \/ 未运行 \/ 已失效>/);
  assert.doesNotMatch(push, /## Step 0：交互式完成链门禁/);
  assertOrdered(
    push,
    "普通 push 或用户 `commit-only` 已经构成明确 Git 意图",
    "不会阻止读取 Git 状态或生成提交计划",
    "direct Git 证据只读不阻断",
  );
  assert.match(autoLoop, /`refresh_brief`/);
  assert.match(autoLoop, /无需再次让用户确认/);
  assert.doesNotMatch(autoLoop, /未确认时停止，不得 record/);
});

test("trellis-release 只匹配上线操作单而不抢占实际发版", () => {
  for (const relativePath of [
    ".agents/skills/trellis-release/SKILL.md",
    ".claude/skills/trellis-release/SKILL.md",
  ]) {
    const skill = readSource(relativePath);

    assert.match(
      skill,
      /只在用户明确要求‘生成上线单’‘汇总 release\.md’或点名 trellis-release 时使用/,
    );
    assert.match(
      skill,
      /实际软件包发版、部署和版本标签流程应先读取项目 SOP，不使用本 skill/,
    );
    assert.doesNotMatch(skill, /用于正式上线前整理/);
  }
});

test("最终 dogfood 产物只有一个 Hub marker 且 owner Patch 已落盘", () => {
  const workflow = readRoot(".trellis/workflow.md");
  const beforeDevAgents = readRoot(".agents/skills/trellis-before-dev/SKILL.md");
  const beforeDevClaude = readRoot(".claude/skills/trellis-before-dev/SKILL.md");
  const continueAgents = readRoot(".agents/skills/trellis-continue/SKILL.md");
  const continueClaude = readRoot(".claude/commands/trellis/continue.md");

  assert.equal(
    (workflow.match(/BEGIN skill-garden patch workflow-hub v0\.6/g) || []).length,
    1,
  );
  assert.match(workflow, /### Skill-Garden Workflow Owner Index/);
  assert.doesNotMatch(workflow, /#### Request Intent Routing/);
  assert.match(beforeDevAgents, /BEGIN skill-garden patch before-dev-project-knowledge-discovery/);
  assert.match(beforeDevClaude, /BEGIN skill-garden patch before-dev-project-knowledge-discovery/);
  assert.match(continueAgents, /BEGIN skill-garden patch trellis-continue-task-progress-recovery/);
  assert.match(continueClaude, /BEGIN skill-garden patch trellis-continue-task-progress-recovery/);
  assertOrdered(
    continueAgents,
    "task_progress.py status --json",
    "## Step 2: Load the Phase Index",
    "dogfood continue 恢复顺序",
  );
});
