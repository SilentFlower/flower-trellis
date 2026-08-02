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
  assert.match(agents, /没有相关内容时直接省略 `Risks \/ Deferred` 整节/);
  assert.match(agents, /`Artifact Status` 只在对话展示时/);
  assert.match(agents, /不能把文件存在等同于已策展/);
  assert.match(agents, /只写进入下一阶段后的一个直接动作/);
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

test("0.6 发布快照与 Brief 预授权作者源一致", () => {
  for (const relativePath of [
    ".agents/skills/trellis-task-brief/SKILL.md",
    ".claude/skills/trellis-task-brief/SKILL.md",
    "overrides/patches/workflow/task-brief-review/phase-1-activate-content.md",
    "overrides/conflicts.json",
  ]) {
    assert.equal(read(snapshotRoot, relativePath), read(sourceRoot, relativePath), relativePath);
  }
});
