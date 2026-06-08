import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";

/**
 * 定位捆绑的 @mindfoldhq/trellis 可执行 bin 的绝对路径。
 *
 * 关键:解析依赖的 `package.json`(必随包发布)再读其 `bin` 字段,
 * 而不是 `require.resolve("@mindfoldhq/trellis")` —— 后者解析的是 main
 * (dist/index.js),不是 CLI 入口。
 *
 * @returns {string} bin 的绝对路径
 */
export function resolveTrellisBin() {
  const require = createRequire(import.meta.url);
  const pkgJsonPath = require.resolve("@mindfoldhq/trellis/package.json");
  const pkgRoot = path.dirname(pkgJsonPath);
  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
  const binRel = typeof pkg.bin === "string" ? pkg.bin : pkg.bin.trellis;
  return path.resolve(pkgRoot, binRel);
}

/**
 * 用当前 node 执行 trellis bin,透传子命令与参数。
 *
 * - 用 `process.execPath` 直接跑 bin 的 .js,不依赖 PATH / .cmd / shebang,跨平台最稳。
 * - `stdio: "inherit"`:trellis 的交互提示与输出直达用户终端,行为与手动运行完全一致。
 * - 返回退出码(而非 reject),由调用方决定是否中止后续叠加。
 *
 * @param {string[]} args trellis 子命令及其参数,如 ["init", "--claude", "-y"]
 * @param {string} cwd 目标项目目录
 * @returns {Promise<number>} 子进程退出码
 */
export function runTrellis(args, cwd) {
  const bin = resolveTrellisBin();
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bin, ...args], {
      cwd,
      stdio: "inherit",
      env: process.env,
    });
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 0));
  });
}
