import { compareUtf8 } from "./stable-order.js";

/**
 * 从当前直接声明出发，分类既有 lock 中的可达、孤立和缺失节点。
 *
 * lock roots 可能来自半清理的旧项目，不能作为活跃 Plugin 的事实入口。调用方应使用当前
 * `plugins.json` 声明开始遍历，才能在不访问外部来源的前提下识别可冻结节点和孤立状态。
 *
 * @param {import("./contracts.js").ProjectPluginDeclaration[]} declarations 当前直接声明
 * @param {import("./contracts.js").PluginLock|null} lock 既有 Plugin lock
 * @returns {{reachableIds:Set<string>,orphanIds:Set<string>,missingIds:Set<string>}} lock 节点分类
 */
export function classifyLockReachability(declarations, lock) {
  const plugins = lock?.plugins || [];
  const byId = new Map(plugins.map((plugin) => [plugin.id, plugin]));
  const visited = new Set();
  const reachableIds = new Set();
  const missingIds = new Set();

  const visit = (id) => {
    if (visited.has(id)) return;
    visited.add(id);
    const plugin = byId.get(id);
    if (!plugin) {
      missingIds.add(id);
      return;
    }
    reachableIds.add(id);
    Object.keys(plugin.dependencies).sort(compareUtf8).forEach(visit);
  };

  declarations.map(({ id }) => id).sort(compareUtf8).forEach(visit);
  const orphanIds = new Set(
    plugins.map(({ id }) => id).filter((id) => !reachableIds.has(id)).sort(compareUtf8),
  );
  return { reachableIds, orphanIds, missingIds };
}
