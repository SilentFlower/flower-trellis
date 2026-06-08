import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import figlet from "figlet";

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

/** 去除 ANSI 颜色码,便于按文本匹配。 */
function stripAnsi(s) {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

/** Trellis 启动横幅(figlet Rebel "Trellis")的实体行集合,用于过滤掉重复 banner。 */
function trellisBannerLines() {
  try {
    return new Set(
      figlet
        .textSync("Trellis", { font: "Rebel" })
        .split("\n")
        .map((l) => l.replace(/\s+$/, ""))
        .filter((l) => l.trim()),
    );
  } catch {
    return new Set();
  }
}

/**
 * 用当前 node 执行 trellis bin,透传子命令与参数。
 *
 * - 用 `process.execPath` 直接跑 bin 的 .js,不依赖 PATH / .cmd / shebang,跨平台最稳。
 * - 默认 `stdio: "inherit"`:trellis 的交互与输出直达终端,行为与手动运行一致。
 * - 返回退出码(被信号终止返回 128),由调用方决定是否中止后续叠加。
 *
 * @param {string[]} args trellis 子命令及参数,如 ["init","--claude","-y"]
 * @param {string} cwd 目标项目目录
 * @param {object} [opts]
 * @param {boolean} [opts.stripBanner] 捕获 stdout 并过滤掉 trellis 的启动 banner /
 *   副标题 / Developer / Mode 行(flower 自己已显示品牌头部时用)。要求 trellis 非交互
 *   (调用方需确保已传 -y),否则管道会破坏其交互菜单。
 * @returns {Promise<number>} 子进程退出码
 */
export function runTrellis(args, cwd, opts = {}) {
  const bin = resolveTrellisBin();
  const strip = opts.stripBanner;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bin, ...args], {
      cwd,
      stdio: strip ? ["inherit", "pipe", "inherit"] : "inherit",
      // 管道下 chalk 默认不上色;强制上色以保留 trellis 后续输出的颜色
      env: strip ? { ...process.env, FORCE_COLOR: "1" } : process.env,
    });

    if (strip && child.stdout) {
      const banner = trellisBannerLines();
      const rl = createInterface({ input: child.stdout });
      rl.on("line", (line) => {
        const plain = stripAnsi(line);
        const t = plain.trim();
        if (!t) return; // 跳过空行(含 banner 周围的彩色空行),输出更紧凑
        const key = plain.replace(/\s+$/, "");
        if (banner.has(key)) return; // Trellis banner 实体行
        if (t.startsWith("All-in-one AI framework")) return; // 副标题
        if (t.startsWith("👤 Developer:")) return; // 开发者(flower 已显示)
        if (t.startsWith("Mode:")) return; // -y 的 "Mode: Non-interactive" 提示
        process.stdout.write(line + "\n");
      });
    }

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      // 被信号终止(如 Ctrl+C → SIGINT)时 code 为 null;返回非 0,
      // 让上层中止、绝不把「取消」误判为成功而继续叠加。
      if (signal) resolve(128);
      else resolve(code ?? 0);
    });
  });
}
