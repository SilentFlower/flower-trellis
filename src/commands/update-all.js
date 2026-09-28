import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { hasHelpFlag } from "../lib/cli-args.js";
import { gitSafety } from "../lib/self-check.js";
import { readProjectVersions } from "../lib/telemetry-context.js";
import {
  compareVersions,
  fetchPackageDistTags,
  getUpdateRecommendation,
  installFlowerVersion,
} from "../lib/update-check.js";
import { ProjectStore } from "../plugin/state/project-store.js";
import { discoverFlowerProjects, gitRepositoryRoot, projectTaskSafety } from "../lib/update-all-projects.js";
import { flowerVersion, trellisVersion } from "../lib/versions.js";

/** 打印批量更新命令帮助。 */
function printUpdateAllHelp() {
  console.log(`flower-trellis update-all — 批量更新多个 Flower 项目

用法:
  flower-trellis update-all --root <dir> [--root <dir>...] --dry-run
  flower-trellis update-all --target <dir> [--target <dir>...] --yes
  flower-trellis update-all --root <dir> --target <dir> --yes

选项:
  --root <dir>       扫描指定父目录，可重复
  --target <dir>     指定已安装 Flower 的项目，可重复
  --dry-run          只读预览，不安装 CLI 或修改项目与缓存
  -y, --yes          确认真实更新
  --no-update-check  不查询远端，仅追平已安装的 Flower/Trellis 版本

脏 Git 工作区、活动任务和版本证据缺失的项目会跳过；有跳过或失败时退出码为 1。
远端无法确认时仅使用本机版本。项目更新后需分别确认 Git 变更，本命令不提交或推送。`);
}

/** 定位 npm 全局安装的入口，保证后续子进程确实使用安装后的包。 */
function installedCliScript() {
  const result = spawnSync("npm", ["root", "-g"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
  });
  if (result.error || result.status !== 0) {
    throw new Error(`无法定位 npm 全局目录(${result.error?.message || result.stderr?.trim() || `退出码 ${result.status ?? 1}`})`);
  }
  const script = path.join(String(result.stdout).trim(), "flower-trellis", "bin", "flower-trellis.js");
  if (!fs.existsSync(script)) throw new Error(`全局 Flower CLI 不存在: ${script}`);
  return script;
}

/** 通过 Node 参数数组启动已安装 CLI，路径不交给 shell 拼接。 */
function runInstalledCli(script, args, options = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: options.cwd,
    env: { ...process.env, FLOWER_NO_UPDATE_CHECK: "1", ...options.env },
    encoding: options.capture ? "utf8" : undefined,
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
}

/** 从新进程读取实际 CLI 版本，避免全局安装后继续信任旧模块缓存。 */
function inspectInstalledCli() {
  const script = installedCliScript();
  const packageRoot = path.dirname(path.dirname(script));
  const result = runInstalledCli(script, ["self-check", "--json", "--target", packageRoot, "--no-update-check"], {
    cwd: packageRoot,
    capture: true,
    env: { FLOWER_NO_TELEMETRY: "1" },
  });
  if (result.error || result.status !== 0) {
    throw new Error(`已安装 CLI 版本核对失败(${result.error?.message || result.stderr?.trim() || `退出码 ${result.status ?? 1}`})`);
  }
  try {
    const current = JSON.parse(result.stdout).current;
    if (!current?.flowerVersion || !current?.bundledTrellisVersion) throw new Error("缺少版本字段");
    return { flower: current.flowerVersion, trellis: current.bundledTrellisVersion, script };
  } catch (error) {
    throw new Error(`已安装 CLI 版本结果无效(${error.message})`);
  }
}

/** 使用已安装 CLI 完整更新一个项目。 */
function runProjectUpdate(target, installed) {
  return runInstalledCli(installed.script, ["update", "--target", target, "--no-update-check", "--force", "-y"], { cwd: target });
}

/** 将子进程失败转换为可读原因。 */
function processFailure(result) {
  return result?.error?.message || `退出码 ${result?.status ?? 1}`;
}

/** 防止把已安装版本较新的项目降级，或把无法比较的版本误判为相同。 */
function versionBlockReason(project, desired) {
  for (const key of ["flower", "trellis"]) {
    const relation = compareVersions(project[key], desired[key]);
    if (relation === 1) return `${key} 项目版本高于目标版本(${project[key]} > ${desired[key]})`;
    if (relation === 0 && project[key] !== desired[key]) {
      return `${key} 版本无法比较(${project[key]} / ${desired[key]})`;
    }
  }
  return null;
}

