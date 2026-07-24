import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { applyPatchPlan, preparePatchPlan } from "../../src/lib/patch-engine.js";

const TEST_ROOT = path.dirname(fileURLToPath(import.meta.url));
const SHARED_CORE_FIXTURE = path.join(
  TEST_ROOT,
  "../fixtures/patch-engine/core",
);

function write(root, relative, value) {
  const file = path.join(root, ...relative.split("/"));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value);
  return file;
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "flower-patch-"));
  const target = path.join(root, "target");
  const catalog = path.join(root, "catalog");
  fs.mkdirSync(path.join(target, ".trellis"), { recursive: true });
  return {
    root,
    target,
    catalog,
    catalogSpec: {
      id: "skill-garden",
      patchesDir: path.join(catalog, "patches"),
      bundlesDir: path.join(catalog, "bundles"),
    },
  };
}

function addPatch(f, ref, declaration, sources = {}) {
  const leaf = path.join(f.catalog, "patches", ...ref.split("/"));
  write(leaf, "patch.json", JSON.stringify(declaration, null, 2) + "\n");
  for (const [name, value] of Object.entries(sources)) write(leaf, name, value);
}

function addBundle(f, declaration) {
  write(
    path.join(f.catalog, "bundles"),
    `${declaration.id}.json`,
    JSON.stringify(declaration, null, 2) + "\n",
  );
}

function sharedCoreFixture() {
  const f = fixture();
  fs.cpSync(path.join(SHARED_CORE_FIXTURE, "catalog"), f.catalog, { recursive: true });
  fs.cpSync(path.join(SHARED_CORE_FIXTURE, "target"), f.target, { recursive: true });
  return f;
}

test("literal insert/replace/remove 支持旧 transform marker 迁移且重复应用幂等", () => {
  const f = sharedCoreFixture();

  const first = applyPatchPlan(f.target, preparePatchPlan(f.target, [f.catalogSpec]));
  assert.equal(first.changed, 1);
  const once = fs.readFileSync(path.join(f.target, "sample.md"), "utf8");
  assert.match(once, /skill-garden patch replace-rule/);
  assert.match(once, /ANCHOR\n<!-- BEGIN skill-garden patch insert-rule/);
  assert.match(once, /INSERT A\nINSERT B/);
  assert.doesNotMatch(once, /^REMOVE$/m);

  const second = applyPatchPlan(
    f.target,
    preparePatchPlan(f.target, [f.catalogSpec], { skills: ["alias"] }),
  );
  assert.equal(second.changed, 0);
  assert.equal(fs.readFileSync(path.join(f.target, "sample.md"), "utf8"), once);

  const legacy = once.replaceAll("skill-garden patch replace-rule", "skill-garden transform replace-rule");
  fs.writeFileSync(path.join(f.target, "sample.md"), legacy);
  const migrated = applyPatchPlan(f.target, preparePatchPlan(f.target, [f.catalogSpec]));
  assert.equal(migrated.changed, 1);
  const migratedText = fs.readFileSync(path.join(f.target, "sample.md"), "utf8");
  assert.match(migratedText, /skill-garden patch replace-rule/);
  assert.doesNotMatch(migratedText, /skill-garden transform replace-rule/);
});

test("JS/Python 对共享 Core fixture 返回相同结构化 plan 与 provenance", () => {
  const f = sharedCoreFixture();
  const plan = preparePatchPlan(f.target, [f.catalogSpec]);
  const result = applyPatchPlan(f.target, plan);
  const normalizedPlan = {
    bundles: plan.bundles,
    patches: plan.patches,
    catalogs: plan.catalogs,
    selectedBundles: plan.selectedBundles,
    selectedPatches: plan.selectedPatches,
    operationOrder: plan.operationOrder,
    files: plan.files.map((item) => ({
      target: item.target,
      original: item.original,
      originalExists: item.originalExists,
      next: item.next,
      operations: item.operations,
      patches: item.patches,
      bundles: item.bundles,
      operationEntries: item.operationEntries,
      changed: item.changed,
      beforeHash: item.beforeHash,
      afterHash: item.afterHash,
    })),
    results: plan.results,
    catalogHash: plan.catalogHash,
    catalogOperations: plan.catalogOperations,
  };
  const python = JSON.parse(execFileSync(
    "python3",
    [path.join(TEST_ROOT, "../python/patch_engine_plan_helper.py")],
    { encoding: "utf8" },
  ));
  assert.deepEqual(python, {
    plan: normalizedPlan,
    provenance: result.provenance,
  });
});

