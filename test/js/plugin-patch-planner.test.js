import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { plugin as runPluginCommand } from "../../src/commands/plugin.js";
import { preparePatchPlan } from "../../src/lib/patch-engine.js";
import { PluginApplicationService } from "../../src/plugin/application-service.js";
import { PLUGIN_CAPABILITY_ERROR_CODES } from "../../src/plugin/capabilities/errors.js";
import {
  markBuiltinProviderTrusted,
  markSourceProviderTrusted,
} from "../../src/plugin/capabilities/builtin-trust.js";
import {
  assertNoContentPatchConflicts,
  externalPluginCatalogId,
  inspectExternalPatchCatalog,
  preparePluginPatchPlan,
} from "../../src/plugin/install/patch-planner.js";
import { SourceRegistry } from "../../src/plugin/sources/source-registry.js";

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "flower-plugin-patch-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const projectRoot = path.join(root, "project");
  const packageRoot = path.join(root, options.pluginId?.replace("/", "-") || "plugin");
  fs.mkdirSync(path.join(projectRoot, ".trellis"), { recursive: true });
  fs.writeFileSync(
    path.join(projectRoot, ".trellis", "workflow.md"),
    options.workflow || "# Workflow\n\n## Anchor\n\nBody\n",
  );
  const operation = {
    id: options.operationId || "insert-note",
    operation: "insert",
    targets: [{
      kind: "workflow",
      path: ".trellis/workflow.md",
      missing: "error",
    }],
    selector: { type: "literal", source: "selector.md", expectedMatches: 1 },
    content: { source: "content.md" },
    position: "after",
    ...(options.operation || {}),
  };
  const leaf = path.join(packageRoot, "patches", "workflow", "note");
  writeJson(path.join(leaf, "patch.json"), {
    schemaVersion: 2,
    id: options.patchId || "workflow-note",
    purpose: "测试外部 Integration Patch",
    operations: [operation],
  });
  fs.writeFileSync(path.join(leaf, "selector.md"), "## Anchor\n");
  fs.writeFileSync(path.join(leaf, "content.md"), options.content || "Injected note\n");
  writeJson(path.join(packageRoot, "patches", "bundles", "default.json"), {
    schemaVersion: 1,
    id: "default",
    aliases: [],
    installMode: "full-or-selected",
    patches: ["workflow/note"],
  });
  const pluginId = options.pluginId || "rd-guide/code-review";
  return {
    projectRoot,
    packageRoot,
    plugin: {
      id: pluginId,
      version: options.version || "1.0.0",
      integrity: options.integrity || `sha256:${"1".repeat(64)}`,
      source: {
        id: pluginId.split("/")[0],
        type: "gitlab",
        reference: "group/rd-guide",
        indexCommit: "a".repeat(40),
      },
    },
    manifest: {
      schemaVersion: 1,
      id: pluginId.split("/")[1],
      name: "Patch Fixture",
      version: options.version || "1.0.0",
      compatibility: { flower: ">=0.5.0" },
      capabilities: { profile: "integration", required: ["patch.insert"] },
      content: { skills: ["skills/example"] },
      patches: { catalog: "patches", bundles: "patches/bundles" },
    },
    marketplaceMaxProfile: "integration",
  };
}

test("Patch Planner 合并多 catalog 只执行一次 preflight 并使用 qualified identity", (t) => {
  const first = fixture(t, { pluginId: "rd-guide/code-review", content: "First note\n" });
  const second = fixture(t, { pluginId: "team/standards", content: "Second note\n" });
  second.projectRoot = first.projectRoot;
  let calls = 0;
  const preview = preparePluginPatchPlan(first.projectRoot, [second, first], {
    approvalMode: "preview",
    preparePatchPlan(target, catalogs, options) {
      calls += 1;
      return preparePatchPlan(target, catalogs, options);
    },
  });
  assert.equal(calls, 1);
  assert.equal(preview.approvalRequests.length, 2);
  assert.equal(preview.patchMutations.length, 2);
  assert.equal(new Set(preview.patchMutations.map(({ operations }) => operations[0])).size, 2);
  assert.ok(preview.patchMutations.every(({ operations }) => operations[0].includes("/insert-note")));
  assert.match(preview.patchPlan.files[0].next, /First note/);
  assert.match(preview.patchPlan.files[0].next, /Second note/);
  assert.equal(
    fs.readFileSync(path.join(first.projectRoot, ".trellis", "workflow.md"), "utf8"),
    "# Workflow\n\n## Anchor\n\nBody\n",
  );

  const approvedDigests = new Map(preview.approvalRequests.map(({ pluginId, approvalDigest }) => (
    [pluginId, approvalDigest]
  )));
  const frozen = preparePluginPatchPlan(first.projectRoot, [first, second], {
    approvedDigests,
    nonInteractive: true,
  });
  assert.ok(frozen.grants.every(({ grant, reusedApproval }) => grant.approvalDigest && reusedApproval));
  assert.equal(frozen.approvalRequests.length, 0);
});