/** 校验现代 Plugin 状态后读取项目版本，避免旧 manifest 掩盖损坏状态。 */
function readValidatedProjectVersions(target) {
  const store = new ProjectStore(target);
  store.readLock();
  store.readState();
  return readProjectVersions(target);
}

/** 输出逐项目状态和计数；结果块供 AI 接续独立 Git 确认。 */
function printResult(rows, options, log) {
  const labels = {
    planned: "待更新",
    updated: "已更新",
    up_to_date: "已是最新版",
    skipped: "跳过",
    failed: "失败",
  };
  for (const row of rows) {
    const prefix = row.status === "updated" ? "  ✓ " : "  · ";
    log(`${prefix}${labels[row.status]}: ${row.target}${row.reason ? ` (${row.reason})` : ""}`);
  }
  const counts = Object.fromEntries(Object.keys(labels).map((status) => [status, rows.filter((row) => row.status === status).length]));
  log(`  · 汇总: 待更新 ${counts.planned}，已更新 ${counts.updated}，已是最新版 ${counts.up_to_date}，跳过 ${counts.skipped}，失败 ${counts.failed}`);
  if (options.dryRun) {
    log("  · 写入:否");
    return;
  }
  const attempted = rows.filter((row) => row.attempted);
  if (attempted.length > 0) {
    log("<flower-update-result>");
    log(`status: ${counts.failed || counts.skipped ? "partial" : "completed"}`);
    log(`updated_targets: ${JSON.stringify(rows.filter((row) => row.status === "updated").map((row) => row.target))}`);
    log(`attempted_targets: ${JSON.stringify(attempted.map((row) => row.target))}`);
    log("post_action: run_trellis_push_confirmation");
    log("ai_instruction: 各项目按所属 Git 仓库分别加载并遵循 trellis-push，展示精确文件范围和提交信息，等待确认；不要自动提交或推送。");
    log("</flower-update-result>");
  }
}

/**
 * 批量更新显式指定或在根目录发现的 Flower 项目。
 * @param {object} ctx CLI 解析上下文
 * @param {{fetchTags?:Function,install?:Function,inspectCli?:Function,updateProject?:Function,log?:Function}} [options] 测试替身
 * @returns {Promise<number>} 0 表示全部完成，1 表示存在未完成项目
 */
