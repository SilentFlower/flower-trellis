import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ENHANCEMENT_SKILL_TARGETS } from "../../src/constants.js";
import { applyEnhancements } from "../../src/lib/apply-enhancements.js";
import { ENHANCEMENTS_ROOT } from "../../src/lib/paths.js";

const V06_DIR = path.join(ENHANCEMENTS_ROOT, "0.6");
const META_PATCH_ROOT = path.join(
  V06_DIR,
  "overrides",
  "patches",
  "skills",
  "trellis-meta",
);
const UPSTREAM_META_ROOT = path.resolve(
  "node_modules/@mindfoldhq/trellis/dist/templates/common/bundled-skills/trellis-meta",
);
const COMPILED_TARGET_ROOT = path.resolve(
  "vendor/skill-garden/compiled-targets/0.6.12/full/targets",
);
const ENHANCEMENTS_MODEL_SPEC = path.resolve(
  ".trellis/spec/flower-trellis/cli/enhancements-model.md",
);
const META_PATCHES = [
  "managed-mode-precedence",
  "managed-architecture-and-ownership",
  "managed-customization-routing",
  "managed-workflow-owners",
];
const META_OPERATIONS = [
  "trellis-meta-trigger-description",
  "trellis-meta-managed-scope",
  "trellis-meta-managed-usage",
  "trellis-meta-managed-current-rules",
  "trellis-meta-managed-system-model",
  "trellis-meta-managed-customization-principles",
  "trellis-meta-managed-template-hashes",
  "trellis-meta-managed-file-boundaries",
  "trellis-meta-managed-skill-taxonomy",
  "trellis-meta-managed-platform-skill-roots",
  "trellis-meta-managed-bundled-overrides",
  "trellis-meta-managed-customization-entry",
  "trellis-meta-managed-customization-order",
  "trellis-meta-managed-workflow-entry",
  "trellis-meta-managed-workflow-edit-route",
  "trellis-meta-managed-skill-classification",
  "trellis-meta-managed-skill-edit-route",
  "trellis-meta-managed-common-paths",
  "trellis-meta-managed-shared-skill-consumers",
  "trellis-meta-managed-platform-edit-route",
  "trellis-meta-managed-workflow-source",
  "trellis-meta-managed-owner-routing",
  "trellis-meta-managed-state-boundary",
  "trellis-meta-managed-workflow-change-map",
];
const META_ASSERTION_FILES = [
  "SKILL.md",
  "references/local-architecture/overview.md",
  "references/local-architecture/generated-files.md",
  "references/local-architecture/bundled-skills.md",
  "references/local-architecture/workflow.md",
  "references/customize-local/overview.md",
  "references/customize-local/change-workflow.md",
  "references/customize-local/change-skills-or-commands.md",
  "references/platform-files/overview.md",
];

function makeTarget(prefix) {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(target, ".trellis"), { recursive: true });
  fs.writeFileSync(path.join(target, ".trellis/.version"), "0.6.12\n");
  return target;
}

function copyUpstreamMeta(target, skillRoot) {
  const destination = path.join(target, ...skillRoot.split("/"), "trellis-meta");
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(UPSTREAM_META_ROOT, destination, { recursive: true });
  return destination;
}

function quietApply(target, skills) {
  const original = console.log;
  console.log = () => {};
  try {
    return applyEnhancements(target, { variant: "0.6", skills });
  } finally {
    console.log = original;
  }
}

function readMeta(target, skillRoot, relativePath) {
  return fs.readFileSync(
    path.join(target, ...skillRoot.split("/"), "trellis-meta", ...relativePath.split("/")),
    "utf8",
  );
}

