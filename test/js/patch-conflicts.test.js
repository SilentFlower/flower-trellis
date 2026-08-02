import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import {
  assertNoPatchConflictErrors,
  buildPatchConflictReport,
  evaluatePatchCompatibility,
  evaluatePatchConflicts,
  formatPatchDiagnostic,
  loadPatchPolicies,
  loadPatchPolicy,
} from "../../src/lib/patch-conflicts.js";
import {
  disposePinnedPatchFixture,
  preparePinnedPatchFixture,
} from "../../src/lib/patch-fixture.js";

const compatibility = {
  schemaVersion: 1,
  variant: "0.6",
  compatibleLine: { major: 0, minor: 6 },
  testedVersions: ["0.6.5"],
  untestedPatchPolicy: "warning",
  newLinePolicy: "error",
};

function plan(value, results = [], operations = ["workflow-phase-3-commit"]) {
  return {
    files: [{
      target: ".trellis/workflow.md",
      next: value,
      operations,
    }],
    results,
  };
}

test("版本兼容分为 tested、同线 warning、跨线 error 和 invalid", () => {
  assert.deepEqual(
    evaluatePatchCompatibility("0.6.5", compatibility),
    { version: { value: "0.6.5", status: "tested" }, diagnostics: [] },
  );
  const warning = evaluatePatchCompatibility("0.6.6", compatibility);
  assert.equal(warning.version.status, "untested-compatible");
  assert.equal(warning.diagnostics[0].severity, "warning");
  assert.equal(warning.diagnostics[0].id, "untested-upstream");

  for (const version of ["0.7.0", "1.0.0"]) {
    const unsupported = evaluatePatchCompatibility(version, compatibility);
    assert.equal(unsupported.version.status, "unsupported");
    assert.equal(unsupported.diagnostics[0].severity, "error");
  }
  const invalid = evaluatePatchCompatibility("0.6", compatibility);
  assert.equal(invalid.version.status, "invalid");
  assert.equal(invalid.diagnostics[0].id, "invalid-upstream-version");
});

test("冲突规则只审计已选 operation 并支持 absent、required 和 max-occurrences", () => {
  const conflicts = {
    schemaVersion: 1,
    rules: [
      {
        id: "absent",
        severity: "error",
        target: ".trellis/workflow.md",
        whenOperations: ["workflow-phase-3-commit"],
        assertion: { type: "absent-literal", values: ["Never push"] },
        owner: "trellis-push",
        reason: "不得保留旧协议",
      },
      {
        id: "required",
        severity: "error",
        target: ".trellis/workflow.md",
        whenOperations: ["workflow-phase-3-commit"],
        assertion: { type: "required-literal", values: ["trellis-push"] },
        owner: "trellis-push",
        reason: "必须保留入口",
      },
      {
        id: "count",
        severity: "warning",
        target: ".trellis/workflow.md",
        whenOperations: ["workflow-phase-3-commit"],
        assertion: { type: "max-occurrences", value: "Hub", max: 1 },
        owner: "workflow",
        reason: "限制重复",
      },
      {
        id: "not-selected",
        severity: "error",
        target: ".trellis/workflow.md",
        whenOperations: ["other-operation"],
        assertion: { type: "required-literal", values: ["missing"] },
        owner: "other",
        reason: "不应运行",
      },
    ],
  };
  const result = evaluatePatchConflicts(
    plan("Never push\nHub Hub\n"),
    conflicts,
  );
  assert.deepEqual(
    result.diagnostics.map((item) => [item.id, item.severity]),
    [["absent", "error"], ["required", "error"], ["count", "warning"]],
  );
});

test("missing-target 只计 info，optional-skip 计 warning", () => {
  const result = evaluatePatchConflicts(
    plan("trellis-push\n", [
      { id: "missing", patch: "p", target: ".cursor/a.md", status: "missing-target" },
      { id: "optional", patch: "p", target: ".claude/a.md", status: "optional-skip", reason: "drift" },
    ]),
    { schemaVersion: 1, rules: [] },
  );
  assert.deepEqual(
    result.diagnostics.map((item) => item.severity).sort(),
    ["info", "warning"],
  );
});

test("完整报告稳定排序且 error 会抛聚合错误", () => {
  const policy = {
    compatibility,
    conflicts: {
      schemaVersion: 1,
      rules: [{
        id: "old-rule",
        severity: "error",
        target: ".trellis/workflow.md",
        whenOperations: ["workflow-phase-3-commit"],
        assertion: { type: "absent-literal", values: ["Never push"] },
        owner: "trellis-push",
        reason: "旧规则冲突",
      }],
    },
  };
  const report = buildPatchConflictReport({
    version: "0.6.6",
    plan: plan("Never push\n"),
    policy,
  });
  assert.deepEqual(report.summary, { errors: 1, warnings: 1, info: 0 });
  assert.equal(report.diagnostics[0].severity, "error");
  assert.throws(
    () => assertNoPatchConflictErrors(report),
    /Patch 冲突检查失败:skill-garden\/old-rule@\.trellis\/workflow\.md/,
  );
});

