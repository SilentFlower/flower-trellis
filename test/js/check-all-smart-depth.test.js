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

test("Check-All 双平台副本统一智能深度契约", () => {
  const relativePath = ".agents/skills/trellis-check-all/SKILL.md";
  const agents = read(sourceRoot, relativePath);
  const claude = read(sourceRoot, ".claude/skills/trellis-check-all/SKILL.md");

  assert.equal(agents, claude);
  assert.match(agents, /requested_depth: auto \| light \| full/);
  assert.match(agents, /effective_depth: light \| full/);
  assert.match(agents, /hard-full 信号/);
  assert.match(agents, /简单检查.*轻量检查.*light check.*表示 light/);
  assert.match(agents, /全面检查.*最终检查.*提交前检查.*full check.*表示 full/);
  assert.match(agents, /以最后一次明确表达为准/);
  assert.match(agents, /light 通过正式满足 Phase 2\.2 检查门禁/);
  assert.ok(
    agents.indexOf("## Auto-Loop Return Gate")
      < agents.indexOf("## Interactive Post-Check Stop Gate"),
  );
  assert.match(agents, /最新用户消息识别 direct Git intent/);
  assert.match(agents, /findings、blocked、部分验证或实质剩余风险/);
  assert.match(agents, /普通 interactive 检查保持原行为/);
  assert.match(agents, /不新增 direct Git 专用摘要/);
});

test("route 只决定 Check-All 执行位置", () => {
  const agents = read(sourceRoot, ".agents/skills/trellis-route/SKILL.md");
  const claude = read(sourceRoot, ".claude/skills/trellis-route/SKILL.md");
  const routeState = read(
    sourceRoot,
    ".agents/skills/trellis-route/scripts/route_state.py",
  );

  assert.equal(agents, claude);
  assert.doesNotMatch(agents, /隐藏逃生口/);
  assert.doesNotMatch(agents, /`inline check`/);
  assert.doesNotMatch(agents, /`subagent check`/);
  assert.doesNotMatch(agents, /check-inline|check-subagent/);
  assert.match(routeState, /"check-inline": "check-all-inline"/);
  assert.match(routeState, /"check-subagent": "check-all-subagent"/);
  assert.match(routeState, /def _normalize_mode/);
  assert.match(agents, /light\/full 是 Check-All 的 requested depth/);
});

test("auto-loop 与 workflow 先续跑再应用交互停止门禁", () => {
  const workflow = read(sourceRoot, "overrides/patches/workflow/hub/content.md");
  const state = read(
    sourceRoot,
    "overrides/patches/workflow/states-in-progress/common-content.md",
  );
  const inlineState = state;
  const autoLoop = read(sourceRoot, ".agents/skills/trellis-auto-loop/SKILL.md");

  assert.match(
    workflow,
    /A validated auto-loop result returns through matching `record` \+ `next` before the interactive post-check stop applies/,
  );
  assert.match(state, /validated auto-loop immediately records and advances/);
  assert.match(inlineState, /validated auto-loop immediately records and advances/);
  assert.match(autoLoop, /--check-depth auto\|light\|full/);
  assert.match(autoLoop, /旧调用缺字段时只能按 `full \/ legacy-default-full`/);
});

test("0.6 发布快照与智能检查源保持一致", () => {
  const paths = [
    ".agents/skills/trellis-check-all/SKILL.md",
    ".claude/skills/trellis-check-all/SKILL.md",
    ".agents/skills/trellis-route/SKILL.md",
    ".agents/skills/trellis-route/scripts/route_state.py",
    ".claude/skills/trellis-route/SKILL.md",
    ".claude/skills/trellis-route/scripts/route_state.py",
    ".agents/skills/trellis-auto-loop/SKILL.md",
    ".claude/skills/trellis-auto-loop/SKILL.md",
    "overrides/patches/workflow/hub/content.md",
    "overrides/patches/workflow/states-in-progress/common-content.md",
    "overrides/patches/workflow/states-in-progress/subagent-content.md",
    "overrides/patches/workflow/states-in-progress/inline-content.md",
    "scripts/auto_loop.py",
  ];

  for (const relativePath of paths) {
    assert.equal(read(snapshotRoot, relativePath), read(sourceRoot, relativePath), relativePath);
  }
});
