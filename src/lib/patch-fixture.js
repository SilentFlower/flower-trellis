import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { PKG_ROOT } from "./paths.js";
import { resolveTrellisBin } from "./trellis-runner.js";
import { preparePatchPlan } from "./patch-engine.js";
import { flowerPatchAdapters } from "./platform-patch-adapters.js";
import {
  assertNoPatchConflictErrors,
  buildPatchCompatibilityReport,
  buildPatchConflictReport,
  loadPatchPolicies,
} from "./patch-conflicts.js";

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
const PINNED_INIT_ARGS = [
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

function readCatalogCoverage(catalogs) {
  const patchIds = new Set();
  const targetKinds = new Set();
  let operations = 0;
  let targets = 0;
  for (const catalog of catalogs) {
    for (const relative of listRelativeFiles(catalog.patchesDir).filter(
      (item) => item.endsWith("patch.json"),
    )) {
      const declaration = JSON.parse(
        fs.readFileSync(path.join(catalog.patchesDir, relative), "utf8"),
      );
      patchIds.add(`${catalog.id}/${declaration.id}`);
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

function assertCoverage(plan, coverage) {
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
    throw new Error(`Patch target kind 漂移:${coverage.targetKinds.join(",")}`);
  }
}

/**
 * 返回维护期固定使用的内置 Patch catalog descriptors。
 *
 * @returns {Array<{id:string,patchesDir:string,bundlesDir:string,policy?:object}>} 内置 catalog descriptors
 */
export function getPinnedPatchCatalogs() {
  return [
    {
      id: "skill-garden",
      patchesDir: path.join(VENDOR_OVERRIDES, "patches"),
      bundlesDir: path.join(VENDOR_OVERRIDES, "bundles"),
      policy: {
        compatibilityFile: path.join(VENDOR_OVERRIDES, "compatibility.json"),
        conflictsFile: path.join(VENDOR_OVERRIDES, "conflicts.json"),
      },
    },
    {
      id: "flower",
      patchesDir: path.join(PKG_ROOT, "src", "patches", "platforms"),
      bundlesDir: path.join(PKG_ROOT, "src", "patches", "bundles"),
      policy: {
        conflictsFile: path.join(PKG_ROOT, "src", "patches", "conflicts.json"),
      },
    },
  ];
}

/**
 * 校验 Skill-Garden vendor overrides 与发布快照逐字节一致。
 *
 * @returns {void}
 */
export function assertPatchOverrideSnapshotsMatch() {
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

/**
 * 初始化覆盖全部受支持平台入口的 pinned Trellis 临时项目。
 *
 * @returns {string} 临时项目根目录，调用方负责通过 `disposePinnedPatchFixture()` 清理
 */
export function createPinnedPatchFixture() {
  const trellisBin = resolveTrellisBin();
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "flower-patch-fixture-"));
  try {
    execFileSync(process.execPath, [trellisBin, ...PINNED_INIT_ARGS], {
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
 * 清理 `createPinnedPatchFixture()` 创建的临时项目。
 *
 * @param {string} target pinned fixture 根目录
 * @returns {void}
 */
export function disposePinnedPatchFixture(target) {
  fs.rmSync(target, { recursive: true, force: true });
}

/**
 * 构建 pinned Trellis 的 full Patch 计划、policy 报告与覆盖率证据。
 *
 * @param {{requireSnapshotMatch?:boolean}} [options] 是否要求 vendor 与发布快照一致
 * @returns {{target:string,version:string,catalogs:Array<object>,policies:Array<object>,plan:object,report:object,coverage:object}} fixture 上下文
 */
export function preparePinnedPatchFixture(options = {}) {
  const { requireSnapshotMatch = true } = options;
  if (requireSnapshotMatch) assertPatchOverrideSnapshotsMatch();
  const target = createPinnedPatchFixture();
  try {
    const catalogs = getPinnedPatchCatalogs();
    const policies = loadPatchPolicies(catalogs);
    const version = fs.readFileSync(path.join(target, ".trellis", ".version"), "utf8").trim();
    const compatibilityReport = buildPatchCompatibilityReport({ version, policies });
    assertNoPatchConflictErrors(compatibilityReport);
    const plan = preparePatchPlan(target, catalogs, { adapters: flowerPatchAdapters() });
    const coverage = readCatalogCoverage(catalogs);
    assertCoverage(plan, coverage);
    const report = buildPatchConflictReport({ version, plan, policies });
    assertNoPatchConflictErrors(report);
    return { target, version, catalogs, policies, plan, report, coverage };
  } catch (error) {
    disposePinnedPatchFixture(target);
    throw error;
  }
}
