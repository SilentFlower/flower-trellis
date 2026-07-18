import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  applyPreparedTransforms,
  prepareEnhancementTransforms,
} from "../../src/lib/enhancement-transform.js";

function write(root, relativePath, value) {
  const file = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value);
  return file;
}

function makeFixture(operations) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "flower-transform-"));
  const target = path.join(root, "target");
  const variant = path.join(root, "variant");
  fs.mkdirSync(target, { recursive: true });
  write(
    variant,
    "overrides/transforms/example.json",
    JSON.stringify({
      schemaVersion: 1,
      id: "example",
      aliases: ["workflow-enhancement"],
      operations,
    }, null, 2) + "\n",
  );
  return { root, target, variant };
}

test("insert/replace/remove 可首次应用并重复运行幂等", () => {
  const fixture = makeFixture([
    {
      id: "replace-rule",
      operation: "replace",
      targets: [{ kind: "workflow", path: ".trellis/workflow.md" }],
      selector: { source: "matches/replace.txt", expectedMatches: 1 },
      content: { source: "content/replace.txt" },
    },
    {
      id: "insert-rule",
      operation: "insert",
      position: "after",
      targets: [{ kind: "workflow", path: ".trellis/workflow.md" }],
      selector: { source: "matches/insert.txt", expectedMatches: 1 },
      content: { source: "content/insert.txt" },
    },
    {
      id: "remove-rule",
      operation: "remove",
      targets: [{ kind: "workflow", path: ".trellis/workflow.md" }],
      selector: { source: "matches/remove.txt", expectedMatches: 1 },
    },
  ]);
  write(fixture.variant, "overrides/transforms/matches/replace.txt", "OLD");
  write(fixture.variant, "overrides/transforms/content/replace.txt", "NEW");
  write(fixture.variant, "overrides/transforms/matches/insert.txt", "ANCHOR");
  write(fixture.variant, "overrides/transforms/content/insert.txt", "INSERTED");
  write(fixture.variant, "overrides/transforms/matches/remove.txt", "REMOVE ME");
  const targetFile = write(
    fixture.target,
    ".trellis/workflow.md",
    "prefix\nOLD\nANCHOR\nREMOVE ME\nsuffix\n",
  );

  const first = prepareEnhancementTransforms(fixture.target, fixture.variant);
  const applied = applyPreparedTransforms(fixture.target, first);
  assert.equal(applied.changed, 1);
  const once = fs.readFileSync(targetFile, "utf8");
  assert.match(once, /skill-garden transform replace-rule/);
  assert.match(once, /NEW/);
  assert.match(once, /ANCHOR\n<!-- BEGIN skill-garden transform insert-rule/);
  assert.doesNotMatch(once, /REMOVE ME/);
  assert.match(once, /skill-garden transform remove-rule/);

  const second = prepareEnhancementTransforms(fixture.target, fixture.variant);
  assert.equal(second.files[0].changed, false);
  const secondApplied = applyPreparedTransforms(fixture.target, second);
  assert.equal(secondApplied.changed, 0);
  assert.equal(fs.readFileSync(targetFile, "utf8"), once);
});

test("required 漂移在 apply 前汇总失败且目标零写入", () => {
  const fixture = makeFixture([
    {
      id: "valid-rule",
      operation: "replace",
      targets: [{ kind: "workflow", path: ".trellis/workflow.md" }],
      selector: { source: "matches/valid.txt", expectedMatches: 1 },
      content: { source: "content/valid.txt" },
    },
    {
      id: "drift-rule",
      operation: "replace",
      targets: [{ kind: "skill", path: ".agents/skills/demo/SKILL.md" }],
      selector: { source: "matches/drift.txt", expectedMatches: 1 },
      content: { source: "content/drift.txt" },
    },
  ]);
  write(fixture.variant, "overrides/transforms/matches/valid.txt", "VALID");
  write(fixture.variant, "overrides/transforms/content/valid.txt", "CHANGED");
  write(fixture.variant, "overrides/transforms/matches/drift.txt", "EXPECTED");
  write(fixture.variant, "overrides/transforms/content/drift.txt", "REPLACED");
  const workflow = write(fixture.target, ".trellis/workflow.md", "VALID\n");
  const skill = write(fixture.target, ".agents/skills/demo/SKILL.md", "OTHER\n");

  assert.throws(
    () => prepareEnhancementTransforms(fixture.target, fixture.variant),
    /drift-rule.*匹配 0 次/,
  );
  assert.equal(fs.readFileSync(workflow, "utf8"), "VALID\n");
  assert.equal(fs.readFileSync(skill, "utf8"), "OTHER\n");
});