function assertManagedMeta(target, skillRoot) {
  const skill = readMeta(target, skillRoot, "SKILL.md");
  const architecture = readMeta(
    target,
    skillRoot,
    "references/local-architecture/overview.md",
  );
  const generated = readMeta(
    target,
    skillRoot,
    "references/local-architecture/generated-files.md",
  );
  const bundled = readMeta(
    target,
    skillRoot,
    "references/local-architecture/bundled-skills.md",
  );
  const workflow = readMeta(
    target,
    skillRoot,
    "references/local-architecture/workflow.md",
  );
  const skillRoute = readMeta(
    target,
    skillRoot,
    "references/customize-local/change-skills-or-commands.md",
  );

  assert.match(skill, /including Flower\/Skill-Garden managed Plugin overlays/);
  assert.match(skill, /vendor\/skill-garden\/\.trellis\/0\.6/);
  assert.match(skill, /runtime truth for current behavior, but it is not automatically the authoring source/);
  assert.match(architecture, /\*\*Plugin management layer\*\*/);
  assert.match(architecture, /npm run sync.*enhancements\/0\.6/);
  assert.match(generated, /Plugin ownership, Patch provenance, transaction checks/);
  assert.match(bundled, /selectors and full baselines fail closed on upstream drift/);
  assert.match(bundled, /\| Oh My Pi \| `\.omp\/skills\/<skill>\/` \|/);
  assert.match(bundled, /\| Grok Build \| `\.grok\/skills\/<skill>\/` \|/);
  assert.match(bundled, /\| Snow CLI \| `\.snow\/skills\/<skill>\/` \|/);
  assert.match(bundled, /Codex, Gemini CLI, Pi Agent, and Kimi Code/);
  assert.match(bundled, /`\.kimi-code\/skills\/` must not receive a second bundled copy/);
  assert.match(bundled, /Do not infer ownership from a skill name/);
  assert.match(workflow, /Do not choose implementation or checking behavior from a static platform-capability split/);
  assert.match(workflow, /trellis-route/);
  assert.match(workflow, /trellis-auto-loop/);
  assert.match(workflow, /Untracked work completion \| `workflow-state:untracked`/);
  assert.match(workflow, /Untracked task adoption \| Request Triage, `trellis-brainstorm`/);
  assert.match(workflow, /Planning handoff \| `trellis-task-brief` and the task-start brief guard/);
  assert.match(workflow, /Do not maintain a fixed Skill-Garden skill count/);
  assert.match(skillRoute, /Do not classify every non-bundled name as project-local/);
  assert.match(skillRoute, /\| Oh My Pi \| `\.omp\/skills\/`, `\.omp\/commands\/` \|/);
  assert.match(skillRoute, /\| Grok Build \| `\.grok\/skills\/`, `\.grok\/commands\/` \|/);
  assert.match(skillRoute, /\| Snow CLI \| `\.snow\/skills\/`, `\.snow\/commands\/` \|/);
  assert.match(skillRoute, /Codex, Gemini CLI, Pi Agent, Kimi Code/);

  assert.doesNotMatch(bundled, /Not managed by Trellis at all/);
  assert.doesNotMatch(bundled, /Edit the local file directly/);
  assert.doesNotMatch(skillRoute, /Created by the user \(or another skill\) and never moved/);
  assert.doesNotMatch(workflow, /dispatch `trellis-implement` by default/);
  assert.doesNotMatch(workflow, /edit these state blocks and the routing table above them/);
  assert.doesNotMatch(workflow, /preauthori[sz]ation/i);
}

function snapshotMeta(target) {
  const snapshot = {};
  for (const { root } of ENHANCEMENT_SKILL_TARGETS) {
    for (const relativePath of META_ASSERTION_FILES) {
      snapshot[`${root}/${relativePath}`] = readMeta(target, root, relativePath);
    }
  }
  return snapshot;
}

