import { spawnSync } from "node:child_process";
import { confirm } from "@inquirer/prompts";
import chalk from "chalk";
import { readManifest, readUpdateCheck, writeUpdateCheck } from "./manifest.js";
import { isRunningViaNpx } from "./runtime-env.js";
import { flowerVersion } from "./versions.js";

/**
 * 版本自动检测 —— 在 init / update 启动时尽力而为地比对 npm 上 flower-trellis 自身的
 * 可用版本,发现新版时提示用户并(交互场景下)询问是否立即升级。
 *
 * 设计基调与本项目一致:**绝不阻断主流程**。网络探测带超时,离线/超时/失败一律静默跳过;
 * 仅在「全局直跑 + 有新版」时才打扰用户。稳定版只跟 latest;预发布版同时看 latest / beta。
 */

/** npm registry 根地址。 */
const REGISTRY = "https://registry.npmjs.org";
/** 待检测的包名(即本包)。 */
const PKG = "flower-trellis";
/** 网络探测超时(毫秒)—— 启动检查有 hook 总预算兜底,5s 可降低 registry 偶发慢响应误判。 */
const TIMEOUT_MS = 5000;
/** npm 刚发布后的 metadata 缓存竞争只允许等待并重试一次。 */
const ETARGET_RETRY_DELAY_MS = 1000;
/** npm package metadata 中保存 flower 内部发布说明的字段名。 */
const RELEASE_NOTES_FIELD = "flowerReleaseNotes";
/** 单次注入最多展示的版本数。 */
const RELEASE_NOTES_MAX_VERSIONS = 5;
/** 单个版本发布说明最多保留的字符数。 */
const RELEASE_NOTES_MAX_VERSION_CHARS = 500;
/** 所有版本发布说明合计最多保留的字符数。 */
const RELEASE_NOTES_MAX_TOTAL_CHARS = 1600;

/**
 * 从 npm registry 根文档解析 dist-tags。
 *
 * @param {object} json registry 根文档 JSON
 * @returns {{latest:string|null,beta:string|null}|null} 可用 dist-tags
 */
function parseDistTags(json) {
  const tags = json && typeof json === "object" ? json["dist-tags"] : null;
  const latest = typeof tags?.latest === "string" ? tags.latest : null;
  const beta = typeof tags?.beta === "string" ? tags.beta : null;
  return latest || beta ? { latest, beta } : null;
}

/**
 * 解析单个版本的 flowerReleaseNotes metadata。
 *
 * @param {string} version registry versions 字典里的版本号
 * @param {object} pkgVersion 对应版本 package metadata
 * @returns {{version:string,body:string,truncated:boolean,source:string}|null} 发布说明 metadata
 */
function parseReleaseNotesMetadata(version, pkgVersion) {
  const raw = pkgVersion?.[RELEASE_NOTES_FIELD];
  if (!raw || typeof raw !== "object") return null;
  if (raw.version !== version) return null;
  const body = typeof raw.body === "string" ? raw.body.trim() : "";
  if (!body) return null;
  return {
    version,
    body,
    truncated: raw.truncated === true,
    source: "npm-metadata",
  };
}

/**
 * 从 npm registry 根文档解析每个版本的发布说明 metadata。
 *
 * @param {object} json registry 根文档 JSON
 * @returns {Record<string,{version:string,body:string,truncated:boolean,source:string}>} 按版本号索引的发布说明
 */
function parseReleaseNotesByVersion(json) {
  const versions = json && typeof json === "object" ? json.versions : null;
  if (!versions || typeof versions !== "object") return {};
  const notes = {};
  for (const [version, pkgVersion] of Object.entries(versions)) {
    const parsed = parseReleaseNotesMetadata(version, pkgVersion);
    if (parsed) notes[version] = parsed;
  }
  return notes;
}

/**
 * 取 npm 上 flower-trellis 的更新 metadata。
 *
 * 一次请求 registry 根文档,同时解析 dist-tags 与各版本的 flowerReleaseNotes。任何失败
 * (离线/超时/非 200/解析异常)一律返回 null,调用方继续主流程。
 *
 * @returns {Promise<{tags:{latest:string|null,beta:string|null},releaseNotesByVersion:Record<string,{version:string,body:string,truncated:boolean,source:string}>}|null>} 更新 metadata
 */
