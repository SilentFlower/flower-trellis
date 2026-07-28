import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const SOURCE_CLI = path.resolve("bin/flower-trellis.js");

/**
 * 创建隔离的 CLI 用户环境，避免测试读取真实 HOME、XDG 配置或调试变量。
 *
 * @param {string} root 隔离环境根目录
 * @param {NodeJS.ProcessEnv} [overrides] 额外环境变量
 * @returns {NodeJS.ProcessEnv} 子进程环境
 */
export function createIsolatedFlowerEnv(root, overrides = {}) {
  const {
    DEBUG: _debug,
    FLOWER_DEBUG: _flowerDebug,
    XDG_CONFIG_HOME: _xdgConfig,
    XDG_CACHE_HOME: _xdgCache,
    ...base
  } = process.env;
  const home = path.join(root, "home");
  const config = path.join(root, "config");
  const cache = path.join(root, "cache");
  for (const directory of [home, config, cache]) fs.mkdirSync(directory, { recursive: true });
  return {
    ...base,
    HOME: home,
    XDG_CONFIG_HOME: config,
    XDG_CACHE_HOME: cache,
    FLOWER_NO_UPDATE_CHECK: "1",
    NO_COLOR: "1",
    ...overrides,
  };
}

/**
 * 创建真实 bin/src 的隔离副本，并用临时 mock keyring 支持跨 CLI 进程认证场景。
 *
 * @param {string} root 副本根目录
 * @returns {{cli:string,keyringFile:string}} CLI 与 mock keyring 路径
 */
