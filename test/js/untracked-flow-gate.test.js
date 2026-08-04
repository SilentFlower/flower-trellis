import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { copyScriptAssets } from "../../src/lib/copy-scripts.js";
import { applyEnhancements } from "../../src/lib/apply-enhancements.js";


const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sourceRoot = path.join(projectRoot, "vendor/skill-garden/.trellis/0.6");
const upstreamTemplates = path.join(
  projectRoot,
  "node_modules/@mindfoldhq/trellis/dist/templates",
);


function read(relativePath) {
  return fs.readFileSync(path.join(sourceRoot, ...relativePath.split("/")), "utf8");
}


function quietApply(target) {
  const original = console.log;
  console.log = () => {};
  try {
    return applyEnhancements(target, { variant: "0.6", skills: ["trellis-route"] });
  } finally {
    console.log = original;
  }
}


test("untracked workflow 只保存阶段游标并路由到单一 owner", () => {
  const state = read("overrides/patches/workflow/state-untracked/content.md");
  const noTask = read("overrides/patches/workflow/state-no-task/content.md");
  const triage = read("overrides/patches/workflow/intent-routing/request-triage/content.md");
  const route = read(".agents/skills/trellis-route/SKILL.md");
  const check = read(".agents/skills/trellis-check-all/references/reporting-and-disposition.md");
  const updateSpec = read("overrides/patches/skills/trellis-update-spec/autonomous-evaluation/content.md");
  const push = read(".agents/skills/trellis-push/SKILL.md");
  const helper = read("scripts/untracked_flow.py");

  assert.match(noTask, /untracked_flow\.py begin/);
  assert.match(noTask, /A same-item hit resumes the existing state/);
  assert.match(noTask, /`active-work-conflict` blocks unrelated code writes/);
  assert.match(noTask, /Unrelated read-only requests may continue without mutating the state/);
  assert.match(noTask, /starts at `stage=implement`/);
  assert.match(noTask, /helper is a workflow cursor/);
  assert.match(state, /single-active-work guard/);
  assert.match(state, /\[workflow-state:untracked_check\]/);
  assert.match(state, /\[workflow-state:untracked_spec\]/);
  assert.match(state, /\[workflow-state:untracked_push\]/);
  assert.match(state, /`owner` \/ `remainingOwners` fields are route reminders/);
  assert.match(state, /`stage=push` is only a route cursor/);
  assert.match(state, /load `trellis-push`/);
  assert.match(state, /task_intent\.py adopt/);
  assert.doesNotMatch(triage, /untracked_flow\.py begin/);
  assert.doesNotMatch(triage, /prepare-edit --paths/);
  assert.doesNotMatch(triage, /task_intent\.py adopt/);
  assert.match(state, /--reason completed/);
  for (const removed of [
    /prepare-edit/,
    /record-validation/,
    /record-check/,
    /record-spec/,
    /workspace fingerprint/i,
  ]) {
    assert.doesNotMatch(state, removed);
    assert.doesNotMatch(noTask, removed);
  }
  assert.match(route, /read-pref --target/);
  assert.match(route, /untracked 的“仅本次”只用于当前调用，不写任何 runtime 或偏好/);
  assert.match(route, /不得写 `Active task:`/);
  assert.match(route, /helper 只提供流程游标/);
  assert.match(check, /advance --stage implement/);
  assert.match(check, /advance --stage spec/);
  assert.doesNotMatch(check, /untracked_flow\.py record-check/);
  assert.match(updateSpec, /untracked_flow\.py advance --stage push/);
  assert.doesNotMatch(updateSpec, /untracked_flow\.py record-spec/);
  assert.match(push, /untracked_flow\.py clear --reason completed/);
  assert.match(push, /游标命中不表示 Push 已计划、已确认或已执行/);
  assert.match(helper, /STAGE_CONTRACTS/);
  assert.match(helper, /"trellis-check-all"/);
  assert.match(helper, /"trellis-update-spec"/);
  assert.match(helper, /"trellis-push"/);
  assert.match(helper, /remainingOwners/);
  assert.doesNotMatch(helper, /from git_evidence/);
  assert.doesNotMatch(helper, /workspace-drift/);
  assert.doesNotMatch(helper, /record_validation|record_check|record_spec|prepare_edit/);
});


test("untracked agent Patch 覆盖 Markdown、OMP、Codex 与 Kiro 合同", () => {
  const declaration = JSON.parse(
    read("overrides/patches/agents/untracked-context/patch.json"),
  );
  const operationIds = declaration.operations.map(({ id }) => id);
  const markdown = read("overrides/patches/agents/untracked-context/markdown-content.md");
  const codex = read("overrides/patches/agents/untracked-context/codex-content.md");
  const kiro = read("overrides/patches/agents/untracked-context/kiro-content.txt");

  assert.deepEqual(operationIds, [
    "markdown-agents-untracked-context",
    "markdown-implement-agents-untracked-context",
    "markdown-check-agents-untracked-context",
    "omp-implement-agent-untracked-context",
    "omp-check-agent-untracked-context",
    "codex-agents-untracked-context",
    "kiro-agents-untracked-context",
    "markdown-check-all-intent-guard",
    "codex-check-all-intent-guard",
    "kiro-check-agent-boundaries",
    "channel-check-all-intent-guard",
  ]);
  for (const content of [markdown, codex, kiro]) {
    assert.match(content, /Untracked work:/);
    assert.match(content, /untracked_flow\.py status --verbose/);
  }
  assert.match(markdown, /do not require or invent task artifacts/i);
});