test("optional 漂移和缺失平台入口会结构化跳过", () => {
  const fixture = makeFixture([
    {
      id: "optional-rule",
      operation: "replace",
      required: false,
      targets: [
        { kind: "workflow", path: ".trellis/workflow.md" },
        { kind: "command", path: ".claude/commands/trellis/demo.md" },
      ],
      selector: { source: "matches/optional.txt", expectedMatches: 1 },
      content: { source: "content/optional.txt" },
    },
  ]);
  write(fixture.variant, "overrides/transforms/matches/optional.txt", "EXPECTED");
  write(fixture.variant, "overrides/transforms/content/optional.txt", "REPLACED");
  const workflow = write(fixture.target, ".trellis/workflow.md", "OTHER");

  const plan = prepareEnhancementTransforms(fixture.target, fixture.variant);
  assert.deepEqual(
    plan.results.map((item) => item.status).sort(),
    ["missing-target", "optional-skip"],
  );
  const result = applyPreparedTransforms(fixture.target, plan);
  assert.equal(result.skipped, 2);
  assert.equal(result.changed, 0);
  assert.equal(fs.readFileSync(workflow, "utf8"), "OTHER");
});

test("首次备份保持原文且非目标区域不被覆盖", () => {
  const fixture = makeFixture([
    {
      id: "replace-rule",
      operation: "replace",
      targets: [{ kind: "workflow", path: ".trellis/workflow.md" }],
      selector: { source: "matches/replace.txt", expectedMatches: 1 },
      content: { source: "content/replace.txt" },
    },
  ]);
  write(fixture.variant, "overrides/transforms/matches/replace.txt", "OLD");
  write(fixture.variant, "overrides/transforms/content/replace.txt", "NEW");
  const original = "user-before\nOLD\nuser-after\n";
  const targetFile = write(fixture.target, ".trellis/workflow.md", original);
  applyPreparedTransforms(
    fixture.target,
    prepareEnhancementTransforms(fixture.target, fixture.variant),
  );

  const changed = fs.readFileSync(targetFile, "utf8");
  assert.match(changed, /^user-before/m);
  assert.match(changed, /user-after$/m);
  const backup = path.join(
    fixture.target,
    ".trellis/.backup-flower/.trellis/workflow.md",
  );
  assert.equal(fs.readFileSync(backup, "utf8"), original);
});

test("目标路径穿越和重复 marker 会被拒绝", () => {
  const unsafe = makeFixture([
    {
      id: "unsafe-rule",
      operation: "replace",
      targets: [{ kind: "workflow", path: "../outside.md" }],
      selector: { source: "matches/replace.txt", expectedMatches: 1 },
      content: { source: "content/replace.txt" },
    },
  ]);
  write(unsafe.variant, "overrides/transforms/matches/replace.txt", "OLD");
  write(unsafe.variant, "overrides/transforms/content/replace.txt", "NEW");
  assert.throws(
    () => prepareEnhancementTransforms(unsafe.target, unsafe.variant),
    /不安全路径片段/,
  );

  const duplicate = makeFixture([
    {
      id: "replace-rule",
      operation: "replace",
      targets: [{ kind: "workflow", path: ".trellis/workflow.md" }],
      selector: { source: "matches/replace.txt", expectedMatches: 1 },
      content: { source: "content/replace.txt" },
    },
  ]);
  write(duplicate.variant, "overrides/transforms/matches/replace.txt", "OLD");
  write(duplicate.variant, "overrides/transforms/content/replace.txt", "NEW");
  const block = [
    "<!-- BEGIN skill-garden transform replace-rule v0.6 -->",
    "NEW",
    "<!-- END skill-garden transform replace-rule v0.6 -->",
  ].join("\n");
  write(duplicate.target, ".trellis/workflow.md", `${block}\n${block}\n`);
  assert.throws(
    () => prepareEnhancementTransforms(duplicate.target, duplicate.variant),
    /marker 数量 2 不等于预期 1/,
  );
});

