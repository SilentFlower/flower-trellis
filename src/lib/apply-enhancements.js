import { applySkillGardenPlugin } from "../builtin-plugins/skill-garden/runtime.js";
import { resolveEnhancementSnapshot } from "./enhancement-catalog.js";
import { formatPatchDiagnostic } from "./patch-conflicts.js";

/**
 * 叠加强化包的兼容 facade。
 *
 * 成功状态统一由 Plugin Runtime 写入 `.flower/`；旧
 * `.trellis/.flower-manifest.json` 只作为迁移证据读取，不再更新。
 *
 * @param {string} target 目标项目根
 * @param {{variant?:string|null,skills?:string[],dryRun?:boolean}} [opts] 兼容参数
 * @returns {{variant:string,installed:string[],patchReport?:object,runtime:object}} 兼容结果
 */
export function applyEnhancements(target, opts = {}) {
  const snapshot = resolveEnhancementSnapshot(target, opts.variant);
  console.log(
    `\n强化包变体:${snapshot.variant}${snapshot.version ? `(项目 Trellis ${snapshot.version})` : ""}`,
  );
  let preflightLogged = false;
  const result = applySkillGardenPlugin(target, {
    ...opts,
    variant: snapshot.variant,
    onPreflight(preflight) {
      for (const diagnostic of (preflight.patchReport?.diagnostics || [])
        .filter(({ severity }) => severity === "warning")) {
        console.log(`  · ${formatPatchDiagnostic(diagnostic)}`);
      }
      for (const diagnostic of preflight.diagnostics.filter(({ severity, code }) => (
        severity === "warning" && code !== "PLUGIN_PATCH_POLICY_DIAGNOSTIC"
      ))) {
        console.log(`  · ${diagnostic.message}`);
      }
      preflightLogged = true;
    },
  });
  if (!preflightLogged) {
    for (const diagnostic of result.runtime.diagnostics.filter(({ severity }) => severity === "warning")) {
      console.log(`  · ${diagnostic.message}`);
    }
  }
  console.log(`  ✓ Plugin Runtime:${result.runtime.transaction.status}`);
  console.log(`  ✓ 铺设 ${result.installed.length} 个强化项`);
  return {
    variant: result.variant,
    installed: result.installed,
    ...(result.patchReport ? { patchReport: result.patchReport } : {}),
    runtime: result.runtime,
  };
}
