import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ALL_MANAGED_DIRS } from "@mindfoldhq/trellis/dist/configurators/index.js";
import { shouldExcludeFromBackup } from "@mindfoldhq/trellis/dist/commands/update.js";
import { ProjectStore } from "../plugin/state/project-store.js";

const MANIFEST_NAME = "manifest.json";
const SNAPSHOT_SCHEMA_VERSION = 1;

function toPosix(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function validateRelativePath(relativePath) {
  if (
    typeof relativePath !== "string" ||
    !relativePath ||
    path.isAbsolute(relativePath) ||
    relativePath.includes("\\") ||
    relativePath.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error(`Update 受管路径不合法:${relativePath}`);
  }
  return relativePath;
}

function isExcluded(relativePath, directory = false) {
  const candidate = directory ? `${relativePath.replace(/\/$/, "")}/` : relativePath;
  return shouldExcludeFromBackup(candidate);
}

function assertOrdinaryRoot(projectRoot) {
  const absolute = path.resolve(projectRoot);
  const stat = fs.lstatSync(absolute);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`Update 项目根必须是普通目录:${absolute}`);
  }
  return fs.realpathSync(absolute);
}

function resolveManagedScopes(projectRoot) {
  const scopes = new Set([...ALL_MANAGED_DIRS, "AGENTS.md", ".flower"]);
  const state = new ProjectStore(projectRoot).readState();
  for (const plugin of state?.plugins || []) {
    for (const entry of plugin.paths) scopes.add(validateRelativePath(entry.path));
  }
  return [...scopes]
    .map(validateRelativePath)
    .sort((left, right) => left.localeCompare(right));
}

function snapshotScopeForTarget(projectRoot, relativePath) {
  const segments = validateRelativePath(relativePath).split("/");
  for (let index = 1; index < segments.length; index += 1) {
    const ancestor = segments.slice(0, index).join("/");
    if (!fs.existsSync(path.join(projectRoot, ...ancestor.split("/")))) return ancestor;
  }
  return relativePath;
}

function scopeContains(scope, relativePath) {
  return scope === relativePath || relativePath.startsWith(`${scope}/`);
}

function ensureSafeDestination(root, relativePath) {
  const destination = path.resolve(root, ...relativePath.split("/"));
  if (!isWithin(root, destination)) throw new Error(`Update 路径逃逸项目:${relativePath}`);
  let current = root;
  for (const segment of relativePath.split("/").slice(0, -1)) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) {
      fs.mkdirSync(current);
      continue;
    }
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(`Update 父路径不是普通目录:${toPosix(path.relative(root, current))}`);
    }
  }
  return destination;
}

function ensureSafeDirectory(root, relativePath) {
  const destination = path.resolve(root, ...relativePath.split("/"));
  if (!isWithin(root, destination)) throw new Error(`Update 路径逃逸项目:${relativePath}`);
  let current = root;
  for (const segment of relativePath.split("/")) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) {
      fs.mkdirSync(current);
      continue;
    }
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(`Update 路径不是普通目录:${toPosix(path.relative(root, current))}`);
    }
  }
  return destination;
}

function scanScopes(projectRoot, scopes, onFile, options = {}) {
  const entries = new Map();
  const forcedScopes = options.forcedScopes || [];

  const isForced = (relativePath) => forcedScopes.some((scope) => (
    scopeContains(scope, relativePath) || scopeContains(relativePath, scope)
  ));

  function walk(absolutePath, relativePath) {
    const stat = fs.lstatSync(absolutePath);
    if (stat.isSymbolicLink()) throw new Error(`Update 受管范围包含软链:${relativePath}`);
    if (stat.isDirectory()) {
      if (isExcluded(relativePath, true) && !isForced(relativePath)) return;
      entries.set(relativePath, { path: relativePath, kind: "directory", mode: stat.mode & 0o777 });
      const children = fs.readdirSync(absolutePath, { withFileTypes: true })
        .sort((left, right) => left.name.localeCompare(right.name));
      for (const child of children) {
        const childRelative = path.posix.join(relativePath, child.name);
        walk(path.join(absolutePath, child.name), childRelative);
      }
      return;
    }
    if (!stat.isFile()) throw new Error(`Update 受管范围包含特殊文件:${relativePath}`);
    if (isExcluded(relativePath) && !isForced(relativePath)) return;
    entries.set(relativePath, { path: relativePath, kind: "file", mode: stat.mode & 0o777 });
    onFile?.(absolutePath, relativePath);
  }

  for (const scope of scopes) {
    if ([...entries.keys()].some((entry) => scope === entry || scope.startsWith(`${entry}/`))) continue;
    const absolutePath = path.join(projectRoot, ...scope.split("/"));
    if (!fs.existsSync(absolutePath)) continue;
    walk(absolutePath, scope);
  }
  return [...entries.values()].sort((left, right) => left.path.localeCompare(right.path));
}