test("policy loader 拒绝不安全 target 和未知 assertion", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "patch-policy-"));
  fs.writeFileSync(
    path.join(root, "compatibility.json"),
    JSON.stringify(compatibility),
  );
  fs.writeFileSync(
    path.join(root, "conflicts.json"),
    JSON.stringify({
      schemaVersion: 1,
      rules: [{
        id: "unsafe",
        severity: "error",
        target: "../outside.md",
        whenOperations: ["x"],
        assertion: { type: "regex", values: ["x"] },
        owner: "x",
        reason: "x",
      }],
    }),
  );
  assert.throws(() => loadPatchPolicy(root), /不安全路径片段/);

  fs.writeFileSync(
    path.join(root, "conflicts.json"),
    JSON.stringify({
      schemaVersion: 1,
      rules: [{
        id: "windows-drive",
        severity: "error",
        target: "C:/outside.md",
        whenOperations: ["x"],
        assertion: { type: "required-literal", values: ["x"] },
        owner: "x",
        reason: "x",
      }],
    }),
  );
  assert.throws(() => loadPatchPolicy(root), /POSIX 相对路径/);

  fs.writeFileSync(
    path.join(root, "compatibility.json"),
    JSON.stringify({
      ...compatibility,
      compatibleLine: { major: true, minor: 6 },
    }),
  );
  fs.writeFileSync(
    path.join(root, "conflicts.json"),
    JSON.stringify({ schemaVersion: 1, rules: [] }),
  );
  assert.throws(() => loadPatchPolicy(root), /非负整数 major\/minor/);

  fs.writeFileSync(
    path.join(root, "compatibility.json"),
    JSON.stringify({ ...compatibility, testedVersions: ["0.6"] }),
  );
  assert.throws(() => loadPatchPolicy(root), /完整 semver/);
});

test("catalog policy 在读取前拒绝 catalog 根目录外路径", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "flower-policy-boundary-"));
  const catalog = path.join(root, "catalog");
  const outside = path.join(root, "outside");
  fs.mkdirSync(path.join(catalog, "patches"), { recursive: true });
  fs.mkdirSync(outside);
  const compatibilityFile = path.join(outside, "compatibility.json");
  fs.writeFileSync(compatibilityFile, JSON.stringify(compatibility));
  assert.throws(
    () => loadPatchPolicies([{
      id: "plugin",
      patchesDir: path.join(catalog, "patches"),
      bundlesDir: path.join(catalog, "bundles"),
      policy: { compatibilityFile },
    }]),
    /必须位于 catalog 根目录内/,
  );
});

test("catalog operation/target 引用错误会阻断而不是静默跳过", () => {
  const basePlan = plan("FINAL\n", [], ["known-operation"]);
  basePlan.catalogOperations = [{
    id: "known-operation",
    targets: [".trellis/workflow.md"],
  }];
  const rule = {
    id: "reference-check",
    severity: "error",
    target: ".trellis/workflow.md",
    whenOperations: ["missing-operation"],
    assertion: { type: "required-literal", values: ["FINAL"] },
    owner: "test",
    reason: "test",
  };
  assert.throws(
    () => evaluatePatchConflicts(basePlan, { schemaVersion: 1, rules: [rule] }),
    /引用未知 operation:missing-operation/,
  );
  assert.throws(
    () => evaluatePatchConflicts(basePlan, {
      schemaVersion: 1,
      rules: [{
        ...rule,
        target: ".trellis/other.md",
        whenOperations: ["known-operation"],
      }],
    }),
    /target 未被 operation skill-garden\/known-operation 修改/,
  );
});

