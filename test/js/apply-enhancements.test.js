import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { applyEnhancements } from "../../src/lib/apply-enhancements.js";
import { ENHANCEMENTS_ROOT } from "../../src/lib/paths.js";

const V06_DIR = path.join(ENHANCEMENTS_ROOT, "0.6");
const TRANSFORM_DIR = path.join(V06_DIR, "overrides", "transforms");

function write(root, relativePath, value) {
  const file = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value);
  return file;
}

function match(name) {
  return fs.readFileSync(path.join(TRANSFORM_DIR, "matches", name), "utf8").trimEnd();
}

function minimalWorkflow() {
  return [
    "## Phase Index",
    "",
    "```",
    match("workflow-phase-summary.md"),
    "Phase 2: Execute",
    "Phase 3: Finish",
    "```",
    "",
    "### Request Triage",
    "",
    match("workflow-request-triage.md"),
    "",
    "[workflow-state:no_task]",
    match("workflow-no-task-body.md"),
    "[/workflow-state:no_task]",
    "",
    "### Phase 1: Plan",
    match("workflow-phase-index-create-task.md"),
    "",
    "[workflow-state:planning]",
    "Planning body.",
    "[/workflow-state:planning]",
    "",
    "[workflow-state:planning-inline]",
    "Planning inline body.",
    "[/workflow-state:planning-inline]",
    "",
    "[workflow-state:in_progress]",
    "In progress body.",
    "[/workflow-state:in_progress]",
    "",
    "[workflow-state:in_progress-inline]",
    "In progress inline body.",
    "[/workflow-state:in_progress-inline]",
    "",
    "## Phase 1: Plan",
    "",
    match("workflow-phase-one-goal.md"),
    "",
    "#### 1.0 Create task `[required · once]`",
    "",
    match("workflow-create-task-rule.md"),
    "",
    match("workflow-create-task-command.md"),
    "",
    "## Customizing Trellis (for forks)",
    "",
    "Critical invariants:",
    match("workflow-customization-intent-invariant.md"),
    "",
  ].join("\n");
}

function snapshotTree(root) {
  const files = new Map();
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile()) {
        files.set(path.relative(root, file).split(path.sep).join("/"), fs.readFileSync(file));
      }
    }
  }
  walk(root);
  return [...files.entries()].map(([name, value]) => [name, value.toString("base64")]);
}

function quietApply(target, options = { variant: "0.6" }) {
  const original = console.log;
  console.log = () => {};
  try {
    return applyEnhancements(target, options);
  } finally {
    console.log = original;
  }
}

test("required transform 漂移时强化流水线零写入且 manifest 不更新", () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "flower-apply-drift-"));
  write(target, ".trellis/.version", "0.6.5\n");
  const workflow = write(target, ".trellis/workflow.md", "upstream drift\n");
  const before = snapshotTree(target);

  assert.throws(() => quietApply(target), /声明式强化变换预检失败/);
  assert.deepEqual(snapshotTree(target), before);
  assert.equal(fs.readFileSync(workflow, "utf8"), "upstream drift\n");
  assert.equal(fs.existsSync(path.join(target, ".trellis/.flower-manifest.json")), false);
  assert.equal(fs.existsSync(path.join(target, ".agents")), false);
  assert.equal(fs.existsSync(path.join(target, ".claude")), false);
});

test("fresh 0.6 apply 写入 transform/helper/manifest 且重复运行文件树不变", () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "flower-apply-fresh-"));
  write(target, ".trellis/.version", "0.6.5\n");
  const workflow = write(target, ".trellis/workflow.md", minimalWorkflow());
  write(
    target,
    ".agents/skills/trellis-start/SKILL.md",
    `# Start\n\n${match("start-no-task-routing.md")}\n`,
  );
  write(
    target,
    ".agents/skills/trellis-brainstorm/SKILL.md",
    `# Brainstorm\n\n${match("brainstorm-planning-authorization.md")}\n\n` +
      `${match("brainstorm-auto-task-create.md")}\n`,
  );
  write(
    target,
    ".codex/hooks/session-start.py",
    `${match("codex-session-start-no-task.py")}\n`,
  );
  write(
    target,
    ".claude/hooks/session-start.py",
    `${match("claude-session-start-no-task.py")}\n`,
  );

  quietApply(target);
  const first = snapshotTree(target);
  const workflowText = fs.readFileSync(workflow, "utf8");
  assert.match(workflowText, /skill-garden transform workflow-request-triage/);
  assert.match(workflowText, /#### Request Intent Routing/);
  assert.doesNotMatch(workflowText, /ask only whether this turn should create/);
  assert.match(workflowText, /task_intent\.py create --title/);
  assert.match(workflowText, /only for a task auto-created by intent routing/);
  assert.match(workflowText, /Keep manual or historical tasks unchanged/);
  assert.match(
    fs.readFileSync(path.join(target, ".agents/skills/trellis-brainstorm/SKILL.md"), "utf8"),
    /task_intent\.py create --title/,
  );
  assert.doesNotMatch(
    fs.readFileSync(path.join(target, ".codex/hooks/session-start.py"), "utf8"),
    /task-creation consent/,
  );
  assert.doesNotMatch(
    fs.readFileSync(path.join(target, ".claude/hooks/session-start.py"), "utf8"),
    /asks only whether|task creation and planning are allowed/,
  );
  assert.equal(
    fs.existsSync(path.join(target, ".trellis/scripts/task_intent.py")),
    true,
  );
  const manifest = JSON.parse(
    fs.readFileSync(path.join(target, ".trellis/.flower-manifest.json"), "utf8"),
  );
  assert.equal(manifest.variant, "0.6");
  assert.ok(manifest.paths.includes(".trellis/scripts/task_intent.py"));

  quietApply(target);
  assert.deepEqual(snapshotTree(target), first);
});

test("task-intent 与 intent-routing 精细安装都会刷新完整 intent unit", () => {
  for (const alias of ["task-intent", "intent-routing"]) {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), `flower-alias-${alias}-`));
    write(target, ".trellis/.version", "0.6.5\n");
    const workflow = write(target, ".trellis/workflow.md", minimalWorkflow());

    quietApply(target, { variant: "0.6", skills: [alias] });

    const value = fs.readFileSync(workflow, "utf8");
    assert.match(value, /#### Request Intent Routing/);
    assert.match(value, /skill-garden transform workflow-request-triage/);
    assert.equal(
      fs.existsSync(path.join(target, ".trellis/scripts/task_intent.py")),
      true,
    );
    assert.equal(
      fs.existsSync(path.join(target, ".trellis/scripts/spec_router.py")),
      true,
    );
  }
});