function writeManifest(snapshotRoot, manifest) {
  fs.writeFileSync(
    path.join(snapshotRoot, MANIFEST_NAME),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { mode: 0o600 },
  );
}

function materializeSnapshot(snapshot, destinationRoot) {
  const realDestination = assertOrdinaryRoot(destinationRoot);
  for (const entry of snapshot.manifest.entries.filter(({ kind }) => kind === "directory")) {
    const destination = ensureSafeDirectory(realDestination, entry.path);
    fs.chmodSync(destination, entry.mode);
  }
  for (const entry of snapshot.manifest.entries.filter(({ kind }) => kind === "file")) {
    const destination = ensureSafeDestination(realDestination, entry.path);
    const source = path.join(snapshot.dataRoot, ...entry.path.split("/"));
    fs.copyFileSync(source, destination);
    fs.chmodSync(destination, entry.mode);
  }
}

/**
 * 为 Flower update 创建项目外补偿快照。
 *
 * @param {string} projectRoot 目标项目根目录
 * @returns {{root:string,dataRoot:string,manifestPath:string,manifest:{schemaVersion:number,projectRoot:string,scopes:string[],forcedScopes:string[],entries:Array<{path:string,kind:"file"|"directory",mode:number}>}}} 快照描述
 */
export function createUpdateSnapshot(projectRoot) {
  const realProjectRoot = assertOrdinaryRoot(projectRoot);
  const snapshotRoot = fs.mkdtempSync(path.join(os.tmpdir(), "flower-update-snapshot-"));
  const dataRoot = path.join(snapshotRoot, "data");
  fs.mkdirSync(dataRoot);
  try {
    const scopes = resolveManagedScopes(realProjectRoot);
    const entries = scanScopes(realProjectRoot, scopes, (source, relativePath) => {
      const destination = path.join(dataRoot, ...relativePath.split("/"));
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(source, destination);
    });
    const manifest = {
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      projectRoot: realProjectRoot,
      scopes,
      forcedScopes: [],
      entries,
    };
    writeManifest(snapshotRoot, manifest);
    return {
      root: snapshotRoot,
      dataRoot,
      manifestPath: path.join(snapshotRoot, MANIFEST_NAME),
      manifest,
    };
  } catch (error) {
    fs.rmSync(snapshotRoot, { recursive: true, force: true });
    throw error;
  }
}

/**
 * 在 Plugin 事务真正写入前，把计划触达的外部路径补入 Update 快照。
 *
 * @param {ReturnType<typeof createUpdateSnapshot>} snapshot 补偿快照
 * @param {string[]} targets Plugin 预检计划中的项目内 POSIX 相对路径
 * @returns {string[]} 本次新增的快照范围
 */
export function extendUpdateSnapshot(snapshot, targets) {
  const projectRoot = snapshot.manifest.projectRoot;
  const previousForcedScopes = snapshot.manifest.forcedScopes || [];
  const additions = [...new Set(targets.map((target) => snapshotScopeForTarget(projectRoot, target)))]
    .filter((target) => !previousForcedScopes.some((scope) => scopeContains(scope, target)))
    .sort((left, right) => left.localeCompare(right));
  if (additions.length === 0) return [];

  const reducedAdditions = additions.filter((target, index) => (
    !additions.some((scope, otherIndex) => otherIndex !== index && scopeContains(scope, target))
  ));
  const forcedScopes = [...previousForcedScopes, ...reducedAdditions]
    .sort((left, right) => left.localeCompare(right));
  const captured = scanScopes(projectRoot, reducedAdditions, (source, relativePath) => {
    const destination = path.join(snapshot.dataRoot, ...relativePath.split("/"));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
  }, { forcedScopes });
  const entries = new Map(snapshot.manifest.entries.map((entry) => [entry.path, entry]));
  for (const entry of captured) entries.set(entry.path, entry);
  snapshot.manifest.scopes = [...snapshot.manifest.scopes, ...reducedAdditions]
    .sort((left, right) => left.localeCompare(right));
  snapshot.manifest.forcedScopes = forcedScopes;
  snapshot.manifest.entries = [...entries.values()]
    .sort((left, right) => left.path.localeCompare(right.path));
  writeManifest(snapshot.root, snapshot.manifest);
  return reducedAdditions;
}