test("多 catalog policy 可复用 rule/operation 本地 ID 并以 qualified identity 隔离", () => {
  const multiCatalogPlan = {
    files: [{
      target: ".trellis/workflow.md",
      next: "PLUGIN ONE\nPLUGIN TWO\n",
      operations: ["shared-operation", "shared-operation"],
      operationEntries: [
        { id: "shared-operation", catalog: "plugin-one", qualifiedId: "plugin-one/shared-operation" },
        { id: "shared-operation", catalog: "plugin-two", qualifiedId: "plugin-two/shared-operation" },
      ],
    }],
    results: [{
      id: "missing-operation",
      catalog: "plugin-one",
      qualifiedId: "plugin-one/missing-operation",
      patch: "missing-patch",
      target: ".plugin/missing.md",
      status: "missing-target",
    }],
    catalogOperations: [
      {
        id: "shared-operation",
        catalog: "plugin-one",
        qualifiedId: "plugin-one/shared-operation",
        targets: [".trellis/workflow.md"],
      },
      {
        id: "shared-operation",
        catalog: "plugin-two",
        qualifiedId: "plugin-two/shared-operation",
        targets: [".trellis/workflow.md"],
      },
    ],
  };
  const policy = (catalog, literal) => ({
    catalog,
    compatibility,
    conflicts: {
      schemaVersion: 1,
      rules: [{
        id: "shared-rule",
        severity: "warning",
        target: ".trellis/workflow.md",
        whenOperations: ["shared-operation"],
        assertion: { type: "absent-literal", values: [literal] },
        owner: catalog,
        reason: "catalog 隔离",
      }],
    },
  });

  const report = buildPatchConflictReport({
    version: "0.6.5",
    plan: multiCatalogPlan,
    policies: [policy("plugin-one", "PLUGIN ONE"), policy("plugin-two", "PLUGIN TWO")],
  });
  assert.deepEqual(
    report.diagnostics.map((item) => item.qualifiedId),
    [
      "plugin-one/shared-rule",
      "plugin-two/shared-rule",
      "plugin-one/missing-target:missing-operation:.plugin/missing.md",
    ],
  );
  assert.equal(report.summary.info, 1);
});

test("Phase 正向断言不能被其它段落中的裸 Skill 指针误满足", () => {
  const root = path.resolve("vendor/skill-garden/.trellis/0.6/overrides");
  const { conflicts } = loadPatchPolicy(root);
  const rules = conflicts.rules.filter((rule) =>
    ["workflow-required-route-pointer", "workflow-required-finish-pointers"].includes(rule.id)
  );
  const operations = [
    "workflow-phase-2-implement",
    "workflow-phase-2-check",
    "workflow-phase-3-update-spec",
    "workflow-phase-3-commit",
  ];
  const result = evaluatePatchConflicts({
    files: [{
      target: ".trellis/workflow.md",
      next: [
        "`trellis-route(target=implement)`",
        "`trellis-route(target=check)`",
        "`trellis-update-spec`",
        "`trellis-push`",
      ].join("\n"),
      operations,
    }],
    results: [],
    catalogOperations: operations.map((id) => ({
      id,
      targets: [".trellis/workflow.md"],
    })),
  }, { schemaVersion: 1, rules });

  assert.deepEqual(
    result.diagnostics.map((item) => item.id),
    ["workflow-required-route-pointer", "workflow-required-finish-pointers"],
  );
});

test("Flower 冲突策略会阻断 Codex 配置与 Hook 的路由语义回归", () => {
  const fixture = preparePinnedPatchFixture();
  try {
    const replacements = new Map([
      [
        ".trellis/config.yaml",
        [
          "codex:\n  dispatch_mode: auto",
          "codex:\n  dispatch_mode: sub-agent",
        ],
      ],
      [
        ".codex/hooks/inject-workflow-state.py",
        ["It is not a route decision.", "It is the route decision."],
      ],
    ]);
    const changedTargets = new Set();
    const plan = {
      ...fixture.plan,
      files: fixture.plan.files.map((file) => {
        const replacement = replacements.get(file.target);
        if (!replacement) return file;
        const [expected, drifted] = replacement;
        assert.match(file.next, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
        changedTargets.add(file.target);
        return { ...file, next: file.next.replace(expected, drifted) };
      }),
    };
    assert.deepEqual([...changedTargets].sort(), [...replacements.keys()].sort());

    const report = buildPatchConflictReport({
      version: fixture.version,
      plan,
      policies: fixture.policies,
    });
    const errors = report.diagnostics
      .filter((item) => item.severity === "error")
      .map((item) => item.qualifiedId);
    assert.deepEqual(errors, [
      "flower/codex-config-required-route-capability-semantics",
      "flower/codex-hook-required-route-capability-semantics",
    ]);
  } finally {
    disposePinnedPatchFixture(fixture.target);
  }
});

test("diagnostic formatter 输出规则、目标、原因和证据", () => {
  assert.equal(
    formatPatchDiagnostic({
      id: "untested-upstream",
      severity: "warning",
      target: ".trellis/.version",
      reason: "未登记",
      evidence: ["0.6.6"],
    }),
    "Patch 警告:untested-upstream@.trellis/.version(未登记;证据:0.6.6)",
  );
});

test("JS/Python 对共享 fixture 返回完全相同的结构化报告", () => {
  const fixturePath = path.resolve("test/fixtures/patch-conflicts/parity.json");
  const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  const jsReport = buildPatchConflictReport({
    version: fixture.version,
    plan: fixture.plan,
    policy: fixture.policy,
  });
  const pythonReport = JSON.parse(execFileSync(
    "python3",
    ["test/python/patch_conflict_report_helper.py", fixturePath],
    { encoding: "utf8" },
  ));

  assert.deepEqual(pythonReport, jsReport);
  assert.deepEqual(jsReport.summary, { errors: 1, warnings: 2, info: 1 });
});