test("required 漂移在全部目标写入前失败", () => {
  const f = fixture();
  write(f.target, "valid.md", "VALID\n");
  write(f.target, "drift.md", "DRIFT\n");
  addPatch(f, "text/atomic", {
    schemaVersion: 2,
    id: "atomic",
    purpose: "test",
    operations: [
      {
        id: "valid-rule",
        operation: "replace",
        targets: [{ kind: "markdown", path: "valid.md", missing: "error" }],
        selector: { type: "literal", source: "valid.selector.md" },
        content: { source: "valid.content.md" },
      },
      {
        id: "drift-rule",
        operation: "replace",
        targets: [{ kind: "markdown", path: "drift.md", missing: "error" }],
        selector: { type: "literal", source: "drift.selector.md" },
        content: { source: "drift.content.md" },
      },
    ],
  }, {
    "valid.selector.md": "VALID",
    "valid.content.md": "CHANGED",
    "drift.selector.md": "EXPECTED",
    "drift.content.md": "REPLACED",
  });
  addBundle(f, { schemaVersion: 1, id: "atomic", patches: ["text/atomic"] });

  assert.throws(
    () => preparePatchPlan(f.target, [f.catalogSpec]),
    /Patch 预检失败:drift-rule@drift\.md/,
  );
  assert.equal(fs.readFileSync(path.join(f.target, "valid.md"), "utf8"), "VALID\n");
});

test("preflight 后目标并发变化时 apply 停止且不覆盖新内容", () => {
  const f = fixture();
  write(f.target, "sample.md", "OLD\n");
  addPatch(f, "text/concurrent", {
    schemaVersion: 2,
    id: "concurrent",
    purpose: "test",
    operations: [{
      id: "concurrent-rule",
      operation: "replace",
      targets: [{ kind: "markdown", path: "sample.md", missing: "error" }],
      selector: { type: "literal", source: "selector.md" },
      content: { source: "content.md" },
    }],
  }, { "selector.md": "OLD", "content.md": "NEW" });
  addBundle(f, { schemaVersion: 1, id: "concurrent", patches: ["text/concurrent"] });

  const plan = preparePatchPlan(f.target, [f.catalogSpec]);
  fs.writeFileSync(path.join(f.target, "sample.md"), "USER CHANGE\n");
  assert.throws(() => applyPatchPlan(f.target, plan), /内容漂移/);
  assert.equal(fs.readFileSync(path.join(f.target, "sample.md"), "utf8"), "USER CHANGE\n");
});

test("optional、targetPolicy 与 missing=create 遵守声明边界", () => {
  const f = fixture();
  write(f.target, "existing.md", "KEEP\n");
  fs.mkdirSync(path.join(f.target, "generated"), { recursive: true });
  addPatch(f, "targets/policies", {
    schemaVersion: 2,
    id: "target-policies",
    purpose: "test",
    operations: [
      {
        id: "optional-drift",
        operation: "replace",
        required: false,
        targets: [{ kind: "markdown", path: "existing.md", missing: "error" }],
        selector: { type: "literal", source: "missing.selector.md" },
        content: { source: "optional.content.md" },
      },
      {
        id: "one-existing",
        operation: "replace",
        targetPolicy: "at-least-one",
        targets: [
          { kind: "json", path: "generated/result.json", missing: "create", markerStyle: "none" },
          { kind: "file", path: "absent/result.txt", missing: "skip", markerStyle: "none" },
        ],
        selector: { type: "whole-file" },
        content: { source: "generated.content.txt" },
      },
    ],
  }, {
    "missing.selector.md": "MISSING",
    "optional.content.md": "IGNORED",
    "generated.content.txt": "{\"created\":true}",
  });
  addBundle(f, { schemaVersion: 1, id: "policies", patches: ["targets/policies"] });

  const plan = preparePatchPlan(f.target, [f.catalogSpec]);
  assert.equal(plan.results.filter((item) => item.status === "optional-skip").length, 1);
  assert.equal(plan.results.filter((item) => item.status === "missing-target").length, 1);
  applyPatchPlan(f.target, plan);
  assert.equal(fs.readFileSync(path.join(f.target, "existing.md"), "utf8"), "KEEP\n");
  assert.equal(
    fs.readFileSync(path.join(f.target, "generated/result.json"), "utf8"),
    "{\"created\":true}\n",
  );

  const requiredAll = fixture();
  addPatch(requiredAll, "targets/all", {
    schemaVersion: 2,
    id: "required-all",
    purpose: "test",
    operations: [{
      id: "required-all-targets",
      operation: "replace",
      targetPolicy: "required-all",
      targets: [
        { kind: "file", path: "missing-a.txt", missing: "skip", markerStyle: "none" },
        { kind: "file", path: "missing-b.txt", missing: "skip", markerStyle: "none" },
      ],
      selector: { type: "whole-file" },
      content: { source: "content.txt" },
    }],
  }, { "content.txt": "NOPE" });
  addBundle(requiredAll, { schemaVersion: 1, id: "required-all", patches: ["targets/all"] });
  assert.throws(
    () => preparePatchPlan(requiredAll.target, [requiredAll.catalogSpec]),
    /required-all target 不完整/,
  );

  const invalidCreate = fixture();
  addPatch(invalidCreate, "targets/invalid-create", {
    schemaVersion: 2,
    id: "invalid-create",
    purpose: "test",
    operations: [{
      id: "invalid-create-file",
      operation: "replace",
      targets: [{ kind: "file", path: "result.txt", missing: "create" }],
      selector: { type: "whole-file" },
      content: { source: "content.txt" },
    }],
  }, { "content.txt": "NOPE" });
  addBundle(invalidCreate, {
    schemaVersion: 1,
    id: "invalid-create",
    patches: ["targets/invalid-create"],
  });
  assert.throws(
    () => preparePatchPlan(invalidCreate.target, [invalidCreate.catalogSpec]),
    /missing=create 只允许 json\/yaml\/toml target/,
  );
});