test("untracked agent Patch 对完整平台真实模板重复应用幂等", () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "flower-untracked-agents-"));
  fs.mkdirSync(path.join(target, ".trellis"), { recursive: true });
  fs.writeFileSync(path.join(target, ".trellis/.version"), "0.6.12\n");
  const targets = [];
  for (const [sourcePlatform, sourceDirectory, targetPattern] of [
    ["claude", "agents", ".claude/agents/{role}.md"],
    ["cursor", "agents", ".cursor/agents/{role}.md"],
    ["codebuddy", "agents", ".codebuddy/agents/{role}.md"],
    ["opencode", "agents", ".opencode/agents/{role}.md"],
    ["droid", "droids", ".factory/droids/{role}.md"],
    ["gemini", "agents", ".gemini/agents/{role}.md"],
    ["grok", "agents", ".grok/agents/{role}.md"],
    ["kimi", "agents", ".kimi-code/skills/{role}/SKILL.md"],
    ["qoder", "agents", ".qoder/agents/{role}.md"],
    ["pi", "agents", ".pi/agents/{role}.md"],
    ["reasonix", "agents", ".reasonix/skills/{role}/SKILL.md"],
    ["snow", "agents", ".snow/agents/{role}.md"],
    ["trae", "agents", ".trae/agents/{role}.md"],
    ["zcode", "agents", ".zcode/agents/{role}.md"],
    ["omp", "agents", ".omp/agents/{role}.md"],
    ["codex", "agents", ".codex/agents/{role}.toml"],
    ["kiro", "agents", ".kiro/agents/{role}.json"],
  ]) {
    for (const role of ["trellis-implement", "trellis-check"]) {
      const relativePath = targetPattern.replace("{role}", role);
      const destination = path.join(target, ...relativePath.split("/"));
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      const extension = path.extname(relativePath).slice(1);
      fs.copyFileSync(
        path.join(upstreamTemplates, sourcePlatform, sourceDirectory, `${role}.${extension}`),
        destination,
      );
      targets.push(relativePath);
    }
  }

  const first = quietApply(target);
  assert.equal(first.patchReport.summary.errors, 0);
  const applied = new Map(targets.map((relativePath) => [
    relativePath,
    fs.readFileSync(path.join(target, ...relativePath.split("/")), "utf8"),
  ]));
  for (const [relativePath, value] of applied) {
    assert.match(value, /Untracked work:/, relativePath);
    if (relativePath.endsWith(".json")) {
      assert.doesNotMatch(value, /BEGIN skill-garden/, relativePath);
      JSON.parse(value);
    }
  }

  const second = quietApply(target);
  assert.equal(second.patchReport.summary.errors, 0);
  for (const [relativePath, value] of applied) {
    assert.equal(
      fs.readFileSync(path.join(target, ...relativePath.split("/")), "utf8"),
      value,
      relativePath,
    );
  }
});


test("相关精细安装入口携带 untracked helper，只有 task-intent 携带 Git evidence", () => {
  for (const skill of [
    "task-intent",
    "trellis-route",
    "trellis-check-all",
    "trellis-update-spec",
    "trellis-push",
  ]) {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), "flower-untracked-copy-"));
    const variant = path.join(target, "variant");
    fs.mkdirSync(path.join(variant, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(variant, "scripts/git_evidence.py"), "# evidence\n");
    fs.writeFileSync(path.join(variant, "scripts/untracked_flow.py"), "# flow\n");

    const result = copyScriptAssets(target, variant, [skill]);

    const expected = skill === "task-intent"
      ? ["script:git_evidence.py", "script:untracked_flow.py"]
      : ["script:untracked_flow.py"];
    assert.deepEqual(result.installed.sort(), expected, skill);
    fs.rmSync(target, { recursive: true, force: true });
  }
});


test("intent 与 execution Bundle 分别提供 workflow 全链和 agent 合同", () => {
  const intentBundle = JSON.parse(read("overrides/bundles/intent-routing.json"));
  const executionBundle = JSON.parse(read("overrides/bundles/untracked-execution.json"));
  for (const alias of [
    "trellis-route",
    "trellis-check-all",
    "trellis-update-spec",
    "trellis-push",
  ]) {
    assert.ok(executionBundle.aliases.includes(alias), alias);
  }
  assert.ok(intentBundle.aliases.includes("untracked-flow"));
  assert.ok(intentBundle.patches.includes("workflow/state-untracked"));
  assert.ok(intentBundle.patches.includes("hooks/inject-workflow-state/shared-runtime"));
  assert.deepEqual(executionBundle.patches, ["agents/untracked-context"]);
});
