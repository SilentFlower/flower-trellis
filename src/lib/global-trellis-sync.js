import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isRunningViaNpx } from "./runtime-env.js";
import { trellisVersion } from "./versions.js";

/** 全局同步的目标包名。 */
const TRELLIS_PACKAGE = "@mindfoldhq/trellis";

/** 可被本项目识别的 semver 字符串。 */
const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/**
 * 生成用于手动修复的全局 Trellis 安装命令。
 *
 * @param {string} version 目标 Trellis 版本
 * @returns {string} 可直接复制执行的 npm 命令
 */
export function globalTrellisInstallCommand(version) {
  return `npm install -g ${TRELLIS_PACKAGE}@${version}`;
}

/**
 * 读取 flower-trellis 当前捆绑的 Trellis 版本。
 *
 * @returns {string} 捆绑 Trellis 版本
 */
export function bundledTrellisVersion() {
  const version = trellisVersion();
  if (!VERSION_RE.test(version)) {
    throw new Error("无法读取捆绑 Trellis 版本,请确认 @mindfoldhq/trellis 依赖已正确安装");
  }
  return version;
}

/**
 * 从 trellis --version 的输出中提取最后一个版本号。
 *
 * 旧版 trellis 在项目内执行 --version 时可能先打印项目版本警告,最后一行才是 CLI 版本;
 * 因此这里取最后一个 semver 片段,避免把警告里的项目版本误判成全局 CLI 版本。
 *
 * @param {string} output 命令 stdout / stderr 文本
 * @returns {string|null} 解析出的版本号,无可识别版本时返回 null
 */
export function extractLastVersion(output) {
  const matches = String(output || "").match(/\b\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?\b/g);
  return matches ? matches[matches.length - 1] : null;
}

/**
 * 读取当前 npm 全局 prefix。
 *
 * npm 生命周期脚本和 `npm install -g --prefix <dir>` 会通过环境变量传递目标 prefix;
 * 优先读环境变量,可避免再起 npm 子进程时被外层 shell 配置影响。
 *
 * @returns {string|null} npm 全局 prefix,不可读取时返回 null
 */
export function npmGlobalPrefix() {
  const envPrefix = process.env.npm_config_prefix || process.env.NPM_CONFIG_PREFIX;
  if (envPrefix) return envPrefix;

  const res = spawnSync("npm", ["prefix", "-g"], {
    encoding: "utf8",
    shell: process.platform === "win32",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (res.error || res.status !== 0) return null;
  const prefix = String(res.stdout || "").trim();
  return prefix || null;
}

/**
 * 计算 npm 全局 prefix 下的 trellis 可执行文件路径。
 *
 * @param {string|null} prefix npm 全局 prefix
 * @returns {string|null} 可执行文件路径,不可推导或文件不存在时返回 null
 */
export function trellisBinInPrefix(prefix) {
  if (!prefix) return null;
  const candidates =
    process.platform === "win32"
      ? ["trellis.cmd", "trellis.ps1", "trellis"].map((name) => path.join(prefix, name))
      : [path.join(prefix, "bin", "trellis")];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

/**
 * 读取 PATH 上当前全局 trellis 命令的版本。
 *
 * @param {string} cwd 执行目录
 * @param {string} command trellis 命令或绝对路径
 * @returns {string|null} 全局 trellis 版本;命令不存在或输出不可解析时返回 null
 */
export function globalTrellisVersion(cwd = os.tmpdir(), command = "trellis") {
  const res = spawnSync(command, ["--version"], {
    cwd,
    encoding: "utf8",
    shell: process.platform === "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (res.error || res.status !== 0) return null;
  return extractLastVersion(`${res.stdout || ""}\n${res.stderr || ""}`);
}

/**
 * 同步本机全局 Trellis 到 flower-trellis 捆绑版本。
 *
 * @param {object} [opts] 运行选项
 * @param {{log:(message:string)=>void}} [opts.logger] 输出对象,默认使用 console
 * @param {string} [opts.cwd] 执行目录,默认当前目录
 * @param {"inherit"|"ignore"} [opts.stdio] npm 安装子进程输出模式
 * @returns {{targetVersion:string,currentVersion:string|null,installed:boolean,skipped:boolean,command:string}} 同步结果
 */
export function syncGlobalTrellis(opts = {}) {
  const logger = opts.logger || console;
  const cwd = opts.cwd || process.cwd();
  const targetVersion = bundledTrellisVersion();
  const command = globalTrellisInstallCommand(targetVersion);

  if (isRunningViaNpx(import.meta.url)) {
    logger.log("  · npx 临时运行:跳过全局 Trellis 同步");
    return {
      targetVersion,
      currentVersion: null,
      installed: false,
      skipped: true,
      command,
    };
  }

  const prefix = npmGlobalPrefix();
  const prefixBin = trellisBinInPrefix(prefix);
  const currentVersion = prefixBin ? globalTrellisVersion(os.tmpdir(), prefixBin) : null;
  if (currentVersion === targetVersion) {
    logger.log(`  ✓ 全局 Trellis 已是 ${targetVersion}`);
    return {
      targetVersion,
      currentVersion,
      installed: false,
      skipped: false,
      command,
    };
  }

  if (currentVersion) {
    logger.log(`  · 同步全局 Trellis:${currentVersion} → ${targetVersion}`);
  } else {
    logger.log(`  · 安装全局 Trellis:${targetVersion}`);
  }

  const res = spawnSync("npm", ["install", "-g", `${TRELLIS_PACKAGE}@${targetVersion}`], {
    cwd,
    stdio: opts.stdio || "inherit",
    shell: process.platform === "win32",
  });

  if (res.status !== 0) {
    const reason = res.error ? res.error.message : `退出码 ${res.status ?? 1}`;
    throw new Error(`全局 Trellis 同步失败(${reason});请手动运行:${command}`);
  }

  logger.log(`  ✓ 全局 Trellis 已同步到 ${targetVersion}`);
  return {
    targetVersion,
    currentVersion,
    installed: true,
    skipped: false,
    command,
  };
}
