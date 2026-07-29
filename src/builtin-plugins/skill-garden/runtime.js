import fs from "node:fs";
import path from "node:path";
import "../../plugin/install/patch-planner.js";
import { ENHANCEMENT_SKILL_TARGETS } from "../../constants.js";
import { PluginApplicationService } from "../../plugin/application-service.js";
import { ProjectStore } from "../../plugin/state/project-store.js";
import { SourceRegistry } from "../../plugin/sources/source-registry.js";
import {
  SKILL_GARDEN_PLUGIN_ID,
  SkillGardenBuiltinProvider,
} from "./provider.js";

/**
 * 选择与旧 enhancement fallback 一致的平台参数。
 *
 * @param {string} projectRoot 项目根
 * @returns {string[]} 显式平台；可自动检测时返回空数组
 */
function compatibilityPlatforms(projectRoot) {
  const detected = ENHANCEMENT_SKILL_TARGETS.some(({ root }) => (
    fs.existsSync(path.join(projectRoot, ...root.split("/")))
  ));
  return detected ? [] : ["claude"];
}

/**
 * 声明或重放内置 `flower/skill-garden`。
 *
 * @param {string} projectRoot 项目根
 * @param {{variant?:string|null,skills?:string[],dryRun?:boolean,providers?:object[],onPreflight?:(result:object)=>void}} [options] 运行参数
 * @returns {{variant:string,version:string,installed:string[],runtime:object,patchReport:object|null}} 兼容结果与 Runtime 证据
 */
export function applySkillGardenPlugin(projectRoot, options = {}) {
  const store = new ProjectStore(projectRoot);
  const provider = new SkillGardenBuiltinProvider({
    projectRoot,
    variant: options.variant,
    skills: options.skills,
    previousState: store.readState(),
  });
  provider.listCandidates(SKILL_GARDEN_PLUGIN_ID);
  const registry = new SourceRegistry([provider, ...(options.providers || [])]);
  const service = new PluginApplicationService(projectRoot, { registry, store });
  const declared = store.readPlugins().plugins.some(({ id }) => id === SKILL_GARDEN_PLUGIN_ID);
  const lifecycleOptions = {
    platforms: compatibilityPlatforms(projectRoot),
    dryRun: Boolean(options.dryRun),
    nonInteractive: true,
    onPreflight: options.onPreflight,
  };
  const runtime = declared
    ? service.update({
      ...lifecycleOptions,
      id: SKILL_GARDEN_PLUGIN_ID,
      version: provider.manifest.version,
    })
    : service.add({
      ...lifecycleOptions,
      id: SKILL_GARDEN_PLUGIN_ID,
      version: provider.manifest.version,
    });
  return {
    variant: provider.snapshot.variant,
    version: provider.snapshot.version,
    installed: provider.lastProjection?.installed || [],
    runtime,
    patchReport: runtime.patchReport,
  };
}
