import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const PKG_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const GENERATOR = path.join(PKG_ROOT, "scripts", "run-skill-garden-compiled-targets.mjs");
const SKILL_GARDEN_ROOT = path.join(PKG_ROOT, "vendor", "skill-garden");

function listFiles(root) {
  const files = [];
  function walk(dir, prefix = "") {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(absolute, relative);
      else files.push(relative);
    }
  }
  walk(root);
  return files.sort();
}

function snapshotTree(root) {
  return new Map(listFiles(root).map((file) => [file, fs.readFileSync(path.join(root, file))]));
}

function runGenerator(args) {
  return spawnSync(process.execPath, [GENERATOR, ...args], {
    cwd: PKG_ROOT,
    encoding: "utf8",
  });
}

test("Skill-Garden canonical compiled targets 可重复生成并检测漂移", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "skill-garden-targets-test-"));
  const outputRoot = path.join(temp, "compiled-targets");
  try {
    fs.mkdirSync(path.join(outputRoot, "0.6.4", "full"), { recursive: true });
    fs.writeFileSync(path.join(outputRoot, "0.6.4", "full", "obsolete.txt"), "obsolete\n");

    const first = runGenerator(["--output-root", outputRoot]);
    assert.equal(first.status, 0, first.stderr);
    const versions = fs.readdirSync(outputRoot);
    assert.equal(versions.length, 1);
    const version = versions[0];
    const firstTree = snapshotTree(outputRoot);
    assert.ok(firstTree.has(`${version}/full/plan.json`));
    assert.ok([...firstTree.keys()].some((file) => file.includes("/full/targets/")));

    const plan = JSON.parse(
      fs.readFileSync(path.join(outputRoot, version, "full", "plan.json"), "utf8"),
    );
    assert.deepEqual(plan.catalogs, [{ id: "skill-garden" }]);
    assert.equal(plan.profile.id, "all-platforms");
    assert.equal(plan.profile.platforms.length, 21);
    assert.deepEqual(plan.profile.roots, [
      ".trellis",
      ".agent",
      ".agents",
      ".claude",
      ".codebuddy",
      ".codex",
      ".cursor",
      ".devin",
      ".factory",
      ".gemini",
      ".github",
      ".grok",
      ".kilocode",
      ".kimi-code",
      ".kiro",
      ".omp",
      ".opencode",
      ".pi",
      ".qoder",
      ".reasonix",
      ".snow",
      ".trae",
      ".zcode",
    ]);
    assert.deepEqual(
      [...new Set(plan.targets.map((item) => item.target.split("/", 1)[0]))].sort(),
      plan.profile.roots.toSorted(),
    );
    for (const [file, content] of firstTree) {
      if (!file.endsWith(".diff")) continue;
      const value = content.toString("utf8");
      assert.match(value, /^diff --git a\//);
      assert.doesNotMatch(value, /skill-garden-compiled-|compiled-targets-staging-/);
      assert.equal(firstTree.has(file.slice(0, -".diff".length)), true);
    }

    const second = runGenerator(["--output-root", outputRoot]);
    assert.equal(second.status, 0, second.stderr);
    const secondTree = snapshotTree(outputRoot);
    assert.deepEqual([...secondTree.keys()], [...firstTree.keys()]);
    for (const [file, content] of firstTree) assert.ok(content.equals(secondTree.get(file)));

    const planFile = path.join(outputRoot, version, "full", "plan.json");
    fs.appendFileSync(planFile, "drift\n");
    const check = runGenerator(["--check", "--output-root", outputRoot]);
    assert.equal(check.status, 1);
    assert.match(check.stderr, /变更:.*plan\.json[\s\S]*npm run patch:targets/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("Flower 发布包排除 Skill-Garden compiled targets 与维护 fixture", () => {
  assert.equal(fs.existsSync(path.join(PKG_ROOT, "compiled-targets")), false);
  assert.equal(
    fs.existsSync(path.join(PKG_ROOT, "enhancements", "0.6", "compiled-targets")),
    false,
  );
  assert.equal(
    fs.existsSync(path.join(PKG_ROOT, "vendor", "skill-garden", "compiled-targets")),
    true,
  );
  const result = spawnSync(
    "npm",
    ["pack", "--dry-run", "--json", "--ignore-scripts"],
    { cwd: PKG_ROOT, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  const files = output[0].files.map((entry) => entry.path);
  assert.equal(
    files.some((file) => file.includes("skill-garden/compiled-targets/")),
    false,
  );
  assert.equal(files.some((file) => file.startsWith("compiled-targets/")), false);
  assert.equal(files.includes("src/lib/patch-fixture.js"), false);
});

test("Skill-Garden diff sidecar 保留补丁空白且不触发仓库 whitespace 检查", () => {
  const sidecar = path.join(
    "compiled-targets",
    "0.6.12",
    "full",
    "targets",
    ".trellis",
    "workflow.md.diff",
  );
  const result = spawnSync(
    "git",
    ["-C", SKILL_GARDEN_ROOT, "check-attr", "whitespace", "--", sidecar],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /whitespace: unset\s*$/);
});