test("trellis-meta Patch 目标与集中平台 skill roots 完全一致", () => {
  for (const patchName of META_PATCHES) {
    const declaration = JSON.parse(
      fs.readFileSync(path.join(META_PATCH_ROOT, patchName, "patch.json"), "utf8"),
    );
    for (const operation of declaration.operations) {
      assert.equal(operation.targetPolicy, "each-existing", operation.id);
      const relative = operation.targets[0].path.split("/trellis-meta/")[1];
      const expected = ENHANCEMENT_SKILL_TARGETS
        .map(({ root }) => `${root}/trellis-meta/${relative}`)
        .sort();
      assert.deepEqual(
        operation.targets.map(({ path: targetPath }) => targetPath).sort(),
        expected,
        operation.id,
      );
      assert.ok(operation.targets.every(({ missing }) => missing === "skip"), operation.id);
    }
  }
});

test("trellis-meta 联动复核区分 owner 内部 SOP 与稳定架构变化", () => {
  const spec = fs.readFileSync(ENHANCEMENTS_MODEL_SPEC, "utf8");

  assert.match(spec, /## Scenario: Trellis Meta Synchronization Gate/);
  assert.match(spec, /meta-impact: no-op \| patch-required/);
  assert.match(spec, /owner identity\/boundary/);
  assert.match(spec, /capability discovery path/);
  assert.match(spec, /authoring source and managed ownership/);
  assert.match(spec, /Bundle selection and platform distribution surface/);
  assert.match(
    spec,
    /vendor\/skill-garden\/\.trellis\/0\.6\/overrides\/patches\/skills\/trellis-meta\//,
  );
  assert.match(
    spec,
    /Planning Brief 的显式预授权属于 `trellis-task-brief` 与 task-start brief guard 的内部交互合同/,
  );
});

test("trellis-meta 四个选择入口只应用 meta Patch", () => {
  for (const alias of [
    "trellis-meta",
    "meta-architecture",
    "trellis-create-command",
    "create-command",
  ]) {
    const target = makeTarget(`flower-meta-${alias}-`);
    copyUpstreamMeta(target, ".agents/skills");

    const result = quietApply(target, [alias]);
    assert.equal(result.patchReport.summary.errors, 0, alias);
    assertManagedMeta(target, ".agents/skills");

    const state = JSON.parse(fs.readFileSync(path.join(target, ".flower/state.json"), "utf8"));
    const skillGarden = state.plugins.find(({ id }) => id === "flower/skill-garden");
    const operations = skillGarden.patches
      .map(({ operation }) => operation.replace(/^skill-garden\//, ""))
      .sort();
    assert.deepEqual(operations, [...META_OPERATIONS].sort(), alias);
    assert.equal(fs.existsSync(path.join(target, ".claude")), false, alias);

    if (["trellis-create-command", "create-command"].includes(alias)) {
      assert.ok(result.installed.includes("trellis-create-command"), alias);
      assert.equal(
        fs.existsSync(path.join(target, ".agents/skills/trellis-create-command/SKILL.md")),
        true,
        alias,
      );
    }
  }
});

test("trellis-meta 覆盖全部现有平台 root 且重复应用字节不变", () => {
  const target = makeTarget("flower-meta-platforms-");
  for (const { root } of ENHANCEMENT_SKILL_TARGETS) copyUpstreamMeta(target, root);

  quietApply(target, ["trellis-meta"]);
  for (const { root } of ENHANCEMENT_SKILL_TARGETS) assertManagedMeta(target, root);
  for (const root of [".agents/skills", ".claude/skills"]) {
    for (const relativePath of META_ASSERTION_FILES) {
      const compiled = fs.readFileSync(
        path.join(
          COMPILED_TARGET_ROOT,
          ...root.split("/"),
          "trellis-meta",
          ...relativePath.split("/"),
        ),
        "utf8",
      );
      assert.equal(readMeta(target, root, relativePath), compiled, `${root}/${relativePath}`);
    }
  }
  const first = snapshotMeta(target);

  quietApply(target, ["trellis-meta"]);
  assert.deepEqual(snapshotMeta(target), first);
});
