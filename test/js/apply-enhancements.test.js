import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { applyEnhancements } from "../../src/lib/apply-enhancements.js";
import { ENHANCEMENTS_ROOT } from "../../src/lib/paths.js";

const V06_DIR = path.join(ENHANCEMENTS_ROOT, "0.6");
const PATCHES = path.join(V06_DIR, "overrides", "patches");
const UPSTREAM_SCRIPTS = path.resolve(
  "node_modules/@mindfoldhq/trellis/dist/templates/trellis/scripts",
);
const SHARED_HOOK_TARGETS = [
  ".codex/hooks/inject-workflow-state.py",
  ".claude/hooks/inject-workflow-state.py",
  ".gemini/hooks/inject-workflow-state.py",
  ".qoder/hooks/inject-workflow-state.py",
  ".github/copilot/hooks/inject-workflow-state.py",
  ".codebuddy/hooks/inject-workflow-state.py",
  ".factory/hooks/inject-workflow-state.py",
  ".kiro/hooks/inject-workflow-state.py",
  ".trae/hooks/inject-workflow-state.py",
];

function write(root, relativePath, value) {
  const file = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value);
  return file;
}

function patchSource(ref, name) {
  return fs.readFileSync(path.join(PATCHES, ...ref.split("/"), name), "utf8").trimEnd();
}

function assertIntentRoutingSemantics(value) {
  assert.match(value, /Repair authorization and permission to skip task planning are separate/);
  assert.match(value, /repair scope is unknown, use `inspect` first and reclassify from evidence/);
  assert.match(value, /`direct_edit` requires known, bounded, local, low-risk, reversible scope/);
  assert.match(value, /Permission\/authentication\/data-scope\/security/);
  assert.match(value, /cross-package\/layer or multi-entry behavior/);
  assert.match(value, /validation, or unknown scope are `task_plan` signals/);
  assert.match(value, /python3 \.\/\.trellis\/scripts\/spec_router\.py/);
  assert.match(value, /Project Knowledge Discovery applies once per user intent/);
  assert.match(value, /apply the Active Task Scope Guard before artifact ownership/);
  assert.match(value, /without reusing the current task or progress/);
  assert.match(value, /`fix item 1`, `change that`, `修一下`, `改一下`/);
  assert.match(value, /Only an explicit current-request workflow instruction/);
}

function writeContinueTargets(target) {
  const selector = patchSource(
    "skills/trellis-continue/task-progress-recovery",
    "selector.md",
  );
  const body = [
    "# Continue Current Task",
    "",
    "## Step 1: Load Current Context",
    "",
    selector,
    "",
    "## Step 2: Load the Phase Index",
    "",
    "## Step 3: Decide Where You Are",
    "",
  ].join("\n");
  return [
    write(
      target,
      ".agents/skills/trellis-continue/SKILL.md",
      `---\nname: trellis-continue\n---\n\n${body}`,
    ),
    write(target, ".claude/commands/trellis/continue.md", body),
  ];
}

function writeAllContinueTargets(target) {
  const patch = JSON.parse(patchSource(
    "skills/trellis-continue/task-progress-recovery",
    "patch.json",
  ));
  const selector = patchSource(
    "skills/trellis-continue/task-progress-recovery",
    "selector.md",
  );
  const body = [
    "# Continue Current Task",
    "",
    "## Step 1: Load Current Context",
    "",
    selector,
    "",
    "## Step 2: Load the Phase Index",
    "",
  ].join("\n");

  return patch.operations[0].targets.map(({ kind, path: relativePath }) => {
    let content = body;
    if (kind === "skill") {
      content = `---\nname: trellis-continue\n---\n\n${body}`;
    } else if (relativePath.endsWith(".toml")) {
      content = `description = "Trellis: continue"\n\nprompt = """\n${body}\n"""\n`;
    }
    return write(target, relativePath, content);
  });
}

