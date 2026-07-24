import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyPatchPlan } from "../src/lib/patch-engine.js";
import {
  disposePinnedPatchFixture,
  preparePinnedPatchFixture,
} from "../src/lib/patch-fixture.js";
import { formatPatchDiagnostic } from "../src/lib/patch-conflicts.js";

/**
 * 对 pinned Trellis 模板执行真实 Patch 计划和最终产物冲突检查。
 *
 * @param {{log?:boolean,requireSnapshotMatch?:boolean}} [options] 输出与快照一致性选项
 * @returns {{version:object,summary:object,patches:number,operations:number,readyTargets:number,changed:number,targetKinds:string[]}} 检查汇总
 */
export function runPatchConflictCheck(options = {}) {
  const { log = true, requireSnapshotMatch = true } = options;
  const fixture = preparePinnedPatchFixture({ requireSnapshotMatch });
  try {
    if (log) {
      for (const diagnostic of fixture.report.diagnostics.filter(
        (item) => item.severity === "warning",
      )) {
        console.log(`  · ${formatPatchDiagnostic(diagnostic)}`);
      }
    }
    const applied = applyPatchPlan(fixture.target, fixture.plan);
    const summary = {
      version: fixture.report.version,
      summary: fixture.report.summary,
      patches: fixture.plan.patches.length,
      operations: fixture.plan.catalogOperations.length,
      readyTargets: fixture.plan.results.filter((item) => item.status === "ready").length,
      changed: applied.changed,
      targetKinds: fixture.coverage.targetKinds,
    };
    if (log) {
      console.log(
        `✓ Patch 冲突检查通过:Trellis ${fixture.report.version.value}` +
          `(${fixture.report.version.status}),Patch ${summary.patches}、` +
          `operation ${summary.operations}、ready target ${summary.readyTargets}、` +
          `target kind ${summary.targetKinds.length}、` +
          `warning ${fixture.report.summary.warnings}、info ${fixture.report.summary.info}`,
      );
    }
    return summary;
  } finally {
    disposePinnedPatchFixture(fixture.target);
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
