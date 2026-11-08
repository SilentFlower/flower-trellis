import fs from "node:fs";
import path from "node:path";
import { ProjectStore } from "../../plugin/state/project-store.js";
import { TransactionWriter } from "../../plugin/install/transaction-writer.js";
import { hashContent, hashFileIfExists } from "../../plugin/install/content-hash.js";
import { SKILL_GARDEN_PLUGIN_ID } from "./provider.js";

/** 共享设置只撤回安装记录拥有的确认 Hook，保留其它设置和用户改写的 handler。 */
function planConfirmationCleanup(root, events) {
  const target = ".claude/settings.json";
  if (!events.length) return null;
  const file = path.join(fs.realpathSync(root), target);
  let content, value;
  try {
    if (fs.realpathSync(file) !== file || !fs.lstatSync(file).isFile()) return null;
    content = fs.readFileSync(file);
    value = JSON.parse(content);
  } catch { return null; }
  let changed = false;
  for (const event of events) {
    if (!Array.isArray(value?.hooks?.[event])) continue;
    const condition = event.includes("Tool") ? "Bash(ftl confirm *)" : undefined;
    value.hooks[event] = value.hooks[event].flatMap(group => {
      if (!Array.isArray(group?.hooks)) return [group];
      const hooks = group.hooks.filter(hook => !(hook?.type === "command" && hook.command === "ftl confirm hook"
        && hook.timeout === 2 && hook.if === condition && Object.keys(hook).every(key => ["type", "command", "timeout", "if"].includes(key))));
      if (hooks.length === group.hooks.length) return [group];
      changed = true;
      if (!hooks.length && group.matcher === (condition ? "Bash" : "*")
        && Object.keys(group).every(key => ["matcher", "hooks"].includes(key))) return [];
      return [{ ...group, hooks }];
    });
  }
  if (!changed) return null;
  const bytes = Buffer.from(JSON.stringify(value, null, 2) + "\n");
  return { bytes, mutation: { owner: SKILL_GARDEN_PLUGIN_ID, target, beforeHash: hashContent(content), afterHash: hashContent(bytes) } };
}

/**
 * 按 Plugin state 生成 skill-garden 卸载计划。
 *
 * `.trellis/` 内目标交给 Trellis uninstall；这里只计划平台侧受管普通文件。
 *
 * @param {string} projectRoot 项目根
 * @returns {{managed:boolean,removals:object[],confirmationEvents:string[],conflicts:object[],shared:string[],dependents:string[],plugins:object|null,lock:object|null,state:object|null}} 卸载计划
 */
export function planSkillGardenUninstall(projectRoot) {
  const store = new ProjectStore(projectRoot);
  const plugins = store.readPlugins();
  const lock = store.readLock();
  const state = store.readState();
  const entry = state?.plugins.find(({ id }) => id === SKILL_GARDEN_PLUGIN_ID);
  if (!entry) {
    return {
      managed: false,
      removals: [],
      confirmationEvents: [],
      conflicts: [],
      shared: [],
      dependents: [],
      plugins,
      lock,
      state,
    };
  }
  const removals = [];
  const conflicts = [];
  const shared = [];
  const dependents = (lock?.plugins || [])
    .filter(({ id, dependencies }) => (
      id !== SKILL_GARDEN_PLUGIN_ID &&
      Object.hasOwn(dependencies, SKILL_GARDEN_PLUGIN_ID)
    ))
    .map(({ id }) => id)
    .sort();
  for (const item of entry.paths) {
    if (item.path === ".trellis" || item.path.startsWith(".trellis/")) continue;
    if (item.ownership === "shared") {
      shared.push(item.path);
      continue;
    }
    if (item.kind !== "file") continue;
    const actual = hashFileIfExists(path.join(projectRoot, ...item.path.split("/")));
    if (actual !== item.hash) {
      conflicts.push({ path: item.path, expected: item.hash, actual });
      continue;
    }
    removals.push({
      owner: SKILL_GARDEN_PLUGIN_ID,
      target: item.path,
      operation: "remove",
      beforeHash: actual,
      afterHash: null,
      source: `state:${SKILL_GARDEN_PLUGIN_ID}:${item.path}`,
    });
  }
  const confirmationEvents = ["UserPromptSubmit", "PreToolUse", "PostToolUseFailure", "SessionEnd"].filter(event =>
    entry.patches.some(patch => patch.target === ".claude/settings.json"
      && patch.operation === `flower/flower-claude-confirmation-${event.toLowerCase()}`));
  return { managed: true, removals, confirmationEvents, conflicts, shared, dependents, plugins, lock, state };
}

