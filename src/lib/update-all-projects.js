import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const SKIP_DIRECTORIES = new Set([".git", ".trellis", ".flower", "node_modules"]);
const INACTIVE_TASK_STATUSES = new Set(["planning", "completed", "done"]);

/** 判断目录是否已有 Flower 安装记录。 */
function isFlowerProject(directory) {
  const trellis = path.join(directory, ".trellis");
  const hasLock = fs.existsSync(path.join(directory, ".flower", "plugin-lock.json"));
  const hasManifest = fs.existsSync(path.join(trellis, ".flower-manifest.json"));
  if (!hasLock && !hasManifest) return false;
  try {
    const stat = fs.lstatSync(trellis);
    if (stat.isSymbolicLink()) throw new Error(".trellis 是软链接");
    return stat.isDirectory();
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

/** 把用户输入解析为真实目录，避免重复路径与符号链接循环。 */
function resolveDirectory(input) {
  if (!input) return { directory: null, reason: "缺少目录路径" };
  try {
    const directory = fs.realpathSync(path.resolve(input));
    if (!fs.statSync(directory).isDirectory()) {
      return { directory: null, reason: "目标不是目录" };
    }
    return { directory, reason: null };
  } catch (error) {
    return { directory: null, reason: `无法读取目录(${error.code || error.message})` };
  }
}

/**
 * 在显式根目录与目标路径中发现 Flower 项目。
 * @param {string[]} roots 允许扫描的父目录
 * @param {string[]} targets 显式项目目录
 * @returns {{projects:string[],errors:Array<{target:string,reason:string}>}} 去重项目与输入错误
 */
export function discoverFlowerProjects(roots, targets) {
  const projects = new Set();
  const errors = [];

  for (const input of targets) {
    const { directory, reason } = resolveDirectory(input);
    if (!directory) {
      errors.push({ target: input || "--target", reason });
      continue;
    }
    try {
      if (isFlowerProject(directory)) projects.add(directory);
      else errors.push({ target: input, reason: "目标不是已安装 Flower 项目" });
    } catch (error) {
      errors.push({ target: input, reason: `无法读取安装记录(${error.code || error.message})` });
    }
  }

  for (const input of roots) {
    const { directory, reason } = resolveDirectory(input);
    if (!directory) {
      errors.push({ target: input || "--root", reason });
      continue;
    }
    const stack = [directory];
    while (stack.length) {
      const current = stack.pop();
      try {
        if (isFlowerProject(current)) projects.add(current);
      } catch (error) {
        errors.push({ target: current, reason: `无法读取安装记录(${error.code || error.message})` });
      }
      try {
        const entries = fs.readdirSync(current, { withFileTypes: true })
          .filter((entry) => entry.isDirectory() && !SKIP_DIRECTORIES.has(entry.name))
          .sort((a, b) => b.name.localeCompare(a.name));
        for (const entry of entries) stack.push(path.join(current, entry.name));
      } catch (error) {
        errors.push({ target: current, reason: `无法扫描目录(${error.code || error.message})` });
      }
    }
  }

  return { projects: [...projects].sort(), errors };
}

/**
 * 读取项目所属 Git 根，用于共享写入前的安全检查。
 * @param {string} target Flower 项目目录
 * @returns {string|null} Git 根真实路径；无法读取时返回 null
 */
export function gitRepositoryRoot(target) {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: target,
    encoding: "utf8",
    shell: process.platform === "win32",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 1500,
  });
  if (result.error || result.status !== 0) return null;
  try {
    return fs.realpathSync(String(result.stdout || "").trim());
  } catch {
    return null;
  }
}

/**
 * 严格检查批量更新目标的任务状态；不可读状态不能等同于没有活动任务。
 * @param {string} target Flower 项目目录
 * @returns {{safe:boolean,reason:string|null}} 是否允许进入更新队列
 */
export function projectTaskSafety(target) {
  const tasksDir = path.join(target, ".trellis", "tasks");
  let rootStat;
  try {
    rootStat = fs.lstatSync(tasksDir);
  } catch (error) {
    return error.code === "ENOENT"
      ? { safe: true, reason: null }
      : { safe: false, reason: `无法读取任务目录(${error.code || error.message})` };
  }
  if (!rootStat.isDirectory()) return { safe: false, reason: "任务目录不是普通目录" };

  const stack = [tasksDir];
  while (stack.length) {
    const directory = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch (error) {
      return { safe: false, reason: `无法读取任务目录(${error.code || error.message})` };
    }
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) return { safe: false, reason: `任务目录含软链接:${path.relative(target, absolute)}` };
      if (entry.isDirectory()) {
        stack.push(absolute);
        continue;
      }
      if (entry.name !== "task.json") continue;
      if (!entry.isFile()) return { safe: false, reason: `任务记录不是普通文件:${path.relative(target, absolute)}` };
      try {
        const data = JSON.parse(fs.readFileSync(absolute, "utf8"));
        if (data?.status === "in_progress" || data?.status === "active") {
          return { safe: false, reason: "存在活动 Trellis 任务" };
        }
        if (!INACTIVE_TASK_STATUSES.has(data?.status)) {
          return { safe: false, reason: `任务记录状态无法确认:${path.relative(target, absolute)}` };
        }
      } catch (error) {
        return { safe: false, reason: `任务记录损坏或不可读:${path.relative(target, absolute)} (${error.code || error.message})` };
      }
    }
  }
  return { safe: true, reason: null };
}
