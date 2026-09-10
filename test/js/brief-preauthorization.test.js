import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const sourceRoot = path.resolve("vendor/skill-garden/.trellis/0.6");
const snapshotRoot = path.resolve("enhancements/0.6");

function read(root, relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("Brief 显式预授权只形成文案级窄例外", () => {
  const phase = read(
    sourceRoot,
    "overrides/patches/workflow/task-brief-review/phase-1-activate-content.md",
  );
  const agents = read(sourceRoot, ".agents/skills/trellis-task-brief/SKILL.md");
  const claude = read(sourceRoot, ".claude/skills/trellis-task-brief/SKILL.md");
  const brainstormHandoff = read(
    sourceRoot,
    "overrides/patches/skills/trellis-brainstorm/planning-handoff/content.md",
  );
  const briefShape = read(
    sourceRoot,
    "overrides/patches/skills/trellis-brainstorm/planning-handoff/summary-shape-content.md",
  );
  const startPatch = [
    "helper-content.py",
    "guard-content.py",
    "degraded-content.py",
    "session-content.py",
  ].map((name) => read(
    sourceRoot,
    `overrides/patches/scripts/task-start-brief-gate/${name}`,
  )).join("\n");

  assert.equal(agents, claude);
  assert.match(phase, /Unless `trellis-task-brief` validates an explicit preauthorization/);
  assert.match(phase, /Ordinary implementation or task-creation intent is not confirmation/);
  assert.match(phase, /After a later confirmation, or in the same turn/);
  assert.doesNotMatch(phase, /If the final Brief expands scope|permission\/security\/privacy/);
  assert.match(agents, /展示后直接开始 \/ 不用再次确认 \/ 视为已确认/);
  assert.match(agents, /普通实现或建任务意图不是 Brief 预授权/);
  assert.match(agents, /若最终内容扩大范围、仍有未解决 Open Questions/);
  assert.match(agents, /不建立跨会话永久偏好，也不写 session runtime/);
  assert.match(agents, /先完整展示，再在同一回合返回主 workflow/);
  assert.match(agents, /## Key Decisions/);
  assert.match(agents, /## Key Context/);
  assert.match(agents, /没有相关内容时直接省略 `Risks \/ Deferred` 整节/);
  assert.doesNotMatch(agents, /Artifact Status/);
  assert.doesNotMatch(agents, /Planning artifacts|Context manifests|Review: awaiting approval/);
  assert.match(agents, /只写进入下一阶段后的一个直接动作/);
  assert.match(brainstormHandoff, /display the full Brief in chat/);
  assert.doesNotMatch(brainstormHandoff, /Artifact Status/);
  assert.match(briefShape, /Non-Goals, Key Decisions, Key Context, Acceptance/);
  assert.doesNotMatch(briefShape, /Artifact Status/);
  const persistedTemplate = agents.slice(
    agents.indexOf("## 模板"),
    agents.indexOf("## 展示格式"),
  );
  assert.doesNotMatch(persistedTemplate, /^## Artifact Status$/m);
  assert.equal(
    fs.existsSync(path.join(sourceRoot, "scripts/brief_review_state.py")),
    false,
  );
  assert.doesNotMatch(startPatch, /brief_review_state|planning_start_authorization/);
});

test("Brief 规划阶段展示确认，实现及恢复阶段读取执行", () => {
  const skill = read(sourceRoot, ".agents/skills/trellis-task-brief/SKILL.md");
  const state = read(
    sourceRoot,
    "overrides/patches/workflow/states-in-progress/common-content.md",
  );
  const trellisVersion = JSON.parse(fs.readFileSync("package.json", "utf8"))
    .dependencies["@mindfoldhq/trellis"];
  const compiled = read(
    path.resolve("vendor/skill-garden/compiled-targets", trellisVersion, "full/targets"),
    ".trellis/workflow.md",
  );

  assert.match(state, /read `<task>\/brief\.md` and task artifacts without routine redisplay, including after context recovery/);
  assert.match(state, /if the Brief is missing, follow `trellis-task-brief` backfill guidance/);
  assert.match(skill, /`in_progress` 阶段只读取 brief 和任务材料，不例行重新生成、展示或确认；新会话或压缩恢复同样如此/);
  assert.match(skill, /范围变化沿用 workflow 的既有评审门禁，用户明确要求查看时再完整展示/);
  assert.match(skill, /只有用户明确要求当场回补并 review 时，才继续写回/);
  assert.doesNotMatch(skill, /## 实现阶段承接|交接已完成且内容未变|恢复交接上下文|展示计数|三个展示场景都完整展示/);

  for (const name of ["in_progress", "in_progress-inline"]) {
    const body = compiled.split(`\n[workflow-state:${name}]\n`)[1]
      ?.split(`\n[/workflow-state:${name}]`)[0];
    assert.ok(body, name);
    assert.match(body, /read `<task>\/brief\.md` and task artifacts without routine redisplay/, name);
    assert.match(body, /Active Task Scope Guard/, name);
    assert.doesNotMatch(body, /restate `<task>\/brief\.md`|implementation handoff|reuse the unchanged reviewed Brief/, name);
  }
});

test("0.6 发布快照与 Brief 交接作者源一致", () => {
  for (const relativePath of [
    ".agents/skills/trellis-task-brief/SKILL.md",
    ".claude/skills/trellis-task-brief/SKILL.md",
    "overrides/patches/skills/trellis-brainstorm/planning-handoff/content.md",
    "overrides/patches/skills/trellis-brainstorm/planning-handoff/readiness-content.md",
    "overrides/patches/skills/trellis-brainstorm/planning-handoff/summary-shape-content.md",
    "overrides/patches/workflow/task-brief-review/phase-1-activate-content.md",
    "overrides/patches/workflow/states-in-progress/common-content.md",
    "overrides/conflicts.json",
  ]) {
    assert.equal(read(snapshotRoot, relativePath), read(sourceRoot, relativePath), relativePath);
  }
});