function minimalWorkflow() {
  return [
    patchSource("workflow/runtime-contract-reference", "state-contract-comment-selector.md"),
    "",
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
    patchSource("workflow/phase-ownership", "active-task-routing-baseline.md"),
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
    patchSource("workflow/task-brief-review", "phase-1-activate-baseline.md"),
    "",
    "## Phase 2: Execute",
    "",
    patchSource("workflow/phase-ownership", "phase-2-implement-baseline.md"),
    "",
    patchSource("workflow/phase-ownership", "phase-2-check-baseline.md"),
    "",
    "#### 2.3 Rollback `[on demand]`",
    "",
    "## Phase 3: Finish",
    "",
    patchSource("workflow/phase-ownership", "phase-3-update-spec-baseline.md"),
    "",
    patchSource("workflow/phase-ownership", "phase-3-commit-baseline.md"),
    "",
    "#### 3.5 Wrap-up reminder",
    "",
    "## Customizing Trellis (for forks)",
    "",
    "Critical invariants:",
    patchSource("workflow/intent-routing/customization-intent-invariant", "selector.md"),
    "",
    "### Full contract",
    "",
    patchSource("workflow/runtime-contract-reference", "runtime-reference-selector.md"),
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

function writeAllUpdateSpecTargets(target) {
  const declaration = JSON.parse(patchSource(
    "skills/trellis-update-spec/autonomous-evaluation",
    "patch.json",
  ));
  const canonicalBody = [
    "# Update Code-Spec",
    "",
    patchSource("skills/trellis-update-spec/autonomous-evaluation", "baseline.md"),
    "",
    "## Quality Checklist",
    "",
  ].join("\n");
  const nativeBody = [
    "# Update Code-Spec",
    "",
    "## Interactive Mode",
    "",
    "Legacy interactive body",
    "",
    "## Quality Checklist",
    "",
  ].join("\n");
  const files = new Map();
  for (const operation of declaration.operations) {
    for (const targetConfig of operation.targets) {
      const body = operation.id === "trellis-update-spec-autonomous-evaluation"
        ? canonicalBody
        : nativeBody;
      const content = targetConfig.kind === "skill"
        ? `---\nname: trellis-update-spec\n---\n\n${body}`
        : body;
      files.set(targetConfig.path, write(target, targetConfig.path, content));
    }
  }
  return files;
}

function writeAllFinishTargets(target) {
  const declaration = JSON.parse(patchSource(
    "skills/trellis-finish-work/exact-bookkeeping",
    "patch.json",
  ));
  const agentBody = patchSource(
    "skills/trellis-finish-work/exact-bookkeeping",
    "baseline-agent.md",
  );
  const commandBody = patchSource(
    "skills/trellis-finish-work/exact-bookkeeping",
    "baseline-command.md",
  );
  const files = new Map();
  for (const operation of declaration.operations) {
    for (const targetConfig of operation.targets) {
      if (targetConfig.path === ".claude/skills/trellis-finish-work/SKILL.md") continue;
      let content;
      if (targetConfig.path.endsWith(".toml")) {
        content = 'description = "Trellis: finish-work"\n\nprompt = """\n# Finish Work\n\nLegacy body\n"""\n';
      } else if (operation.id === "trellis-finish-work-exact-bookkeeping") {
        content = targetConfig.kind === "skill"
          ? `---\nname: trellis-finish-work\n---\n\n${agentBody}\n`
          : `${commandBody}\n`;
      } else {
        const body = "# Finish Work\n\nLegacy platform body\n";
        content = targetConfig.kind === "skill"
          ? `---\nname: trellis-finish-work\n---\n\n${body}`
          : body;
      }
      files.set(targetConfig.path, write(target, targetConfig.path, content));
    }
  }
  return files;
}

function writeActiveTaskTarget(target) {
  return write(
    target,
    ".trellis/scripts/common/active_task.py",
    fs.readFileSync(path.join(UPSTREAM_SCRIPTS, "common/active_task.py"), "utf8"),
  );
}

function writeTaskScriptTarget(target) {
  return write(
    target,
    ".trellis/scripts/task.py",
    fs.readFileSync(path.join(UPSTREAM_SCRIPTS, "task.py"), "utf8"),
  );
}

function writeControlPlaneTargets(target) {
  write(
    target,
    ".trellis/scripts/common/paths.py",
    fs.readFileSync(path.join(UPSTREAM_SCRIPTS, "common/paths.py"), "utf8"),
  );
  write(
    target,
    ".trellis/scripts/common/task_store.py",
    fs.readFileSync(path.join(UPSTREAM_SCRIPTS, "common/task_store.py"), "utf8"),
  );
}

function writeIntentTargets(target) {
  writeActiveTaskTarget(target);
  writeControlPlaneTargets(target);
  write(
    target,
    ".agents/skills/trellis-start/SKILL.md",
    `# Start\n\n${patchSource("skills/trellis-start/no-task-routing", "selector.md")}\n`,
  );
  const beforeDev = [
    "# Before Dev",
    "",
    patchSource(
      "skills/trellis-before-dev/project-knowledge-discovery",
      "selector.md",
    ),
    "",
  ].join("\n");
  write(target, ".agents/skills/trellis-before-dev/SKILL.md", beforeDev);
  write(target, ".claude/skills/trellis-before-dev/SKILL.md", beforeDev);
  const brainstorm = [
    "# Brainstorm",
    "",
    patchSource("skills/trellis-brainstorm/planning-authorization", "selector.md"),
    "",
    patchSource("skills/trellis-brainstorm/auto-task-create", "selector.md"),
    "",
    patchSource("skills/trellis-brainstorm/planning-handoff", "quality-bar-baseline.md"),
    "",
  ].join("\n");
  write(target, ".agents/skills/trellis-brainstorm/SKILL.md", brainstorm);
  write(target, ".claude/skills/trellis-brainstorm/SKILL.md", brainstorm);
  writeTaskScriptTarget(target);
  write(
    target,
    ".codex/hooks/session-start.py",
    [
      patchSource("hooks/codex-session-start/no-task-routing", "selector.py"),
      patchSource("hooks/codex-session-start/missing-task-routing", "selector.py"),
      patchSource("hooks/session-start/pre-check-hold", "codex-selector.py"),
      "",
    ].join("\n\n"),
  );
  write(
    target,
    ".claude/hooks/session-start.py",
    [
      patchSource("hooks/claude-session-start/no-task-routing", "selector.py"),
      patchSource("hooks/claude-session-start/missing-task-routing", "selector.py"),
      patchSource("hooks/session-start/pre-check-hold", "claude-selector.py"),
      "",
    ].join("\n\n"),
  );
  const hookBaseline = patchSource(
    "hooks/inject-workflow-state/shared-runtime",
    "selector.py",
  );
  for (const relativePath of SHARED_HOOK_TARGETS) {
    write(target, relativePath, `${hookBaseline}\n`);
  }
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

function captureApply(target, options, onLog) {
  const original = console.log;
  const logs = [];
  console.log = (...args) => {
    const line = args.join(" ");
    logs.push(line);
    onLog?.(line);
  };
  try {
    return { result: applyEnhancements(target, options), logs };
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
  const continueTargets = writeContinueTargets(target);
  const updateSpecTargets = writeUpdateSpecTargets(target);
  const finishTargets = writeFinishTargets(target);

  const applied = quietApply(target);
  assert.equal(applied.patchReport.version.status, "tested");
  assert.equal(applied.patchReport.summary.errors, 0);
  const first = snapshotTree(target);
  const workflowText = fs.readFileSync(workflow, "utf8");
  assert.match(workflowText, /skill-garden patch workflow-request-triage/);
  assert.match(workflowText, /skill-garden patch workflow-state-in-progress/);
  assert.match(workflowText, /skill-garden patch workflow-state-missing-task/);
  assert.match(workflowText, /skill-garden patch workflow-state-contract-comment/);
  assert.match(workflowText, /skill-garden patch workflow-runtime-contract-reference/);
  assert.match(workflowText, /\[workflow-state:missing_task\]/);
  assert.match(workflowText, /in the same turn treat the current user request as `no_task`/);
  assert.match(workflowText, /This Flower variant uses fixed pseudo-status tag names `no_task` and `missing_task`/);
  assert.doesNotMatch(workflowText, /stale_<source_type>/);
  assert.doesNotMatch(workflowText, /\.trellis\/spec\/cli\/backend\/workflow-state-contract\.md/);
  assert.doesNotMatch(workflowText, /\.trellis\/scripts\/inject-workflow-state\.py/);
  assert.match(workflowText, /### Skill-Garden Workflow Owner Index/);
  assert.doesNotMatch(workflowText, /#### Request Intent Routing/);
  assertIntentRoutingSemantics(workflowText);
  assert.doesNotMatch(workflowText, /ask only whether this turn should create/);
  assert.doesNotMatch(workflowText, /Flow: .*finish-work/);
  assert.doesNotMatch(workflowText, /This guard overrides any lower/);
  assert.doesNotMatch(workflowText, /Spawn the implement sub-agent:/);
  assert.doesNotMatch(workflowText, /Auto-fix issues it finds/);
  assert.doesNotMatch(workflowText, /Never push to remote in this step\./);
  assert.match(workflowText, /trellis-route\(target=implement\)/);
  assert.match(workflowText, /trellis-route\(target=check\)/);
  assert.match(workflowText, /Load `trellis-push`/);
  assert.match(workflowText, /task_intent\.py create --title/);
  assert.match(workflowText, /skill-garden patch workflow-phase-1-activate/);
  assert.match(workflowText, /display the full brief in chat, then stop the current turn/);
  assert.ok(
    workflowText.indexOf("| Task Brief Handoff |") <
      workflowText.indexOf("| Project Knowledge Discovery |"),
  );
  for (const relativePath of [
    ".agents/skills/trellis-before-dev/SKILL.md",
    ".claude/skills/trellis-before-dev/SKILL.md",
  ]) {
    const beforeDevText = fs.readFileSync(path.join(target, relativePath), "utf8");
    assert.match(beforeDevText, /skill-garden patch before-dev-project-knowledge-discovery/);
    assert.match(beforeDevText, /Follow the workflow `Request Triage` Project Knowledge Discovery contract/);
    assert.doesNotMatch(beforeDevText, /python3 \.\/\.trellis\/scripts\/spec_router\.py/);
  }
  for (const continueTarget of continueTargets) {
    const continueText = fs.readFileSync(continueTarget, "utf8");
    assert.match(continueText, /skill-garden patch trellis-continue-task-progress-recovery/);
    assert.match(continueText, /task_progress\.py status --json/);
    assert.ok(
      continueText.indexOf("task_progress.py status --json")
        < continueText.indexOf("## Step 2: Load the Phase Index"),
    );
  }
  for (const relativePath of [
    ".agents/skills/trellis-brainstorm/SKILL.md",
    ".claude/skills/trellis-brainstorm/SKILL.md",
  ]) {
    const brainstormText = fs.readFileSync(path.join(target, relativePath), "utf8");
    assert.match(brainstormText, /skill-garden patch brainstorm-planning-handoff/);
    assert.match(brainstormText, /skill-garden patch brainstorm-planning-readiness/);
    assert.match(brainstormText, /Planning readiness does not authorize `task\.py start`/);
    assert.match(brainstormText, /Implementation intent expressed before the final artifacts/);
    assert.doesNotMatch(brainstormText, /The user has reviewed the final planning artifacts/);
  }
  const handoffPatch = JSON.parse(
    fs.readFileSync(
      path.join(PATCHES, "skills/trellis-brainstorm/planning-handoff/patch.json"),
      "utf8",
    ),
  );
  const authorizationPatch = JSON.parse(
    fs.readFileSync(
      path.join(PATCHES, "skills/trellis-brainstorm/planning-authorization/patch.json"),
      "utf8",
    ),
  );
  assert.deepEqual(
    handoffPatch.operations[0].targets.map((item) => item.path).sort(),
    authorizationPatch.operations[0].targets.map((item) => item.path).sort(),
  );
  assert.deepEqual(
    handoffPatch.operations[1].targets.map((item) => item.path).sort(),
    authorizationPatch.operations[0].targets.map((item) => item.path).sort(),
  );
  const taskScript = fs.readFileSync(
    path.join(target, ".trellis/scripts/task.py"),
    "utf8",
  );
  assert.match(taskScript, /skill-garden patch task-start-brief-validator/);
  assert.match(taskScript, /skill-garden patch task-start-brief-guard/);
  assert.match(taskScript, /Planning task brief\.md is stale/);
  assert.match(taskScript, /Failed to persist task status before start/);
  assert.match(taskScript, /task-finish-clear-result/);
  assert.equal(fs.existsSync(path.join(target, ".trellis/scripts/task_intent.py")), true);
  assert.equal(fs.existsSync(path.join(target, ".trellis/scripts/pre_check_state.py")), true);
  for (const relativePath of SHARED_HOOK_TARGETS) {
    const value = fs.readFileSync(path.join(target, ...relativePath.split("/")), "utf8");
    assert.match(value, /return task_dir\.name, "missing_task", active\.source/);
    assert.doesNotMatch(value, /f"stale_\{active\.source_type\}"/);
  }
  assert.equal(
    fs.existsSync(path.join(target, ".cursor/hooks/inject-workflow-state.py")),
    false,
  );
  const codexSessionStart = fs.readFileSync(
    path.join(target, ".codex/hooks/session-start.py"),
    "utf8",
  );
  const claudeSessionStart = fs.readFileSync(
    path.join(target, ".claude/hooks/session-start.py"),
    "utf8",
  );
  assert.match(codexSessionStart, /treat the current request as NO ACTIVE TASK in the same turn/);
  assert.match(claudeSessionStart, /treat the current request as NO ACTIVE TASK in the same/);
  assert.match(codexSessionStart, /skill-garden patch codex-session-start-pre-check-hold/);
  assert.match(claudeSessionStart, /skill-garden patch claude-session-start-pre-check-hold/);
  assert.match(codexSessionStart, /from pre_check_state import session_start_hint/);
  assert.match(claudeSessionStart, /from pre_check_state import session_start_hint/);
  assert.doesNotMatch(claudeSessionStart, /ask the user what to work on next/);
  const activeTask = fs.readFileSync(
    path.join(target, ".trellis/scripts/common/active_task.py"),
    "utf8",
  );
  assert.match(activeTask, /skill-garden patch active-task-clear-session-fallback/);
  assert.match(
    activeTask,
    /previous\.source_type in \{"session-fallback", "session-corrupt", "session-io_error"\}/,
  );
  assert.match(activeTask, /context_key = previous\.context_key/);
  assert.match(activeTask, /active-task-runtime-json-io/);
  assert.match(activeTask, /class ClearActiveTaskResult/);

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
  assert.ok(manifest.paths.includes(".trellis/scripts/pre_check_state.py"));
  assert.equal(manifest.patches.schemaVersion, 1);
  assert.match(manifest.patches.catalogHash, /^sha256:/);
  assert.ok(manifest.patches.applied.some((item) => item.id === "workflow-state-in-progress"));
  assert.ok(manifest.patches.applied.some((item) => item.id === "workflow-state-missing-task"));
  assert.ok(manifest.patches.applied.some((item) => item.id === "workflow-phase-1-activate"));
  assert.ok(manifest.patches.applied.some((item) => item.id === "brainstorm-planning-handoff"));
  assert.ok(manifest.patches.applied.some((item) => item.id === "task-start-brief-guard"));
  assert.ok(manifest.patches.applied.some((item) => item.id === "task-start-session-write-gate"));
  assert.ok(manifest.patches.applied.some((item) => item.id === "task-finish-clear-result"));
  assert.ok(manifest.patches.applied.some((item) => item.id === "task-create-parent-link"));
  assert.ok(
    manifest.patches.applied.some((item) => item.id === "active-task-clear-session-fallback"),
  );
  assert.ok(manifest.patches.applied.some((item) => item.id === "codex-session-start-missing-task"));
  assert.ok(manifest.patches.applied.some((item) => item.id === "claude-session-start-missing-task"));
  assert.ok(manifest.patches.applied.some((item) => item.id === "codex-session-start-pre-check-hold"));
  assert.ok(manifest.patches.applied.some((item) => item.id === "claude-session-start-pre-check-hold"));
  assert.equal(fs.existsSync(path.join(target, ".codex/hooks.json")), true);
  assert.equal(fs.existsSync(path.join(target, ".claude/settings.json")), true);

  quietApply(target);
  assert.deepEqual(snapshotTree(target), first);
});

test("0.6 未登记 patch 版本 warning 放行，跨兼容线 error 且零写入", () => {
  const compatible = fs.mkdtempSync(path.join(os.tmpdir(), "flower-version-warning-"));
  write(compatible, ".trellis/.version", "0.6.6\n");
  const compatibleWorkflow = write(
    compatible,
    ".trellis/workflow.md",
    minimalWorkflow(),
  );
  writeIntentTargets(compatible);
  writeUpdateSpecTargets(compatible);
  writeFinishTargets(compatible);

  let warningBeforeApply = false;
  const { result: warningResult, logs: warningLogs } = captureApply(
    compatible,
    { variant: "0.6" },
    (line) => {
      if (line.includes("Patch 警告:untested-upstream")) {
        warningBeforeApply = !fs.readFileSync(compatibleWorkflow, "utf8").includes(
          "workflow-phase-2-implement v0.6",
        );
      }
    },
  );
  assert.equal(warningResult.patchReport.version.status, "untested-compatible");
  assert.equal(warningBeforeApply, true);
  assert.ok(warningLogs.some((line) => line.includes("证据:0.6.6")));
  assert.ok(
    warningResult.patchReport.diagnostics.some((item) => item.id === "untested-upstream"),
  );

  const unsupported = fs.mkdtempSync(path.join(os.tmpdir(), "flower-version-error-"));
  write(unsupported, ".trellis/.version", "0.7.0\n");
  write(unsupported, ".trellis/workflow.md", "# Trellis 0.7 changed upstream\n");
  const before = snapshotTree(unsupported);

  assert.throws(
    () => quietApply(unsupported, { variant: "0.6" }),
    /unsupported-upstream-line.*--no-enhance/,
  );
  assert.deepEqual(snapshotTree(unsupported), before);
  assert.equal(
    fs.existsSync(path.join(unsupported, ".trellis/.flower-manifest.json")),
    false,
  );

  const invalid = fs.mkdtempSync(path.join(os.tmpdir(), "flower-version-invalid-"));
  write(invalid, ".trellis/workflow.md", minimalWorkflow());
  writeIntentTargets(invalid);
  writeUpdateSpecTargets(invalid);
  writeFinishTargets(invalid);
  const invalidBefore = snapshotTree(invalid);
  assert.throws(
    () => quietApply(invalid, { variant: "0.6" }),
    /invalid-upstream-version/,
  );
  assert.deepEqual(snapshotTree(invalid), invalidBefore);

  const skillOnly = fs.mkdtempSync(path.join(os.tmpdir(), "flower-version-skill-only-"));
  write(skillOnly, ".trellis/.version", "0.6.6\n");
  fs.mkdirSync(path.join(skillOnly, ".agents"));
  const { logs: skillOnlyLogs } = captureApply(
    skillOnly,
    { variant: "0.6", skills: ["trellis-push"] },
  );
  assert.ok(skillOnlyLogs.some((line) => line.includes(
    "Patch 警告:untested-upstream@.trellis/.version",
  )));
});

test("0.5/old legacy 变体不加载 0.6 compatibility policy", () => {
  for (const variant of ["0.5", "old"]) {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), `flower-legacy-${variant}-`));
    write(target, ".trellis/.version", "0.7.0\n");
    const result = quietApply(target, { variant, skills: ["not-installed"] });
    assert.equal(result.variant, variant);
    assert.equal(Object.hasOwn(result, "patchReport"), false);
  }
});

test("task-intent 与 intent-routing 精细安装刷新完整 intent Bundle", () => {
  for (const alias of ["task-intent", "intent-routing"]) {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), `flower-alias-${alias}-`));
    write(target, ".trellis/.version", "0.6.5\n");
    const workflow = write(target, ".trellis/workflow.md", minimalWorkflow());
    writeIntentTargets(target);

    quietApply(target, { variant: "0.6", skills: [alias] });
    const first = snapshotTree(target);

    const value = fs.readFileSync(workflow, "utf8");
    assert.match(value, /### Skill-Garden Workflow Owner Index/);
    assert.doesNotMatch(value, /#### Request Intent Routing/);
    assertIntentRoutingSemantics(value);
    assert.match(value, /skill-garden patch workflow-request-triage/);
    assert.match(value, /skill-garden patch workflow-state-planning/);
    assert.match(value, /skill-garden patch workflow-state-missing-task/);
    assert.match(value, /skill-garden patch workflow-runtime-contract-reference/);
    assert.match(value, /skill-garden patch workflow-phase-1-activate/);
    assert.match(value, /display the full brief in chat, then stop the current turn/);
    assert.match(value, /follow `\[workflow-state:no_task\]` \/ Request Intent Routing/);
    assert.match(
      fs.readFileSync(
        path.join(target, ".agents/skills/trellis-before-dev/SKILL.md"),
        "utf8",
      ),
      /skill-garden patch before-dev-project-knowledge-discovery/,
    );
    assert.doesNotMatch(value, /stale_<source_type>/);
    for (const relativePath of SHARED_HOOK_TARGETS) {
      const hook = fs.readFileSync(path.join(target, ...relativePath.split("/")), "utf8");
      assert.match(hook, /return task_dir\.name, "missing_task", active\.source/);
    }
    assert.match(
      fs.readFileSync(path.join(target, ".codex/hooks/session-start.py"), "utf8"),
      /before any edit, task creation, or task start/,
    );
    assert.match(
      fs.readFileSync(path.join(target, ".claude/hooks/session-start.py"), "utf8"),
      /before any edit, task creation, or task start/,
    );
    assert.match(
      fs.readFileSync(path.join(target, ".trellis/scripts/common/active_task.py"), "utf8"),
      /skill-garden patch active-task-clear-session-fallback/,
    );
    assert.match(
      fs.readFileSync(path.join(target, ".trellis/scripts/common/active_task.py"), "utf8"),
      /skill-garden patch active-task-clear-read-result/,
    );
    assert.doesNotMatch(
      fs.readFileSync(path.join(target, ".trellis/scripts/common/active_task.py"), "utf8"),
      /skill-garden patch active-task-runtime-json-io/,
    );
    assert.equal(fs.existsSync(path.join(target, ".trellis/scripts/task_intent.py")), true);
    for (const relativePath of [
      ".agents/skills/trellis-brainstorm/SKILL.md",
      ".claude/skills/trellis-brainstorm/SKILL.md",
    ]) {
      const brainstormText = fs.readFileSync(path.join(target, relativePath), "utf8");
      assert.match(brainstormText, /skill-garden patch brainstorm-planning-handoff/);
      assert.match(brainstormText, /skill-garden patch brainstorm-planning-readiness/);
      assert.doesNotMatch(brainstormText, /The user has reviewed the final planning artifacts/);
    }
    assert.match(
      fs.readFileSync(path.join(target, ".trellis/scripts/task.py"), "utf8"),
      /skill-garden patch task-start-brief-guard/,
    );
    assert.equal(fs.existsSync(path.join(target, ".trellis/scripts/spec_router.py")), true);
    assert.equal(fs.existsSync(path.join(target, ".trellis/.flower-manifest.json")), false);

    quietApply(target, { variant: "0.6", skills: [alias] });
    assert.deepEqual(snapshotTree(target), first);
  }
});

test("trellis-continue 精细安装同时恢复入口与 task_progress helper", () => {
  for (const alias of [
    "trellis-continue",
    "continue",
    "task-progress",
    "progress-recovery",
  ]) {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), `flower-continue-${alias}-`));
    write(target, ".trellis/.version", "0.6.5\n");
    const continueTargets = writeContinueTargets(target);

    const result = quietApply(target, { variant: "0.6", skills: [alias] });
    assert.ok(result.installed.includes("script:task_progress.py"));
    assert.equal(result.patchReport.summary.errors, 0);
    assert.equal(fs.existsSync(path.join(target, ".trellis/scripts/task_progress.py")), true);
    for (const continueTarget of continueTargets) {
      const value = fs.readFileSync(continueTarget, "utf8");
      assert.match(value, /skill-garden patch trellis-continue-task-progress-recovery/);
      assert.match(value, /status=candidates/);
      assert.match(value, /Never rebind the session or task automatically/);
      assert.match(value, /enter `trellis-brainstorm` before using artifact presence/);
      assert.match(value, /current explicit user confirmation before `task\.py start`/);
      assert.ok(
        value.indexOf("task_progress.py status --json")
          < value.indexOf("## Step 2: Load the Phase Index"),
      );
    }

    const first = snapshotTree(target);
    quietApply(target, { variant: "0.6", skills: [alias] });
    assert.deepEqual(snapshotTree(target), first);
  }
});

