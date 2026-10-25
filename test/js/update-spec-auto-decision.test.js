import assert from "node:assert/strict";
import { readCheckAllContract, readPushContract } from "./prompt-contract-helpers.js";
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
  assert.match(override, /a `no-op` or `written` result must load `trellis-push` in the same turn/i);
  assert.match(override, /spec-needs-review/);
  assert.match(override, /“下一步”, “继续”, `next`, `continue`/);
  assert.match(override, /follow the continuation decision made by Check-All's `Interactive Post-Check Stop Gate`/);
  assert.match(override, /including strict pass and accepted-risk pass/);
  assert.match(override, /Check-All report or brief acceptance acknowledgment/);
  assert.match(override, /do not infer risk acceptance or Git write authorization from unrelated history, summaries, dirty state/);
  assert.match(override, /Do not treat an agent-authored "no commit\/push" restriction in task artifacts or ordinary implementation-plan approval as an explicit user stop instruction/);
  assert.match(override, /stopping this handoff requires an explicit user instruction/);
  assert.match(override, /pending Git write authorization does not block presenting the Push plan/);
  assert.match(override, /an explicit check-only or stop-after-check request keeps the chain stopped/);
  assert.match(override, /no deliverable changes.*no commit is needed/);
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

test("交互 Check-All 通过默认同轮收尾，明确停止、人工修复和 Git 确认边界保留", () => {
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
  const checkAllReporting = readCheckAllContract(sourceRoot);
  const push = readPushContract(sourceRoot);
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
  const autoLoopReturn = read(sourceRoot, ".agents/skills/trellis-check-all/references/auto-loop-return.md");
  assert.match(autoLoopReturn, /不提示用户回复“继续”/);
  assert.match(autoLoopReturn, /record 成功后立即 `next`/);
  assert.match(autoLoopReturn, /status=retryable reason=artifact-drift/);
  assert.match(autoLoopReturn, /不得 `next`/);
  assert.match(updateSpec, /only after a successful record immediately run `next`/);
  assert.match(updateSpec, /resubmit the original truthful record/);
  assert.doesNotMatch(autoLoopReturn, /提示用户回复 `继续`/);
  assert.match(postCheck, /只从当前完成链证据识别 direct Git intent/);
  assert.match(postCheck, /全部 findings 已有效接受/);
  assert.match(postCheck, /风险接受沿用 findings reference 的证据规则/);
  assert.match(postCheck, /报告或简短确认后同轮进入 Update-Spec/);
  assert.match(postCheck, /先识别当前事项最新有效的明确停止要求/);
  for (const stop of ["只检查", "只读检查", "检查后停止", "暂不收尾", "仅接受、不继续"]) {
    assert.ok(postCheck.includes(`\`${stop}\``), stop);
  }
  assert.match(postCheck, /同一事项后续明确继续可解除该限制/);
  assert.match(postCheck, /普通“检查一下”不等于只检查后停止/);
  assert.match(postCheck, /普通代码问题始终由用户选择修复范围/);
  assert.match(postCheck, /没有有效停止要求且 strict pass，或全部 findings 已有效接受时，默认同轮继续/);
  assert.match(postCheck, /无需 direct Git intent 或额外回复“继续”，通过不授权 Git 写入/);
  assert.ok(postCheck.indexOf("先识别当前事项") < postCheck.indexOf("未处置 `CHK-*`"));
  assert.ok(postCheck.indexOf("未处置 `CHK-*`") < postCheck.indexOf("没有有效停止要求且 strict pass"));
  assert.doesNotMatch(postCheck, /普通 interactive 检查保持原行为|提示用户回复 `继续`/);
  assert.match(postCheck, /### 交互式下一步引导/);
  assert.match(postCheck, /无有效停止要求且 strict pass \/ 已接受风险通过：说明本轮正在进入 `trellis-update-spec`/);
  assert.match(postCheck, /有有效的明确停止要求且检查通过：说明已按要求停止/);
  assert.match(postCheck, /完成后重跑 Check-All/);
  assert.match(postCheck, /不新增 direct Git 摘要或 Git 计划/);
  assert.match(workflow, /Interactive completion proceeds Check-All -> `trellis-update-spec` -> `trellis-push`/);
  assert.doesNotMatch(postCheck, /spec_update_result|changed_files|\.trellis\/spec/);
  assert.match(state, /interactive strict pass or valid accepted-risk pass defaults to same-turn `trellis-update-spec`/);
  assert.match(inlineState, /explicit check-only\/stop requests and unresolved findings stop/);
  assert.doesNotMatch(state, /spec_update_result|changed_files|\.trellis\/spec/);
  assert.doesNotMatch(inlineState, /spec_update_result|changed_files|\.trellis\/spec/);
  assert.match(checkAllReporting, /## Interactive Post-Check Stop Gate/);
  assert.match(checkAllReporting, /通过且按下方 Gate 默认推进时执行 `advance --stage spec`/);
  assert.match(checkAllReporting, /用户明确只检查或检查后停止时保持 `stage=check`/);
  assert.match(state, /Later next\/continue resumes a deliberately stopped completion chain/);
  assert.match(state, /follow the `Interactive Post-Check Stop Gate`/);
  assert.doesNotMatch(state, /no-op.*written|partial verification|material residual risk/);
  assert.match(updateSpec, /Interactive completion, including direct Git/);
  assert.match(updateSpec, /Default continuation does not authorize Git writes/);
  assert.match(push, /普通 push 或用户 `commit-only` 已经构成明确 Git 意图/);
  assert.match(push, /根据当前 `spec_update_result` 与实际 diff 标记/);
  assert.match(push, /本步骤不得返回 Phase 2\.2/);
  assert.match(push, /不得加载 `trellis-check-all` 或 `trellis-update-spec`/);
  assert.match(push, /不会阻止读取 Git 状态或生成提交计划/);
  assert.match(push, /即将展示用户可见计划时，读取 `references\/output-templates\.md`/);
  assert.match(push, /即将展示用户可见结果时，读取 `references\/output-templates\.md`/);
  assert.match(push, /已读、未变化且内容仍可用时直接复用/);
  assert.match(push, /模板变化或上下文缺失才重读/);
  assert.match(push, /“共用展示规则”、“结果模板”和“结果补充规则”/);
  assert.match(push, /不得凭记忆重建、缩写或自制替代模板/);
  assert.match(pushTemplates, /### 完成链证据/);
  assert.match(pushTemplates, /`未运行`、`已失效`、任一未处置 `CHK-\*` \/ `FBK-\*`、blocked、部分验证或 `needs-review` 同时计入风险区/);
  assert.match(pushTemplates, /`\[上线后验证\]` 作为非阻断风险逐项保留/);
  assert.match(pushTemplates, /既有 `trellis-release` \/ `release\.md` 流程承接/);
  assert.match(push, /有效已接受风险/);
  assert.match(pushTemplates, /通过（N 项风险已接受）/);
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