export function createFlowerCliCopy(root) {
  const packageRoot = path.join(root, "package");
  fs.mkdirSync(packageRoot, { recursive: true });
  fs.cpSync(path.resolve("bin"), path.join(packageRoot, "bin"), { recursive: true });
  fs.cpSync(path.resolve("src"), path.join(packageRoot, "src"), { recursive: true });
  fs.copyFileSync(path.resolve("package.json"), path.join(packageRoot, "package.json"));
  const metadata = JSON.parse(fs.readFileSync(path.resolve("package.json"), "utf8"));
  for (const name of Object.keys(metadata.dependencies)) {
    const parts = name.split("/");
    const target = path.resolve("node_modules", ...parts);
    const destination = path.join(packageRoot, "node_modules", ...parts);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.symlinkSync(target, destination, "dir");
  }
  const keyringRoot = path.join(packageRoot, "node_modules/@napi-rs/keyring");
  fs.mkdirSync(keyringRoot, { recursive: true });
  fs.writeFileSync(path.join(keyringRoot, "package.json"), `${JSON.stringify({
    name: "@napi-rs/keyring",
    version: "0.0.0-e2e",
    type: "module",
    exports: "./index.js",
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(keyringRoot, "index.js"), `import fs from "node:fs";

function readStore() {
  const file = process.env.FLOWER_E2E_KEYRING_FILE;
  if (!file || !fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeStore(value) {
  fs.writeFileSync(process.env.FLOWER_E2E_KEYRING_FILE, JSON.stringify(value));
}

export class Entry {
  constructor(service, account) {
    this.key = service + ":" + account;
  }

  async getPassword() {
    return readStore()[this.key] || null;
  }

  async setPassword(value) {
    writeStore({ ...readStore(), [this.key]: value });
  }

  async deletePassword() {
    const store = readStore();
    if (!(this.key in store)) throw new Error("not found");
    delete store[this.key];
    writeStore(store);
  }
}
`);
  return {
    cli: path.join(packageRoot, "bin/flower-trellis.js"),
    keyringFile: path.join(root, "mock-keyring.json"),
  };
}

/**
 * 通过真实 bin 入口同步执行 flower-trellis。
 *
 * @param {string} project 项目根目录
 * @param {string[]} args CLI 参数
 * @param {{cli?:string,cwd?:string,envRoot?:string,env?:NodeJS.ProcessEnv,timeout?:number,appendTarget?:boolean}} [options] 执行选项
 * @returns {ReturnType<typeof spawnSync>} 子进程结果
 */
export function runFlower(project, args, options = {}) {
  const envRoot = options.envRoot || path.join(path.dirname(project), ".flower-e2e-env");
  const argv = options.appendTarget === false || args.includes("--target")
    ? [...args]
    : [...args, "--target", project];
  return spawnSync(process.execPath, [options.cli || SOURCE_CLI, ...argv], {
    cwd: options.cwd || project,
    encoding: "utf8",
    env: createIsolatedFlowerEnv(envRoot, options.env),
    timeout: options.timeout || 30_000,
  });
}

/**
 * 通过真实 bin 入口异步执行 flower-trellis，供本地 HTTP mock 与子进程并行响应。
 *
 * @param {string} project 项目根目录
 * @param {string[]} args CLI 参数
 * @param {{cli?:string,cwd?:string,envRoot?:string,env?:NodeJS.ProcessEnv,timeout?:number,appendTarget?:boolean}} [options] 执行选项
 * @returns {Promise<{status:number|null,signal:NodeJS.Signals|null,stdout:string,stderr:string}>} 子进程结果
 */
export async function runFlowerAsync(project, args, options = {}) {
  const envRoot = options.envRoot || path.join(path.dirname(project), ".flower-e2e-env");
  const argv = options.appendTarget === false || args.includes("--target")
    ? [...args]
    : [...args, "--target", project];
  const child = spawn(process.execPath, [options.cli || SOURCE_CLI, ...argv], {
    cwd: options.cwd || project,
    env: createIsolatedFlowerEnv(envRoot, options.env),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const timeout = setTimeout(() => child.kill("SIGKILL"), options.timeout || 30_000);
  try {
    const result = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (status, signal) => resolve({ status, signal }));
    });
    return { ...result, stdout, stderr };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * 解析 stdout 中唯一的 JSON 文档。
 *
 * @param {{stdout:string}} result 子进程结果
 * @returns {object} JSON 文档
 */
export function parseFlowerJson(result) {
  return JSON.parse(result.stdout.trim());
}

/**
 * 记录项目文件内容、mtime 与符号链接目标，用于零写入和幂等断言。
 *
 * @param {string} root 项目根目录
 * @returns {Record<string,object>} 稳定文件快照
 */
export function snapshotProjectFiles(root) {
  const snapshot = {};
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name, "en"))) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      const stat = fs.lstatSync(absolute);
      if (entry.isDirectory()) {
        visit(absolute);
      } else if (entry.isSymbolicLink()) {
        snapshot[relative] = { type: "symlink", target: fs.readlinkSync(absolute), mtimeMs: stat.mtimeMs };
      } else {
        snapshot[relative] = {
          type: "file",
          digest: crypto.createHash("sha256").update(fs.readFileSync(absolute)).digest("hex"),
          mtimeMs: stat.mtimeMs,
        };
      }
    }
  };
  visit(root);
  return snapshot;
}

/**
 * 扫描文本中的已知敏感值和常见 GitLab/OAuth 凭据形态。
 *
 * @param {string} text 待扫描文本
 * @param {string[]} [sensitiveValues] 场景内的精确敏感值
 * @returns {string[]} 命中的脱敏标签
 */
export function findSensitiveText(text, sensitiveValues = []) {
  const findings = [];
  sensitiveValues.forEach((value, index) => {
    if (value && text.includes(value)) findings.push(`exact-${index + 1}`);
  });
  const patterns = [
    /\b(?:glpat|gloas|glrt|glcbt)-[A-Za-z0-9_-]{16,}\b/g,
    /\b(?:access_token|refresh_token|device_code)\b["']?\s*[:=]\s*["'][A-Za-z0-9._~-]{16,}["']/gi,
    /\bauthorization\b["']?\s*[:=]\s*["'](?:Bearer|Basic)\s+[A-Za-z0-9._~+/-]{12,}["']/gi,
  ];
  patterns.forEach((pattern, index) => {
    if (pattern.test(text)) findings.push(`pattern-${index + 1}`);
  });
  return findings;
}

/**
 * 递归扫描目录文件，返回包含敏感信息的相对路径和脱敏命中标签。
 *
 * @param {string} root 扫描根目录
 * @param {string[]} [sensitiveValues] 场景内的精确敏感值
 * @returns {Array<{path:string,findings:string[]}>} 扫描结果
 */
export function scanSensitiveFiles(root, sensitiveValues = []) {
  const matches = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolute);
      } else if (entry.isFile()) {
        const findings = findSensitiveText(fs.readFileSync(absolute).toString("utf8"), sensitiveValues);
        if (findings.length > 0) {
          matches.push({ path: path.relative(root, absolute).split(path.sep).join("/"), findings });
        }
      }
    }
  };
  visit(root);
  return matches.sort((left, right) => left.path.localeCompare(right.path, "en"));
}