test("trellis-continue Patch 覆盖全部平台入口且保持 Phase 前恢复顺序", () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "flower-continue-platforms-"));
  write(target, ".trellis/.version", "0.6.5\n");
  const continueTargets = writeAllContinueTargets(target);

  quietApply(target, { variant: "0.6", skills: ["trellis-continue"] });
  assert.equal(continueTargets.length, 17);
  for (const continueTarget of continueTargets) {
    const value = fs.readFileSync(continueTarget, "utf8");
    assert.match(value, /skill-garden patch trellis-continue-task-progress-recovery/);
    assert.match(value, /### Planning Resume Gate/);
    assert.ok(
      value.indexOf("task_progress.py status --json")
        < value.indexOf("## Step 2: Load the Phase Index"),
    );
  }
});

test("beta.2 旧 shared Hook 可通过历史 baseline 升级", () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "flower-hook-beta2-upgrade-"));
  write(target, ".trellis/.version", "0.6.5\n");
  write(target, ".trellis/workflow.md", minimalWorkflow());
  writeActiveTaskTarget(target);
  writeTaskScriptTarget(target);
  writeControlPlaneTargets(target);
  const hook = write(
    target,
    ".codex/hooks/inject-workflow-state.py",
    `${patchSource(
      "hooks/inject-workflow-state/shared-runtime",
      "baseline-flower-beta2.py",
    )}\n`,
  );

  quietApply(target, { variant: "0.6", skills: ["task-intent"] });
  assert.equal(
    fs.readFileSync(hook, "utf8").trimEnd(),
    patchSource("hooks/inject-workflow-state/shared-runtime", "content.py"),
  );
  assert.match(fs.readFileSync(hook, "utf8"), /return task_dir\.name, "missing_task", active\.source/);

  const first = snapshotTree(target);
  quietApply(target, { variant: "0.6", skills: ["task-intent"] });
  assert.deepEqual(snapshotTree(target), first);
});

