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
const UPSTREAM_META = path.resolve(
  "node_modules/@mindfoldhq/trellis/dist/templates/common/bundled-skills/trellis-meta",
);
const UPSTREAM_BRAINSTORM = path.resolve(
  "node_modules/@mindfoldhq/trellis/dist/templates/common/skills/brainstorm.md",
);
const UPSTREAM_SHARED_HOOK = path.resolve(
  "node_modules/@mindfoldhq/trellis/dist/templates/shared-hooks/inject-workflow-state.py",
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
  ".zcode/hooks/inject-workflow-state.py",
];

function write(root, relativePath, value) {
  const file = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value);
  return file;
}

function writeMetaTargets(target) {
  for (const root of [".agents/skills", ".claude/skills"]) {
    const destination = path.join(target, ...root.split("/"), "trellis-meta");
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.cpSync(UPSTREAM_META, destination, { recursive: true });
  }
}

function patchSource(ref, name) {
  return fs.readFileSync(path.join(PATCHES, ...ref.split("/"), name), "utf8").trimEnd();
}

function assertIntentRoutingSemantics(value) {
  assert.match(value, /Treat requests for an opinion, expressions of discomfort, rejected proposals/);
  assert.match(value, /treat requests to inspect, explain, verify, or locate a cause as `inspect`/);
  assert.match(value, /Both are read-only unless the current request explicitly authorizes a concrete edit/);
  assert.match(value, /Selecting a repair does not authorize editing while scope is unknown or permission to skip task planning/);
  assert.match(value, /`direct_edit` requires known, bounded, low-risk, reversible scope/);
  assert.match(value, /no unresolved design choice, and simple validation/);
  assert.match(value, /Permission\/authentication\/data-scope\/security/);
  assert.match(value, /cross-package\/layer or multi-entry behavior/);
  assert.match(value, /do not automatically require `task_plan`/);
  assert.match(value, /exact rollback or mechanically synchronized known change/);
  assert.match(value, /build a short query from the request, intended commands, affected files or systems, package\/layer, and domain terms/);
  assert.match(value, /python3 \.\/\.trellis\/scripts\/spec_router\.py/);
  assert.match(value, /once per user intent, workflow phase, or decision boundary/);
  assert.match(value, /follow its returned `load_strategy` and `action`/);
  assert.match(value, /apply the Active Task Scope Guard before artifact ownership/);
  assert.match(value, /does not reuse current progress/);
  assert.match(value, /Only an explicit current-request workflow instruction/);
  assert.match(value, /untracked_flow\.py begin --summary/);
  assert.match(value, /A same-item hit resumes the existing state/);
  assert.match(value, /`active-work-conflict` blocks unrelated code writes/);
  assert.match(value, /Unrelated read-only requests may continue without mutating the state/);
  assert.match(value, /Do not edit when baseline capture or workspace validation fails/);
  assert.match(value, /Do not edit when baseline capture, scope extension, or workspace validation fails/);
  assert.match(value, /task_intent\.py adopt/);
  assert.match(value, /Entering untracked `direct_edit`, creating or resuming a task, or switching intent gets one non-blocking status line/);
  assert.match(value, /the owning workflow state or capability owns its commands and transition details/);
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
    patchSource(
      "skills/trellis-continue/task-progress-recovery",
      "completed-route-selector.md",
    ),
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
    patchSource(
      "skills/trellis-continue/task-progress-recovery",
      "completed-route-selector.md",
    ),
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
    patchSource("workflow/runtime-contract-reference", "completed-selector.md"),
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
    patchSource("workflow/runtime-contract-reference", "customizing-trellis-baseline.md"),
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
    ".trellis/scripts/common/session_context.py",
    fs.readFileSync(path.join(UPSTREAM_SCRIPTS, "common/session_context.py"), "utf8"),
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
    "---",
    "name: trellis-brainstorm",
    "---",
    "",
    fs.readFileSync(UPSTREAM_BRAINSTORM, "utf8")
      .replaceAll("{{PYTHON_CMD}}", "python3")
      .trimEnd(),
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
  const hookBaseline = fs.readFileSync(UPSTREAM_SHARED_HOOK, "utf8").trimEnd();
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

function renderSeededPythonCommand(root, command) {
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(file);
        continue;
      }
      if (!entry.isFile()) continue;
      const content = fs.readFileSync(file);
      if (content.includes(0)) continue;
      const rendered = content
        .toString("utf8")
        .split("\n")
        .map((line) => line.startsWith("#!") ? line : line.replaceAll("python3", command))
        .join("\n");
      fs.writeFileSync(file, rendered);
    }
  }
  walk(root);
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
  write(target, ".trellis/.version", "0.6.12\n");
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
  write(target, ".trellis/.version", "0.6.12\n");
  const workflow = write(target, ".trellis/workflow.md", minimalWorkflow());
  writeIntentTargets(target);
  writeMetaTargets(target);
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
  assert.match(workflowText, /skill-garden patch workflow-state-completed/);
  assert.match(workflowText, /\[workflow-state:missing_task\]/);
  assert.match(workflowText, /\[workflow-state:untracked\]/);
  assert.match(workflowText, /in the same turn treat the current user request as `no_task`/);
  assert.match(workflowText, /This Flower variant uses fixed pseudo-status tag names `no_task`, `untracked`, and `missing_task`/);
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
  assert.match(workflowText, /Business push and task progress are complete/);
  assert.match(workflowText, /task_progress\.py reopen --task <task-name> --json/);
  assert.match(workflowText, /task_intent\.py create --title/);
  assert.match(workflowText, /skill-garden patch workflow-phase-1-activate/);
  assert.match(workflowText, /Unless `trellis-task-brief` validates an explicit preauthorization/);
  assert.match(workflowText, /After a later confirmation, or in the same turn/);
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
  for (const relativePath of [
    ".agents/skills/trellis-meta/SKILL.md",
    ".claude/skills/trellis-meta/SKILL.md",
  ]) {
    const metaText = fs.readFileSync(path.join(target, relativePath), "utf8");
    assert.match(metaText, /including Flower\/Skill-Garden managed Plugin overlays/);
    assert.match(metaText, /skill-garden patch trellis-meta-managed-scope/);
    assert.match(metaText, /vendor\/skill-garden\/\.trellis\/0\.6/);
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
    assert.match(brainstormText, /Only a subsequent user message that explicitly approves the latest full Brief/);
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
    assert.match(value, /### 1\. Completion State Gate/);
    assert.match(value, /### 2\. Decision Audit/);
    assert.match(value, /### 3\. Current Task Release Audit/);
  }
  const plugins = JSON.parse(
    fs.readFileSync(path.join(target, ".flower/plugins.json"), "utf8"),
  );
  const state = JSON.parse(
    fs.readFileSync(path.join(target, ".flower/state.json"), "utf8"),
  );
  const skillGarden = state.plugins.find(({ id }) => id === "flower/skill-garden");
  assert.ok(plugins.plugins.some(({ id }) => id === "flower/skill-garden"));
  assert.ok(skillGarden.paths.some(({ path: value }) => value === ".trellis/scripts/task_intent.py"));
  assert.ok(skillGarden.paths.some(({ path: value }) => value === ".trellis/scripts/pre_check_state.py"));
  assert.ok(skillGarden.patches.every((item) => item.operation.includes("/")));
  for (const operation of [
    "workflow-state-in-progress",
    "workflow-state-missing-task",
    "workflow-phase-1-activate",
    "brainstorm-planning-handoff",
    "task-start-brief-guard",
    "task-start-session-write-gate",
    "task-finish-clear-result",
    "task-create-parent-link",
    "active-task-clear-session-fallback",
    "codex-session-start-missing-task",
    "claude-session-start-missing-task",
    "codex-session-start-pre-check-hold",
    "claude-session-start-pre-check-hold",
  ]) {
    assert.ok(skillGarden.patches.some((item) => item.operation.endsWith(`/${operation}`)));
  }
  assert.equal(fs.existsSync(path.join(target, ".trellis/.flower-manifest.json")), false);
  assert.equal(fs.existsSync(path.join(target, ".codex/hooks.json")), true);
  assert.equal(fs.existsSync(path.join(target, ".claude/settings.json")), true);

  quietApply(target);
  assert.deepEqual(snapshotTree(target), first);
});

test("Windows Python 命令渲染后的 0.6.12 目标可完整强化且重复运行幂等", () => {
  for (const command of ["python", "py -3"]) {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), "flower-apply-python-command-"));
    write(target, ".trellis/.version", "0.6.12\n");
    write(target, ".trellis/workflow.md", minimalWorkflow());
    writeIntentTargets(target);
    writeMetaTargets(target);
    writeContinueTargets(target);
    writeUpdateSpecTargets(target);
    writeFinishTargets(target);
    renderSeededPythonCommand(target, command);

    const applied = quietApply(target);
    assert.equal(applied.patchReport.summary.errors, 0);
    const first = snapshotTree(target);
    const workflow = fs.readFileSync(path.join(target, ".trellis/workflow.md"), "utf8");
    assert.ok(workflow.includes(`${command} ./.trellis/scripts/spec_router.py`));
    assert.match(workflow, /skill-garden patch workflow-phase-1-activate/);
    for (const relative of [
      ".agents/skills/trellis-brainstorm/SKILL.md",
      ".agents/skills/trellis-finish-work/SKILL.md",
      ".claude/commands/trellis/finish-work.md",
    ]) {
      const value = fs.readFileSync(path.join(target, ...relative.split("/")), "utf8");
      assert.doesNotMatch(value, /python3 (?:-X utf8 )?\.\/\.trellis\/scripts\//);
      assert.ok(value.includes(`${command} ./.trellis/scripts/`));
    }

    quietApply(target);
    assert.deepEqual(snapshotTree(target), first);
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test("0.6 未登记 patch 版本 warning 放行，跨兼容线 error 且零写入", () => {
  const compatible = fs.mkdtempSync(path.join(os.tmpdir(), "flower-version-warning-"));
  write(compatible, ".trellis/.version", "0.6.13\n");
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
      if (line.includes("Patch 警告:skill-garden/untested-upstream")) {
        warningBeforeApply = !fs.readFileSync(compatibleWorkflow, "utf8").includes(
          "workflow-phase-2-implement v0.6",
        );
      }
    },
  );
  assert.equal(warningResult.patchReport.version.status, "untested-compatible");
  assert.equal(warningBeforeApply, true);
  assert.ok(warningLogs.some((line) => line.includes("证据:0.6.13")));
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
  write(skillOnly, ".trellis/.version", "0.6.13\n");
  fs.mkdirSync(path.join(skillOnly, ".agents"));
  const { logs: skillOnlyLogs } = captureApply(
    skillOnly,
    { variant: "0.6", skills: ["trellis-push"] },
  );
  assert.ok(skillOnlyLogs.some((line) => line.includes(
    "Patch 警告:skill-garden/untested-upstream@.trellis/.version",
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
    write(target, ".trellis/.version", "0.6.12\n");
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
    assert.match(value, /Unless `trellis-task-brief` validates an explicit preauthorization/);
    assert.match(value, /After a later confirmation, or in the same turn/);
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

test("Auto-Loop 与 Finish-Work 精细安装同时携带决策归档硬门禁", () => {
  for (const alias of ["trellis-auto-loop", "auto-loop", "trellis-finish-work", "finish-work"]) {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), "flower-decision-audit-bundle-"));
    write(target, ".trellis/.version", "0.6.12\n");
    writeControlPlaneTargets(target);
    fs.mkdirSync(path.join(target, ".agents/skills"), { recursive: true });

    quietApply(target, { variant: "0.6", skills: [alias] });

    const taskStore = fs.readFileSync(
      path.join(target, ".trellis/scripts/common/task_store.py"),
      "utf8",
    );
    assert.match(taskStore, /BEGIN skill-garden patch task-store-decision-log-import/, alias);
    assert.match(taskStore, /decision_review_status\(task_dir\)/, alias);
    assert.equal(
      fs.existsSync(path.join(target, ".trellis/scripts/decision_log.py")),
      true,
      alias,
    );
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
    write(target, ".trellis/.version", "0.6.12\n");
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
  write(target, ".trellis/.version", "0.6.12\n");
  const continueTargets = writeAllContinueTargets(target);

  quietApply(target, { variant: "0.6", skills: ["trellis-continue"] });
  assert.equal(continueTargets.length, 21);
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

test("0.6.12 shared Hook 通过局部 Patch 保留上游结构", () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "flower-hook-local-patch-"));
  write(target, ".trellis/.version", "0.6.12\n");
  write(target, ".trellis/workflow.md", minimalWorkflow());
  writeActiveTaskTarget(target);
  writeTaskScriptTarget(target);
  writeControlPlaneTargets(target);
  const hook = write(
    target,
    ".codex/hooks/inject-workflow-state.py",
    fs.readFileSync(UPSTREAM_SHARED_HOOK, "utf8"),
  );

  quietApply(target, { variant: "0.6", skills: ["task-intent"] });
  const value = fs.readFileSync(hook, "utf8");
  assert.match(value, /BEGIN skill-garden patch workflow-state-codex-session-start-guard/);
  assert.match(value, /BEGIN skill-garden patch workflow-state-stale-task-status/);
  assert.match(value, /BEGIN skill-garden patch workflow-state-untracked-helper/);
  assert.match(value, /BEGIN skill-garden patch workflow-state-breadcrumb-subject/);
  assert.match(value, /BEGIN skill-garden patch workflow-state-main-subject-routing/);
  assert.match(value, /return task_dir\.name, "missing_task", active\.source/);
  assert.match(value, /Gemini CLI 0\.40\.x renamed/);
  assert.match(value, /"ZCODE_PROJECT_DIR": "zcode"/);

  const first = snapshotTree(target);
  quietApply(target, { variant: "0.6", skills: ["task-intent"] });
  assert.deepEqual(snapshotTree(target), first);
});

test("Update-Spec 三个精细安装别名都替换现有入口且不创建缺失平台", () => {
  for (const alias of ["trellis-update-spec", "update-spec", "update-spec-enhancement"]) {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), `flower-update-spec-${alias}-`));
    write(target, ".trellis/.version", "0.6.12\n");
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
  write(missing, ".trellis/.version", "0.6.12\n");
  quietApply(missing, { variant: "0.6", skills: ["update-spec-enhancement"] });
  assert.equal(fs.existsSync(path.join(missing, ".agents/skills/trellis-update-spec/SKILL.md")), false);
  assert.equal(fs.existsSync(path.join(missing, ".claude/skills/trellis-update-spec/SKILL.md")), false);
});

