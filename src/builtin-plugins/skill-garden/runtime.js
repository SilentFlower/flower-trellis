import "../../plugin/install/patch-planner.js";
import { getConfiguredPlatforms } from "@mindfoldhq/trellis/dist/configurators/index.js";
import { PluginApplicationService } from "../../plugin/application-service.js";
import {
  detectPluginPlatforms,
  listPluginPlatforms,
} from "../../plugin/install/platform-detector.js";
import { PLUGIN_RUNTIME_ERROR_CODES } from "../../plugin/runtime-errors.js";
import { compareUtf8 } from "../../plugin/stable-order.js";
import { ProjectStore } from "../../plugin/state/project-store.js";
import { SourceRegistry } from "../../plugin/sources/source-registry.js";
import {
  SKILL_GARDEN_PLUGIN_ID,
  SkillGardenBuiltinProvider,
} from "./provider.js";

const TRELLIS_TO_PLUGIN_PLATFORM = new Map([
  ["claude-code", "claude"],
]);

/**
 * 读取 Trellis 已配置平台并转换为 Plugin 平台 ID。
 *
 * @param {string} projectRoot 项目根
 * @returns {string[]} Plugin 平台列表；无法读取或没有命中时返回空数组
 */
function configuredTrellisPluginPlatforms(projectRoot) {
  try {
    const supported = new Set(listPluginPlatforms());
    return [...new Set([...getConfiguredPlatforms(projectRoot)]
      .map((platform) => TRELLIS_TO_PLUGIN_PLATFORM.get(platform) || platform)
      .filter((platform) => supported.has(platform)))]
      .sort(compareUtf8);
  } catch {
    return [];
  }
}

/**
 * 选择 Skill-Garden lifecycle 的显式平台参数。
 *
 * 优先使用 Trellis 模板 hash 记录的平台，避免旧 Plugin state 污染把未启用平台继续投影。
 * 缺少 hash 记录的旧项目继续沿用原生检测与 Claude fallback，保持旧 enhancement 兼容行为。
 *
 * @param {string} projectRoot 项目根
 * @returns {string[]} 显式平台
 */
export function resolveSkillGardenPlatforms(projectRoot) {
  const configured = configuredTrellisPluginPlatforms(projectRoot);
  if (configured.length > 0) return configured;
  try {
    return detectPluginPlatforms(projectRoot).platforms;
  } catch (error) {
    if (error?.code === PLUGIN_RUNTIME_ERROR_CODES.PLATFORM_SELECTION_REQUIRED) {
      return ["claude"];
    }
    throw error;
  }
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
    platforms: resolveSkillGardenPlatforms(projectRoot),
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