test("外部 catalog ID 由 canonical ID 派生且不能伪装内置 marker namespace", () => {
  const first = externalPluginCatalogId("a-b/c");
  const second = externalPluginCatalogId("a/b-c");
  assert.match(first, /^plugin-a-b-c-[a-f0-9]{12}$/);
  assert.notEqual(first, second);
  assert.notEqual(first, "skill-garden");
  assert.notEqual(first, "flower");
});

test("Integration 子协议拒绝 replace/create/hook/adapter/cleanup 与配置目标", (t) => {
  const cases = [
    { operation: { operation: "replace" } },
    { operation: { targets: [{ kind: "workflow", path: ".trellis/workflow.md", missing: "create" }] } },
    { operation: { targets: [{ kind: "hook", path: ".trellis/hooks/example.py", missing: "error" }] } },
    { operation: { selector: { type: "whole-file" } } },
    { operation: { cleanup: [{ type: "workflow-hub" }] } },
    { operation: { content: { value: "inline" } } },
    { operation: { targets: [{ kind: "json", path: ".codex/hooks.json", missing: "error" }] } },
  ];
  for (const [index, change] of cases.entries()) {
    const entry = fixture(t, { pluginId: `rd-guide/case-${index}`, operation: change.operation });
    assert.throws(() => inspectExternalPatchCatalog(entry), (error) => (
      error.code === PLUGIN_CAPABILITY_ERROR_CODES.PATCH_POLICY_INVALID
    ));
  }
});

test("optional patch.insert 被来源上限拒绝时跳过 catalog 并保留诊断", (t) => {
  const entry = fixture(t, { pluginId: "local/optional" });
  entry.plugin.source = { id: "local", type: "local", reference: "plugins/optional" };
  entry.manifest.capabilities = {
    profile: "integration",
    required: ["content.skills"],
    optional: ["patch.insert"],
  };
  const result = preparePluginPatchPlan(entry.projectRoot, [entry]);
  assert.equal(result.patchPlan.files.length, 0);
  assert.equal(result.patchMutations.length, 0);
  assert.deepEqual(result.grants[0].grant.granted, ["content.skills"]);
  assert.deepEqual(result.grants[0].grant.denied, ["patch.insert"]);
  assert.equal(result.diagnostics[0].code, "PLUGIN_CAPABILITY_OPTIONAL_DENIED");
});

test("可信 builtin system catalog 可使用完整 replace，外部预构造 descriptor 被拒绝", (t) => {
  const trusted = fixture(t, {
    pluginId: "flower/system",
    operation: { operation: "replace", position: undefined },
  });
  trusted.plugin.source = { id: "flower", type: "builtin", reference: "builtin:system" };
  trusted.manifest.capabilities = { profile: "system", required: ["patch.replace"] };
  trusted.provider = markBuiltinProviderTrusted({ id: "flower" });
  trusted.catalog = {
    id: "flower",
    patchesDir: path.join(trusted.packageRoot, "patches"),
    bundlesDir: path.join(trusted.packageRoot, "patches", "bundles"),
  };
  const result = preparePluginPatchPlan(trusted.projectRoot, [trusted]);
  assert.equal(result.grants[0].grant.profile, "system");
  assert.equal(result.grants[0].grant.approvalDigest, null);
  assert.equal(result.patchMutations[0].operations[0], "flower/insert-note");

  const external = fixture(t, { pluginId: "rd-guide/prebuilt" });
  external.catalog = trusted.catalog;
  assert.throws(() => preparePluginPatchPlan(external.projectRoot, [external], {
    approvals: [external.plugin.id],
  }), (error) => error.code === PLUGIN_CAPABILITY_ERROR_CODES.PATCH_POLICY_INVALID);
});