/**
 * 从快照构造项目外升级沙箱。
 *
 * @param {string} projectRoot 只读来源项目
 * @returns {{root:string,snapshot:ReturnType<typeof createUpdateSnapshot>}} 沙箱与来源快照
 */
export function createUpdateSandbox(projectRoot) {
  const snapshot = createUpdateSnapshot(projectRoot);
  const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), "flower-update-sandbox-"));
  try {
    materializeSnapshot(snapshot, sandboxRoot);
    return { root: sandboxRoot, snapshot };
  } catch (error) {
    fs.rmSync(sandboxRoot, { recursive: true, force: true });
    disposeUpdateSnapshot(snapshot);
    throw error;
  }
}

/**
 * 恢复 Update 快照并删除本轮新增的受管文件。
 *
 * @param {ReturnType<typeof createUpdateSnapshot>} snapshot 补偿快照
 * @returns {{ok:boolean,restored:string[],removed:string[],failedPaths:Array<{path:string,error:string}>,manifestPath:string}} 恢复证据
 */
export function restoreUpdateSnapshot(snapshot) {
  const restored = [];
  const removed = [];
  const failedPaths = [];
  const projectRoot = snapshot.manifest.projectRoot;
  const previous = new Map(snapshot.manifest.entries.map((entry) => [entry.path, entry]));
  let currentEntries = [];
  try {
    currentEntries = scanScopes(projectRoot, snapshot.manifest.scopes, undefined, {
      forcedScopes: snapshot.manifest.forcedScopes || [],
    });
  } catch (error) {
    failedPaths.push({ path: "<scan>", error: error.message });
  }

  const additions = currentEntries
    .filter((entry) => !previous.has(entry.path))
    .sort((left, right) => right.path.split("/").length - left.path.split("/").length);
  for (const entry of additions) {
    const candidate = path.join(projectRoot, ...entry.path.split("/"));
    try {
      if (entry.kind === "directory") fs.rmdirSync(candidate);
      else fs.rmSync(candidate, { force: false });
      removed.push(entry.path);
    } catch (error) {
      if (error?.code !== "ENOENT" && error?.code !== "ENOTEMPTY") {
        failedPaths.push({ path: entry.path, error: error.message });
      }
    }
  }

  const directories = snapshot.manifest.entries
    .filter(({ kind }) => kind === "directory")
    .sort((left, right) => left.path.split("/").length - right.path.split("/").length);
  for (const entry of directories) {
    try {
      const destination = path.join(projectRoot, ...entry.path.split("/"));
      if (fs.existsSync(destination)) {
        const stat = fs.lstatSync(destination);
        if (stat.isSymbolicLink()) throw new Error("恢复目标是软链");
        if (!stat.isDirectory()) fs.rmSync(destination, { force: false });
      }
      fs.mkdirSync(destination, { recursive: true });
      fs.chmodSync(destination, entry.mode);
      restored.push(entry.path);
    } catch (error) {
      failedPaths.push({ path: entry.path, error: error.message });
    }
  }

  for (const entry of snapshot.manifest.entries.filter(({ kind }) => kind === "file")) {
    try {
      const destination = ensureSafeDestination(projectRoot, entry.path);
      if (fs.existsSync(destination)) {
        const stat = fs.lstatSync(destination);
        if (stat.isSymbolicLink()) throw new Error("恢复目标是软链");
        if (!stat.isFile()) fs.rmSync(destination, { recursive: true, force: false });
      }
      fs.copyFileSync(path.join(snapshot.dataRoot, ...entry.path.split("/")), destination);
      fs.chmodSync(destination, entry.mode);
      restored.push(entry.path);
    } catch (error) {
      failedPaths.push({ path: entry.path, error: error.message });
    }
  }

  return {
    ok: failedPaths.length === 0,
    restored,
    removed,
    failedPaths,
    manifestPath: snapshot.manifestPath,
  };
}

/**
 * 删除 Update 快照。
 *
 * @param {ReturnType<typeof createUpdateSnapshot>} snapshot 补偿快照
 * @returns {void}
 */
export function disposeUpdateSnapshot(snapshot) {
  fs.rmSync(snapshot.root, { recursive: true, force: true });
}

/**
 * 删除 Update 沙箱及其来源快照。
 *
 * @param {ReturnType<typeof createUpdateSandbox>} sandbox 沙箱描述
 * @returns {void}
 */
export function disposeUpdateSandbox(sandbox) {
  fs.rmSync(sandbox.root, { recursive: true, force: true });
  disposeUpdateSnapshot(sandbox.snapshot);
}
