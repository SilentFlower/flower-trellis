import { fileURLToPath } from "node:url";

/**
 * 判断当前 flower-trellis 是否来自 npx / npm exec 的临时缓存。
 *
 * 经 npx 跑的永远是临时包,不应触发全局安装类副作用。最可靠的信号是模块路径里含
 * npx 缓存目录标记 `_npx`;辅以 `npm_command === "exec"` 覆盖 npm exec 场景。
 *
 * @param {string} moduleUrl 调用方的 `import.meta.url`
 * @returns {boolean} 经 npx / npm exec 临时运行时返回 true
 */
export function isRunningViaNpx(moduleUrl) {
  try {
    const selfPath = fileURLToPath(moduleUrl);
    if (selfPath.includes("_npx")) return true;
  } catch {
    // 路径解析失败不应影响主流程;退而判 npm_command。
  }
  return process.env.npm_command === "exec";
}