export async function fetchPackageUpdateMetadata() {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${REGISTRY}/${PKG}`, {
      signal: ac.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null; // 非 200(404/5xx 等)→ 静默跳过
    const json = await res.json();
    const tags = parseDistTags(json);
    if (!tags) return null;
    return {
      tags,
      releaseNotesByVersion: parseReleaseNotesByVersion(json),
    };
  } catch {
    return null; // AbortError(超时)/ fetch failed(离线)/ JSON 解析失败 → 静默
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 取 npm 上 flower-trellis 的 dist-tags;任何失败(离线/超时/非 200/解析异常)一律
 * 返回 null —— 调用方据此「拿不到就当没这回事」继续主流程。
 *
 * 用 AbortController 给内置 fetch 加超时,finally 清除定时器防句柄泄漏。
 * @returns {Promise<{latest:string|null,beta:string|null}|null>} 可用 dist-tags,或失败时 null
 */
export async function fetchPackageDistTags() {
  const metadata = await fetchPackageUpdateMetadata();
  return metadata?.tags ?? null;
}

/**
 * 取 npm 上 flower-trellis 的 latest 版本号。
 *
 * 保留这个导出是为了兼容已有调用方;新逻辑应优先使用 `fetchPackageUpdateMetadata()`。
 * @returns {Promise<string|null>} latest 版本号,或失败时 null
 */
export async function fetchLatestVersion() {
  const tags = await fetchPackageDistTags();
  return tags?.latest ?? null;
}

/** 同步等待短暂的 registry metadata 收敛窗口。 */
function sleepSync(ms) {
  const signal = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(signal, 0, 0, ms);
}

/** 判断 npm 安装结果是否为发布后 metadata 尚未收敛的 ETARGET。 */
function isEtargetResult(result) {
  return result?.status !== 0 && /\bETARGET\b/.test(String(result?.stderr || ""));
}

/**
 * 安装更新检查已经确认存在的 flower-trellis 精确版本。
 *
 * 使用 `--prefer-online` 避免 npm CLI 复用发布前的旧 packument；若仍遇到 ETARGET，
 * 只等待并重试一次，防止真正的版本错误进入无限循环。其它错误不重试。
 *
 * @param {string} version 已由 registry metadata 确认存在的精确版本
 * @param {{cwd?:string,spawn?:Function,wait?:Function,stderr?:{write:Function},log?:Function,platform?:string}} options 运行参数与测试替身
 * @returns {ReturnType<typeof spawnSync>} 最终一次 npm 安装结果
 */
export function installFlowerVersion(version, options = {}) {
  const spawn = typeof options.spawn === "function" ? options.spawn : spawnSync;
  const wait = typeof options.wait === "function" ? options.wait : sleepSync;
  const stderr = options.stderr?.write ? options.stderr : process.stderr;
  const log = typeof options.log === "function" ? options.log : console.log;
  const platform = typeof options.platform === "string" ? options.platform : process.platform;
  const args = ["i", "-g", `${PKG}@${version}`, "--prefer-online"];
  const run = () => spawn("npm", args, {
    cwd: options.cwd,
    stdio: ["inherit", "inherit", "pipe"],
    encoding: "utf8",
    shell: platform === "win32",
  });

  const first = run();
  if (!isEtargetResult(first)) {
    if (first?.stderr) stderr.write(String(first.stderr));
    return first;
  }

  // Registry 根文档和 npm packument 可能在刚发布后短暂不同步，等待后仅重试一次。
  log("  · npm 版本元数据尚未收敛,1 秒后刷新并重试一次");
  wait(ETARGET_RETRY_DELAY_MS);
  const retried = run();
  if (retried?.stderr) {
    stderr.write(String(retried.stderr));
  } else if (retried?.status !== 0 && first.stderr) {
    stderr.write(String(first.stderr));
  }
  return retried;
}

/**
 * 解析项目需要的轻量 semver 版本号。
 *
 * @param {string} version 版本号
 * @returns {{major:number,minor:number,patch:number,prerelease:string[]}|null} 解析结果
 */
function parseVersion(version) {
  const match = String(version || "")
    .trim()
    .replace(/^v/, "")
    .match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split(".") : [],
  };
}

/**
 * 判断版本号是否为 prerelease。
 *
 * @param {string} version 版本号
 * @returns {boolean}
 */
export function isPrerelease(version) {
  const parsed = parseVersion(version);
  return Boolean(parsed && parsed.prerelease.length);
}

/**
 * 比较 prerelease 标识符数组。
 *
 * 同一 base 下,稳定版高于 prerelease;相同 label(如 beta.1 → beta.2)按数值递增比较。
 * 不同 label 之间不做主观排序,返回 0 以避免把 alpha/rc/beta 的跨线比较误判成升级。
 *
 * @param {string[]} aParts A prerelease 标识符
 * @param {string[]} bParts B prerelease 标识符
 * @returns {-1|0|1}
 */
function comparePrerelease(aParts, bParts) {
  if (!aParts.length && !bParts.length) return 0;
  if (!aParts.length) return 1;
  if (!bParts.length) return -1;
  if (aParts[0] !== bParts[0]) return 0;

  const len = Math.max(aParts.length, bParts.length);
  for (let i = 0; i < len; i++) {
    const a = aParts[i];
    const b = bParts[i];
    if (a === undefined) return -1;
    if (b === undefined) return 1;
    if (a === b) continue;

    const aNum = /^\d+$/.test(a);
    const bNum = /^\d+$/.test(b);
    if (aNum && bNum) {
      const delta = Number(a) - Number(b);
      if (delta !== 0) return delta > 0 ? 1 : -1;
      continue;
    }
    if (aNum !== bNum) return aNum ? -1 : 1;
    return a > b ? 1 : -1;
  }
  return 0;
}

/**
 * 比较两个版本号,返回 1 / 0 / -1(a 比 b 新 / 相同 / 旧)。
 *
 * 支持 `major.minor.patch` 与项目 beta 通道使用的 `major.minor.patch-beta.n`。
 * 不引 `semver` 依赖,因为这里仅服务启动时的轻量升级提示,失败/不认识时宁可不提示。
 * @param {string} a 版本号 A
 * @param {string} b 版本号 B
 * @returns {-1|0|1}
 */
export function compareVersions(a, b) {
  const av = parseVersion(a);
  const bv = parseVersion(b);
  if (!av || !bv) return 0;

  for (const key of ["major", "minor", "patch"]) {
    if (av[key] !== bv[key]) return av[key] > bv[key] ? 1 : -1;
  }
  return comparePrerelease(av.prerelease, bv.prerelease);
}

/**
 * 判断版本是否属于目标更新通道。
 *
 * @param {string} version 版本号
 * @param {"latest"|"beta"|string} channel 目标通道
 * @returns {boolean}
 */
function matchesReleaseNotesChannel(version, channel) {
  if (channel === "beta") return isPrerelease(version);
  return !isPrerelease(version);
}

/**
 * 把单版本发布说明裁剪到注入上限。
 *
 * @param {{body:string,truncated?:boolean}} note 原始版本发布说明
 * @param {number} remainingTotal 总字符剩余额度
 * @returns {{body:string,truncated:boolean,used:number}|null} 裁剪后的发布说明
 */
function limitReleaseNoteBody(note, remainingTotal) {
  if (remainingTotal <= 0) return null;
  let body = String(note.body || "").trim();
  let truncated = note.truncated === true;
  if (!body) return null;
  if (body.length > RELEASE_NOTES_MAX_VERSION_CHARS) {
    body = body.slice(0, RELEASE_NOTES_MAX_VERSION_CHARS).trimEnd();
    truncated = true;
  }
  if (body.length > remainingTotal) {
    body = body.slice(0, remainingTotal).trimEnd();
    truncated = true;
  }
  if (!body) return null;
  return { body, truncated, used: body.length };
}

/**
 * 为 self-check / hook 构造跨版本发布说明摘要。
 *
 * @param {Record<string,{version:string,body:string,truncated:boolean,source:string}>|null|undefined} releaseNotesByVersion 按版本索引的 npm metadata
 * @param {{from:string|null,to:string|null,channel:"latest"|"beta"|string,reason:string}} range 聚合范围
 * @returns {{source:string,range:object,versions:Array<{version:string,body:string,truncated:boolean}>,truncated:boolean,moreVersions:boolean,unavailable:boolean}} 可注入的发布说明摘要
 */
export function buildReleaseNotesSummary(releaseNotesByVersion, range) {
  const summaryRange = {
    from: range?.from ?? null,
    to: range?.to ?? null,
    channel: range?.channel ?? "latest",
    reason: range?.reason ?? null,
  };
  const empty = {
    source: "npm-metadata",
    range: summaryRange,
    versions: [],
    truncated: false,
    moreVersions: false,
    unavailable: true,
  };
  if (!summaryRange.from || !summaryRange.to || !releaseNotesByVersion) return empty;

  const candidates = Object.keys(releaseNotesByVersion)
    .filter((version) => compareVersions(version, summaryRange.from) === 1)
    .filter((version) => compareVersions(version, summaryRange.to) <= 0)
    .filter((version) => matchesReleaseNotesChannel(version, summaryRange.channel))
    .sort(compareVersions);

  if (!candidates.length) return empty;

  const limitedCandidates = candidates.slice(-RELEASE_NOTES_MAX_VERSIONS);
  const versions = [];
  let remainingTotal = RELEASE_NOTES_MAX_TOTAL_CHARS;
  let truncated = false;
  for (const version of limitedCandidates) {
    const limited = limitReleaseNoteBody(releaseNotesByVersion[version], remainingTotal);
    if (!limited) {
      truncated = true;
      break;
    }
    versions.push({
      version,
      body: limited.body,
      truncated: limited.truncated,
    });
    remainingTotal -= limited.used;
    if (limited.truncated) truncated = true;
  }

  const moreVersions =
    candidates.length > limitedCandidates.length ||
    versions.length < limitedCandidates.length;
  return {
    source: "npm-metadata",
    range: summaryRange,
    versions,
    truncated,
    moreVersions,
    unavailable: versions.length === 0,
  };
}

/**
 * 根据当前版本和 npm dist-tags 生成升级推荐。
 *
 * 稳定版只跟随稳定形态的 latest,避免把稳定用户引导到预发布通道;预发布版同时看
 * 稳定形态的 latest / beta,且 latest 高于当前版本时优先推荐 latest,用于 beta 线被
 * 稳定版追上后的回归稳定。
 *
 * @param {string} current 当前安装的 flower-trellis 版本
 * @param {{latest?:string|null,beta?:string|null}|null} tags npm dist-tags
 * @returns {{version:string,tag:"latest"|"beta",command:string}|null} 升级推荐
 */
export function getUpdateRecommendation(current, tags) {
  if (!current || !tags) return null;
  const currentIsPrerelease = isPrerelease(current);
  const latest = typeof tags.latest === "string" ? tags.latest : null;
  const beta = typeof tags.beta === "string" ? tags.beta : null;
  const latestIsStable = latest && !isPrerelease(latest);

  if (latestIsStable && compareVersions(latest, current) === 1) {
    return {
      version: latest,
      tag: "latest",
      command: `npm i -g ${PKG}@${latest} --prefer-online`,
    };
  }
  if (currentIsPrerelease && beta && compareVersions(beta, current) === 1) {
    return {
      version: beta,
      tag: "beta",
      command: `npm i -g ${PKG}@${beta} --prefer-online`,
    };
  }
  return null;
}

/** 尽力而为刷新目标项目的远端探测缓存。 */
function rememberRemoteTags(target, tags, status, releaseNotes = null) {
  try {
    if (!readManifest(target)) return;
    const patch = {
      lastCheckedAt: new Date().toISOString(),
      lastRemote: tags,
      lastStatus: status,
      lastErrorCode: null,
      lastReleaseNotes: null,
    };
    if (releaseNotes && !releaseNotes.unavailable) {
      patch.lastReleaseNotes = releaseNotes;
    }
    writeUpdateCheck(target, patch);
  } catch {
    // 缓存写入只是优化后续启动提示,失败不能影响 init/update 主流程。
  }
}

/**
 * 检测 flower-trellis 自身是否有新版本,并按场景提示/引导升级。在 init / update 的
 * 品牌头部之后、主操作之前调用。
 *
 * 短路条件(任一命中即跳过,什么都不打印):关闭开关(`--no-update-check` 使
 * `ctx.updateCheck===false`,目标 manifest 的 `updateCheck.enabled=false` /
 * `policy=off`,或环境变量 `FLOWER_NO_UPDATE_CHECK` 非空)、经 npx 运行、网络探测失败、
 * 无升级推荐。
 *
 * 发现新版时的行为:
 *  - 交互 TTY:打印通知 → confirm 询问是否升级 → 同意则执行推荐的 npm install 命令;
 *    成功后打印「请重新运行」并 **process.exit(0)**(不做 re-exec 自动重跑),失败则降级为
 *    打印手动升级命令并继续主流程;拒绝则继续主流程。
 *  - 非交互(`-y`/`--yes` 或非 TTY):仅打印通知 + 升级命令,不弹确认、不阻塞。
 *
 * @param {object} ctx cli-args.js parseCliArgs() 产出的上下文(用到 updateCheck / passthrough)
 * @param {string} commandLabel 当前命令名,用于「请重新运行 ft <command>」文案(如 "init"/"update")
 * @returns {Promise<void>} 注意:用户确认升级且成功时本函数会直接退出进程,不返回
 */
export async function checkForUpdate(ctx, commandLabel) {
  // 1. 关闭开关:显式 flag 或环境变量
  if (ctx.updateCheck === false || process.env.FLOWER_NO_UPDATE_CHECK) return;
  const updateCheck = readUpdateCheck(ctx.target);
  if (!updateCheck.enabled || updateCheck.policy === "off") return;
  // 2. npx 本就是最新版,跳过(连通知都不打,避免误导)
  if (isRunningViaNpx(import.meta.url)) return;

  // 3. 尽力而为取 dist-tags;拿不到就静默退出
  const metadata = await fetchPackageUpdateMetadata();
  if (!metadata) return;
  const tags = metadata.tags;

  // 4. 根据本地版本通道生成推荐;无推荐时不打扰
  const current = flowerVersion();
  const recommendation = getUpdateRecommendation(current, tags);
  const releaseNotes = recommendation
    ? buildReleaseNotesSummary(metadata.releaseNotesByVersion, {
        from: current,
        to: recommendation.version,
        channel: recommendation.tag,
        reason: "update_available",
      })
    : null;
  rememberRemoteTags(
    ctx.target,
    tags,
    recommendation ? "update_available" : "up_to_date",
    releaseNotes,
  );
  if (!recommendation) return;

  // 5. 打印发现新版本通知(粉色品牌色,与 banner 一致)
  console.log(
    "\n🌸 " +
      chalk.hex("#ff6fb5")(`发现 flower-trellis 新版本 ${chalk.bold(recommendation.version)}`) +
      chalk.gray(`(当前 ${current}, 通道 ${recommendation.tag})`),
  );

  // 6. 非交互(-y/--yes 或非 TTY):仅打印升级命令,不弹确认、不阻塞
  const nonInteractive =
    ctx.passthrough.includes("-y") ||
    ctx.passthrough.includes("--yes") ||
    !process.stdin.isTTY;
  if (nonInteractive) {
    console.log(`  · 升级:${recommendation.command}`);
    console.log(`  · 升级后请重跑 ft ${commandLabel},让新版强化包重新叠加到现有项目`);
    return;
  }

  // 7. 交互:询问是否升级(@inquirer/confirm,返回 boolean)
  const doUpgrade = await confirm({
    message: `是否现在升级到 ${recommendation.version}(${recommendation.tag})?(升级后需重新运行命令)`,
    default: true,
  });
  if (!doUpgrade) {
    console.log("  · 已跳过升级");
    return;
  }

  // 8. 执行全局升级。失败(含 EACCES 权限问题、npm 不存在)不自行提权,降级为打印手动命令
  const res = installFlowerVersion(recommendation.version);
  if (res.status === 0) {
    console.log(`\n  ✓ 已升级到 ${recommendation.version}(${recommendation.tag})`);
    console.log(`  · 请重新运行 ft ${commandLabel} 以使用新版本`);
    console.log("  · 强化包随版本更新,升级后可 ft update 重新叠加到现有项目");
    // 当前进程内存里仍是旧代码,必须退出由用户重跑新版本(不做 re-exec,规避权限/平台/进程态坑)
    process.exit(0);
  } else {
    console.log(`  · 自动升级失败,请手动运行:${recommendation.command}`);
    // 升级未成功:以当前版本继续 init/update,不阻断
  }
}