test("上一版 missing_task 改名前的 shared Hook 可通过历史 baseline 升级", () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "flower-hook-stale-task-upgrade-"));
  write(target, ".trellis/.version", "0.6.5\n");
  write(target, ".trellis/workflow.md", minimalWorkflow());
  writeActiveTaskTarget(target);
  writeTaskScriptTarget(target);
  writeControlPlaneTargets(target);
  const hook = write(
    target,
    ".codex/hooks/inject-workflow-state.py",
    `${patchSource(
      "hooks/inject-workflow-state/shared-runtime",
      "baseline-flower-stale-task.py",
    )}\n`,
  );

  quietApply(target, { variant: "0.6", skills: ["task-intent"] });
  assert.equal(
    fs.readFileSync(hook, "utf8").trimEnd(),
    patchSource("hooks/inject-workflow-state/shared-runtime", "content.py"),
  );
  assert.match(fs.readFileSync(hook, "utf8"), /return task_dir\.name, "missing_task", active\.source/);
  assert.doesNotMatch(fs.readFileSync(hook, "utf8"), /return task_dir\.name, "stale_task", active\.source/);

  const first = snapshotTree(target);
  quietApply(target, { variant: "0.6", skills: ["task-intent"] });
  assert.deepEqual(snapshotTree(target), first);
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

