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
  "Harness Plan Mode Ban",
  "Brainstorm Gate",
  "Task Brief Handoff",
  "Project Knowledge Discovery",
  "Flower Update Confirmation",
  "Active Task Scope Guard",
  "Untracked Work Completion Chain",
  "Untracked Task Adoption",
  "Routing Gate",
  "Auto-Loop Return Gate",
  "Interactive Post-Check Stop Gate",
  "Code Commit Confirmation Gate",
  "Auto-loop Commit-only Preauthorization",
  "Bookkeeping Auto-commit Scope",
  "Task Progress Recovery",
];

test("Workflow Hub 只保留 16 项 owner 索引和跨阶段顺序", () => {
  const hub = readSource("overrides/patches/workflow/hub/content.md");

  assert.match(hub, /### Skill-Garden Workflow Owner Index/);
  assert.ok(Buffer.byteLength(hub, "utf8") < 5000);
  for (const gate of GATES) {
    assert.match(hub, new RegExp(`\\| ${gate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\|`));
    assert.doesNotMatch(hub, new RegExp(`#### ${gate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  }
  assertOrdered(
    hub,
    "A blocking `<flower-update>`",
    "Request intent, active-task scope",
    "更新确认先于请求路由",
  );
  assertOrdered(
    hub,
    "matching `record` + `next`",
    "Interactive completion proceeds Check-All",
    "Auto-Loop 返回先于交互完成链",
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

test("内置 Plan Mode 禁令必须存在于所有会产生 planning 冲动的注入状态", () => {
  const banned = /`EnterPlanMode` \/ `ExitPlanMode`/;
  const states = [
    "overrides/patches/workflow/state-no-task/content.md",
    "overrides/patches/workflow/states-planning/common-content.md",
    "overrides/patches/workflow/states-in-progress/common-content.md",
  ];

  for (const relativePath of states) {
    assert.match(readSource(relativePath), banned, relativePath);
  }
  // hub 的 owner 行是 canonical 归属：3e9f2d3 那次重构正因无人认领才把禁令整段丢掉。
  assert.match(
    readSource("overrides/patches/workflow/hub/content.md"),
    /\| Harness Plan Mode Ban \|/,
  );
});

test("Auto-Loop commit-only 复用 Push 的动态多仓链和三次恢复预算", () => {
  const autoLoop = readSource(".agents/skills/trellis-auto-loop/SKILL.md");
  const autoLoopClaude = readSource(".claude/skills/trellis-auto-loop/SKILL.md");
  const push = readSource(".agents/skills/trellis-push/SKILL.md");
  const pushClaude = readSource(".claude/skills/trellis-push/SKILL.md");
  const pushTemplates = readSource(
    ".agents/skills/trellis-push/references/output-templates.md",
  );
  const pushTemplatesClaude = readSource(
    ".claude/skills/trellis-push/references/output-templates.md",
  );
  const completedRecovery = readSource(
    ".agents/skills/trellis-push/references/completed-task-recovery.md",
  );
  const completedRecoveryClaude = readSource(
    ".claude/skills/trellis-push/references/completed-task-recovery.md",
  );
  const runner = readSource("scripts/auto_loop.py");

  assert.equal(autoLoop, autoLoopClaude);
  assert.equal(push, pushClaude);
  assert.equal(pushTemplates, pushTemplatesClaude);
  assert.equal(completedRecovery, completedRecoveryClaude);
  assert.equal(
    completedRecovery,
    readRoot("enhancements/0.6/.agents/skills/trellis-push/references/completed-task-recovery.md"),
  );
  assert.equal(
    completedRecovery,
    readRoot(".agents/skills/trellis-push/references/completed-task-recovery.md"),
  );
  assert.equal(
    completedRecovery,
    readRoot(".claude/skills/trellis-push/references/completed-task-recovery.md"),
  );
  assert.ok(Buffer.byteLength(completedRecovery) <= 4096);
  assert.match(autoLoop, /commit -> generate -> commit/);
  assert.match(autoLoop, /不得仅因多个仓库、submodule pin 或证据充分的本地生成命令返回 `multi-repo-commit-boundary`/);
  assert.match(autoLoop, /--repo-commit <repository>::<hash>/);
  assert.match(autoLoop, /--failure-type commit-repairable/);
  assert.match(autoLoop, /第 4 次失败进入 `commit-repair-budget-exhausted`/);
  assert.match(push, /动态执行链按以下证据优先级生成/);
  assert.match(push, /任务 `design\.md` \/ `implement\.md`/);
  assert.match(push, /受版本控制的 `package\.json`、Makefile 或仓库脚本入口/);
  assert.match(push, /互相冲突时失败关闭/);
  assert.match(push, /retained exact paths 的内容摘要不变/);
  assert.match(push, /验证 repository、commit object、message 和文件集合/);
  assert.match(push, /Auto-Loop runner 仍按自己的状态契约写入本地 `task\.json\.progress`/);
  assert.match(push, /本 skill 跳过 Step 5/);
  assert.match(push, /不得 reset、rebase、revert、amend 或撤销成功提交/);
  assert.match(push, /auto-loop 内部 `commit-only` 不渲染交互式计划或结果/);
  assert.match(push, /不得为了内部执行读取 `references\/output-templates\.md`/);
  assert.match(push, /auto-loop 内部 `commit-only` 不读取或渲染该交互式结果模板/);
  assert.match(pushTemplates, /## Trellis Push 计划/);
  assert.match(pushTemplates, /## Trellis Push 结果/);
  assert.doesNotMatch(push, /本 skill 只执行该提交/);
  assert.match(runner, /MAX_COMMIT_REPAIR = MAX_FIX_RECHECK/);
  assert.match(runner, /record\.add_argument\("--repo-commit", action="append", default=\[\]\)/);
  assert.match(runner, /"commit-repair-budget-exhausted"/);
  assert.doesNotMatch(runner, /add_parser\("commit-(?:plan|step)"/);
});

test("15 个 Gate 的完整契约位于原生 owner", () => {
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
  const noTaskState = readSource(
    "overrides/patches/workflow/state-no-task/content.md",
  );
  const untrackedState = readSource(
    "overrides/patches/workflow/state-untracked/content.md",
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
  const completedRecovery = readSource(
    ".agents/skills/trellis-push/references/completed-task-recovery.md",
  );
  const autoLoop = readSource(".agents/skills/trellis-auto-loop/SKILL.md");
  const finish = readSource(
    "overrides/patches/skills/trellis-finish-work/exact-bookkeeping/content.md",
  );
  const completedState = readSource(
    "overrides/patches/workflow/runtime-contract-reference/completed-content.md",
  );
  const progress = readSource("scripts/task_progress.py");

  assert.match(requestTriage, /Treat requests for an opinion, expressions of discomfort, rejected proposals/);
  assert.match(requestTriage, /treat requests to inspect, explain, verify, or locate a cause as `inspect`/);
  assert.match(requestTriage, /Both are read-only unless the current request explicitly authorizes a concrete edit/);
  assert.match(requestTriage, /Selecting a repair does not authorize editing while scope is unknown/);
  assert.match(requestTriage, /`direct_edit` requires known, bounded, low-risk, reversible scope/);
  assert.match(requestTriage, /do not automatically require `task_plan`/);
  assert.match(requestTriage, /exact rollback or mechanically synchronized known change/);
  assert.match(requestTriage, /build a short query from the request, intended commands, affected files or systems, package\/layer, and domain terms/);
  assert.match(requestTriage, /python3 \.\/\.trellis\/scripts\/spec_router\.py/);
  assert.match(requestTriage, /apply the Active Task Scope Guard before artifact ownership, task routing, or file edits/);
  assert.match(requestTriage, /Entering untracked `direct_edit`, creating or resuming a task, or switching intent gets one non-blocking status line/);
  assert.match(requestTriage, /the owning workflow state or capability owns its commands and transition details/);
  assert.doesNotMatch(requestTriage, /untracked_flow\.py begin/);
  assert.doesNotMatch(requestTriage, /untracked_flow\.py prepare-edit/);
  assert.doesNotMatch(requestTriage, /task_intent\.py adopt/);
  assert.doesNotMatch(requestTriage, /task_intent\.py discard/);
  assert.match(noTaskState, /untracked_flow\.py begin --summary/);
  assert.match(noTaskState, /A same-item hit resumes the existing state/);
  assert.match(noTaskState, /`active-work-conflict` blocks unrelated code writes/);
  assert.match(noTaskState, /Unrelated read-only requests may continue without mutating the state/);
  assert.match(noTaskState, /starts at `stage=implement`/);
  assert.match(noTaskState, /helper is a workflow cursor/);
  assert.match(untrackedState, /\[workflow-state:untracked_check\]/);
  assert.match(untrackedState, /\[workflow-state:untracked_spec\]/);
  assert.match(untrackedState, /\[workflow-state:untracked_push\]/);
  assert.match(untrackedState, /`stage=push` is only a route cursor/);
  assert.doesNotMatch(untrackedState, /prepare-edit|record-validation|record-check|record-spec/);
  assert.match(untrackedState, /task_intent\.py adopt/);
  assert.match(untrackedState, /never authorizes immediate implementation/);
  assert.match(planningState, /task_intent\.py discard --task <current-task>/);
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
  assert.match(route, /implement 路由只决定执行位置，不拥有实现后的停止策略/);
  assert.match(route, /返回 workflow Phase 2\.1 的 completion contract/);
  assert.ok(
    checkAllReporting.indexOf("## Auto-Loop Return Gate")
      < checkAllReporting.indexOf("## Interactive Post-Check Stop Gate"),
  );
  assert.equal((checkAllReporting.match(/## Interactive Post-Check Stop Gate/g) || []).length, 1);
  assert.match(checkAll, /本 skill 是 \*\*薄入口\*\*/);
  assert.match(checkAllReporting, /不新增 direct Git 摘要或 Git 计划/);
  assert.match(activeState, /follow the `Interactive Post-Check Stop Gate`/);
  assert.doesNotMatch(activeState, /no-op.*written|partial verification|material residual risk/);
  assert.match(push, /Phase 3\.4 唯一的代码提交入口/);
  assert.match(push, /## Step 0：记录完成链证据/);
  assert.match(push, /根据当前 `spec_update_result` 与实际 diff 标记/);
  assert.match(push, /本步骤不得返回 Phase 2\.2/);
  assert.match(push, /不得加载 `trellis-check-all` 或 `trellis-update-spec`/);
  assert.match(push, /auto-loop 内部 `commit-only`/);
  assert.match(push, /git commit --only/);
  assert.match(push, /--complete/);
  assert.match(push, /原子写入 `progress`、`status=completed` 与 `completedAt`/);
  assertOrdered(
    push,
    "通过 helper 用同一份最终 progress 原子写入",
    "helper 成功后，只提交并推送首次确认的当前任务 exact files",
    "普通任务完成先写 complete 再提交任务记录",
  );
  assert.match(push, /helper 成功但任务记录 commit 失败/);
  assert.match(push, /任务记录 commit 成功但 push 失败/);
  assert.match(push, /后续只重试该 commit 的 push/);
  assert.match(push, /任务记录 push 成功：本任务产生的当前任务目录变更必须 clean/);
  assert.match(push, /按需读取 `references\/completed-task-recovery\.md`/);
  assert.doesNotMatch(push, /pending_archive\.tasks_awaiting_archive/);
  assert.match(completedRecovery, /pending_archive\.tasks_awaiting_archive/);
  assert.match(completedRecovery, /不得把该本地完成态改成普通远端 push/);
  assert.match(completedRecovery, /任务记录 commit \+ push 恢复计划/);
  assert.match(completedRecovery, /任务记录 push-only 恢复计划/);
  assert.match(completedRecovery, /显式 finish-work，普通已同步/);
  assert.match(completedRecovery, /未知 ahead 修改任务/);
  assert.doesNotMatch(push, /只有进度 commit 和 push 都成功后/);
  assert.doesNotMatch(push, /archive bookkeeping commit 承接/);
  assert.match(autoLoop, /## Commit-Only/);
  assert.match(autoLoop, /`review_planning_readiness`/);
  assert.match(autoLoop, /`resolve_open_questions`/);
  assert.match(autoLoop, /不逐任务执行 `confirm_brief`/);
  assert.match(autoLoop, /Check record 中其它变化进入有限自纠/);
  assert.match(autoLoop, /其它 action 仍按 `artifact-drift` 阻塞/);
  assert.match(finish, /This skill owns only the current task's release audit, archive bookkeeping/);
  assert.match(finish, /### 1\. Completion State Gate/);
  assert.match(finish, /taskStatus=completed/);
  assert.match(finish, /finish-work must not manufacture completion/);
  assert.match(finish, /auto_loop\.py status --verbose/);
  assert.match(finish, /pending_archive\.tasks_awaiting_archive/);
  assert.match(finish, /does not classify the normal task record into commit recovery versus push recovery/);
  assert.match(finish, /enter `trellis-push` completed-task preflight/);
  assert.doesNotMatch(finish, /Normal task-record commit pending/);
  assert.doesNotMatch(finish, /Normal task-record push pending/);
  assert.match(finish, /must not recommit or push the normal task record itself/);
  assert.match(finish, /### 2\. Decision Audit/);
  assert.match(finish, /decision_log\.py status --task <task-name> --json/);
  assert.match(finish, /preserves the existing `completedAt` and performs no lifecycle status write/);
  assert.match(continueRecovery, /task_progress\.py status --json/);
  assert.match(continueRecovery, /Never rebind the session or task automatically/);
  assert.match(continueRecovery, /taskStatus=completed/);
  assert.match(continueRecovery, /Enter the `trellis-push` completed-task preflight/);
  assert.doesNotMatch(continueRecovery, /auto_loop\.py status|@\{u\}\.\.HEAD|pending_archive\.tasks_awaiting_archive/);
  assert.match(continueRecovery, /task_progress\.py reopen --task <task-name> --json/);
  assert.match(completedState, /Business work and final task progress are complete/);
  assert.match(completedState, /Enter the `trellis-push` completed-task preflight/);
  assert.match(completedState, /does not inspect Git or auto-loop details itself/);
  assert.doesNotMatch(completedState, /pending_archive|@\{u\}\.\.HEAD/);
  assert.match(progress, /def _validate_progress/);
  assert.match(progress, /os\.replace\(temp_path, path\)/);
  assert.match(progress, /def cmd_reopen/);
  assert.match(progress, /--complete/);
});

test("Workflow Gate 可达性场景覆盖真实入口顺序", () => {
  const requestTriage = readSource(
    "overrides/patches/workflow/intent-routing/request-triage/content.md",
  );
  const noTask = readSource("overrides/patches/workflow/state-no-task/content.md");
  const planning = readSource(
    "overrides/patches/workflow/states-planning/common-content.md",
  );
  const untracked = readSource(
    "overrides/patches/workflow/state-untracked/content.md",
  );
  const inProgress = readSource(
    "overrides/patches/workflow/states-in-progress/common-content.md",
  );
  const continueRecovery = readSource(
    "overrides/patches/skills/trellis-continue/task-progress-recovery/content.md",
  );
  const route = readSource(".agents/skills/trellis-route/SKILL.md");
  const push = readSource(".agents/skills/trellis-push/SKILL.md");
  const pushTemplates = readSource(
    ".agents/skills/trellis-push/references/output-templates.md",
  );
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
    "For quick direct edit",
    "无任务非平凡 inspect/direct_edit",
  );
  assert.match(requestTriage, /follow its returned `load_strategy`/);
  assert.match(requestTriage, /and `action`/);
  assert.match(requestTriage, /build a short query from the request, intended commands, affected files or systems/);
  assert.doesNotMatch(noTask, /load_strategy/);
  assert.doesNotMatch(planning, /load_strategy/);
  assert.doesNotMatch(inProgress, /load_strategy/);
  assert.match(requestTriage, /Use quick direct edit for one-turn small fixes/);
  assert.match(requestTriage, /Use tracked direct edit only when the user explicitly wants no task but still wants later turns to remember the current phase/);
  assert.match(noTask, /untracked_flow\.py begin --summary/);
  assert.match(noTask, /--mode tracked-direct-edit/);
  assert.match(noTask, /Never create `untracked_flow` for `workflow_action` itself/);
  assert.match(noTask, /A same-item hit resumes the existing state/);
  assert.match(noTask, /`active-work-conflict` blocks unrelated code writes/);
  assert.match(noTask, /starts at `stage=implement`/);
  assert.match(noTask, /helper is a workflow cursor/);
  assert.match(untracked, /\[workflow-state:untracked_check\]/);
  assert.match(untracked, /\[workflow-state:untracked_spec\]/);
  assert.match(untracked, /\[workflow-state:untracked_push\]/);
  assert.match(untracked, /load `trellis-push`/);
  assert.match(untracked, /task_intent\.py adopt/);
  assert.match(untracked, /planning artifacts, Brief review, and `task\.py start`/);
  assert.match(planning, /task_intent\.py discard --task <current-task>/);
  assert.doesNotMatch(requestTriage, /untracked_flow\.py begin/);
  assert.doesNotMatch(requestTriage, /task_intent\.py adopt/);
  assert.doesNotMatch(requestTriage, /task_intent\.py discard/);

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
  assert.match(continueRecovery, /a completed candidate uses the same Push preflight/);
  assert.match(continueRecovery, /Do not inspect or classify completed Git recovery here/);
  assert.match(continueRecovery, /or resume Git\/commit orchestration from progress text/);
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
  assert.match(pushTemplates, /### 完成链证据/);
  assert.match(pushTemplates, /\*\*Check-All\*\*：<通过 \/ 通过（已接受风险：CHK-001,FBK-002） \/ 未运行 \/ 已失效 \/ 存在未处置 findings \/ blocked \/ 部分验证>/);
  assert.match(pushTemplates, /\*\*Update-Spec\*\*：<no-op \/ written \/ needs-review \/ 未运行 \/ 已失效>/);
  assert.match(pushTemplates, /`\[上线后验证\]` 作为非阻断风险逐项保留/);
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
