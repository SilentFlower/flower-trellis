import { validatePluginLock } from "../schemas/project-files.js";

/**
 * 从 resolved graph 构建并校验 Plugin lock。
 *
 * @param {import("../contracts.js").ResolvedGraph} graph 已解析图
 * @returns {import("../contracts.js").PluginLock} 可持久化锁文件
 */
export function buildPluginLock(graph) {
  return validatePluginLock({
    schemaVersion: 1,
    roots: [...graph.roots],
    plugins: graph.plugins.map((plugin) => ({
      ...plugin,
      source: { ...plugin.source },
      dependencies: { ...plugin.dependencies },
      compatibility: { ...plugin.compatibility },
      capabilities: {
        ...plugin.capabilities,
        granted: [...plugin.capabilities.granted],
        denied: [...plugin.capabilities.denied],
      },
    })),
  });
}