/**
 * 在 Trellis uninstall 成功后应用已冻结的 skill-garden 清理计划。
 *
 * @param {string} projectRoot 项目根
 * @param {ReturnType<typeof planSkillGardenUninstall>} cleanupPlan 冻结计划
 * @returns {object} Plugin 事务结果或保留结果
 */
export function applySkillGardenUninstall(projectRoot, cleanupPlan) {
  if (!cleanupPlan.managed) return { status: "not-managed", removed: 0, conflicts: [] };
  const hasConflicts = cleanupPlan.conflicts.length > 0;
  const conflictPaths = new Set(cleanupPlan.conflicts.map(({ path: target }) => target));
  const existingLock = cleanupPlan.lock || { schemaVersion: 1, roots: [], plugins: [] };
  const plugins = hasConflicts ? cleanupPlan.plugins : {
    ...cleanupPlan.plugins,
    plugins: cleanupPlan.plugins.plugins.filter(({ id }) => id !== SKILL_GARDEN_PLUGIN_ID),
  };
  const lock = hasConflicts ? existingLock : {
    ...existingLock,
    roots: existingLock.roots.filter((id) => id !== SKILL_GARDEN_PLUGIN_ID),
    plugins: existingLock.plugins.filter(({ id }) => id !== SKILL_GARDEN_PLUGIN_ID),
  };
  const state = hasConflicts ? {
    ...cleanupPlan.state,
    plugins: cleanupPlan.state.plugins.map((plugin) => (
      plugin.id === SKILL_GARDEN_PLUGIN_ID
        ? {
          ...plugin,
          paths: plugin.paths.filter((entry) => (
            entry.ownership === "shared" || conflictPaths.has(entry.path)
          )),
          patches: plugin.patches.filter(({ target }) => (
            target !== ".trellis" && !target.startsWith(".trellis/")
          )),
        }
        : plugin
    )),
  } : cleanupPlan.state ? {
    ...cleanupPlan.state,
    plugins: cleanupPlan.state.plugins.filter(({ id }) => id !== SKILL_GARDEN_PLUGIN_ID),
  } : { schemaVersion: 1, transactionVersion: 1, plugins: [] };
  const store = new ProjectStore(projectRoot);
  const writer = new TransactionWriter(projectRoot, { store });
  // 上游卸载也会移除其自身 Hook，因此在同一已批准事件范围内重新读取剩余设置。
  const patchCleanup = planConfirmationCleanup(projectRoot, cleanupPlan.confirmationEvents || []);
  const transaction = writer.apply({
    plan: {
      graph: { roots: [...lock.roots], plugins: [...lock.plugins] },
      contentMutations: cleanupPlan.removals,
      patchMutations: patchCleanup ? [patchCleanup.mutation] : [],
      diagnostics: [],
    },
    payloads: new Map(),
    patchPayloads: new Map(patchCleanup ? [[patchCleanup.mutation.target, patchCleanup.bytes]] : []),
    plugins,
    lock,
    state,
  });
  return {
    status: hasConflicts ? "conflict" : transaction.status,
    removed: cleanupPlan.removals.length,
    conflicts: cleanupPlan.conflicts,
    shared: cleanupPlan.shared,
    transaction,
  };
}