test("Patch selector 漂移与普通内容冲突都在写盘前失败", (t) => {
  const entry = fixture(t, { workflow: "# Workflow\n\nNo anchor\n" });
  const original = fs.readFileSync(path.join(entry.projectRoot, ".trellis", "workflow.md"), "utf8");
  assert.throws(() => preparePluginPatchPlan(entry.projectRoot, [entry], {
    approvals: [entry.plugin.id],
  }), (error) => {
    assert.equal(error.code, PLUGIN_CAPABILITY_ERROR_CODES.PATCH_POLICY_INVALID);
    assert.doesNotMatch(error.message, new RegExp(entry.projectRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    return true;
  });
  assert.equal(fs.readFileSync(path.join(entry.projectRoot, ".trellis", "workflow.md"), "utf8"), original);

  const valid = fixture(t, { pluginId: "rd-guide/conflict" });
  assert.throws(() => preparePluginPatchPlan(valid.projectRoot, [valid], {
    approvals: [valid.plugin.id],
    contentMutations: [{
      owner: "local/content",
      target: ".trellis/workflow.md",
      operation: "write",
      beforeHash: null,
      afterHash: `sha256:${"2".repeat(64)}`,
      source: "fixture",
    }],
  }), (error) => error.code === PLUGIN_CAPABILITY_ERROR_CODES.MUTATION_CONFLICT);
});

test("显式冲突检查允许同一 Patch plan 的多 owner，但拒绝内容覆盖", () => {
  const patches = [
    { owner: "a/one", target: ".trellis/workflow.md" },
    { owner: "b/two", target: ".trellis/workflow.md" },
  ];
  assert.doesNotThrow(() => assertNoContentPatchConflicts([], patches));
  assert.throws(() => assertNoContentPatchConflicts([
    { owner: "c/three", target: ".trellis/workflow.md" },
  ], patches), (error) => error.code === PLUGIN_CAPABILITY_ERROR_CODES.MUTATION_CONFLICT);
});

test("可信 system catalog 的兼容与冲突 policy 在事务前阻断", (t) => {
  const trusted = fixture(t, { pluginId: "flower/system-policy" });
  trusted.plugin.source = { id: "flower", type: "builtin", reference: "builtin:system-policy" };
  trusted.manifest.capabilities = { profile: "system", required: ["patch.insert"] };
  trusted.provider = markBuiltinProviderTrusted({ id: "flower" });
  const compatibilityFile = path.join(trusted.packageRoot, "compatibility.json");
  const conflictsFile = path.join(trusted.packageRoot, "conflicts.json");
  writeJson(compatibilityFile, {
    schemaVersion: 1,
    variant: "0.6",
    compatibleLine: { major: 0, minor: 6 },
    testedVersions: ["0.6.5"],
    untestedPatchPolicy: "warning",
    newLinePolicy: "error",
  });
  writeJson(conflictsFile, {
    schemaVersion: 1,
    rules: [{
      id: "required-policy-literal",
      severity: "error",
      target: ".trellis/workflow.md",
      whenOperations: ["insert-note"],
      assertion: { type: "required-literal", values: ["POLICY_REQUIRED"] },
      owner: "test",
      reason: "测试冲突 policy 阻断",
    }],
  });
  trusted.catalog = {
    id: "flower-policy",
    patchesDir: path.join(trusted.packageRoot, "patches"),
    bundlesDir: path.join(trusted.packageRoot, "patches", "bundles"),
    policy: { compatibilityFile, conflictsFile },
  };
  assert.throws(() => preparePluginPatchPlan(trusted.projectRoot, [trusted], {
    trellisVersion: "0.6.5",
  }), (error) => error.code === PLUGIN_CAPABILITY_ERROR_CODES.PATCH_POLICY_INVALID);
  assert.equal(
    fs.readFileSync(path.join(trusted.projectRoot, ".trellis", "workflow.md"), "utf8"),
    "# Workflow\n\n## Anchor\n\nBody\n",
  );
});

test("Application Service 通过统一事务写入 Patch 并持久化 grant 与 provenance", (t) => {
  const entry = fixture(t, { pluginId: "local/guide" });
  entry.plugin.source = { id: "local", type: "local", reference: "plugins/guide" };
  entry.plugin.commit = null;
  entry.manifest.content = {};
  const provider = markSourceProviderTrusted({
    id: "local",
    type: "local",
    listCandidates(id) {
      return id === entry.plugin.id ? [{ ...entry.plugin, manifest: entry.manifest }] : [];
    },
    readPackage() {
      return { root: entry.packageRoot, manifest: entry.manifest, integrity: entry.plugin.integrity };
    },
  }, "integration");
  const service = new PluginApplicationService(entry.projectRoot, {
    registry: new SourceRegistry([provider]),
  });
  const result = service.add({
    id: entry.plugin.id,
    platforms: ["codex"],
    approvals: [entry.plugin.id],
  });
  assert.equal(result.transaction.status, "applied");
  assert.match(
    fs.readFileSync(path.join(entry.projectRoot, ".trellis", "workflow.md"), "utf8"),
    /Injected note/,
  );
  const lock = JSON.parse(fs.readFileSync(path.join(entry.projectRoot, ".flower", "plugin-lock.json"), "utf8"));
  const state = JSON.parse(fs.readFileSync(path.join(entry.projectRoot, ".flower", "state.json"), "utf8"));
  assert.equal(lock.plugins[0].capabilities.profile, "integration");
  assert.match(lock.plugins[0].capabilities.approvalDigest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(state.plugins[0].patches[0].target, ".trellis/workflow.md");
  assert.match(state.plugins[0].patches[0].operation, /\/insert-note$/);

  const repeated = service.update({ id: entry.plugin.id, platforms: ["codex"], nonInteractive: true });
  assert.equal(repeated.transaction.status, "unchanged");
  assert.equal(repeated.graph.plugins[0].capabilities.approvalDigest, lock.plugins[0].capabilities.approvalDigest);
});

test("CLI 首次 Integration 安装展示完整范围并只在交互确认后写入", async (t) => {
  const entry = fixture(t, { pluginId: "local/interactive" });
  entry.plugin.source = { id: "local", type: "local", reference: "plugins/interactive" };
  entry.plugin.commit = null;
  entry.manifest.content = {};
  const provider = markSourceProviderTrusted({
    id: "local",
    type: "local",
    listCandidates(id) {
      return id === entry.plugin.id ? [{ ...entry.plugin, manifest: entry.manifest }] : [];
    },
    readPackage() {
      return { root: entry.packageRoot, manifest: entry.manifest, integrity: entry.plugin.integrity };
    },
  }, "integration");
  const previewLines = [];
  const previewCode = await runPluginCommand({
    target: entry.projectRoot,
    passthrough: ["add", entry.plugin.id, "--platform", "codex", "--dry-run"],
  }, {
    providers: [provider],
    output: { log: (message) => previewLines.push(message), error: (message) => previewLines.push(message) },
  });
  assert.equal(previewCode, 0, previewLines.join("\n"));
  assert.match(previewLines.join("\n"), /需要批准 local\/interactive@1\.0\.0/);
  assert.equal(fs.existsSync(path.join(entry.projectRoot, ".flower")), false);

  const jsonLines = [];
  const nonInteractiveCode = await runPluginCommand({
    target: entry.projectRoot,
    passthrough: ["add", entry.plugin.id, "--platform", "codex", "--json"],
  }, {
    providers: [provider],
    output: { log: (message) => jsonLines.push(message), error: (message) => jsonLines.push(message) },
  });
  assert.equal(nonInteractiveCode, 3, jsonLines.join("\n"));
  assert.equal(JSON.parse(jsonLines[0]).diagnostics[0].code, "PLUGIN_CAPABILITY_APPROVAL_REQUIRED");
  assert.equal(fs.existsSync(path.join(entry.projectRoot, ".flower")), false);

  const lines = [];
  let approvalRequests = null;
  const code = await runPluginCommand({
    target: entry.projectRoot,
    passthrough: ["add", entry.plugin.id, "--platform", "codex"],
  }, {
    providers: [provider],
    output: { log: (message) => lines.push(message), error: (message) => lines.push(message) },
    confirmApproval(requests) {
      approvalRequests = requests;
      return true;
    },
  });
  assert.equal(code, 0, lines.join("\n"));
  assert.equal(approvalRequests.length, 1);
  assert.match(lines.join("\n"), /需要批准 local\/interactive@1\.0\.0/);
  assert.match(lines.join("\n"), /能力:patch\.insert/);
  assert.match(lines.join("\n"), /insert \.trellis\/workflow\.md selector=literal:selector\.md/);
  const lock = JSON.parse(fs.readFileSync(path.join(entry.projectRoot, ".flower", "plugin-lock.json"), "utf8"));
  assert.match(lock.plugins[0].capabilities.approvalDigest, /^sha256:[a-f0-9]{64}$/);
});
