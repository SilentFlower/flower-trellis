import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { applyEnhancements } from "../../src/lib/apply-enhancements.js";
import { ENHANCEMENTS_ROOT } from "../../src/lib/paths.js";

const V06_DIR = path.join(ENHANCEMENTS_ROOT, "0.6");
const PATCHES = path.join(V06_DIR, "overrides", "patches");

function write(root, relativePath, value) {
  const file = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value);
  return file;
}

function patchSource(ref, name) {
  return fs.readFileSync(path.join(PATCHES, ...ref.split("/"), name), "utf8").trimEnd();
}

function minimalWorkflow() {
  return [
    "## Phase Index",
    "",
    "```",
    patchSource("workflow/intent-routing/phase-summary", "selector.md"),
    "Phase 2: Execute",
    "Phase 3: Finish",
    "```",
    "",
    "### Request Triage",
    "",
    patchSource("workflow/intent-routing/request-triage", "selector.md"),
    "",
    "[workflow-state:no_task]",
    patchSource("workflow/state-no-task", "selector.md"),
    "[/workflow-state:no_task]",
    "",
    "### Phase 1: Plan",
    patchSource("workflow/intent-routing/phase-index-create-task", "selector.md"),
    "",
    "[workflow-state:planning]",
    patchSource("workflow/states-planning", "planning-baseline.md"),
    "[/workflow-state:planning]",
    "",
    "[workflow-state:planning-inline]",
    patchSource("workflow/states-planning", "planning-inline-baseline.md"),
    "[/workflow-state:planning-inline]",
    "",
    "[workflow-state:in_progress]",
    patchSource("workflow/states-in-progress", "in-progress-baseline.md"),
    "[/workflow-state:in_progress]",
    "",
    "[workflow-state:in_progress-inline]",
    patchSource("workflow/states-in-progress", "in-progress-inline-baseline.md"),
    "[/workflow-state:in_progress-inline]",
    "",
    "## Phase 1: Plan",
    "",
    patchSource("workflow/intent-routing/phase-one-goal", "selector.md"),
    "",
    "#### 1.0 Create task `[required · once]`",
    "",
    patchSource("workflow/intent-routing/create-task-rule", "selector.md"),
    "",
    patchSource("workflow/intent-routing/create-task-command", "selector.md"),
    "",
    "## Customizing Trellis (for forks)",
    "",
    "Critical invariants:",
    patchSource("workflow/intent-routing/customization-intent-invariant", "selector.md"),
    "",
  ].join("\n");
}

function writeUpdateSpecTargets(target) {
  const body = [
    "# Update Code-Spec",
    "",
    "KEEP BEFORE",
    "",
    patchSource("skills/trellis-update-spec/autonomous-evaluation", "baseline.md"),
    "",
    "## Quality Checklist",
    "",
    "KEEP AFTER",
    "",
  ].join("\n");
  const skill = `---\nname: trellis-update-spec\n---\n\n${body}`;
  return [
    write(target, ".agents/skills/trellis-update-spec/SKILL.md", skill),
    write(target, ".claude/skills/trellis-update-spec/SKILL.md", skill),
    write(target, ".claude/commands/trellis/update-spec.md", body),
  ];
}

function writeFinishTargets(target) {
  const agentBody = patchSource(
    "skills/trellis-finish-work/exact-bookkeeping",
    "baseline-agent.md",
  );
  const commandBody = patchSource(
    "skills/trellis-finish-work/exact-bookkeeping",
    "baseline-command.md",
  );
  return [
    write(
      target,
      ".agents/skills/trellis-finish-work/SKILL.md",
      `---\nname: trellis-finish-work\n---\n\n${agentBody}\n`,
    ),
    write(target, ".claude/commands/trellis/finish-work.md", `${commandBody}\n`),
  ];
}

function writeIntentTargets(target) {
  write(
    target,
    ".agents/skills/trellis-start/SKILL.md",
    `# Start\n\n${patchSource("skills/trellis-start/no-task-routing", "selector.md")}\n`,
  );
  const brainstorm = [
    "# Brainstorm",
    "",
    patchSource("skills/trellis-brainstorm/planning-authorization", "selector.md"),
    "",
    patchSource("skills/trellis-brainstorm/auto-task-create", "selector.md"),
    "",
  ].join("\n");
  write(target, ".agents/skills/trellis-brainstorm/SKILL.md", brainstorm);
  write(target, ".claude/skills/trellis-brainstorm/SKILL.md", brainstorm);
  write(
    target,
    ".codex/hooks/session-start.py",
    `${patchSource("hooks/codex-session-start/no-task-routing", "selector.py")}\n`,
  );
  write(
    target,
    ".claude/hooks/session-start.py",
    `${patchSource("hooks/claude-session-start/no-task-routing", "selector.py")}\n`,
  );
  const hookBaseline = patchSource(
    "hooks/inject-workflow-state/shared-runtime",
    "selector.py",
  );
  write(target, ".codex/hooks/inject-workflow-state.py", `${hookBaseline}\n`);
  write(target, ".claude/hooks/inject-workflow-state.py", `${hookBaseline}\n`);
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

test("required Patch 漂移时强化流水线零写入且 manifest 不更新", () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "flower-apply-drift-"));
  write(target, ".trellis/.version", "0.6.5\n");
  const workflow = write(target, ".trellis/workflow.md", "upstream drift\n");
  const before = snapshotTree(target);

  assert.throws(() => quietApply(target), /Patch 预检失败/);
  assert.deepEqual(snapshotTree(target), before);
  assert.equal(fs.readFileSync(workflow, "utf8"), "upstream drift\n");
  assert.equal(fs.existsSync(path.join(target, ".trellis/.flower-manifest.json")), false);
  assert.equal(fs.existsSync(path.join(target, ".agents")), false);
  assert.equal(fs.existsSync(path.join(target, ".claude")), false);
});