test("Update-Spec 与 Finish-Work Patch 覆盖真实平台原生入口并保持幂等", () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "flower-native-gate-matrix-"));
  write(target, ".trellis/.version", "0.6.12\n");
  writeControlPlaneTargets(target);
  const updateTargets = writeAllUpdateSpecTargets(target);
  const finishTargets = writeAllFinishTargets(target);

  quietApply(target, {
    variant: "0.6",
    skills: ["trellis-update-spec", "trellis-finish-work"],
  });

  const updateSkillTargets = [...updateTargets.entries()].filter(([relativePath]) =>
    relativePath.endsWith("/trellis-update-spec/SKILL.md")
  );
  assert.equal(updateSkillTargets.length, 18);
  for (const [relativePath, file] of updateTargets) {
    const value = fs.readFileSync(file, "utf8");
    assert.match(value, /BEGIN skill-garden patch trellis-update-spec-(?:autonomous-evaluation|native-autonomous-evaluation)/, relativePath);
    assert.match(value, /## Autonomous Spec Evaluation/, relativePath);
    assert.doesNotMatch(value, /^## Interactive Mode$/m, relativePath);
  }

  assert.equal(finishTargets.size, 21);
  for (const [relativePath, file] of finishTargets) {
    const value = fs.readFileSync(file, "utf8");
    if (relativePath.endsWith(".toml")) {
      assert.match(value, /BEGIN skill-garden patch trellis-finish-work-gemini-owner/, relativePath);
      assert.match(value, /platform-native `trellis-finish-work` skill as the sole owner/, relativePath);
    } else {
      assert.match(value, /BEGIN skill-garden patch trellis-finish-work-(?:exact-bookkeeping|native-exact-bookkeeping)/, relativePath);
      assert.match(value, /### 1\. Completion State Gate/, relativePath);
      assert.match(value, /### 2\. Decision Audit/, relativePath);
      assert.match(value, /### 3\. Current Task Release Audit/, relativePath);
    }
  }

  const first = snapshotTree(target);
  quietApply(target, {
    variant: "0.6",
    skills: ["trellis-update-spec", "trellis-finish-work"],
  });
  assert.deepEqual(snapshotTree(target), first);
});