test("新建目标与首次备份拒绝通过软链逃逸项目", () => {
  const createFixture = fixture();
  const outsideCreate = fs.mkdtempSync(path.join(os.tmpdir(), "flower-patch-outside-"));
  fs.symlinkSync(outsideCreate, path.join(createFixture.target, "generated"), "dir");
  addPatch(createFixture, "targets/symlink-create", {
    schemaVersion: 2,
    id: "symlink-create",
    purpose: "test",
    operations: [{
      id: "symlink-create-json",
      operation: "replace",
      targets: [{ kind: "json", path: "generated/result.json", missing: "create" }],
      selector: { type: "whole-file" },
      content: { source: "content.json" },
    }],
  }, { "content.json": "{\"unsafe\":false}" });
  addBundle(createFixture, {
    schemaVersion: 1,
    id: "symlink-create",
    patches: ["targets/symlink-create"],
  });
  assert.throws(
    () => preparePatchPlan(createFixture.target, [createFixture.catalogSpec]),
    /target\.parent 通过软链逃逸根目录/,
  );
  assert.equal(fs.existsSync(path.join(outsideCreate, "result.json")), false);

  const applyFixture = fixture();
  const outsideApply = fs.mkdtempSync(path.join(os.tmpdir(), "flower-apply-outside-"));
  fs.mkdirSync(path.join(applyFixture.target, "generated"));
  addPatch(applyFixture, "targets/symlink-swap", {
    schemaVersion: 2,
    id: "symlink-swap",
    purpose: "test",
    operations: [{
      id: "symlink-swap-json",
      operation: "replace",
      targets: [{ kind: "json", path: "generated/result.json", missing: "create" }],
      selector: { type: "whole-file" },
      content: { source: "content.json" },
    }],
  }, { "content.json": "{\"unsafe\":false}" });
  addBundle(applyFixture, {
    schemaVersion: 1,
    id: "symlink-swap",
    patches: ["targets/symlink-swap"],
  });
  const applyPlan = preparePatchPlan(applyFixture.target, [applyFixture.catalogSpec]);
  fs.rmdirSync(path.join(applyFixture.target, "generated"));
  fs.symlinkSync(outsideApply, path.join(applyFixture.target, "generated"), "dir");
  assert.throws(
    () => applyPatchPlan(applyFixture.target, applyPlan),
    /Patch 目标父目录:generated\/result\.json 通过软链逃逸根目录/,
  );
  assert.equal(fs.existsSync(path.join(outsideApply, "result.json")), false);

  const backupFixture = fixture();
  const outsideBackup = fs.mkdtempSync(path.join(os.tmpdir(), "flower-backup-outside-"));
  write(backupFixture.target, "sample.md", "OLD\n");
  fs.symlinkSync(
    outsideBackup,
    path.join(backupFixture.target, ".trellis/.backup-flower"),
    "dir",
  );
  addPatch(backupFixture, "targets/symlink-backup", {
    schemaVersion: 2,
    id: "symlink-backup",
    purpose: "test",
    operations: [{
      id: "symlink-backup-file",
      operation: "replace",
      targets: [{ kind: "markdown", path: "sample.md", missing: "error" }],
      selector: { type: "literal", source: "selector.md" },
      content: { source: "content.md" },
    }],
  }, { "selector.md": "OLD", "content.md": "NEW" });
  addBundle(backupFixture, {
    schemaVersion: 1,
    id: "symlink-backup",
    patches: ["targets/symlink-backup"],
  });
  const plan = preparePatchPlan(backupFixture.target, [backupFixture.catalogSpec]);
  assert.throws(() => applyPatchPlan(backupFixture.target, plan), /备份路径通过软链逃逸项目/);
  assert.equal(fs.readFileSync(path.join(backupFixture.target, "sample.md"), "utf8"), "OLD\n");
  assert.equal(fs.readdirSync(outsideBackup).length, 0);
});

