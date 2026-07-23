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
  const taskBrief = readSource(".agents/skills/trellis-task-brief/SKILL.md");
  const beforeDev = readSource(
    "overrides/patches/skills/trellis-before-dev/project-knowledge-discovery/content.md",
  );
  const updateHook = readRoot("src/assets/flower_update_hook.py");
  const selfUpdate = readRoot("src/commands/self-update.js");
  const activeState = readSource(
    "overrides/patches/workflow/states-in-progress/common-content.md",
  );
  const route = readSource(".agents/skills/trellis-route/SKILL.md");
  const checkAll = readSource(".agents/skills/trellis-check-all/SKILL.md");
  const push = readSource(".agents/skills/trellis-push/SKILL.md");
  const autoLoop = readSource(".agents/skills/trellis-auto-loop/SKILL.md");
  const finish = readSource(
    "overrides/patches/skills/trellis-finish-work/exact-bookkeeping/content.md",
  );
  const progress = readSource("scripts/task_progress.py");

  assert.match(requestTriage, /`direct_edit` requires known, bounded, local, low-risk, reversible scope/);
  assert.match(requestTriage, /task_intent\.py discard --task <current-task>/);
  assert.match(brainstorm, /Wait for the user's planning review confirmation/);
  assert.match(taskBrief, /等待用户确认 planning artifacts 和 brief/);
  assert.match(beforeDev, /python3 \.\/\.trellis\/scripts\/spec_router\.py/);
  assert.match(updateHook, /priority: blocking_confirmation_required/);
  assert.match(selfUpdate, /post_action: "run_trellis_push_confirmation"/);
  assert.match(activeState, /New work outside the active task title\/brief must stop before routing or edits/);
  assert.match(route, /合法 route 决策必须能追溯到/);
  assert.ok(
    checkAll.indexOf("## Auto-Loop Return Gate")
      < checkAll.indexOf("## Interactive Post-Check Stop Gate"),
  );
  assert.match(push, /Phase 3\.4 唯一的代码提交入口/);
  assert.match(push, /git commit --only/);
  assert.match(autoLoop, /## Commit-Only 预授权/);
  assert.match(finish, /This skill owns only the current task's release audit, archive bookkeeping/);
  assert.match(progress, /def _validate_progress/);
  assert.match(progress, /os\.replace\(temp_path, path\)/);
});

test("最终 dogfood 产物只有一个 Hub marker 且 owner Patch 已落盘", () => {
  const workflow = readRoot(".trellis/workflow.md");
  const beforeDevAgents = readRoot(".agents/skills/trellis-before-dev/SKILL.md");
  const beforeDevClaude = readRoot(".claude/skills/trellis-before-dev/SKILL.md");

  assert.equal(
    (workflow.match(/BEGIN skill-garden patch workflow-hub v0\.6/g) || []).length,
    1,
  );
  assert.match(workflow, /### Skill-Garden Workflow Owner Index/);
  assert.doesNotMatch(workflow, /#### Request Intent Routing/);
  assert.match(beforeDevAgents, /BEGIN skill-garden patch before-dev-project-knowledge-discovery/);
  assert.match(beforeDevClaude, /BEGIN skill-garden patch before-dev-project-knowledge-discovery/);
});