test("fresh 0.6 apply 写入 Patch/helper/provenance 且重复运行文件树不变", () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "flower-apply-fresh-"));
  write(target, ".trellis/.version", "0.6.5\n");
  const workflow = write(target, ".trellis/workflow.md", minimalWorkflow());
  writeIntentTargets(target);
  const updateSpecTargets = writeUpdateSpecTargets(target);
  const finishTargets = writeFinishTargets(target);

  quietApply(target);
  const first = snapshotTree(target);
  const workflowText = fs.readFileSync(workflow, "utf8");
  assert.match(workflowText, /skill-garden patch workflow-request-triage/);
  assert.match(workflowText, /skill-garden patch workflow-state-in-progress/);
  assert.match(workflowText, /#### Request Intent Routing/);
  assert.doesNotMatch(workflowText, /ask only whether this turn should create/);
  assert.doesNotMatch(workflowText, /Flow: .*finish-work/);
  assert.doesNotMatch(workflowText, /This guard overrides any lower/);
  assert.match(workflowText, /task_intent\.py create --title/);
  assert.equal(fs.existsSync(path.join(target, ".trellis/scripts/task_intent.py")), true);

  for (const file of updateSpecTargets) {
    const value = fs.readFileSync(file, "utf8");
    assert.match(value, /BEGIN skill-garden patch trellis-update-spec-autonomous-evaluation/);
    assert.doesNotMatch(value, /^## Interactive Mode$/m);
    assert.match(value, /KEEP BEFORE/);
    assert.match(value, /KEEP AFTER/);
  }
  for (const file of finishTargets) {
    const value = fs.readFileSync(file, "utf8");
    assert.match(value, /BEGIN skill-garden patch trellis-finish-work-exact-bookkeeping/);
    assert.doesNotMatch(value, /## Step 1: Survey current state/);
    assert.match(value, /### 1\. Current Task Release Audit/);
  }
  const manifest = JSON.parse(
    fs.readFileSync(path.join(target, ".trellis/.flower-manifest.json"), "utf8"),
  );
  assert.equal(manifest.variant, "0.6");
  assert.ok(manifest.paths.includes(".trellis/scripts/task_intent.py"));
  assert.equal(manifest.patches.schemaVersion, 1);
  assert.match(manifest.patches.catalogHash, /^sha256:/);
  assert.ok(manifest.patches.applied.some((item) => item.id === "workflow-state-in-progress"));
  assert.equal(fs.existsSync(path.join(target, ".codex/hooks.json")), true);
  assert.equal(fs.existsSync(path.join(target, ".claude/settings.json")), true);

  quietApply(target);
  assert.deepEqual(snapshotTree(target), first);
});

test("task-intent 与 intent-routing 精细安装刷新完整 intent Bundle", () => {
  for (const alias of ["task-intent", "intent-routing"]) {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), `flower-alias-${alias}-`));
    write(target, ".trellis/.version", "0.6.5\n");
    const workflow = write(target, ".trellis/workflow.md", minimalWorkflow());

    quietApply(target, { variant: "0.6", skills: [alias] });

    const value = fs.readFileSync(workflow, "utf8");
    assert.match(value, /#### Request Intent Routing/);
    assert.match(value, /skill-garden patch workflow-request-triage/);
    assert.match(value, /skill-garden patch workflow-state-planning/);
    assert.equal(fs.existsSync(path.join(target, ".trellis/scripts/task_intent.py")), true);
    assert.equal(fs.existsSync(path.join(target, ".trellis/scripts/spec_router.py")), true);
    assert.equal(fs.existsSync(path.join(target, ".trellis/.flower-manifest.json")), false);
  }
});

test("Update-Spec 三个精细安装别名都替换已有入口且不创建缺失平台", () => {
  for (const alias of ["trellis-update-spec", "update-spec", "update-spec-enhancement"]) {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), `flower-update-spec-${alias}-`));
    write(target, ".trellis/.version", "0.6.5\n");
    const targets = writeUpdateSpecTargets(target);

    quietApply(target, { variant: "0.6", skills: [alias] });
    const first = snapshotTree(target);
    for (const file of targets) {
      const value = fs.readFileSync(file, "utf8");
      assert.match(value, /skill-garden patch trellis-update-spec-autonomous-evaluation/);
      assert.doesNotMatch(value, /^## Interactive Mode$/m);
    }
    assert.equal(fs.existsSync(path.join(target, ".codex")), false);

    quietApply(target, { variant: "0.6", skills: [alias] });
    assert.deepEqual(snapshotTree(target), first);
  }

  const missing = fs.mkdtempSync(path.join(os.tmpdir(), "flower-update-spec-missing-"));
  write(missing, ".trellis/.version", "0.6.5\n");
  quietApply(missing, { variant: "0.6", skills: ["update-spec-enhancement"] });
  assert.equal(fs.existsSync(path.join(missing, ".agents/skills/trellis-update-spec/SKILL.md")), false);
  assert.equal(fs.existsSync(path.join(missing, ".claude/skills/trellis-update-spec/SKILL.md")), false);
});
