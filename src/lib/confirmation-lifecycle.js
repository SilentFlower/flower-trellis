/** @module confirmation-lifecycle 安装器通过唯一 Python 实现作废旧确认许可。 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { PKG_ROOT } from "./paths.js";
import { resolveTrellisPythonCommand, trellisPythonInvocation } from "./trellis-python-command.js";
import { FLOWER_CONFIRMATION_ASSETS } from "./flower-assets.js";

/**
 * 项目关闭、更新或卸载前作废现有请求；空状态保持零调用。
 * @param {string} project 项目根
 * @param {string} reason 生命周期原因
 * @returns {number} 取消数量
 */
export function cancelProjectConfirmations(project, reason = "project_disabled") {
  const hasState = ["codex", "claude"].some(platform => {
    const directory = path.join(project, ".trellis", ".runtime", `confirmation-${platform}`);
    if (!fs.existsSync(directory)) return false;
    const info = fs.lstatSync(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("确认状态目录必须是普通目录");
    return fs.readdirSync(directory).some(file => file.endsWith(".json"));
  });
  if (!hasState) return 0;
  const python = trellisPythonInvocation(resolveTrellisPythonCommand(project).command);
  const result = spawnSync(python.executable, [...python.args, "-X", "utf8",
    path.join(PKG_ROOT, "src/assets/flower_confirmation.py"), "_cancel-project", "--target", project, "--reason", reason], {
    cwd: project, encoding: "utf8", timeout: 15000, maxBuffer: 1024 * 1024, windowsHide: true,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
  });
  if (result.error) throw new Error(`旧确认许可失效失败：${result.error.message}`);
  let value;
  try { value = JSON.parse(result.stdout); } catch { throw new Error("旧确认许可失效返回无效结果"); }
  if (result.status !== 0 || !Number.isSafeInteger(value.cancelled)) throw new Error(value.reason || "旧确认许可失效失败");
  return value.cancelled;
}

/**
 * 仅在确认受管资产实际变更前取消旧请求；预览保持只读。
 * @param {string} project 项目根
 * @param {object} plan 已预检安装计划
 * @param {boolean} dryRun 是否预览
 * @returns {void}
 */
export function invalidateChangedConfirmations(project, plan, dryRun) {
  if (dryRun) return;
  const targets = [...FLOWER_CONFIRMATION_ASSETS, "confirmation_policy.py", "confirmation.md"]
    .map(asset => `.trellis/scripts/${asset}`);
  const changed = plan.contentMutations.some(({ target, beforeHash, afterHash }) => beforeHash !== afterHash
    && (targets.includes(target) || target.startsWith(".trellis/scripts/flower_confirmation_runtime/")));
  if (changed) cancelProjectConfirmations(project, "project_updated");
}
