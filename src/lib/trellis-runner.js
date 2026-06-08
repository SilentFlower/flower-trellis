import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import figlet from "figlet";
import * as pty from "node-pty";

/**
 * 定位捆绑的 @mindfoldhq/trellis 可执行 bin 的绝对路径。
 * 解析依赖的 package.json(必随包发布)再读其 bin 字段,而非 main。
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
 * 判断 trellis 输出的一行属于「头部」的哪类:
 *  - "skip":banner 实体行 / 空行 / 副标题 / Developer / Mode → 过滤掉
 *  - "keep":proxy 行 → 保留输出,但仍处于头部(继续过滤后续 Mode/Developer)
 *  - "content":其它 → 头部结束,正文开始
 */
function classifyHeaderLine(line, bannerSet) {
  const plain = stripAnsi(line);
  const t = plain.trim();
  const key = plain.replace(/\s+$/, "");
  if (!t) return "skip";
  if (bannerSet.has(key)) return "skip";
  if (t.startsWith("All-in-one AI framework")) return "skip";
  if (t.startsWith("👤 Developer:")) return "skip";
  if (t.startsWith("Mode:")) return "skip";
  if (t.startsWith("Using proxy:")) return "keep";
  return "content";
}

/**
 * 用当前 node 执行 trellis bin(普通 spawn),透传子命令与参数。
 *
 * 用于:兜底透传其它命令(inherit);或非交互场景下捕获 stdout 过滤 banner(pipe)。
 *
 * @param {string[]} args
 * @param {string} cwd
 * @param {object} [opts] { stripBanner }
 * @returns {Promise<number>} 退出码(信号终止返回 128)
 */
export function runTrellis(args, cwd, opts = {}) {
  const bin = resolveTrellisBin();
  const strip = opts.stripBanner;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bin, ...args], {
      cwd,
      stdio: strip ? ["inherit", "pipe", "inherit"] : "inherit",
      env: strip ? { ...process.env, FORCE_COLOR: "1" } : process.env,
    });
    if (strip && child.stdout) {
      const banner = trellisBannerLines();
      const rl = createInterface({ input: child.stdout });
      rl.on("line", (line) => {
        const kind = classifyHeaderLine(line, banner);
        // 普通(非 pty)场景一直按行过滤即可:trellis 此时是 -y 非交互,无 inquirer
        if (kind === "skip") return;
        process.stdout.write(line + "\n");
      });
    }
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) resolve(128);
      else resolve(code ?? 0);
    });
  });
}

/**
 * 在伪终端(node-pty)里运行 trellis,**保留其全部交互**(模板 / monorepo / 冲突菜单),
 * 同时过滤掉它开头重复打印的启动 banner / 副标题 / Developer / Mode。
 *
 * 过滤只作用于「头部阶段」:逐行识别 banner 类行并丢弃(proxy 保留),
 * 一旦遇到正文行或 inquirer 渲染(隐藏光标序列 ESC[?25l)立即停止过滤、转为完全透传,
 * 以免破坏交互菜单的光标控制。
 *
 * @param {string[]} args
 * @param {string} cwd
 * @param {object} [opts] { stripBanner }
 * @returns {Promise<number>} 退出码(信号终止返回 128)
 */
export function runTrellisPty(args, cwd, opts = {}) {
  const bin = resolveTrellisBin();
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = pty.spawn(process.execPath, [bin, ...args], {
        name: "xterm-256color",
        cols: process.stdout.columns || 80,
        rows: process.stdout.rows || 30,
        cwd,
        env: { ...process.env, FORCE_COLOR: "1" },
      });
    } catch (e) {
      reject(e);
      return;
    }

    const bannerSet = trellisBannerLines();
    let filtering = !!opts.stripBanner;
    let buf = "";

    child.onData((data) => {
      if (!filtering) {
        process.stdout.write(data);
        return;
      }
      // inquirer 开始渲染(隐藏光标)→ 立即停止过滤,整体透传,保住交互菜单
      if (data.includes("\x1b[?25l")) {
        filtering = false;
        process.stdout.write(buf + data);
        buf = "";
        return;
      }
      buf += data;
      const parts = buf.split(/\r?\n/);
      buf = parts.pop(); // 末尾不完整行留待下次
      for (const line of parts) {
        const kind = classifyHeaderLine(line, bannerSet);
        if (kind === "skip") continue;
        if (kind === "keep") {
          process.stdout.write(line + "\r\n");
          continue;
        }
        filtering = false; // 正文开始
        process.stdout.write(line + "\r\n");
      }
      if (!filtering && buf) {
        process.stdout.write(buf);
        buf = "";
      }
    });

    // 把真终端的输入转发进 pty(让用户能操作 trellis 的交互菜单)
    const stdin = process.stdin;
    const wasRaw = !!stdin.isRaw;
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    const onStdin = (d) => child.write(d.toString("utf8"));
    stdin.on("data", onStdin);

    const onResize = () => {
      try {
        child.resize(process.stdout.columns || 80, process.stdout.rows || 30);
      } catch {
        // 忽略 resize 失败
      }
    };
    process.stdout.on("resize", onResize);

    child.onExit(({ exitCode, signal }) => {
      stdin.off("data", onStdin);
      if (stdin.isTTY) stdin.setRawMode(wasRaw);
      stdin.pause();
      process.stdout.off("resize", onResize);
      if (signal) resolve(128);
      else resolve(exitCode ?? 0);
    });
  });
}
