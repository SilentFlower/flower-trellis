import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import figlet from "figlet";
import * as pty from "node-pty";
import { disableWindowsTerminalWin32InputMode } from "./terminal-state.js";

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
 * 上游 `trellis update` 的 npm 落后提示行。用宽松匹配容忍上游微调文案,
 * 捕获组取出它自报的 CLI 版本,复用到 Flower 的替代说明里。
 */
const UPSTREAM_UPGRADE_NOTICE = /Your CLI \(([^)]+)\) is behind npm\b/;

/**
 * 上游紧跟其后的引导动作行。只匹配独立成行的 `Run: trellis upgrade`,
 * 避免误伤降级分支里 `1. Update your CLI: trellis upgrade` 这类真实错误指引。
 */
const UPSTREAM_UPGRADE_ACTION = /^Run:\s*trellis upgrade$/;

/**
 * 正文开始后继续按行过滤的行数上限。
 *
 * 上游版本提示固定打印在 `trellis update` 输出最前面,给一个有限窗口即可覆盖;
 * 设上限是为了不让不完整行长期滞留在缓冲区里,影响后续交互输出的实时性。
 */
const UPSTREAM_NOTICE_LINE_BUDGET = 40;

/**
 * 改写上游 trellis 的 npm 升级提示。
 *
 * Flower 在 package.json 里固定 `@mindfoldhq/trellis` 版本,并由 postinstall 同步全局 CLI,
 * 所以上游「CLI 落后于 npm,请运行 trellis upgrade」是错误引导:照做会让全局 CLI 脱离
 * Flower 的版本控制,下次安装又被同步回去。这里替换成 Flower 自己的说明而不是静默丢弃,
 * 让用户仍然知道版本检查发生过、以及为什么不需要照做。
 *
 * @param {string} line 未去色的原始输出行
 * @returns {string|null|undefined} 替换文案;null 表示丢弃该行;undefined 表示不匹配
 */
export function rewriteUpstreamUpgradeNotice(line) {
  const t = stripAnsi(line).trim();
  const notice = UPSTREAM_UPGRADE_NOTICE.exec(t);
  if (notice) return `  · Trellis 版本由 Flower 固定(${notice[1]}),已忽略上游 npm 升级提示`;
  if (UPSTREAM_UPGRADE_ACTION.test(t)) return null;
  return undefined;
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
        const notice = rewriteUpstreamUpgradeNotice(line);
        if (notice !== undefined) {
          if (notice !== null) process.stdout.write(notice + "\n");
          return;
        }
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
 * 同时过滤掉它开头重复打印的启动 banner / 副标题 / Developer / Mode,
 * 以及它自带的、与 Flower 版本固定策略冲突的 npm 升级提示。
 *
 * 过滤分三个阶段:
 *  - "header":逐行识别 banner 类行并丢弃(proxy 保留),遇到正文行转入 "notice";
 *  - "notice":只改写上游 npm 升级提示,其余原样输出,超出行数预算后转入 "raw";
 *  - "raw":完全透传。
 *
 * 任一阶段遇到 inquirer 渲染(隐藏光标序列 ESC[?25l)都立即转入 "raw",
 * 以免破坏交互菜单的光标控制。
 *
 * @param {string[]} args
 * @param {string} cwd
 * @param {object} [opts] { stripBanner, ptySpawn, stdin, stdout, platform }
 * @returns {Promise<number>} 退出码(信号终止返回 128)
 */
export function runTrellisPty(args, cwd, opts = {}) {
  const bin = resolveTrellisBin();
  const stdin = opts.stdin || process.stdin;
  const stdout = opts.stdout || process.stdout;
  const platform = opts.platform ?? process.platform;
  const ptySpawn = opts.ptySpawn || pty.spawn;
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = ptySpawn(process.execPath, [bin, ...args], {
        name: "xterm-256color",
        cols: stdout.columns || 80,
        rows: stdout.rows || 30,
        cwd,
        env: { ...process.env, FORCE_COLOR: "1" },
      });
    } catch (e) {
      disableWindowsTerminalWin32InputMode({ platform, output: stdout });
      reject(e);
      return;
    }

    const bannerSet = trellisBannerLines();
    let phase = opts.stripBanner ? "header" : "raw";
    let noticeBudget = UPSTREAM_NOTICE_LINE_BUDGET;
    let buf = "";

    const dataSubscription = child.onData((data) => {
      if (phase === "raw") {
        stdout.write(data);
        return;
      }
      // inquirer 开始渲染(隐藏光标)→ 立即停止过滤,整体透传,保住交互菜单
      if (data.includes("\x1b[?25l")) {
        phase = "raw";
        stdout.write(buf + data);
        buf = "";
        return;
      }
      buf += data;
      const parts = buf.split(/\r?\n/);
      buf = parts.pop(); // 末尾不完整行留待下次
      for (const line of parts) {
        if (phase === "raw") {
          stdout.write(line + "\r\n");
          continue;
        }
        if (phase === "notice" && noticeBudget-- <= 0) {
          phase = "raw";
          stdout.write(line + "\r\n");
          continue;
        }
        const notice = rewriteUpstreamUpgradeNotice(line);
        if (notice !== undefined) {
          if (notice !== null) stdout.write(notice + "\r\n");
          continue;
        }
        if (phase === "header") {
          const kind = classifyHeaderLine(line, bannerSet);
          if (kind === "skip") continue;
          if (kind === "keep") {
            stdout.write(line + "\r\n");
            continue;
          }
          phase = "notice"; // 正文开始:banner 过滤结束,但仍在有限窗口内改写上游版本提示
        }
        stdout.write(line + "\r\n");
      }
      if (phase === "raw" && buf) {
        stdout.write(buf);
        buf = "";
      }
    });

    // 把真终端的输入转发进 pty(让用户能操作 trellis 的交互菜单)
    const wasRaw = !!stdin.isRaw;
    const wasFlowing = stdin.readableFlowing;
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    const onStdin = (d) => child.write(d.toString("utf8"));
    stdin.on("data", onStdin);

    const onResize = () => {
      try {
        child.resize(stdout.columns || 80, stdout.rows || 30);
      } catch {
        // 忽略 resize 失败
      }
    };
    stdout.on("resize", onResize);

    child.onExit(({ exitCode, signal }) => {
      // 过滤阶段可能扣着一行不完整输出(末尾无换行),退出前补发,避免最后一行被吞掉。
      if (buf) {
        stdout.write(buf);
        buf = "";
      }
      // 先停止接收子进程输出，再恢复宿主终端；否则迟到的 9001h 会重新污染父终端。
      dataSubscription.dispose();
      stdin.off("data", onStdin);
      if (stdin.isTTY) stdin.setRawMode(wasRaw);
      if (wasFlowing === true) stdin.resume();
      else stdin.pause();
      stdout.off("resize", onResize);
      disableWindowsTerminalWin32InputMode({ platform, output: stdout });
      if (signal) resolve(128);
      else resolve(exitCode ?? 0);
    });
  });
}