test("hook 目标受支持且 schema 类型不做隐式转换", () => {
  const hookFixture = makeFixture([
    {
      id: "hook-rule",
      operation: "replace",
      targets: [{
        kind: "hook",
        path: ".codex/hooks/session-start.py",
        markerStyle: "hash",
      }],
      selector: { source: "matches/hook.txt", expectedMatches: 1 },
      content: { source: "content/hook.txt" },
    },
  ]);
  write(hookFixture.variant, "overrides/transforms/matches/hook.txt", "OLD HOOK");
  write(hookFixture.variant, "overrides/transforms/content/hook.txt", "NEW HOOK");
  const hook = write(hookFixture.target, ".codex/hooks/session-start.py", "OLD HOOK\n");
  applyPreparedTransforms(
    hookFixture.target,
    prepareEnhancementTransforms(hookFixture.target, hookFixture.variant),
  );
  const firstHook = fs.readFileSync(hook, "utf8");
  assert.match(firstHook, /# BEGIN skill-garden transform hook-rule/);
  assert.match(firstHook, /NEW HOOK/);
  assert.doesNotMatch(firstHook, /<!-- BEGIN skill-garden transform hook-rule/);

  fs.writeFileSync(hook, [
    "<!-- BEGIN skill-garden transform hook-rule v0.6 -->",
    "LEGACY HOOK",
    "<!-- END skill-garden transform hook-rule v0.6 -->",
    "",
  ].join("\n"));
  applyPreparedTransforms(
    hookFixture.target,
    prepareEnhancementTransforms(hookFixture.target, hookFixture.variant),
  );
  const migratedHook = fs.readFileSync(hook, "utf8");
  assert.match(migratedHook, /# BEGIN skill-garden transform hook-rule/);
  assert.match(migratedHook, /NEW HOOK/);
  assert.doesNotMatch(migratedHook, /<!-- BEGIN skill-garden transform hook-rule/);

  const missingHookStyle = makeFixture([
    {
      id: "hook-without-style",
      operation: "replace",
      targets: [{ kind: "hook", path: ".codex/hooks/session-start.py" }],
      selector: { source: "matches/hook.txt", expectedMatches: 1 },
      content: { source: "content/hook.txt" },
    },
  ]);
  write(missingHookStyle.variant, "overrides/transforms/matches/hook.txt", "OLD HOOK");
  write(missingHookStyle.variant, "overrides/transforms/content/hook.txt", "NEW HOOK");
  write(missingHookStyle.target, ".codex/hooks/session-start.py", "OLD HOOK\n");
  assert.throws(
    () => prepareEnhancementTransforms(missingHookStyle.target, missingHookStyle.variant),
    /hook target 必须显式声明 markerStyle/,
  );

  const invalidMatches = makeFixture([
    {
      id: "invalid-matches",
      operation: "replace",
      targets: [{ kind: "workflow", path: ".trellis/workflow.md" }],
      selector: { source: "matches/value.txt", expectedMatches: "1" },
      content: { source: "content/value.txt" },
    },
  ]);
  write(invalidMatches.variant, "overrides/transforms/matches/value.txt", "OLD");
  write(invalidMatches.variant, "overrides/transforms/content/value.txt", "NEW");
  write(invalidMatches.target, ".trellis/workflow.md", "OLD\n");
  assert.throws(
    () => prepareEnhancementTransforms(invalidMatches.target, invalidMatches.variant),
    /expectedMatches 必须是正整数/,
  );

  const invalidAliases = makeFixture([]);
  const declaration = path.join(
    invalidAliases.variant,
    "overrides/transforms/example.json",
  );
  const raw = JSON.parse(fs.readFileSync(declaration, "utf8"));
  raw.aliases = "workflow-enhancement";
  raw.operations = [{
    id: "alias-rule",
    operation: "remove",
    targets: [{ kind: "workflow", path: ".trellis/workflow.md" }],
    selector: { source: "matches/value.txt", expectedMatches: 1 },
  }];
  fs.writeFileSync(declaration, JSON.stringify(raw));
  write(invalidAliases.variant, "overrides/transforms/matches/value.txt", "OLD");
  write(invalidAliases.target, ".trellis/workflow.md", "OLD\n");
  assert.throws(
    () => prepareEnhancementTransforms(invalidAliases.target, invalidAliases.variant),
    /aliases 必须是非空字符串数组/,
  );
});