test("workflow-state body replace 接受 baseline 和 legacy marker，拒绝未知漂移", () => {
  const f = fixture();
  const workflow = [
    "## Phase Index",
    "",
    "[workflow-state:planning]",
    "UPSTREAM BODY",
    "[/workflow-state:planning]",
    "",
  ].join("\n");
  write(f.target, ".trellis/workflow.md", workflow);
  addPatch(f, "workflow/planning", {
    schemaVersion: 2,
    id: "workflow-planning",
    purpose: "workflow_state",
    operations: [{
      id: "workflow-state-planning",
      operation: "replace",
      scope: "body",
      targets: [{ kind: "workflow", path: ".trellis/workflow.md", missing: "error" }],
      selector: { type: "workflow-state", name: "planning" },
      baselines: ["baseline.md"],
      content: { sources: ["common-content.md", "subagent-content.md"] },
      legacyMarkers: [{ namespace: "workflow-state", id: "planning" }],
    }],
  }, {
    "baseline.md": "UPSTREAM BODY",
    "common-content.md": "COMMON",
    "subagent-content.md": "SUBAGENT",
  });
  addBundle(f, { schemaVersion: 1, id: "workflow", patches: ["workflow/planning"] });

  applyPatchPlan(f.target, preparePatchPlan(f.target, [f.catalogSpec]));
  const applied = fs.readFileSync(path.join(f.target, ".trellis/workflow.md"), "utf8");
  assert.match(applied, /workflow-state:planning\]\n<!-- BEGIN skill-garden patch workflow-state-planning/);
  assert.match(applied, /COMMON\nSUBAGENT/);
  assert.doesNotMatch(applied, /UPSTREAM BODY/);

  fs.writeFileSync(
    path.join(f.target, ".trellis/workflow.md"),
    workflow.replace("UPSTREAM BODY", "UNKNOWN USER BODY"),
  );
  assert.throws(
    () => preparePatchPlan(f.target, [f.catalogSpec]),
    /body fingerprint 漂移/,
  );
});

