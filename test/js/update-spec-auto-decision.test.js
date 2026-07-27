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

test("交互 Check-All 默认停止，direct Git 严格通过后同轮进入 Update-Spec 和 Push", () => {
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
  const push = read(sourceRoot, ".agents/skills/trellis-push/SKILL.md");
  const updateSpec = read(
    sourceRoot,
    "overrides/patches/skills/trellis-update-spec/autonomous-evaluation/content.md",
  );

  const postCheck = checkAll.slice(
    checkAll.indexOf("## Interactive Post-Check Stop Gate"),
    checkAll.indexOf("## 反模式"),
  );
  const autoLoopReturn = checkAll.slice(
    checkAll.indexOf("## Auto-Loop Return Gate"),
    checkAll.indexOf("## Interactive Post-Check Stop Gate"),
  );
  assert.match(autoLoopReturn, /不提示用户回复“继续”/);
  assert.match(autoLoopReturn, /`record \+ next` 就是唯一后续动作/);
  assert.doesNotMatch(autoLoopReturn, /提示用户回复 `继续`/);
  assert.match(postCheck, /最新用户消息识别 direct Git intent/);
  assert.match(postCheck, /整体结论通过、问题数为 0、无阻塞、无部分验证/);
  assert.match(postCheck, /标准报告输出后，同一轮进入 Phase 3\.3 `trellis-update-spec`/);
  assert.match(postCheck, /普通 interactive 检查保持原行为：报告后立即停止并等待用户选择/);
  assert.match(postCheck, /### 交互式下一步引导/);
  assert.match(postCheck, /direct Git 严格通过：说明本轮正在进入 `trellis-update-spec`/);
  assert.match(postCheck, /无 direct Git intent 且严格通过：提示用户回复 `继续`/);
  assert.match(postCheck, /完成后重新运行 Check-All/);
  assert.match(postCheck, /不新增 direct Git 专用摘要/);
  assert.match(workflow, /Interactive completion proceeds Check-All -> `trellis-update-spec` -> `trellis-push`/);
  assert.doesNotMatch(postCheck, /spec_update_result|changed_files|\.trellis\/spec/);
  assert.match(state, /next\/continue.*runs `trellis-update-spec`/);
  assert.match(inlineState, /next\/continue.*runs `trellis-update-spec`/);
  assert.doesNotMatch(state, /spec_update_result|changed_files|\.trellis\/spec/);
  assert.doesNotMatch(inlineState, /spec_update_result|changed_files|\.trellis\/spec/);
  assert.match(checkAll, /## Interactive Post-Check Stop Gate/);
  assert.match(checkAll, /普通 interactive 检查保持原行为/);
  assert.match(state, /later interactive next\/continue runs `trellis-update-spec`/);
  assert.match(state, /follow the `Interactive Post-Check Stop Gate`/);
  assert.match(state, /matching direct Git strict pass may continue to `trellis-update-spec`/);
  assert.doesNotMatch(state, /no-op.*written|partial verification|material residual risk/);
  assert.match(updateSpec, /Interactive direct Git/);
  assert.match(push, /任何普通 push 或用户 `commit-only`/);
  assert.match(push, /当前有效的 `spec_update_result`/);
  assert.match(push, /先加载 `trellis-update-spec`/);
  assert.match(push, /缺少有效 Check-All/);
  assert.match(push, /此分支不得运行 Update-Spec，也不得读取 Git 计划/);
  assert.match(push, /`spec_update_result\.status=written` 的 `changed_files`/);
  assert.match(push, /全部位于 `\.trellis\/spec\/\*\*`/);
  assert.match(push, /不触发额外 Check-All/);
  assert.ok(push.indexOf("缺少有效 Check-All") < push.indexOf("当前有效的 `spec_update_result`"));
  assert.match(push, /auto-loop 内部 `commit-only` 已由 runner/);
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
    "scripts/auto_loop.py",
  ];

  for (const relativePath of paths) {
    assert.equal(read(snapshotRoot, relativePath), read(sourceRoot, relativePath), relativePath);
  }
});
