import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import semver from "semver";
import { REQUIRED_IGNORE_RULES } from "../plugin/state/project-store.js";
import { validatePluginsFile, validatePluginLock, validatePluginState } from "../plugin/schemas/project-files.js";
import { assertSafePosixRelativePath } from "../plugin/schemas/shared.js";
import { stringifyCanonicalJson } from "../plugin/integrity/canonical-json.js";
import { classifyLockReachability } from "../plugin/lock-reachability.js";
import { contentSelectionsEqual } from "../plugin/content-selection.js";
import { hashContent, hashDirectoryIfExists } from "../plugin/install/content-hash.js";
import { assertPluginStateMatches } from "../plugin/install/state-validation.js";
import { normalizeUpdateCheckPolicy } from "./manifest.js";

const RECORDS = ["plugins.json", "plugin-lock.json", "state.json"];
const FILES = [...RECORDS, "settings.json"];

/** 构造含稳定原因和路径的继承错误。 */
function failure(reason, message, relative = null) {
  return Object.assign(new Error(message), { reason, path: relative });
}

/** 校验完整路径链，拒绝祖先目录和末级软链接。 */
function ordinaryPath(root, relative) {
  assertSafePosixRelativePath(relative, "worktree Flower 路径");
  const parts = relative.split("/");
  let current = path.resolve(root);
  for (let index = -1; index < parts.length; index += 1) {
    if (index >= 0) current = path.join(current, parts[index]);
    try {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink() || (index < parts.length - 1 && !stat.isDirectory())) {
        throw failure("flower-path-conflict", `Flower 路径不能包含软链或非目录:${relative}`, relative);
      }
    } catch (error) {
      if (error.code === "ENOENT") break;
      throw error;
    }
  }
  return path.join(root, ...parts);
}

