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

test("交互 Check-All 保留停止点且用户继续后同轮进入 Update-Spec 和 Push", () => {
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

  const postCheck = checkAll.slice(
    checkAll.indexOf("## Interactive Post-Check Stop Gate"),
    checkAll.indexOf("## 反模式"),
  );
  assert.match(postCheck, /立即停止并等待用户选择/);
  assert.match(workflow, /Interactive completion proceeds Check-All -> `trellis-update-spec` -> `trellis-push`/);
  assert.doesNotMatch(postCheck, /spec_update_result|changed_files|\.trellis\/spec/);
  assert.match(state, /next\/continue.*runs `trellis-update-spec`/);
  assert.match(inlineState, /next\/continue.*runs `trellis-update-spec`/);
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
