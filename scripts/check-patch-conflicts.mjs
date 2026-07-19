import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { applyPatchPlan, preparePatchPlan } from "../src/lib/patch-engine.js";
import { flowerPatchAdapters } from "../src/lib/platform-patch-adapters.js";
import {
  assertNoPatchConflictErrors,
  buildPatchConflictReport,
  formatPatchDiagnostic,
  loadPatchPolicy,
} from "../src/lib/patch-conflicts.js";
import { resolveTrellisBin } from "../src/lib/trellis-runner.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(here, "..");
const VENDOR_OVERRIDES = path.join(
  PKG_ROOT,
  "vendor",
  "skill-garden",
  ".trellis",
  "0.6",
  "overrides",
);
const SNAPSHOT_OVERRIDES = path.join(PKG_ROOT, "enhancements", "0.6", "overrides");
const EXPECTED_TARGET_KINDS = [
  "command",
  "file",
  "hook",
  "json",
  "skill",
  "toml",
  "workflow",
  "yaml",
];
const INIT_ARGS = [
  "init",
  "--claude",
  "--codex",
  "--cursor",
  "--opencode",
  "--kilo",
  "--kiro",
  "--gemini",
  "--antigravity",
  "--devin",
  "--qoder",
  "--codebuddy",
  "--copilot",
  "--droid",
  "--pi",
  "--reasonix",
  "--zcode",
  "--trae",
  "--yes",
  "--no-monorepo",
  "--user",
  "patch-conflict-check",
];

function listRelativeFiles(root) {
  const files = [];
  function walk(dir, prefix = "") {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(absolute, relative);
      else if (entry.isFile()) files.push(relative);
    }
  }
  walk(root);
  return files.sort();
}

function assertOverrideSnapshotsMatch() {
  const vendorFiles = listRelativeFiles(VENDOR_OVERRIDES);
  const snapshotFiles = listRelativeFiles(SNAPSHOT_OVERRIDES);
  if (JSON.stringify(vendorFiles) !== JSON.stringify(snapshotFiles)) {
    throw new Error("Patch overrides 文件清单与发布快照不一致;请先运行 npm run sync");
  }
  for (const relative of vendorFiles) {
    if (!fs.readFileSync(path.join(VENDOR_OVERRIDES, relative)).equals(
      fs.readFileSync(path.join(SNAPSHOT_OVERRIDES, relative)),
    )) {
      throw new Error(`Patch overrides 快照漂移:${relative};请先运行 npm run sync`);
    }
  }
}

function readCatalogCoverage() {
  const roots = [
    path.join(VENDOR_OVERRIDES, "patches"),
    path.join(PKG_ROOT, "src", "patches", "platforms"),
  ];
  const patchIds = new Set();
  const targetKinds = new Set();
  let operations = 0;
  let targets = 0;
  for (const root of roots) {
    for (const relative of listRelativeFiles(root).filter((item) => item.endsWith("patch.json"))) {
      const declaration = JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
      patchIds.add(declaration.id);
      for (const operation of declaration.operations) {
        operations++;
        for (const target of operation.targets) {
          targets++;
          targetKinds.add(target.kind);
        }
      }
    }
  }
  return { patchIds, operations, targets, targetKinds: [...targetKinds].sort() };
}

function createPinnedFixture() {
  const trellisBin = resolveTrellisBin();
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "flower-patch-conflicts-"));
  try {
    execFileSync(process.execPath, [trellisBin, ...INIT_ARGS], {
      cwd: target,
      env: { ...process.env, NO_COLOR: "1" },
      stdio: "ignore",
    });
    return target;
  } catch (error) {
    fs.rmSync(target, { recursive: true, force: true });
    throw error;
  }
}

/**
 * 对 pinned Trellis 模板执行真实 Patch 计划和最终产物冲突检查。
 *
 * @param {{log?:boolean,requireSnapshotMatch?:boolean}} [options] 输出与快照一致性选项
 * @returns {{version:object,summary:object,patches:number,operations:number,readyTargets:number,changed:number,targetKinds:string[]}} 检查汇总
 */
export function runPatchConflictCheck(options = {}) {
  const { log = true, requireSnapshotMatch = true } = options;
  if (requireSnapshotMatch) assertOverrideSnapshotsMatch();
  const target = createPinnedFixture();
  try {
    const plan = preparePatchPlan(
      target,
      [
        {
          name: "skill-garden",
          patchesDir: path.join(VENDOR_OVERRIDES, "patches"),
          bundlesDir: path.join(VENDOR_OVERRIDES, "bundles"),
        },
        {
          name: "flower",
          patchesDir: path.join(PKG_ROOT, "src", "patches", "platforms"),
          bundlesDir: path.join(PKG_ROOT, "src", "patches", "bundles"),
        },
      ],
      { adapters: flowerPatchAdapters() },
    );
    const coverage = readCatalogCoverage();
    if (plan.patches.length !== coverage.patchIds.size) {
      throw new Error(
        `Patch catalog 覆盖不完整:计划 ${plan.patches.length}，声明 ${coverage.patchIds.size}`,
      );
    }
    if (plan.results.length !== coverage.targets) {
      throw new Error(
        `Patch target 覆盖不完整:结果 ${plan.results.length}，声明 ${coverage.targets}`,
      );
    }
    if (plan.catalogOperations.length !== coverage.operations) {
      throw new Error(
        `Patch operation 覆盖不完整:计划 ${plan.catalogOperations.length}，声明 ${coverage.operations}`,
      );
    }
    if (JSON.stringify(coverage.targetKinds) !== JSON.stringify(EXPECTED_TARGET_KINDS)) {
      throw new Error(
        `Patch target kind 漂移:${coverage.targetKinds.join(",")}`,
      );
    }
    const version = fs.readFileSync(path.join(target, ".trellis", ".version"), "utf8").trim();
    const report = buildPatchConflictReport({
      version,
      plan,
      policy: loadPatchPolicy(VENDOR_OVERRIDES),
    });
    if (log) {
      for (const diagnostic of report.diagnostics.filter(
        (item) => item.severity === "warning",
      )) {
        console.log(`  · ${formatPatchDiagnostic(diagnostic)}`);
      }
    }
    assertNoPatchConflictErrors(report);
    const applied = applyPatchPlan(target, plan);
    const summary = {
      version: report.version,
      summary: report.summary,
      patches: plan.patches.length,
      operations: plan.catalogOperations.length,
      readyTargets: plan.results.filter((item) => item.status === "ready").length,
      changed: applied.changed,
      targetKinds: coverage.targetKinds,
    };
    if (log) {
      console.log(
        `✓ Patch 冲突检查通过:Trellis ${report.version.value}(${report.version.status}),` +
          `Patch ${summary.patches}、operation ${summary.operations}、` +
          `ready target ${summary.readyTargets}、` +
          `target kind ${summary.targetKinds.length}、` +
          `warning ${report.summary.warnings}、info ${report.summary.info}`,
      );
    }
    return summary;
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    runPatchConflictCheck();
  } catch (error) {
    console.error(`❌ Patch 冲突检查失败:${error.message}`);
    process.exitCode = 1;
  }
}