test("Update-Spec 与 Finish-Work Patch 覆盖真实平台原生入口并保持幂等", () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "flower-native-gate-matrix-"));
  write(target, ".trellis/.version", "0.6.5\n");
  const updateTargets = writeAllUpdateSpecTargets(target);
  const finishTargets = writeAllFinishTargets(target);

  quietApply(target, {
    variant: "0.6",
    skills: ["trellis-update-spec", "trellis-finish-work"],
  });

  const updateSkillTargets = [...updateTargets.entries()].filter(([relativePath]) =>
    relativePath.endsWith("/trellis-update-spec/SKILL.md")
  );
  assert.equal(updateSkillTargets.length, 15);
  for (const [relativePath, file] of updateTargets) {
    const value = fs.readFileSync(file, "utf8");
    assert.match(value, /BEGIN skill-garden patch trellis-update-spec-(?:autonomous-evaluation|native-autonomous-evaluation)/, relativePath);
    assert.match(value, /## Autonomous Spec Evaluation/, relativePath);
    assert.doesNotMatch(value, /^## Interactive Mode$/m, relativePath);
  }

  assert.equal(finishTargets.size, 17);
  for (const [relativePath, file] of finishTargets) {
    const value = fs.readFileSync(file, "utf8");
    if (relativePath.endsWith(".toml")) {
      assert.match(value, /BEGIN skill-garden patch trellis-finish-work-gemini-owner/, relativePath);
      assert.match(value, /platform-native `trellis-finish-work` skill as the sole owner/, relativePath);
    } else {
      assert.match(value, /BEGIN skill-garden patch trellis-finish-work-(?:exact-bookkeeping|native-exact-bookkeeping)/, relativePath);
      assert.match(value, /### 1\. Current Task Release Audit/, relativePath);
    }
  }

  const first = snapshotTree(target);
  quietApply(target, {
    variant: "0.6",
    skills: ["trellis-update-spec", "trellis-finish-work"],
  });
  assert.deepEqual(snapshotTree(target), first);
});