test("Workflow Hub、Markdown section 和 document body 清理旧 override 后生成单一 Patch", () => {
  const f = fixture();
  write(f.target, ".trellis/workflow.md", "## Phase Index\n\nLOWER\n");
  write(f.target, "update.md", [
    "---",
    "name: update",
    "---",
    "",
    "### HIGHEST PRIORITY: skill-garden old",
    "",
    "<!-- BEGIN skill-garden skill override trellis-update-spec v0.6 -->",
    "OLD OVERRIDE",
    "<!-- END skill-garden skill override trellis-update-spec v0.6 -->",
    "",
    "# Update",
    "",
    "## Interactive Mode",
    "",
    "ASK USER",
    "",
    "## Keep",
    "",
    "KEEP",
    "",
  ].join("\n"));
  write(f.target, "finish.md", "---\nname: finish\n---\n\n# Old\n\nOLD BODY\n");
  addPatch(f, "workflow/hub", {
    schemaVersion: 2,
    id: "workflow-hub",
    purpose: "workflow_hub",
    operations: [{
      id: "workflow-hub",
      operation: "insert",
      position: "after",
      targets: [{ kind: "workflow", path: ".trellis/workflow.md", missing: "error" }],
      selector: { type: "workflow-hub", heading: "## Phase Index" },
      cleanup: [{ type: "workflow-hub" }],
      content: { source: "content.md" },
    }],
  }, { "content.md": "HUB" });
  addPatch(f, "skills/update", {
    schemaVersion: 2,
    id: "update",
    purpose: "skill_override",
    operations: [{
      id: "update-autonomous",
      operation: "replace",
      targets: [{ kind: "skill", path: "update.md", missing: "error" }],
      selector: { type: "markdown-section", heading: "## Interactive Mode" },
      cleanup: [{ type: "skill-override", id: "trellis-update-spec" }],
      baselines: ["interactive.md"],
      content: { source: "autonomous.md" },
    }],
  }, {
    "interactive.md": "## Interactive Mode\n\nASK USER",
    "autonomous.md": "## Autonomous Mode\n\nDECIDE",
  });
  addPatch(f, "skills/finish", {
    schemaVersion: 2,
    id: "finish",
    purpose: "skill_override",
    operations: [{
      id: "finish-body",
      operation: "replace",
      scope: "body",
      targets: [{ kind: "skill", path: "finish.md", missing: "error" }],
      selector: { type: "markdown-document", preserveFrontmatter: true },
      baselines: ["body.md"],
      content: { source: "content.md" },
    }],
  }, {
    "body.md": "# Old\n\nOLD BODY",
    "content.md": "# Finish\n\nNEW BODY",
  });
  addBundle(f, {
    schemaVersion: 1,
    id: "all",
    patches: ["workflow/hub", "skills/update", "skills/finish"],
  });

  applyPatchPlan(f.target, preparePatchPlan(f.target, [f.catalogSpec]));
  const workflowText = fs.readFileSync(path.join(f.target, ".trellis/workflow.md"), "utf8");
  assert.match(workflowText, /## Phase Index\n\n<!-- BEGIN skill-garden patch workflow-hub/);
  const update = fs.readFileSync(path.join(f.target, "update.md"), "utf8");
  assert.doesNotMatch(update, /OLD OVERRIDE|Interactive Mode/);
  assert.match(update, /skill-garden patch update-autonomous/);
  assert.match(update, /## Keep\n\nKEEP/);
  const finish = fs.readFileSync(path.join(f.target, "finish.md"), "utf8");
  assert.match(finish, /^---\nname: finish\n---/);
  assert.doesNotMatch(finish, /OLD BODY/);
  assert.match(finish, /skill-garden patch finish-body/);
});

test("whole-file fingerprint、missing policy、路径逃逸和 Bundle 过滤", () => {
  const f = fixture();
  write(f.target, "hook.py", "UPSTREAM\n");
  addPatch(f, "hooks/shared", {
    schemaVersion: 2,
    id: "shared-hook",
    purpose: "hook_override",
    operations: [{
      id: "shared-hook-file",
      operation: "replace",
      targets: [
        { kind: "file", path: "hook.py", missing: "error", markerStyle: "none" },
        { kind: "file", path: "missing.py", missing: "skip", markerStyle: "none" },
      ],
      selector: { type: "whole-file" },
      baselines: ["baseline.py"],
      content: { source: "content.py" },
    }],
  }, { "baseline.py": "UPSTREAM\n", "content.py": "PATCHED\n" });
  addBundle(f, {
    schemaVersion: 1,
    id: "shared-hook",
    aliases: ["hook"],
    patches: ["hooks/shared"],
  });
  const miss = preparePatchPlan(f.target, [f.catalogSpec], { skills: ["other"] });
  assert.deepEqual(miss.patches, []);
  const plan = preparePatchPlan(f.target, [f.catalogSpec], { skills: ["hook"] });
  assert.equal(plan.results.filter((item) => item.status === "missing-target").length, 1);
  applyPatchPlan(f.target, plan);
  assert.equal(fs.readFileSync(path.join(f.target, "hook.py"), "utf8"), "PATCHED\n");

  fs.writeFileSync(path.join(f.target, "hook.py"), "USER CHANGE\n");
  assert.throws(() => preparePatchPlan(f.target, [f.catalogSpec]), /whole-file fingerprint 漂移/);

  const unsafe = fixture();
  addPatch(unsafe, "unsafe", {
    schemaVersion: 2,
    id: "unsafe",
    purpose: "test",
    operations: [{
      id: "unsafe",
      operation: "replace",
      targets: [{ kind: "markdown", path: "../outside.md", missing: "error" }],
      selector: { type: "literal", source: "selector.md" },
      content: { source: "content.md" },
    }],
  }, { "selector.md": "A", "content.md": "B" });
  addBundle(unsafe, { schemaVersion: 1, id: "unsafe", patches: ["unsafe"] });
  assert.throws(() => preparePatchPlan(unsafe.target, [unsafe.catalogSpec]), /不安全路径片段/);
});

test("after、dependsOn 与声明顺序共同解析稳定 operation order", () => {
  const f = fixture();
  addPatch(f, "ordering/flow", {
    schemaVersion: 2,
    id: "ordering-flow",
    purpose: "test",
    operations: [
      {
        id: "auto-task-create",
        dependsOn: ["planning-authorization"],
        operation: "replace",
        targets: [{ kind: "file", path: "missing-auto.txt", missing: "skip", markerStyle: "none" }],
        selector: { type: "whole-file" },
        content: { value: "auto" },
      },
      {
        id: "planning-authorization",
        operation: "replace",
        targets: [{ kind: "file", path: "missing-auth.txt", missing: "skip", markerStyle: "none" }],
        selector: { type: "whole-file" },
        content: { value: "auth" },
      },
      {
        id: "planning-handoff",
        operation: "replace",
        targets: [{ kind: "file", path: "missing-handoff.txt", missing: "skip", markerStyle: "none" }],
        selector: { type: "whole-file" },
        content: { value: "handoff" },
      },
      {
        id: "planning-readiness",
        after: ["planning-handoff"],
        operation: "replace",
        targets: [{ kind: "file", path: "missing-readiness.txt", missing: "skip", markerStyle: "none" }],
        selector: { type: "whole-file" },
        content: { value: "readiness" },
      },
    ],
  });
  addBundle(f, { schemaVersion: 1, id: "ordering", patches: ["ordering/flow"] });

  const plan = preparePatchPlan(f.target, [f.catalogSpec]);
  assert.deepEqual(
    plan.operationOrder.map((item) => item.id),
    ["planning-authorization", "auto-task-create", "planning-handoff", "planning-readiness"],
  );
  assert.deepEqual(plan.operationOrder[1].incomingEdges, [{
    from: "skill-garden/planning-authorization",
    type: "dependsOn",
  }]);
  assert.deepEqual(plan.operationOrder[3].incomingEdges, [{
    from: "skill-garden/planning-handoff",
    type: "after",
  }]);
});

test("after 忽略未选 operation，dependsOn 对未选依赖阻断", () => {
  const f = fixture();
  addPatch(f, "selection/base", {
    schemaVersion: 2,
    id: "selection-base",
    purpose: "test",
    operations: [{
      id: "selection-base",
      operation: "replace",
      targets: [{ kind: "file", path: "missing-base.txt", missing: "skip", markerStyle: "none" }],
      selector: { type: "whole-file" },
      content: { value: "base" },
    }],
  });
  addPatch(f, "selection/after", {
    schemaVersion: 2,
    id: "selection-after",
    purpose: "test",
    operations: [{
      id: "selection-after",
      after: ["selection-base"],
      operation: "replace",
      targets: [{ kind: "file", path: "missing-after.txt", missing: "skip", markerStyle: "none" }],
      selector: { type: "whole-file" },
      content: { value: "after" },
    }],
  });
  addPatch(f, "selection/depends", {
    schemaVersion: 2,
    id: "selection-depends",
    purpose: "test",
    operations: [{
      id: "selection-depends",
      dependsOn: ["selection-base"],
      operation: "replace",
      targets: [{ kind: "file", path: "missing-depends.txt", missing: "skip", markerStyle: "none" }],
      selector: { type: "whole-file" },
      content: { value: "depends" },
    }],
  });
  addBundle(f, {
    schemaVersion: 1,
    id: "base",
    aliases: ["base-only"],
    patches: ["selection/base"],
  });
  addBundle(f, {
    schemaVersion: 1,
    id: "after",
    aliases: ["after-only"],
    patches: ["selection/after"],
  });
  addBundle(f, {
    schemaVersion: 1,
    id: "depends",
    aliases: ["depends-only"],
    patches: ["selection/depends"],
  });

  const afterPlan = preparePatchPlan(f.target, [f.catalogSpec], { skills: ["after-only"] });
  assert.deepEqual(afterPlan.operationOrder.map((item) => item.id), ["selection-after"]);
  assert.throws(
    () => preparePatchPlan(f.target, [f.catalogSpec], { skills: ["depends-only"] }),
    /dependsOn 未进入当前计划:skill-garden\/selection-base/,
  );
});

test("未知依赖、自依赖和循环在 target preflight 前失败", () => {
  const unknown = fixture();
  addPatch(unknown, "invalid/unknown", {
    schemaVersion: 2,
    id: "invalid-unknown",
    purpose: "test",
    operations: [{
      id: "invalid-unknown",
      after: ["missing-operation"],
      operation: "replace",
      targets: [{ kind: "file", path: "missing.txt", missing: "skip", markerStyle: "none" }],
      selector: { type: "whole-file" },
      content: { value: "unknown" },
    }],
  });
  addBundle(unknown, { schemaVersion: 1, id: "invalid", patches: ["invalid/unknown"] });
  assert.throws(
    () => preparePatchPlan(unknown.target, [unknown.catalogSpec]),
    /引用未知 operation:missing-operation/,
  );

  const self = fixture();
  addPatch(self, "invalid/self", {
    schemaVersion: 2,
    id: "invalid-self",
    purpose: "test",
    operations: [{
      id: "invalid-self",
      dependsOn: ["invalid-self"],
      operation: "replace",
      targets: [{ kind: "file", path: "missing.txt", missing: "skip", markerStyle: "none" }],
      selector: { type: "whole-file" },
      content: { value: "self" },
    }],
  });
  addBundle(self, { schemaVersion: 1, id: "invalid", patches: ["invalid/self"] });
  assert.throws(() => preparePatchPlan(self.target, [self.catalogSpec]), /不能依赖自身/);

  const cycle = fixture();
  addPatch(cycle, "invalid/cycle", {
    schemaVersion: 2,
    id: "invalid-cycle",
    purpose: "test",
    operations: [
      {
        id: "cycle-a",
        after: ["cycle-b"],
        operation: "replace",
        targets: [{ kind: "file", path: "a.txt", missing: "skip", markerStyle: "none" }],
        selector: { type: "whole-file" },
        content: { value: "a" },
      },
      {
        id: "cycle-b",
        after: ["cycle-a"],
        operation: "replace",
        targets: [{ kind: "file", path: "b.txt", missing: "skip", markerStyle: "none" }],
        selector: { type: "whole-file" },
        content: { value: "b" },
      },
    ],
  });
  addBundle(cycle, { schemaVersion: 1, id: "invalid", patches: ["invalid/cycle"] });
  assert.throws(() => preparePatchPlan(cycle.target, [cycle.catalogSpec]), /依赖循环/);

  const duplicated = fixture();
  addPatch(duplicated, "invalid/duplicated", {
    schemaVersion: 2,
    id: "invalid-duplicated",
    purpose: "test",
    operations: [
      {
        id: "base-operation",
        operation: "replace",
        targets: [{ kind: "file", path: "base.txt", missing: "skip", markerStyle: "none" }],
        selector: { type: "whole-file" },
        content: { value: "base" },
      },
      {
        id: "consumer-operation",
        after: ["base-operation"],
        dependsOn: ["skill-garden/base-operation"],
        operation: "replace",
        targets: [{ kind: "file", path: "consumer.txt", missing: "skip", markerStyle: "none" }],
        selector: { type: "whole-file" },
        content: { value: "consumer" },
      },
    ],
  });
  addBundle(duplicated, {
    schemaVersion: 1,
    id: "invalid",
    patches: ["invalid/duplicated"],
  });
  assert.throws(
    () => preparePatchPlan(duplicated.target, [duplicated.catalogSpec]),
    /同一依赖不能同时声明 after 和 dependsOn/,
  );
});

test("多 catalog 可复用本地 ID，并以 qualified marker 和 provenance 隔离", () => {
  const f = fixture();
  write(f.target, "sample.md", "FIRST\nSECOND\n");
  const catalogs = ["plugin-one", "plugin-two"].map((id, index) => {
    const catalog = path.join(f.root, id);
    const item = {
      ...f,
      catalog,
      catalogSpec: {
        id,
        patchesDir: path.join(catalog, "patches"),
        bundlesDir: path.join(catalog, "bundles"),
      },
    };
    addPatch(item, "shared/patch", {
      schemaVersion: 2,
      id: "shared-patch",
      purpose: "test",
      operations: [{
        id: "shared-operation",
        operation: "replace",
        targets: [{ kind: "markdown", path: "sample.md", missing: "error" }],
        selector: { type: "literal", source: "selector.md" },
        content: { source: "content.md" },
      }],
    }, {
      "selector.md": index === 0 ? "FIRST" : "SECOND",
      "content.md": index === 0 ? "ONE" : "TWO",
    });
    addBundle(item, { schemaVersion: 1, id: "shared-bundle", patches: ["shared/patch"] });
    return item.catalogSpec;
  });

  const plan = preparePatchPlan(f.target, catalogs);
  const result = applyPatchPlan(f.target, plan);
  const value = fs.readFileSync(path.join(f.target, "sample.md"), "utf8");
  assert.match(value, /skill-garden patch plugin-one\/shared-operation/);
  assert.match(value, /skill-garden patch plugin-two\/shared-operation/);
  assert.deepEqual(
    plan.operationOrder.map((item) => item.qualifiedId),
    ["plugin-one/shared-operation", "plugin-two/shared-operation"],
  );
  assert.equal(result.provenance.schemaVersion, 2);
  assert.deepEqual(
    result.provenance.applied.map((item) => item.qualifiedId),
    ["plugin-one/shared-operation", "plugin-two/shared-operation"],
  );
});

test("下游 catalog 可通过 qualified dependsOn 声明跨 catalog 强依赖", () => {
  const f = fixture();
  const declarations = [
    {
      id: "plugin-downstream",
      operationId: "downstream-operation",
      dependsOn: ["plugin-core/core-operation"],
    },
    { id: "plugin-core", operationId: "core-operation", dependsOn: [] },
  ];
  const catalogs = declarations.map((declaration) => {
    const catalog = path.join(f.root, declaration.id);
    const item = {
      ...f,
      catalog,
      catalogSpec: {
        id: declaration.id,
        patchesDir: path.join(catalog, "patches"),
        bundlesDir: path.join(catalog, "bundles"),
      },
    };
    addPatch(item, "feature/runtime", {
      schemaVersion: 2,
      id: "feature-runtime",
      purpose: "test",
      operations: [{
        id: declaration.operationId,
        ...(declaration.dependsOn.length > 0 ? { dependsOn: declaration.dependsOn } : {}),
        operation: "replace",
        targets: [{
          kind: "file",
          path: `${declaration.id}.txt`,
          missing: "skip",
          markerStyle: "none",
        }],
        selector: { type: "whole-file" },
        content: { value: declaration.id },
      }],
    });
    addBundle(item, { schemaVersion: 1, id: "feature", patches: ["feature/runtime"] });
    return item.catalogSpec;
  });

  const plan = preparePatchPlan(f.target, catalogs);
  assert.deepEqual(
    plan.operationOrder.map((item) => item.qualifiedId),
    ["plugin-core/core-operation", "plugin-downstream/downstream-operation"],
  );
  assert.deepEqual(plan.operationOrder[1].incomingEdges, [{
    from: "plugin-core/core-operation",
    type: "dependsOn",
  }]);
});

test("Patch 多 Bundle 归属稳定保留且 operation 只执行一次", () => {
  const f = fixture();
  write(f.target, "sample.md", "OLD\n");
  addPatch(f, "shared/runtime", {
    schemaVersion: 2,
    id: "shared-runtime",
    purpose: "test",
    operations: [{
      id: "shared-runtime",
      operation: "replace",
      targets: [{ kind: "markdown", path: "sample.md", missing: "error" }],
      selector: { type: "literal", source: "selector.md" },
      content: { source: "content.md" },
    }],
  }, { "selector.md": "OLD", "content.md": "NEW" });
  addBundle(f, { schemaVersion: 1, id: "first", patches: ["shared/runtime"] });
  addBundle(f, { schemaVersion: 1, id: "second", patches: ["shared/runtime"] });

  const plan = preparePatchPlan(f.target, [f.catalogSpec]);
  assert.equal(plan.operationOrder.length, 1);
  assert.deepEqual(plan.selectedPatches[0].bundles, [
    "skill-garden/first",
    "skill-garden/second",
  ]);
  const result = applyPatchPlan(f.target, plan);
  assert.equal(result.provenance.applied.length, 1);
  assert.deepEqual(result.provenance.applied[0].bundles, [
    "skill-garden/first",
    "skill-garden/second",
  ]);
});