/** 只读普通文件，缺失与损坏分开处理。 */
function readText(root, relative) {
  const file = ordinaryPath(root, relative);
  try {
    if (!fs.lstatSync(file).isFile()) throw failure("flower-path-conflict", `Flower 记录必须是普通文件:${relative}`, relative);
    return fs.readFileSync(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

/** 执行只读 Git 查询，失败不能解释为缺少安装记录。 */
function git(root, args) {
  const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8", timeout: 10000 });
  if (result.error || result.status !== 0) throw failure("flower-git-error", `无法查询 Flower 所属 Git 仓库:${result.error?.message || result.stderr}`);
  return result.stdout;
}

/** 从目标 base commit 读取普通 blob，不创建临时 checkout。 */
function readBaseText(source, commit, relative) {
  const parts = relative.split("/");
  for (let length = 1; length <= parts.length; length += 1) {
    const entry = git(source, ["ls-tree", "-z", commit, "--", parts.slice(0, length).join("/")]);
    if (!entry) return null;
    const mode = entry.slice(0, 6);
    if ((length < parts.length && mode !== "040000") || (length === parts.length && !["100644", "100755"].includes(mode))) {
      throw failure("flower-path-conflict", `base 中的 Flower 路径不是普通文件:${relative}`, relative);
    }
  }
  return git(source, ["show", `${commit}:${relative}`]);
}

/** 读取白名单记录及其原始字节；用于指纹检测未提交记录变化。 */
function snapshot(root, source, baseCommit) {
  const read = baseCommit ? (relative) => readBaseText(source, baseCommit, relative) : (relative) => readText(root, relative);
  const texts = Object.fromEntries(FILES.map((name) => [name, read(`.flower/${name}`)]));
  if (read(".flower/trellis-control.json") !== null) throw failure("flower-control-active", "Flower 来源或目标处于禁用/恢复状态，不能继承安装记录", ".flower/trellis-control.json");
  const values = {};
  for (const [name, text] of Object.entries(texts)) {
    if (text === null) { values[name] = null; continue; }
    try {
      values[name] = JSON.parse(text);
    } catch {
      throw failure("flower-record-invalid", `Flower 安装状态 JSON 损坏:.flower/${name}`, `.flower/${name}`);
    }
  }
  for (const [name, validate] of [["plugins.json", validatePluginsFile], ["plugin-lock.json", validatePluginLock], ["state.json", validatePluginState]]) {
    if (texts[name] !== null) validate(values[name]);
  }
  if (texts["settings.json"] !== null) {
    const settings = values["settings.json"];
    if (!settings || settings.schemaVersion !== 1 || !settings.updateCheck || typeof settings.updateCheck !== "object" || Array.isArray(settings.updateCheck)) {
      throw failure("flower-settings-invalid", "Flower settings 结构无效", ".flower/settings.json");
    }
  }
  return { texts, values };
}

/** 验证完整安装集合及可选的当前内容，不访问包缓存或远端。 */
function validateInstallation(root, values, content = true) {
  const declarations = values["plugins.json"].plugins;
  const lock = values["plugin-lock.json"];
  const state = values["state.json"];
  const equalIds = (left, right) => JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
  const reachability = classifyLockReachability(declarations, lock);
  if (!equalIds(declarations.map(({ id }) => id), lock.roots) || reachability.missingIds.size || reachability.orphanIds.size ||
      !equalIds(lock.plugins.map(({ id }) => id), state.plugins.map(({ id }) => id))) {
    throw failure("flower-installation-conflict", "Flower 声明、lock 与 state 的插件集合冲突", ".flower/state.json");
  }
  for (const locked of lock.plugins) {
    const applied = state.plugins.find(({ id }) => id === locked.id);
    const declaration = declarations.find(({ id }) => id === locked.id);
    if (applied.version !== locked.version || !contentSelectionsEqual(applied.contentSelection, locked.contentSelection) ||
        (declaration && (!semver.satisfies(locked.version, declaration.version) ||
          !contentSelectionsEqual(declaration.contentSelection, locked.contentSelection) ||
          (declaration.platforms?.length && !equalIds(declaration.platforms, applied.platforms))))) {
      throw failure("flower-installation-conflict", `Flower 安装约束冲突:${locked.id}`, ".flower/state.json");
    }
    for (const [id, range] of Object.entries(locked.dependencies)) {
      if (!semver.satisfies(lock.plugins.find((entry) => entry.id === id).version, range)) {
        throw failure("flower-installation-conflict", `Flower 依赖版本冲突:${id}`, ".flower/plugin-lock.json");
      }
    }
    if (!content) continue;
    if (locked.compatibility.trellis) {
      const version = readText(root, ".trellis/.version")?.trim();
      if (!version || !semver.satisfies(version, locked.compatibility.trellis)) {
        throw failure("flower-trellis-incompatible", `目标 Trellis 版本不满足 Plugin 兼容范围:${locked.id}`, ".trellis/.version");
      }
    }
    for (const relative of [...applied.paths.map((entry) => entry.path), ...applied.patches.map((entry) => entry.target)]) ordinaryPath(root, relative);
    assertPluginStateMatches(root, locked, applied);
    if (locked.source.type === "local") {
      const local = ordinaryPath(root, locked.source.reference);
      if (hashDirectoryIfExists(local) === null) throw failure("flower-local-source-missing", `目标缺少本地 Plugin 来源:${locked.source.reference}`, locked.source.reference);
    }
  }
}

/** 构造内部载荷和公开计划，完整目标校验在真实 checkout 后执行。 */
function transfer(input) {
  const { source, target, baseCommit = null, sourceDeveloper = null, targetDeveloper = null } = input;
  if (!baseCommit) {
    const sourceCommon = fs.realpathSync(git(source, ["rev-parse", "--path-format=absolute", "--git-common-dir"]).trim());
    const targetCommon = fs.realpathSync(git(target, ["rev-parse", "--path-format=absolute", "--git-common-dir"]).trim());
    if (sourceCommon !== targetCommon) throw failure("flower-repository-mismatch", "Flower 来源与目标必须属于同一 Git 仓库");
  }
  const destination = snapshot(target, source, baseCommit);
  const complete = RECORDS.every((name) => destination.values[name] !== null);
  const origin = complete ? null : snapshot(source);
  const digest = hashContent(stringifyCanonicalJson({ source: path.resolve(source), target: path.resolve(target), sourceDeveloper, targetDeveloper, origin: origin?.texts || null, destination: destination.texts }));
  const plan = { action: "preserved", source: complete ? null : source, paths: [], digest, validationPending: Boolean(baseCommit), reason: null };
  if (complete) {
    validateInstallation(target, destination.values, !baseCommit);
    return { plan, files: [] };
  }
  if (RECORDS.some((name) => origin.values[name] === null)) {
    return { plan: { ...plan, action: "unavailable", reason: "source-installation-missing" }, files: [] };
  }
  validateInstallation(source, origin.values);
  for (const name of RECORDS) {
    if (destination.values[name] !== null && stringifyCanonicalJson(destination.values[name]) !== stringifyCanonicalJson(origin.values[name])) {
      throw failure("flower-installation-conflict", `目标已有 Flower 记录与来源冲突:.flower/${name}`, `.flower/${name}`);
    }
  }
  validateInstallation(target, origin.values, !baseCommit);
  if (!baseCommit) {
    for (const locked of origin.values["plugin-lock.json"].plugins.filter((entry) => entry.source.type === "local")) {
      const relative = locked.source.reference;
      if (hashDirectoryIfExists(ordinaryPath(source, relative)) !== hashDirectoryIfExists(ordinaryPath(target, relative))) {
        throw failure("flower-local-source-conflict", `本地 Plugin 来源内容冲突:${relative}`, relative);
      }
    }
  }
  const files = RECORDS.filter((name) => destination.texts[name] === null).map((name) => ({ path: `.flower/${name}`, content: stringifyCanonicalJson(origin.values[name]) }));
  if (destination.texts["settings.json"] === null && origin.values["settings.json"] && sourceDeveloper && sourceDeveloper === targetDeveloper) {
    files.unshift({ path: ".flower/settings.json", content: stringifyCanonicalJson({ schemaVersion: 1, updateCheck: normalizeUpdateCheckPolicy(origin.values["settings.json"].updateCheck) }) });
  }
  const ignore = baseCommit ? readBaseText(source, baseCommit, ".flower/.gitignore") : readText(target, ".flower/.gitignore");
  if (!baseCommit && ignore !== null && destination.texts["state.json"] === null) {
    const ignored = spawnSync("git", ["-C", target, "check-ignore", "--no-index", "-q", ".flower/state.json"], { timeout: 10000 });
    if (ignored.error || ignored.status !== 0) throw failure("flower-ignore-conflict", "现有忽略规则未覆盖 .flower/state.json，请先完善目标忽略规则", ".flower/.gitignore");
  }
  if (ignore === null) files.unshift({ path: ".flower/.gitignore", content: `${REQUIRED_IGNORE_RULES.join("\n")}\n` });
  return { plan: { ...plan, action: "inherited", paths: files.map((file) => file.path), digest: hashContent(`${digest}\n${ignore ?? ""}`) }, files };
}

/**
 * 只读计算同仓 worktree 的 Flower 继承计划。
 * @param {object} input 来源、目标、可选 baseCommit 及开发者身份
 * @returns {object} 不含配置原文的继承计划
 */
export function planFlowerTransfer(input) {
  return transfer(input).plan;
}

/** 将回执原子存入 engine 提供的项目外临时文件，支持子进程失败后恢复。 */
function saveReceipt(journal, receipt) {
  if (!journal) return;
  const temporary = `${journal}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(receipt), { mode: 0o600 });
  fs.renameSync(temporary, journal);
}

/**
 * 仅清理回执中仍为本操作所创建且未被修改的文件。
 * @param {string} target 目标根
 * @param {object} receipt 本次写入回执
 * @returns {void}
 */
export function rollbackFlowerTransfer(target, receipt) {
  if (!receipt || receipt.target !== path.resolve(target)) throw failure("flower-rollback-invalid", "Flower 回滚回执与目标不一致");
  const errors = [];
  for (const entry of [...receipt.files].reverse()) {
    for (const relative of [entry.path, entry.temporary].filter(Boolean)) {
      try {
        const allowed = [...FILES, ".gitignore"].some((name) => relative === `.flower/${name}`) || /^\.flower\/\.inherit-[a-f0-9]{16}\.tmp$/.test(relative);
        if (!allowed) throw new Error("回执路径不在白名单");
        const file = ordinaryPath(target, relative);
        const stat = fs.lstatSync(file);
        if (stat.dev !== entry.dev || stat.ino !== entry.ino || hashContent(fs.readFileSync(file)) !== entry.hash) {
          throw new Error(`Flower 文件已由其它操作修改:${relative}`);
        }
        fs.unlinkSync(file);
      } catch (error) {
        if (error.code !== "ENOENT") errors.push(error.message);
      }
    }
  }
  if (receipt.directory) {
    try {
      const directory = ordinaryPath(target, ".flower");
      const stat = fs.lstatSync(directory);
      if (stat.dev === receipt.directory.dev && stat.ino === receipt.directory.ino) fs.rmdirSync(directory);
    } catch (error) {
      if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error.code)) errors.push(error.message);
    }
  }
  if (errors.length) throw failure("flower-rollback-conflict", errors.join("; "));
}

/**
 * 校验后补齐缺失安装记录，失败时撤销本次文件写入。
 * @param {object} input 继承参数，含可选 expectedDigest、journal 和测试回调 onWrite
 * @returns {object} 继承结果和本轮回执
 */
export function applyFlowerTransfer(input) {
  const planned = transfer(input);
  if (input.expectedDigest && input.expectedDigest !== planned.plan.digest) throw failure("flower-plan-changed", "Flower 继承计划已变化，请重新预检");
  const { plan, files } = input.baseCommit ? transfer({ ...input, baseCommit: null }) : planned;
  if (plan.digest !== planned.plan.digest) throw failure("flower-plan-changed", "目标 Flower 继承计划已变化，请重新预检");
  const receipt = { target: path.resolve(input.target), files: [], directory: null };
  saveReceipt(input.journal, receipt);
  if (!files.length) return { ...plan, receipt };
  try {
    const directory = ordinaryPath(input.target, ".flower");
    if (!fs.existsSync(directory)) {
      fs.mkdirSync(directory);
      const stat = fs.statSync(directory);
      receipt.directory = { dev: stat.dev, ino: stat.ino };
      saveReceipt(input.journal, receipt);
    }
    for (const entry of files) {
      const target = ordinaryPath(input.target, entry.path);
      const temporary = path.join(directory, `.inherit-${crypto.randomBytes(8).toString("hex")}.tmp`);
      let linked = false;
      try {
        const descriptor = fs.openSync(temporary, "wx", 0o600);
        try {
          fs.writeFileSync(descriptor, entry.content);
          fs.fsyncSync(descriptor);
          const stat = fs.fstatSync(descriptor);
          receipt.files.push({ path: entry.path, temporary: `.flower/${path.basename(temporary)}`, hash: hashContent(entry.content), dev: stat.dev, ino: stat.ino });
          saveReceipt(input.journal, receipt);
        } finally { fs.closeSync(descriptor); }
        // 同目录临时文件先完整写入，再以排他 link 发布，避免 rename 覆盖并发创建的目标。
        fs.linkSync(temporary, target);
        linked = true;
      } finally {
        fs.rmSync(temporary, { force: true });
        if (!linked) {
          receipt.files = receipt.files.filter((file) => file.path !== entry.path);
          saveReceipt(input.journal, receipt);
        }
      }
      input.onWrite?.(entry.path);
    }
    validateInstallation(input.target, snapshot(input.target).values);
    return { ...plan, validationPending: false, receipt };
  } catch (error) {
    try { rollbackFlowerTransfer(input.target, receipt); }
    catch (rollbackError) { error.message += `; 回滚失败:${rollbackError.message}`; }
    throw error;
  }
}

/**
 * 只读诊断目标 Flower 版本证据及安装记录完整性。
 * @param {string} target 目标根
 * @returns {object} 安装状态、版本来源和具体错误
 */
export function inspectWorktreeFlower(target) {
  let version = null;
  let source = null;
  try {
    const { values } = snapshot(target);
    version = values["plugin-lock.json"]?.plugins.find(({ id }) => id === "flower/skill-garden")?.version || null;
    if (version) source = "plugin-lock";
    if (!version) {
      const legacy = readText(target, ".trellis/.flower-manifest.json");
      if (legacy !== null) {
        const manifest = JSON.parse(legacy);
        version = typeof manifest?.flowerVersion === "string" && manifest.flowerVersion.trim() ? manifest.flowerVersion : null;
        if (version) source = "legacy-manifest";
      }
    }
    const complete = RECORDS.every((name) => values[name] !== null);
    if (complete) validateInstallation(target, values);
    return { installation: complete ? "complete" : "incomplete", version, source, reason: complete ? null : "flower-records-missing" };
  } catch (error) {
    return { installation: "invalid", version, source, reason: error.reason || "flower-record-invalid", path: error.path || null, message: error.message };
  }
}

// 仅 Flower facade 提供本入口；目标分支脚本不能替换 schema 或写入实现。
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const input = JSON.parse(fs.readFileSync(0, "utf8"));
    let result;
    if (input.operation === "status") result = inspectWorktreeFlower(input.target);
    else if (input.operation === "plan") result = planFlowerTransfer(input);
    else if (input.operation === "apply") result = applyFlowerTransfer(input);
    else if (input.operation === "rollback") {
      if (fs.existsSync(input.journal)) rollbackFlowerTransfer(input.target, JSON.parse(fs.readFileSync(input.journal, "utf8")));
      result = { action: "rolledBack" };
    } else throw failure("flower-operation-invalid", "未知 Flower worktree 内部操作");
    console.log(JSON.stringify({ ok: true, result }));
  } catch (error) {
    console.log(JSON.stringify({ ok: false, reason: error.reason || "flower-installation-invalid", message: error.message, path: error.path || null }));
    process.exitCode = 1;
  }
}
