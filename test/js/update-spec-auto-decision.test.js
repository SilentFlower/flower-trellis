import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sourceRoot = path.join(projectRoot, "vendor/skill-garden/.trellis/0.6");
const snapshotRoot = path.join(projectRoot, "enhancements/0.6");

function read(root, relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("Update-Spec Patch 使用英文协议、自主返回三态且限制最小必要写入", () => {
  const override = read(
    sourceRoot,
    "overrides/patches/skills/trellis-update-spec/autonomous-evaluation/content.md",
  );

  assert.match(override, /status: no-op \| written \| needs-review/);
  assert.match(override, /Do not enter the upstream Interactive Mode/);
  assert.match(override, /Only `needs-review` may stop/);
  assert.match(override, /\.trellis\/spec\/\*\*/);
  assert.match(override, /smallest required section in the fewest files/);
  assert.match(override, /Do not opportunistically rewrite, expand, reorganize, or format unrelated content/);
  assert.match(override, /git diff --check -- \.trellis\/spec/);
  assert.match(override, /A `no-op` or `written` result must load `trellis-push` in the same turn/);
  assert.match(override, /spec-needs-review/);
  assert.match(override, /“下一步”, “继续”, `next`, `continue`/);
  assert.match(override, /ordinary push or a user-initiated `commit-only`/);
  assert.match(override, /existing standard Check-All report/);
  assert.match(override, /Do not infer this intent from history, summaries, dirty state/);
  assert.doesNotMatch(
    override.replace("“下一步”, “继续”", ""),
    /\p{Script=Han}/u,
  );

  const evidence = [
    "implement.jsonl",
    "prd.md",
    "final Check-All conclusion",
    "actual diff",
    "spec_router.py",
  ];
  for (let i = 1; i < evidence.length; i++) {
    assert.ok(
      override.indexOf(evidence[i - 1]) < override.indexOf(evidence[i]),
      `${evidence[i - 1]} 应先于 ${evidence[i]}`,
    );
  }
});

test("交互 Check-All 默认停止，direct Git 通过或风险接受后同轮进入 Update-Spec 和 Push", () => {
  const workflow = read(sourceRoot, "overrides/patches/workflow/hub/content.md");
  const state = read(
    sourceRoot,
    "overrides/patches/workflow/states-in-progress/common-content.md",
  );
  const inlineState = state;
  const checkAll = read(
    sourceRoot,
    ".agents/skills/trellis-check-all/SKILL.md",
  );
  const checkAllReporting = read(
    sourceRoot,
    ".agents/skills/trellis-check-all/references/reporting-and-disposition.md",
  );
  const push = read(sourceRoot, ".agents/skills/trellis-push/SKILL.md");
  const pushTemplates = read(
    sourceRoot,
    ".agents/skills/trellis-push/references/output-templates.md",
  );
  const updateSpec = read(
    sourceRoot,
    "overrides/patches/skills/trellis-update-spec/autonomous-evaluation/content.md",
  );

  const postCheck = checkAllReporting.slice(
    checkAllReporting.indexOf("## Interactive Post-Check Stop Gate"),
    checkAllReporting.length,
  );
  const autoLoopReturn = checkAllReporting.slice(
    checkAllReporting.indexOf("## Auto-Loop Return Gate"),
    checkAllReporting.indexOf("## Interactive Post-Check Stop Gate"),
  );
  assert.match(autoLoopReturn, /不提示用户回复“继续”/);
  assert.match(autoLoopReturn, /record 成功后立即 `next`/);
  assert.match(autoLoopReturn, /status=retryable reason=artifact-drift/);
  assert.match(autoLoopReturn, /不得 `next`/);
  assert.doesNotMatch(autoLoopReturn, /提示用户回复 `继续`/);
  assert.match(postCheck, /只从当前完成链证据识别 direct Git intent/);
  assert.match(postCheck, /全部 findings 已有效接受/);
  assert.match(postCheck, /用户在当前报告上明确接受风险并要求继续/);
  assert.match(postCheck, /报告后同轮进入 Update-Spec/);
  assert.match(postCheck, /普通 interactive 检查保持原行为：报告后立即停止并等待用户选择/);
  assert.match(postCheck, /### 交互式下一步引导/);
  assert.match(postCheck, /direct Git strict pass 或已接受风险通过：说明本轮正在进入 `trellis-update-spec`/);
  assert.match(postCheck, /无 direct Git intent 且 strict pass \/ 已接受风险通过：提示用户回复 `继续`/);
  assert.match(postCheck, /完成后重跑 Check-All/);
  assert.match(postCheck, /不新增 direct Git 摘要或 Git 计划/);
  assert.match(workflow, /Interactive completion proceeds Check-All -> `trellis-update-spec` -> `trellis-push`/);
  assert.doesNotMatch(postCheck, /spec_update_result|changed_files|\.trellis\/spec/);
  assert.match(state, /next\/continue.*runs `trellis-update-spec`/);
  assert.match(inlineState, /next\/continue.*runs `trellis-update-spec`/);
  assert.doesNotMatch(state, /spec_update_result|changed_files|\.trellis\/spec/);
  assert.doesNotMatch(inlineState, /spec_update_result|changed_files|\.trellis\/spec/);
  assert.match(checkAllReporting, /## Interactive Post-Check Stop Gate/);
  assert.match(checkAllReporting, /普通 interactive 检查保持原行为/);
  assert.match(state, /A later interactive next\/continue/);
  assert.match(state, /explicit acceptance of the current report's findings followed by continue/);
  assert.match(state, /runs `trellis-update-spec`/);
  assert.match(state, /follow the `Interactive Post-Check Stop Gate`/);
  assert.match(state, /matching direct Git strict pass or accepted-risk pass may continue to `trellis-update-spec`/);
  assert.doesNotMatch(state, /no-op.*written|partial verification|material residual risk/);
  assert.match(updateSpec, /Interactive direct Git/);
  assert.match(push, /普通 push 或用户 `commit-only` 已经构成明确 Git 意图/);
  assert.match(push, /根据当前 `spec_update_result` 与实际 diff 标记/);
  assert.match(push, /本步骤不得返回 Phase 2\.2/);
  assert.match(push, /不得加载 `trellis-check-all` 或 `trellis-update-spec`/);
  assert.match(push, /不会阻止读取 Git 状态或生成提交计划/);
  assert.match(push, /即将展示用户可见计划时，必须即时读取 `references\/output-templates\.md`/);
  assert.match(push, /即将展示用户可见结果时，必须再次即时读取 `references\/output-templates\.md`/);
  assert.match(push, /“共用展示规则”、“结果模板”和“结果补充规则”/);
  assert.match(push, /不得凭记忆重建、缩写或自制替代模板/);
  assert.match(pushTemplates, /### 完成链证据/);
  assert.match(pushTemplates, /`未运行`、`已失效`、任一未处置 `CHK-\*` \/ `FBK-\*`、blocked、部分验证或 `needs-review` 同时计入风险区/);
  assert.match(pushTemplates, /`\[上线后验证\]` 作为非阻断风险逐项保留/);
  assert.match(pushTemplates, /既有 `trellis-release` \/ `release\.md` 流程承接/);
  assert.match(push, /所有剩余问题都有当前有效的用户风险接受时标记为 `通过（已接受风险）`/);
  assert.match(push, /auto-loop 内部 `commit-only` 已由 runner/);
  assert.doesNotMatch(push, /## Step 0：交互式完成链门禁/);
});

test("auto-loop 对 Update-Spec 三态使用确定性 record 映射", () => {
  const agents = read(sourceRoot, ".agents/skills/trellis-auto-loop/SKILL.md");
  const claude = read(sourceRoot, ".claude/skills/trellis-auto-loop/SKILL.md");
  const runner = read(sourceRoot, "scripts/auto_loop.py");

  assert.equal(agents, claude);
  assert.match(agents, /`no-op\|written` 用 ok/);
  assert.match(agents, /`needs-review` 用 blocked \+ `spec-needs-review`/);
  assert.match(runner, /no-op\/written[\s\S]*run_spec_update --result ok/);
  assert.match(runner, /needs-review[\s\S]*spec-needs-review/);
});

test("0.6 发布快照包含相同 Update-Spec 自主决策协议", () => {
  const paths = [
    "overrides/patches/skills/trellis-update-spec/autonomous-evaluation/content.md",
    "overrides/patches/workflow/hub/content.md",
    "overrides/patches/workflow/states-in-progress/common-content.md",
    "overrides/patches/workflow/states-in-progress/subagent-content.md",
    "overrides/patches/workflow/states-in-progress/inline-content.md",
    ".agents/skills/trellis-auto-loop/SKILL.md",
    ".claude/skills/trellis-auto-loop/SKILL.md",
    ".agents/skills/trellis-push/SKILL.md",
    ".claude/skills/trellis-push/SKILL.md",
    "scripts/auto_loop.py",
  ];

  for (const relativePath of paths) {
    assert.equal(read(snapshotRoot, relativePath), read(sourceRoot, relativePath), relativePath);
  }
});
