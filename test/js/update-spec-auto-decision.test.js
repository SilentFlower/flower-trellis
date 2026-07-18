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

test("Update-Spec override 自主返回三态且限制最小必要写入", () => {
  const override = read(
    sourceRoot,
    "overrides/skills/trellis-update-spec.md",
  );

  assert.match(override, /status: no-op \| written \| needs-review/);
  assert.match(override, /不得进入上游 Interactive Mode/);
  assert.match(override, /只有 `needs-review` 可以停止/);
  assert.match(override, /\.trellis\/spec\/\*\*/);
  assert.match(override, /最小章节和最少文件/);
  assert.match(override, /不得顺带重写、扩写、整理或格式化无关内容/);
  assert.match(override, /git diff --check -- \.trellis\/spec/);
  assert.match(override, /`no-op` \/ `written` 必须在同一轮加载 `trellis-push`/);
  assert.match(override, /spec-needs-review/);

  const evidence = [
    "implement.jsonl",
    "prd.md",
    "Check-All 最终结论",
    "当前任务实际 diff",
    "spec_router.py",
  ];
  for (let i = 1; i < evidence.length; i++) {
    assert.ok(
      override.indexOf(evidence[i - 1]) < override.indexOf(evidence[i]),
      `${evidence[i - 1]} 应先于 ${evidence[i]}`,
    );
  }
});

test("交互 Check-All 保留停止点且用户继续后同轮进入 Update-Spec 和 Push", () => {
  const workflow = read(sourceRoot, "overrides/workflow.md");
  const state = read(sourceRoot, "overrides/workflow-states/in_progress.md");
  const inlineState = read(
    sourceRoot,
    "overrides/workflow-states/in_progress-inline.md",
  );
  const checkAll = read(
    sourceRoot,
    ".agents/skills/trellis-check-all/SKILL.md",
  );

  const postCheck = workflow.slice(
    workflow.indexOf("#### Interactive Post-Check Stop Gate"),
    workflow.indexOf("#### Code Commit Confirmation Gate"),
  );
  assert.match(postCheck, /Stop and wait for the user to continue/);
  assert.match(postCheck, /must load `trellis-update-spec` in the same turn/);
  assert.match(postCheck, /`no-op` \/ `written` then loads `trellis-push` in the same turn/);
  assert.match(postCheck, /Missing current results run spec first/);
  assert.doesNotMatch(postCheck, /spec_update_result|changed_files|\.trellis\/spec/);
  assert.match(state, /next\/continue.*must run `trellis-update-spec`/);
  assert.match(inlineState, /next\/continue.*must run `trellis-update-spec`/);
  assert.doesNotMatch(state, /spec_update_result|changed_files|\.trellis\/spec/);
  assert.doesNotMatch(inlineState, /spec_update_result|changed_files|\.trellis\/spec/);
  assert.match(checkAll, /## Interactive Post-Check Stop Gate/);
  assert.match(checkAll, /立即停止并等待用户选择/);
});

test("auto-loop 对 Update-Spec 三态使用确定性 record 映射", () => {
  const agents = read(sourceRoot, ".agents/skills/trellis-auto-loop/SKILL.md");
  const claude = read(sourceRoot, ".claude/skills/trellis-auto-loop/SKILL.md");
  const runner = read(sourceRoot, "scripts/auto_loop.py");

  assert.equal(agents, claude);
  assert.match(agents, /`no-op` \/ `written`.*--result ok/);
  assert.match(agents, /`needs-review`.*--failure-type spec-needs-review/);
  assert.match(runner, /no-op\/written[\s\S]*run_spec_update --result ok/);
  assert.match(runner, /needs-review[\s\S]*spec-needs-review/);
});

test("0.6 发布快照包含相同 Update-Spec 自主决策协议", () => {
  const paths = [
    "overrides/skills/trellis-update-spec.md",
    "overrides/workflow.md",
    "overrides/workflow-states/in_progress.md",
    "overrides/workflow-states/in_progress-inline.md",
    ".agents/skills/trellis-auto-loop/SKILL.md",
    ".claude/skills/trellis-auto-loop/SKILL.md",
    "scripts/auto_loop.py",
  ];

  for (const relativePath of paths) {
    assert.equal(read(snapshotRoot, relativePath), read(sourceRoot, relativePath), relativePath);
  }
});