export async function updateAll(ctx, options = {}) {
  if (hasHelpFlag(ctx.passthrough)) {
    printUpdateAllHelp();
    return 0;
  }
  const flags = ctx.passthrough;
  const unknown = flags.filter((arg) => !["--dry-run", "--yes", "-y"].includes(arg));
  if (unknown.length || ctx.forwarded?.length) {
    throw new Error(`update-all 不支持参数: ${[...unknown, ...(ctx.forwarded || [])].join(" ")}`);
  }
  const dryRun = flags.includes("--dry-run");
  if (!dryRun && !flags.includes("--yes") && !flags.includes("-y")) {
    throw new Error("update-all 执行写入前需要 --yes；如需预览请使用 --dry-run");
  }
  if (!ctx.roots.length && !ctx.targets.length) {
    throw new Error("update-all 至少需要一个 --root 或 --target");
  }

  const log = options.log || console.log;
  const { projects, errors } = discoverFlowerProjects(ctx.roots, ctx.targets);
  const rows = errors.map(({ target, reason }) => ({ target, status: "failed", reason }));
  if (!projects.length && !errors.length) {
    rows.push({ target: ctx.roots.join(", "), status: "failed", reason: "未发现已安装 Flower 的项目" });
  }
  const gitChecks = new Map();
  for (const target of projects) {
    const gitRoot = gitRepositoryRoot(target);
    if (!gitRoot) {
      rows.push({ target, status: "skipped", reason: "不是 Git 工作区" });
      continue;
    }
    if (!gitChecks.has(gitRoot)) gitChecks.set(gitRoot, gitSafety(gitRoot));
    const git = gitChecks.get(gitRoot);
    if (!git.clean) {
      rows.push({ target, status: "skipped", reason: git.reason === "dirty_worktree" ? `Git 工作区有 ${git.dirtyCount} 项变动` : `Git 检查失败(${git.reason})` });
      continue;
    }
    const taskSafety = projectTaskSafety(target);
    if (!taskSafety.safe) {
      rows.push({ target, status: "skipped", reason: taskSafety.reason });
      continue;
    }
    try {
      const version = readValidatedProjectVersions(target);
      if (!version.flower || !version.trellis) {
        rows.push({ target, status: "skipped", reason: "Flower/Trellis 项目版本证据缺失" });
        continue;
      }
      rows.push({ target, status: "candidate", version });
    } catch (error) {
      rows.push({ target, status: "skipped", reason: `读取项目版本失败(${error.message})` });
    }
  }

  const local = { flower: flowerVersion(), trellis: trellisVersion() };
  let tags = null;
  if (projects.length && ctx.updateCheck !== false && !process.env.FLOWER_NO_UPDATE_CHECK) {
    try {
      tags = await (options.fetchTags || fetchPackageDistTags)();
    } catch {
      tags = null;
    }
  }
  const recommendation = getUpdateRecommendation(local.flower, tags);
  const desiredFlower = recommendation?.version || local.flower;
  log(`update-all ${dryRun ? "dry-run" : "执行"}:`);
  log(`  · 远端版本: ${tags ? `已确认(${recommendation ? recommendation.version : "无更新"})` : "未确认，仅使用本机版本"}`);
  log(`  · 目标 Flower: ${desiredFlower}`);
  log(`  · 目标 Trellis: ${recommendation ? "安装新版 CLI 后核对" : local.trellis}`);
  if (recommendation) log(`  · 全局升级: ${recommendation.command}`);

  for (const row of rows) {
    if (row.status !== "candidate") continue;
    const reason = versionBlockReason(row.version, { flower: desiredFlower, trellis: recommendation ? row.version.trellis : local.trellis });
    if (reason) {
      row.status = "skipped";
      row.reason = reason;
    } else if (recommendation || row.version.flower !== local.flower || row.version.trellis !== local.trellis) {
      row.status = "planned";
    } else {
      row.status = "up_to_date";
    }
  }

  if (!dryRun && rows.some((row) => row.status === "planned")) {
    let installed = local;
    const firstPlanned = rows.find((row) => row.status === "planned").target;
    try {
      if (recommendation) {
        log("  · 正在安装 Flower 新版本");
        const result = (options.install || installFlowerVersion)(recommendation.version, { cwd: firstPlanned });
        if (result?.status !== 0) throw new Error(`全局安装失败(${processFailure(result)})`);
      }
      installed = (options.inspectCli || inspectInstalledCli)();
      if (installed.flower !== desiredFlower || !installed.trellis || installed.trellis === "(未安装)") {
        throw new Error(`已安装 CLI 版本不符(Flower ${installed.flower || "unknown"}，Trellis ${installed.trellis || "unknown"})`);
      }
    } catch (error) {
      for (const row of rows) {
        if (row.status === "planned") {
          row.status = "failed";
          row.reason = error.message;
        }
      }
      printResult(rows, { dryRun }, log);
      return 1;
    }

    for (const row of rows) {
      if (row.status !== "planned") continue;
      const reason = versionBlockReason(row.version, installed);
      if (reason) {
        row.status = "skipped";
        row.reason = reason;
        continue;
      }
      if (row.version.flower === installed.flower && row.version.trellis === installed.trellis) {
        row.status = "up_to_date";
        continue;
      }
      log(`  · 正在更新: ${row.target}`);
      row.attempted = true;
      try {
        const result = (options.updateProject || runProjectUpdate)(row.target, installed);
        if (result?.status !== 0) throw new Error(processFailure(result));
        const actual = readValidatedProjectVersions(row.target);
        if (actual.flower !== installed.flower || actual.trellis !== installed.trellis) {
          throw new Error(`更新后版本未追平(Flower ${actual.flower || "unknown"}，Trellis ${actual.trellis || "unknown"})`);
        }
        row.status = "updated";
      } catch (error) {
        row.status = "failed";
        row.reason = `项目更新失败(${error.message})`;
      }
    }
  }

  printResult(rows, { dryRun }, log);
  return rows.some((row) => row.status === "failed" || row.status === "skipped") || projects.length === 0 ? 1 : 0;
}
