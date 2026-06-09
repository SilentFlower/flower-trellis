import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { confirm } from "@inquirer/prompts";
import chalk from "chalk";
import { flowerVersion } from "./versions.js";

/**
 * 版本自动检测 —— 在 init / update 启动时尽力而为地比对 npm 上 flower-trellis 自身的
 * 最新版本,发现新版时提示用户并(交互场景下)询问是否立即升级。
 *
 * 设计基调与本项目一致:**绝不阻断主流程**。网络探测带超时,离线/超时/失败一律静默跳过;
 * 仅在「全局直跑 + 有新版」时才打扰用户。详见 design.md / research/version-check-conventions.md。
 */

/** npm registry 根地址。 */
const REGISTRY = "https://registry.npmjs.org";
/** 待检测的包名(即本包)。 */
const PKG = "flower-trellis";
/** 网络探测超时(毫秒)—— init/update 是重操作,2.5s 探测可接受且不显著影响体感。 */
const TIMEOUT_MS = 2500;

/**
 * 取 npm 上 flower-trellis 的 latest 版本号;任何失败(离线/超时/非 200/解析异常)一律
 * 返回 null —— 调用方据此「拿不到就当没这回事」继续主流程。
 *
 * 用 AbortController 给内置 fetch 加超时,finally 清除定时器防句柄泄漏。
 * @returns {Promise<string|null>} latest 版本号,或失败时 null
 */
export async function fetchLatestVersion() {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${REGISTRY}/${PKG}/latest`, {
      signal: ac.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null; // 非 200(404/5xx 等)→ 静默跳过
    const json = await res.json();
    return typeof json.version === "string" ? json.version : null;
  } catch {
    return null; // AbortError(超时)/ fetch failed(离线)/ JSON 解析失败 → 静默
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 比较两个版本号,返回 1 / 0 / -1(a 比 b 新 / 相同 / 旧)。
 *
 * 只比较 major.minor.patch 三段数值;预发布后缀(-beta.x 等)在拆分前剥除。
 * 之所以不引 semver 库:比较对象是 npm `latest` dist-tag(按语义永远指向稳定发布),
 * 天然不含预发布优先级排序问题。与 src/lib/variant.js「剥 -beta.x 再比数值」的先例一致。
 * @param {string} a 版本号 A
 * @param {string} b 版本号 B
 * @returns {-1|0|1}
 */
export function compareVersions(a, b) {
  const norm = (v) =>
    String(v)
      .split("-")[0]
      .split(".")
      .map((n) => parseInt(n, 10) || 0);
  const [a1, a2, a3] = norm(a);
  const [b1, b2, b3] = norm(b);
  if (a1 !== b1) return a1 > b1 ? 1 : -1;
  if (a2 !== b2) return a2 > b2 ? 1 : -1;
  if (a3 !== b3) return a3 > b3 ? 1 : -1;
  return 0;
}

/**
 * 判断当前是否经 npx 执行。
 *
 * 经 npx 跑的永远是临时拉取的最新版,检测无意义,应跳过。最可靠的信号是执行路径里含
 * npx 缓存目录标记 `_npx`(`~/.npm/_npx/<hash>/...`,跨平台一致);辅以 `npm_command==='exec'`
 * (`npm exec` / npx)。全局安装直跑(flower-trellis / ftl / ft)时两者皆否。
 * @returns {boolean}
 */
export function isRunningViaNpx() {
  try {
    const selfPath = fileURLToPath(import.meta.url);
    if (selfPath.includes("_npx")) return true;
  } catch {
    // 路径解析失败不应影响主流程;退而判 npm_command
  }
  return process.env.npm_command === "exec";
}

/**
 * 检测 flower-trellis 自身是否有新版本,并按场景提示/引导升级。在 init / update 的
 * 品牌头部之后、主操作之前调用。
 *
 * 短路条件(任一命中即跳过,什么都不打印):关闭开关(`--no-update-check` 使
 * `ctx.updateCheck===false`,或环境变量 `FLOWER_NO_UPDATE_CHECK` 非空)、经 npx 运行、
 * 网络探测失败、已是最新或本地更高。
 *
 * 发现新版时的行为:
 *  - 交互 TTY:打印通知 → confirm 询问是否升级 → 同意则执行 `npm i -g flower-trellis@latest`;
 *    成功后打印「请重新运行」并 **process.exit(0)**(不做 re-exec 自动重跑),失败则降级为
 *    打印手动升级命令并继续主流程;拒绝则继续主流程。
 *  - 非交互(`-y`/`--yes` 或非 TTY):仅打印通知 + 升级命令,不弹确认、不阻塞。
 *
 * @param {object} ctx cli.js parse() 产出的上下文(用到 updateCheck / passthrough)
 * @param {string} commandLabel 当前命令名,用于「请重新运行 ft <command>」文案(如 "init"/"update")
 * @returns {Promise<void>} 注意:用户确认升级且成功时本函数会直接退出进程,不返回
 */
export async function checkForUpdate(ctx, commandLabel) {
  // 1. 关闭开关:显式 flag 或环境变量
  if (ctx.updateCheck === false || process.env.FLOWER_NO_UPDATE_CHECK) return;
  // 2. npx 本就是最新版,跳过(连通知都不打,避免误导)
  if (isRunningViaNpx()) return;

  // 3. 尽力而为取 latest;拿不到就静默退出
  const latest = await fetchLatestVersion();
  if (!latest) return;

  // 4. 与本地版本比较;仅当 latest 严格更新时才打扰
  const current = flowerVersion();
  if (compareVersions(latest, current) !== 1) return;

  // 5. 打印发现新版本通知(粉色品牌色,与 banner 一致)
  console.log(
    "\n🌸 " +
      chalk.hex("#ff6fb5")(`发现 flower-trellis 新版本 ${chalk.bold(latest)}`) +
      chalk.gray(`(当前 ${current})`),
  );

  // 6. 非交互(-y/--yes 或非 TTY):仅打印升级命令,不弹确认、不阻塞
  const nonInteractive =
    ctx.passthrough.includes("-y") ||
    ctx.passthrough.includes("--yes") ||
    !process.stdin.isTTY;
  if (nonInteractive) {
    console.log(`  · 升级:npm i -g ${PKG}@latest`);
    console.log("  · 升级后请重跑 ft update,让新版强化包重新叠加到现有项目");
    return;
  }

  // 7. 交互:询问是否升级(@inquirer/confirm,返回 boolean)
  const doUpgrade = await confirm({
    message: `是否现在升级到 ${latest}?(升级后需重新运行命令)`,
    default: true,
  });
  if (!doUpgrade) {
    console.log("  · 已跳过升级");
    return;
  }

  // 8. 执行全局升级。失败(含 EACCES 权限问题、npm 不存在)不自行提权,降级为打印手动命令
  const res = spawnSync("npm", ["i", "-g", `${PKG}@latest`], {
    stdio: "inherit",
    shell: process.platform === "win32", // Windows 上 npm 实为 npm.cmd
  });
  if (res.status === 0) {
    console.log(`\n  ✓ 已升级到 ${latest}`);
    console.log(`  · 请重新运行 ft ${commandLabel} 以使用新版本`);
    console.log("  · 强化包随版本更新,升级后可 ft update 重新叠加到现有项目");
    // 当前进程内存里仍是旧代码,必须退出由用户重跑新版本(不做 re-exec,规避权限/平台/进程态坑)
    process.exit(0);
  } else {
    console.log(`  · 自动升级失败,请手动运行:npm i -g ${PKG}@latest`);
    // 升级未成功:以当前版本继续 init/update,不阻断
  }
}
