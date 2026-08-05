import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  collectPlatformTemplates,
  getConfiguredPlatforms,
} from "@mindfoldhq/trellis/dist/configurators/index.js";
import { computeHash } from "@mindfoldhq/trellis/dist/utils/template-hash.js";
import { flowerVersion, trellisVersion } from "./versions.js";
import {
  createUpdateSnapshot,
  disposeUpdateSnapshot,
  extendUpdateSnapshot,
  restoreUpdateSnapshot,
} from "./update-transaction.js";
import { PluginError, PluginPathError } from "../plugin/errors.js";
import { stringifyCanonicalJson } from "../plugin/integrity/canonical-json.js";
import {
  hashContent,
  hashDirectoryIfExists,
  hashFileIfExists,
} from "../plugin/install/content-hash.js";
import { assertSafePosixRelativePath } from "../plugin/schemas/shared.js";
import { validateTrellisDetachedManifest } from "../plugin/schemas/trellis-control.js";
import { ProjectStore } from "../plugin/state/project-store.js";
import { compareUtf8 } from "../plugin/stable-order.js";
import {
  TRELLIS_CONTROL_ERROR_CODES,
  TrellisControlError,
} from "./trellis-control-errors.js";

const TRELLIS_BLOCK_START = "<!-- TRELLIS:START -->";
const TRELLIS_BLOCK_END = "<!-- TRELLIS:END -->";
const CONTROL_FILE = ".flower/trellis-control.json";
const DETACHED_ROOT = ".flower/trellis-detached";
const SKILL_GARDEN_PLUGIN_ID = "flower/skill-garden";
const REMOVE_NODE = Symbol("remove-node");

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function toPosix(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function deepEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cloneJson(value) {
  return structuredClone(value);
}

function controlError(message, code, options = {}) {
  return new TrellisControlError(message, { ...options, code });
}

function assertProjectRoot(projectRoot) {
  const absolute = path.resolve(projectRoot);
  try {
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new PluginPathError(`Trellis 控制项目根必须是普通目录:${absolute}`, {
        path: absolute,
      });
    }
    return fs.realpathSync(absolute);
  } catch (error) {
    if (error instanceof PluginError) throw error;
    throw controlError(
      `无法读取 Trellis 控制项目根:${absolute}`,
      TRELLIS_CONTROL_ERROR_CODES.TRANSACTION_FAILED,
      { path: absolute, cause: error },
    );
  }
}

function resolveProjectPath(projectRoot, relativePath) {
  const safePath = assertSafePosixRelativePath(relativePath, "Trellis 控制路径");
  const realRoot = assertProjectRoot(projectRoot);
  const target = path.resolve(realRoot, ...safePath.split("/"));
  if (!isWithin(realRoot, target)) {
    throw new PluginPathError(`Trellis 控制路径逃逸项目:${safePath}`, { path: safePath });
  }
  let current = realRoot;
  for (const segment of safePath.split("/").slice(0, -1)) {
    current = path.join(current, segment);
    try {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new PluginPathError(`Trellis 控制父路径不是普通目录:${safePath}`, {
          path: safePath,
        });
      }
      if (!isWithin(realRoot, fs.realpathSync(current))) {
        throw new PluginPathError(`Trellis 控制父路径逃逸项目:${safePath}`, {
          path: safePath,
        });
      }
    } catch (error) {
      if (error?.code === "ENOENT") break;
      throw error;
    }
  }
  return target;
}

function ensureOrdinaryDirectory(projectRoot, relativePath) {
  const target = resolveProjectPath(projectRoot, relativePath);
  let current = assertProjectRoot(projectRoot);
  for (const segment of relativePath.split("/")) {
    current = path.join(current, segment);
    try {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new PluginPathError(`Trellis 控制目录不是普通目录:${relativePath}`, {
          path: relativePath,
        });
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      fs.mkdirSync(current, { mode: 0o700 });
    }
  }
  return target;
}

function readFileIfExists(projectRoot, relativePath) {
  const target = resolveProjectPath(projectRoot, relativePath);
  try {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new PluginPathError(`Trellis 控制目标必须是普通文件:${relativePath}`, {
        path: relativePath,
      });
    }
    return { content: fs.readFileSync(target), mode: stat.mode & 0o777 };
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function ensureTargetParent(projectRoot, relativePath) {
  const parent = path.posix.dirname(relativePath);
  if (parent === ".") return;
  ensureOrdinaryDirectory(projectRoot, parent);
}

function atomicWriteBuffer(projectRoot, relativePath, content, mode = 0o600) {
  ensureTargetParent(projectRoot, relativePath);
  const target = resolveProjectPath(projectRoot, relativePath);
  const temporary = path.join(
    path.dirname(target),
    `.${path.basename(target)}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`,
  );
  let descriptor = null;
  try {
    descriptor = fs.openSync(temporary, "wx", mode);
    fs.writeFileSync(descriptor, content);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    fs.renameSync(temporary, target);
    fs.chmodSync(target, mode);
  } catch (error) {
    if (descriptor !== null) {
      try {
        fs.closeSync(descriptor);
      } catch {
        // 保留原始写入异常。
      }
    }
    try {
      fs.unlinkSync(temporary);
    } catch (cleanupError) {
      if (cleanupError?.code !== "ENOENT") throw cleanupError;
    }
    throw error;
  }
}

function atomicWriteJson(projectRoot, relativePath, value) {
  atomicWriteBuffer(projectRoot, relativePath, Buffer.from(stringifyCanonicalJson(value)), 0o600);
}

function removeFileIfExists(projectRoot, relativePath) {
  const target = resolveProjectPath(projectRoot, relativePath);
  try {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new PluginPathError(`Trellis 控制待删目标必须是普通文件:${relativePath}`, {
        path: relativePath,
      });
    }
    fs.unlinkSync(target);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function readJsonFile(projectRoot, relativePath, label) {
  const file = readFileIfExists(projectRoot, relativePath);
  if (!file) return null;
  try {
    return JSON.parse(file.content.toString("utf8"));
  } catch (error) {
    throw controlError(
      `${label} JSON 损坏:${relativePath}`,
      TRELLIS_CONTROL_ERROR_CODES.STATE_CORRUPT,
      { path: relativePath, cause: error },
    );
  }
}

function readTemplateHashes(projectRoot) {
  const relativePath = ".trellis/.template-hashes.json";
  const value = readJsonFile(projectRoot, relativePath, "Trellis template hashes");
  if (value === null) return {};
  if (
    value?.__version !== 2 ||
    !isPlainObject(value.hashes) ||
    Object.entries(value.hashes).some(([key, hash]) => (
      typeof key !== "string" || typeof hash !== "string" || !/^[a-f0-9]{64}$/.test(hash)
    ))
  ) {
    throw controlError(
      "Trellis template hashes schema 无效",
      TRELLIS_CONTROL_ERROR_CODES.STATE_CORRUPT,
      { path: relativePath },
    );
  }
  return value.hashes;
}

function targetRecord(targets, relativePath) {
  assertSafePosixRelativePath(relativePath, "Trellis 集成目标");
  let target = targets.get(relativePath);
  if (!target) {
    target = {
      path: relativePath,
      owners: new Set(),
      templateHashes: new Set(),
      pluginHashes: new Set(),
      templateContents: [],
      allowCurrent: false,
    };
    targets.set(relativePath, target);
  }
  return target;
}

function shouldExcludeTarget(relativePath) {
  return relativePath === ".trellis" ||
    relativePath.startsWith(".trellis/") ||
    relativePath === ".flower" ||
    relativePath.startsWith(".flower/");
}

function listOrdinaryFiles(projectRoot, relativeDirectory) {
  const root = resolveProjectPath(projectRoot, relativeDirectory);
  const files = [];
  const walk = (directory, relative) => {
    const stat = fs.lstatSync(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new PluginPathError(`Trellis 受管目录必须是普通目录:${relative}`, { path: relative });
    }
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => compareUtf8(left.name, right.name))) {
      const childRelative = path.posix.join(relative, entry.name);
      const child = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new PluginPathError(`Trellis 受管目录包含软链:${childRelative}`, {
          path: childRelative,
        });
      }
      if (entry.isDirectory()) walk(child, childRelative);
      else if (entry.isFile()) files.push(childRelative);
      else throw new PluginPathError(`Trellis 受管目录包含特殊文件:${childRelative}`, {
        path: childRelative,
      });
    }
  };
  walk(root, relativeDirectory);
  return files;
}

function discoverIntegrationTargets(projectRoot) {
  const configuredPlatforms = [...getConfiguredPlatforms(projectRoot)].sort(compareUtf8);
  const templateHashes = readTemplateHashes(projectRoot);
  const targets = new Map();

  for (const [relativePath, hash] of Object.entries(templateHashes)) {
    if (shouldExcludeTarget(relativePath)) continue;
    const target = targetRecord(targets, relativePath);
    target.owners.add("trellis-template-hash");
    target.templateHashes.add(hash);
  }

  for (const platform of configuredPlatforms) {
    const templates = collectPlatformTemplates(platform) || new Map();
    for (const [relativePath, content] of templates) {
      if (shouldExcludeTarget(relativePath)) continue;
      const target = targetRecord(targets, relativePath);
      target.owners.add(`trellis-platform:${platform}`);
      target.templateHashes.add(computeHash(content));
      target.templateContents.push(content);
    }
  }

  const store = new ProjectStore(projectRoot);
  const skillGarden = store.readState()?.plugins
    .find(({ id }) => id === SKILL_GARDEN_PLUGIN_ID);
  for (const entry of skillGarden?.paths || []) {
    if (shouldExcludeTarget(entry.path)) continue;
    if (entry.kind === "directory") {
      const currentHash = hashDirectoryIfExists(resolveProjectPath(projectRoot, entry.path));
      if (currentHash === null) continue;
      const clean = currentHash === entry.hash;
      for (const child of listOrdinaryFiles(projectRoot, entry.path)) {
        const target = targetRecord(targets, child);
        target.owners.add(`flower-path:${skillGarden.id}:${entry.path}`);
        target.allowCurrent ||= clean;
      }
      continue;
    }
    const target = targetRecord(targets, entry.path);
    target.owners.add(`flower-path:${skillGarden.id}`);
    target.pluginHashes.add(entry.hash);
  }
  for (const patchEntry of skillGarden?.patches || []) {
    if (shouldExcludeTarget(patchEntry.target)) continue;
    const target = targetRecord(targets, patchEntry.target);
    target.owners.add(`flower-patch:${patchEntry.operation}`);
    target.pluginHashes.add(patchEntry.resultHash);
  }

  if (Object.hasOwn(templateHashes, "AGENTS.md") || readFileIfExists(projectRoot, "AGENTS.md")) {
    targetRecord(targets, "AGENTS.md").owners.add("trellis-managed-block");
  }

  return {
    configuredPlatforms,
    targets: [...targets.values()].sort((left, right) => compareUtf8(left.path, right.path)),
  };
}

function managedBlockMutation(content) {
  const text = content.toString("utf8");
  const start = text.indexOf(TRELLIS_BLOCK_START);
  const endMarker = text.indexOf(TRELLIS_BLOCK_END);
  if (start < 0 && endMarker < 0) return null;
  if (
    start < 0 ||
    endMarker < start ||
    text.indexOf(TRELLIS_BLOCK_START, start + TRELLIS_BLOCK_START.length) >= 0 ||
    text.indexOf(TRELLIS_BLOCK_END, endMarker + TRELLIS_BLOCK_END.length) >= 0
  ) {
    throw controlError(
      "AGENTS.md 的 Trellis 管理块标记不完整或重复",
      TRELLIS_CONTROL_ERROR_CODES.CONFLICT,
      { path: "AGENTS.md" },
    );
  }
  const end = endMarker + TRELLIS_BLOCK_END.length;
  const prefix = text.slice(0, start);
  const block = text.slice(start, end);
  const suffix = text.slice(end);
  return {
    after: Buffer.from(`${prefix}${suffix}`),
    block: { content: block, prefix, suffix },
  };
}

function arrayIdentity(value) {
  if (!isPlainObject(value)) return null;
  for (const key of ["matcher", "id", "name", "path", "command", "plugin", "extension"]) {
    if (typeof value[key] === "string") return `${key}:${value[key]}`;
  }
  if (Array.isArray(value.hooks)) {
    const context = Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== "hooks")
        .sort(([left], [right]) => compareUtf8(left, right)),
    );
    return `hook-group:${stringifyCanonicalJson(context).trim()}`;
  }
  return null;
}

function arrayIdentityFields(value) {
  if (!isPlainObject(value)) return [];
  for (const key of ["matcher", "id", "name", "path", "command", "plugin", "extension"]) {
    if (typeof value[key] === "string") return [key];
  }
  return Array.isArray(value.hooks)
    ? Object.keys(value).filter((key) => key !== "hooks")
    : [];
}

function preserveArrayIdentity(current, template, next) {
  if (!isPlainObject(current) || !isPlainObject(next)) return next;
  const restored = cloneJson(next);
  for (const key of arrayIdentityFields(template)) {
    if (!Object.hasOwn(restored, key) && Object.hasOwn(current, key)) {
      restored[key] = cloneJson(current[key]);
    }
  }
  return restored;
}

function subtractTemplateNode(current, template) {
  if (deepEqual(current, template)) return { value: REMOVE_NODE, changed: true };
  if (Array.isArray(current) && Array.isArray(template)) {
    const next = cloneJson(current);
    let changed = false;
    for (const templateEntry of template) {
      let index = next.findIndex((entry) => deepEqual(entry, templateEntry));
      if (index >= 0) {
        next.splice(index, 1);
        changed = true;
        continue;
      }
      const identity = arrayIdentity(templateEntry);
      if (!identity) continue;
      index = next.findIndex((entry) => arrayIdentity(entry) === identity);
      if (index < 0) continue;
      const currentEntry = next[index];
      const nested = subtractTemplateNode(currentEntry, templateEntry);
      if (!nested.changed) continue;
      changed = true;
      if (nested.value === REMOVE_NODE) next.splice(index, 1);
      else next[index] = preserveArrayIdentity(currentEntry, templateEntry, nested.value);
    }
    return { value: next, changed };
  }
  if (isPlainObject(current) && isPlainObject(template)) {
    const next = cloneJson(current);
    let changed = false;
    for (const [key, templateValue] of Object.entries(template)) {
      if (!Object.hasOwn(next, key)) continue;
      const nested = subtractTemplateNode(next[key], templateValue);
      if (!nested.changed) continue;
      changed = true;
      if (nested.value === REMOVE_NODE) delete next[key];
      else next[key] = nested.value;
    }
    return { value: next, changed };
  }
  return { value: current, changed: false };
}

function stringReferencesManagedPath(value, managedPaths) {
  if (value.includes(".trellis/")) return true;
  return managedPaths.some((managedPath) => value.includes(managedPath));
}

function objectReferencesTrellis(value, managedPaths) {
  if (!isPlainObject(value)) return false;
  return ["command", "path", "script", "plugin", "extension", "name"]
    .some((key) => typeof value[key] === "string" &&
      stringReferencesManagedPath(value[key], managedPaths));
}

function removeManagedJsonNodes(value, managedPaths, root = false) {
  if (Array.isArray(value)) {
    const next = [];
    for (const entry of value) {
      if (objectReferencesTrellis(entry, managedPaths)) continue;
      const nested = removeManagedJsonNodes(entry, managedPaths);
      if (nested !== REMOVE_NODE) next.push(nested);
    }
    return next;
  }
  if (isPlainObject(value)) {
    if (!root && objectReferencesTrellis(value, managedPaths)) return REMOVE_NODE;
    const next = {};
    for (const [key, entry] of Object.entries(value)) {
      const nested = removeManagedJsonNodes(entry, managedPaths);
      if (nested === REMOVE_NODE) continue;
      if ((key === "hooks" || key === "enabledPlugins") && isPlainObject(nested) && Object.keys(nested).length === 0) {
        continue;
      }
      next[key] = nested;
    }
    if (!root && Array.isArray(next.hooks) && next.hooks.length === 0) return REMOVE_NODE;
    return next;
  }
  return value;
}

function isSharedJsonPath(relativePath) {
  if (!relativePath.endsWith(".json")) return false;
  return ![
    "/skills/",
    "/agents/",
    "/commands/",
    "/workflows/",
    "/hooks/",
    "/extensions/",
    "/references/",
  ].some((segment) => relativePath.includes(segment));
}

function currentMatchesOwnership(file, target) {
  const rawHash = hashContent(file.content);
  if (target.allowCurrent || target.pluginHashes.has(rawHash)) return true;
  if (target.templateHashes.size === 0) return false;
  try {
    return target.templateHashes.has(computeHash(file.content.toString("utf8")));
  } catch {
    return false;
  }
}

function jsonMutation(file, target, managedPaths) {
  let current;
  try {
    current = JSON.parse(file.content.toString("utf8"));
  } catch (error) {
    throw controlError(
      `共享 JSON 无法解析:${target.path}`,
      TRELLIS_CONTROL_ERROR_CODES.CONFLICT,
      { path: target.path, cause: error },
    );
  }
  let next = cloneJson(current);
  let changed = false;
  for (const templateContent of target.templateContents) {
    let template;
    try {
      template = JSON.parse(templateContent);
    } catch {
      continue;
    }
    const result = subtractTemplateNode(next, template);
    if (result.changed) {
      next = result.value === REMOVE_NODE ? {} : result.value;
      changed = true;
    }
  }
  const withoutManagedNodes = removeManagedJsonNodes(next, managedPaths, true);
  if (!deepEqual(next, withoutManagedNodes)) {
    next = withoutManagedNodes;
    changed = true;
  }
  if (!changed) return null;
  return Buffer.from(stringifyCanonicalJson(next));
}

function createDisablePlan(projectRoot, discovery, options) {
  const conflicts = [];
  const entries = [];
  const managedPaths = discovery.targets.map(({ path: targetPath }) => targetPath);
  for (const target of discovery.targets) {
    const file = readFileIfExists(projectRoot, target.path);
    if (!file) continue;
    const owners = [...target.owners].sort(compareUtf8);
    if (target.path === "AGENTS.md") {
      const mutation = managedBlockMutation(file.content);
      if (!mutation) continue;
      entries.push({
        path: target.path,
        kind: "managed-block",
        owners,
        before: file.content,
        after: mutation.after,
        mode: file.mode,
        block: mutation.block,
      });
      continue;
    }
    if (isSharedJsonPath(target.path)) {
      const after = jsonMutation(file, target, managedPaths);
      if (after) {
        entries.push({
          path: target.path,
          kind: "json-fragment",
          owners,
          before: file.content,
          after,
          mode: file.mode,
        });
      }
      // 共享 JSON 即使已经没有 Trellis 节点，也不能退化成整文件独占删除。
      continue;
    }
    if (!currentMatchesOwnership(file, target) && !options.force) {
      conflicts.push({ path: target.path, reason: "受管文件已被用户修改" });
      continue;
    }
    entries.push({
      path: target.path,
      kind: "exclusive-file",
      owners,
      before: file.content,
      after: null,
      mode: file.mode,
    });
  }
  if (conflicts.length > 0) {
    throw controlError(
      `Trellis disable 发现 ${conflicts.length} 个冲突，未写入任何文件`,
      TRELLIS_CONTROL_ERROR_CODES.CONFLICT,
      { details: { conflicts }, path: conflicts[0].path },
    );
  }
  return entries.sort((left, right) => compareUtf8(left.path, right.path));
}

function encodedPath(relativePath) {
  return Buffer.from(relativePath).toString("base64url");
}

function manifestEntry(transactionId, entry) {
  const encoded = encodedPath(entry.path);
  return {
    path: entry.path,
    kind: entry.kind,
    owners: entry.owners,
    beforeHash: hashContent(entry.before),
    afterHash: entry.after === null ? null : hashContent(entry.after),
    mode: entry.mode,
    backupPath: `${DETACHED_ROOT}/${transactionId}/files/${encoded}.bin`,
    disabledPath: entry.after === null
      ? null
      : `${DETACHED_ROOT}/${transactionId}/disabled/${encoded}.bin`,
    ...(entry.block ? { block: entry.block } : {}),
  };
}

function readDetachedManifest(projectRoot, controlState) {
  const value = readJsonFile(projectRoot, controlState.manifestPath, "Trellis detached manifest");
  if (value === null) {
    throw controlError(
      `Trellis 恢复 manifest 缺失:${controlState.manifestPath}`,
      TRELLIS_CONTROL_ERROR_CODES.REPAIR_REQUIRED,
      { path: controlState.manifestPath },
    );
  }
  let manifest;
  try {
    manifest = validateTrellisDetachedManifest(value);
  } catch (error) {
    throw controlError(
      `Trellis 恢复 manifest 无效:${controlState.manifestPath}`,
      TRELLIS_CONTROL_ERROR_CODES.REPAIR_REQUIRED,
      { path: controlState.manifestPath, cause: error },
    );
  }
  if (manifest.id !== controlState.transactionId) {
    throw controlError(
      "Trellis control 与恢复 manifest 的事务 ID 不一致",
      TRELLIS_CONTROL_ERROR_CODES.REPAIR_REQUIRED,
      { path: controlState.manifestPath },
    );
  }
  const controlPlatforms = [...controlState.configuredPlatforms].sort(compareUtf8);
  const manifestPlatforms = [...manifest.configuredPlatforms].sort(compareUtf8);
  if (!deepEqual(controlPlatforms, manifestPlatforms)) {
    throw controlError(
      "Trellis control 与恢复 manifest 的平台集合不一致",
      TRELLIS_CONTROL_ERROR_CODES.REPAIR_REQUIRED,
      { path: controlState.manifestPath },
    );
  }
  const expectedByPath = new Map(
    controlState.expectedDisabled.map((entry) => [entry.path, entry]),
  );
  if (expectedByPath.size !== manifest.entries.length || manifest.entries.some((entry) => {
    const expected = expectedByPath.get(entry.path);
    return !expected || expected.kind !== entry.kind || expected.afterHash !== entry.afterHash;
  })) {
    throw controlError(
      "Trellis control 与恢复 manifest 的关闭态期望不一致",
      TRELLIS_CONTROL_ERROR_CODES.REPAIR_REQUIRED,
      { path: controlState.manifestPath },
    );
  }
  if (controlState.status === "disabled") {
    const completed = new Set(manifest.completed);
    if (completed.size !== manifest.entries.length ||
      manifest.entries.some((entry) => !completed.has(entry.path))) {
      throw controlError(
        "Trellis detached manifest 的 completed journal 不完整",
        TRELLIS_CONTROL_ERROR_CODES.REPAIR_REQUIRED,
        { path: controlState.manifestPath },
      );
    }
  }
  return manifest;
}

function readManifestMaterial(projectRoot, entry, field) {
  const relativePath = entry[field];
  if (relativePath === null) return null;
  const file = readFileIfExists(projectRoot, relativePath);
  if (!file) {
    throw controlError(
      `Trellis 恢复材料缺失:${relativePath}`,
      TRELLIS_CONTROL_ERROR_CODES.REPAIR_REQUIRED,
      { path: relativePath },
    );
  }
  const expected = field === "backupPath" ? entry.beforeHash : entry.afterHash;
  if (hashContent(file.content) !== expected) {
    throw controlError(
      `Trellis 恢复材料摘要不匹配:${relativePath}`,
      TRELLIS_CONTROL_ERROR_CODES.REPAIR_REQUIRED,
      { path: relativePath },
    );
  }
  return file.content;
}

function jsonContains(current, desired) {
  if (Array.isArray(current) && Array.isArray(desired)) {
    const usedCurrent = new Set();
    return desired.every((desiredEntry) => {
      const index = findArrayEntry(
        current,
        usedCurrent,
        (currentEntry) => jsonContains(currentEntry, desiredEntry),
      );
      if (index < 0) return false;
      usedCurrent.add(index);
      return true;
    });
  }
  if (isPlainObject(current) && isPlainObject(desired)) {
    return Object.entries(desired).every(([key, value]) => (
      Object.hasOwn(current, key) && jsonContains(current[key], value)
    ));
  }
  return deepEqual(current, desired);
}

function findArrayEntry(values, used, predicate) {
  for (let index = 0; index < values.length; index += 1) {
    if (!used.has(index) && predicate(values[index])) return index;
  }
  return -1;
}

function identityMergeBase(desired, current) {
  if (!isPlainObject(desired) || !isPlainObject(current)) return {};
  const base = {};
  for (const [key, desiredValue] of Object.entries(desired)) {
    if (!Object.hasOwn(current, key)) continue;
    const currentValue = current[key];
    if (deepEqual(desiredValue, currentValue)) base[key] = cloneJson(desiredValue);
    else if (Array.isArray(desiredValue) && Array.isArray(currentValue)) base[key] = [];
    else if (isPlainObject(desiredValue) && isPlainObject(currentValue)) base[key] = {};
  }
  return base;
}

function restoreDeltaPresent(base, desired, current) {
  if (deepEqual(base, desired)) return false;
  if (Array.isArray(base) && Array.isArray(desired) && Array.isArray(current)) {
    const usedBase = new Set();
    return desired.some((desiredEntry) => {
      const exactBase = findArrayEntry(base, usedBase, (entry) => deepEqual(entry, desiredEntry));
      if (exactBase >= 0) {
        usedBase.add(exactBase);
        return false;
      }
      const identity = arrayIdentity(desiredEntry);
      const identityBase = identity === null ? -1 : findArrayEntry(
        base,
        usedBase,
        (entry) => arrayIdentity(entry) === identity,
      );
      if (identityBase >= 0) {
        usedBase.add(identityBase);
        const currentEntry = current.find((entry) => arrayIdentity(entry) === identity);
        return currentEntry === undefined
          ? false
          : restoreDeltaPresent(base[identityBase], desiredEntry, currentEntry);
      }
      return current.some((entry) => jsonContains(entry, desiredEntry));
    });
  }
  if (isPlainObject(base) && isPlainObject(desired) && isPlainObject(current)) {
    return Object.keys(desired).some((key) => {
      if (!Object.hasOwn(base, key)) {
        return Object.hasOwn(current, key) && jsonContains(current[key], desired[key]);
      }
      if (!Object.hasOwn(current, key)) return false;
      return restoreDeltaPresent(base[key], desired[key], current[key]);
    });
  }
  return deepEqual(current, desired);
}

function verifyDisabledEntry(projectRoot, entry) {
  const current = readFileIfExists(projectRoot, entry.path);
  if (entry.kind === "exclusive-file") return current === null;
  if (entry.kind === "managed-block") {
    if (!current) return true;
    const text = current.content.toString("utf8");
    return !text.includes(TRELLIS_BLOCK_START) && !text.includes(TRELLIS_BLOCK_END);
  }
  if (!current) return true;
  const disabled = readManifestMaterial(projectRoot, entry, "disabledPath");
  const original = readManifestMaterial(projectRoot, entry, "backupPath");
  try {
    return !restoreDeltaPresent(
      JSON.parse(disabled.toString("utf8")),
      JSON.parse(original.toString("utf8")),
      JSON.parse(current.content.toString("utf8")),
    );
  } catch {
    return false;
  }
}

function loadControlBundle(projectRoot) {
  const store = new ProjectStore(projectRoot);
  let controlState;
  try {
    controlState = store.readTrellisControl();
  } catch (error) {
    throw controlError(
      "Trellis 控制状态损坏",
      TRELLIS_CONTROL_ERROR_CODES.REPAIR_REQUIRED,
      { path: CONTROL_FILE, cause: error },
    );
  }
  if (!controlState) {
    throw controlError(
      "当前项目未处于 Trellis disabled 状态",
      TRELLIS_CONTROL_ERROR_CODES.USAGE_ERROR,
      { path: CONTROL_FILE },
    );
  }
  const manifest = readDetachedManifest(projectRoot, controlState);
  for (const entry of manifest.entries) {
    readManifestMaterial(projectRoot, entry, "backupPath");
    if (entry.disabledPath !== null) readManifestMaterial(projectRoot, entry, "disabledPath");
  }
  const journalPath = `${DETACHED_ROOT}/${manifest.id}/restore-journal.json`;
  if (readFileIfExists(projectRoot, journalPath)) {
    throw controlError(
      `Trellis 恢复 journal 未完成:${journalPath}`,
      TRELLIS_CONTROL_ERROR_CODES.REPAIR_REQUIRED,
      { path: journalPath },
    );
  }
  return { store, controlState, manifest };
}

/**
 * 只读检查项目的 Trellis 集成控制状态与磁盘漂移。
 *
 * @param {string} projectRoot 项目根目录
 * @returns {{status:"enabled"|"disabled"|"drifted"|"repair-required"|"not-initialized",configuredPlatforms:string[],manifestPath:string|null,restartRequired:boolean,driftedPaths:string[],reason:string|null}} 控制状态
 */
export function inspectTrellisControl(projectRoot) {
  const target = assertProjectRoot(projectRoot);
  const store = new ProjectStore(target);
  let controlState;
  try {
    controlState = store.readTrellisControl();
  } catch (error) {
    return {
      status: "repair-required",
      configuredPlatforms: [],
      manifestPath: CONTROL_FILE,
      restartRequired: false,
      driftedPaths: [],
      reason: error.message,
    };
  }
  if (!controlState) {
    return {
      status: fs.existsSync(path.join(target, ".trellis")) ? "enabled" : "not-initialized",
      configuredPlatforms: fs.existsSync(path.join(target, ".trellis"))
        ? [...getConfiguredPlatforms(target)].sort(compareUtf8)
        : [],
      manifestPath: null,
      restartRequired: false,
      driftedPaths: [],
      reason: null,
    };
  }
  if (controlState.status === "repair-required") {
    return {
      status: "repair-required",
      configuredPlatforms: controlState.configuredPlatforms,
      manifestPath: controlState.manifestPath,
      restartRequired: false,
      driftedPaths: [],
      reason: "上次 Trellis 控制事务需要人工修复",
    };
  }
  try {
    const manifest = readDetachedManifest(target, controlState);
    for (const entry of manifest.entries) {
      readManifestMaterial(target, entry, "backupPath");
      if (entry.disabledPath !== null) readManifestMaterial(target, entry, "disabledPath");
    }
    const journalPath = `${DETACHED_ROOT}/${manifest.id}/restore-journal.json`;
    if (readFileIfExists(target, journalPath)) {
      throw new Error(`存在未完成恢复 journal:${journalPath}`);
    }
    const discovery = discoverIntegrationTargets(target);
    const discoveredByPath = new Map(
      discovery.targets.map((entry) => [entry.path, entry]),
    );
    const managedPaths = discovery.targets.map(({ path: entryPath }) => entryPath);
    const driftedPaths = manifest.entries
      .filter((entry) => {
        if (!verifyDisabledEntry(target, entry)) return true;
        if (entry.kind !== "json-fragment") return false;
        const discovered = discoveredByPath.get(entry.path);
        const current = discovered ? readFileIfExists(target, entry.path) : null;
        return Boolean(current && jsonMutation(current, discovered, managedPaths));
      })
      .map(({ path: entryPath }) => entryPath);
    const expectedPaths = new Set(manifest.entries.map(({ path: entryPath }) => entryPath));
    for (const discovered of discovery.targets) {
      if (expectedPaths.has(discovered.path)) continue;
      const file = readFileIfExists(target, discovered.path);
      if (!file) continue;
      if (isSharedJsonPath(discovered.path)) {
        try {
          if (!jsonMutation(file, discovered, managedPaths)) continue;
        } catch {
          // 共享 JSON 当前内容损坏属于入口漂移，不代表恢复证据损坏。
        }
        driftedPaths.push(discovered.path);
        continue;
      }
      if (discovered.path === "AGENTS.md") {
        const text = file.content.toString("utf8");
        if (!text.includes(TRELLIS_BLOCK_START) && !text.includes(TRELLIS_BLOCK_END)) continue;
      }
      driftedPaths.push(discovered.path);
    }
    const uniqueDrift = [...new Set(driftedPaths)].sort(compareUtf8);
    return {
      status: uniqueDrift.length > 0 ? "drifted" : "disabled",
      configuredPlatforms: controlState.configuredPlatforms,
      manifestPath: controlState.manifestPath,
      restartRequired: true,
      driftedPaths: uniqueDrift,
      reason: uniqueDrift.length > 0 ? "检测到 Trellis 集成入口重新出现" : null,
    };
  } catch (error) {
    return {
      status: "repair-required",
      configuredPlatforms: controlState.configuredPlatforms,
      manifestPath: controlState.manifestPath,
      restartRequired: false,
      driftedPaths: [],
      reason: error.message,
    };
  }
}

/**
 * 事务性关闭项目全部 Trellis 集成入口。
 *
 * @param {string} projectRoot 项目根目录
 * @param {{dryRun?:boolean,force?:boolean,replaceExisting?:boolean,onOperation?:(event:object)=>void}} [options] 关闭选项
 * @returns {{status:"disabled"|"dry-run"|"unchanged",changed:string[],configuredPlatforms:string[],manifestPath:string|null,warnings:string[]}} 关闭结果
 */
export function disableTrellis(projectRoot, options = {}) {
  const target = assertProjectRoot(projectRoot);
  const currentStatus = inspectTrellisControl(target);
  let replaceExisting = options.replaceExisting === true;
  const preserveExistingEvidence = currentStatus.status === "drifted" &&
    options.force === true && !replaceExisting;
  if (currentStatus.status === "disabled" && !replaceExisting) {
    return {
      status: "unchanged",
      changed: [],
      configuredPlatforms: currentStatus.configuredPlatforms,
      manifestPath: currentStatus.manifestPath,
      warnings: [],
    };
  }
  if (preserveExistingEvidence) replaceExisting = true;
  if (["drifted", "repair-required"].includes(currentStatus.status) && !replaceExisting) {
    throw controlError(
      currentStatus.status === "drifted"
        ? "Trellis disabled 状态已漂移；请先检查 status，或使用 --force 重新收敛"
        : "Trellis 控制状态需要修复，拒绝覆盖恢复证据",
      currentStatus.status === "drifted"
        ? TRELLIS_CONTROL_ERROR_CODES.CONFLICT
        : TRELLIS_CONTROL_ERROR_CODES.REPAIR_REQUIRED,
      { details: { status: currentStatus } },
    );
  }
  if (currentStatus.status === "not-initialized") {
    throw controlError(
      "目标项目尚未初始化 Trellis",
      TRELLIS_CONTROL_ERROR_CODES.USAGE_ERROR,
      { path: ".trellis" },
    );
  }
  const previousBundle = preserveExistingEvidence ? loadControlBundle(target) : null;
  const previousControl = replaceExisting
    ? previousBundle?.controlState || new ProjectStore(target).readTrellisControl()
    : null;
  const discovery = discoverIntegrationTargets(target);
  const plan = createDisablePlan(target, discovery, { force: options.force === true });
  const plannedByPath = new Map(plan.map((entry) => [entry.path, entry]));
  const previousEntries = new Map(
    (previousBundle?.manifest.entries || []).map((entry) => [entry.path, entry]),
  );
  if (preserveExistingEvidence) {
    const kindConflict = plan.find((entry) => (
      previousEntries.has(entry.path) && previousEntries.get(entry.path).kind !== entry.kind
    ));
    if (kindConflict) {
      throw controlError(
        `Trellis 漂移入口的 mutation 类型已变化:${kindConflict.path}`,
        TRELLIS_CONTROL_ERROR_CODES.CONFLICT,
        { path: kindConflict.path },
      );
    }
  }
  if (options.dryRun) {
    return {
      status: "dry-run",
      changed: plan.map(({ path: entryPath }) => entryPath),
      configuredPlatforms: discovery.configuredPlatforms,
      manifestPath: null,
      warnings: [],
    };
  }

  const transactionId = crypto.randomBytes(12).toString("hex");
  const transactionRoot = `${DETACHED_ROOT}/${transactionId}`;
  const manifestPath = `${transactionRoot}/manifest.json`;
  const store = new ProjectStore(target);
  const completed = [];
  const applied = [];
  const warnings = [];
  let manifest;
  try {
    store.ensureLayout();
    ensureOrdinaryDirectory(target, DETACHED_ROOT);
    ensureOrdinaryDirectory(target, transactionRoot);
    ensureOrdinaryDirectory(target, `${transactionRoot}/files`);
    ensureOrdinaryDirectory(target, `${transactionRoot}/disabled`);
    const payloads = [];
    if (preserveExistingEvidence) {
      for (const previousEntry of previousBundle.manifest.entries) {
        const planned = plannedByPath.get(previousEntry.path);
        const before = readManifestMaterial(target, previousEntry, "backupPath");
        const after = readManifestMaterial(target, previousEntry, "disabledPath");
        payloads.push({
          entry: {
            path: previousEntry.path,
            kind: previousEntry.kind,
            owners: [...new Set([
              ...previousEntry.owners,
              ...(planned?.owners || []),
            ])].sort(compareUtf8),
            before,
            after,
            mode: previousEntry.mode,
            ...(previousEntry.block ? { block: previousEntry.block } : {}),
          },
        });
        if (!planned) completed.push(previousEntry.path);
      }
    }
    if (preserveExistingEvidence) {
      for (const planned of plan) {
        if (previousEntries.has(planned.path)) continue;
        payloads.push({ entry: planned });
      }
    } else {
      for (const planned of plan) payloads.push({ entry: planned });
    }
    payloads.sort((left, right) => compareUtf8(left.entry.path, right.entry.path));
    const manifestEntries = payloads.map(({ entry }) => manifestEntry(transactionId, entry));
    const persistedByPath = new Map(manifestEntries.map((entry) => [entry.path, entry]));
    manifest = {
      schemaVersion: 1,
      id: transactionId,
      createdAt: new Date().toISOString(),
      configuredPlatforms: discovery.configuredPlatforms,
      entries: manifestEntries,
      completed,
    };
    validateTrellisDetachedManifest(manifest);
    for (const payload of payloads) {
      const persisted = persistedByPath.get(payload.entry.path);
      atomicWriteBuffer(target, persisted.backupPath, payload.entry.before, 0o600);
      if (persisted.disabledPath !== null) {
        atomicWriteBuffer(target, persisted.disabledPath, payload.entry.after, 0o600);
      }
    }
    if (preserveExistingEvidence) {
      const conflictRoot = `${transactionRoot}/conflicts/redetach`;
      const conflictEntries = [];
      for (const entry of plan.filter(({ path: entryPath }) => previousEntries.has(entryPath))) {
        const conflictPath = `${conflictRoot}/${encodedPath(entry.path)}.bin`;
        atomicWriteBuffer(target, conflictPath, entry.before, 0o600);
        conflictEntries.push({ path: entry.path, backupPath: conflictPath, mode: entry.mode });
      }
      if (conflictEntries.length > 0) {
        atomicWriteJson(target, `${conflictRoot}/manifest.json`, {
          schemaVersion: 1,
          createdAt: new Date().toISOString(),
          entries: conflictEntries,
        });
        warnings.push(`漂移入口现场已保留:${conflictRoot}`);
      }
    }
    atomicWriteJson(target, manifestPath, manifest);

    for (let index = 0; index < plan.length; index += 1) {
      const entry = plan[index];
      options.onOperation?.({ phase: "before-disable", path: entry.path, index });
      const actual = hashFileIfExists(resolveProjectPath(target, entry.path));
      if (actual !== hashContent(entry.before)) {
        throw controlError(
          `Trellis 目标在计划后发生漂移:${entry.path}`,
          TRELLIS_CONTROL_ERROR_CODES.CONFLICT,
          { path: entry.path },
        );
      }
      if (entry.after === null) removeFileIfExists(target, entry.path);
      else atomicWriteBuffer(target, entry.path, entry.after, entry.mode);
      applied.push(entry.path);
      if (!completed.includes(entry.path)) completed.push(entry.path);
      atomicWriteJson(target, manifestPath, manifest);
    }

    for (const entry of manifestEntries) {
      if (!verifyDisabledEntry(target, entry)) {
        throw controlError(
          `Trellis 关闭态校验失败:${entry.path}`,
          TRELLIS_CONTROL_ERROR_CODES.TRANSACTION_FAILED,
          { path: entry.path },
        );
      }
    }
    const controlState = {
      schemaVersion: 1,
      status: "disabled",
      transactionId,
      disabledAt: new Date().toISOString(),
      configuredPlatforms: discovery.configuredPlatforms,
      trellisVersion: trellisVersion(),
      flowerVersion: flowerVersion(),
      manifestPath,
      expectedDisabled: manifestEntries.map(({ path: entryPath, kind, afterHash }) => ({
        path: entryPath,
        kind,
        afterHash,
      })),
    };
    store.writeTrellisControl(controlState);
    if (previousControl && previousControl.transactionId !== transactionId) {
      try {
        fs.rmSync(
          resolveProjectPath(target, `${DETACHED_ROOT}/${previousControl.transactionId}`),
          { recursive: true, force: true },
        );
      } catch (error) {
        warnings.push(`旧恢复材料清理失败:${error.message}`);
      }
    }
    return {
      status: "disabled",
      changed: plan.map(({ path: entryPath }) => entryPath),
      configuredPlatforms: discovery.configuredPlatforms,
      manifestPath,
      warnings,
    };
  } catch (error) {
    const rollbackFailures = [];
    for (const completedPath of [...applied].reverse()) {
      const entry = plannedByPath.get(completedPath);
      try {
        options.onOperation?.({ phase: "rollback-disable", path: completedPath, index: 0 });
        atomicWriteBuffer(target, completedPath, entry.before, entry.mode);
      } catch (rollbackError) {
        rollbackFailures.push({ path: completedPath, error: rollbackError.message });
      }
    }
    if (rollbackFailures.length === 0) {
      try {
        fs.rmSync(resolveProjectPath(target, transactionRoot), { recursive: true, force: true });
      } catch {
        // 回滚已完成；残留 staging 不改变项目启停状态。
      }
      if (error instanceof TrellisControlError || error instanceof PluginError) throw error;
      throw controlError(
        "Trellis disable 事务失败，已恢复原状态",
        TRELLIS_CONTROL_ERROR_CODES.TRANSACTION_FAILED,
        { cause: error },
      );
    }
    const repairState = {
      schemaVersion: 1,
      status: "repair-required",
      transactionId,
      disabledAt: new Date().toISOString(),
      configuredPlatforms: discovery.configuredPlatforms,
      trellisVersion: trellisVersion(),
      flowerVersion: flowerVersion(),
      manifestPath,
      expectedDisabled: (manifest?.entries || []).map(({ path: entryPath, kind, afterHash }) => ({
        path: entryPath,
        kind,
        afterHash,
      })),
    };
    try {
      store.writeTrellisControl(repairState);
    } catch {
      // 原始事务与回滚错误更重要，恢复证据仍保留在 detached 目录。
    }
    throw controlError(
      `Trellis disable 失败且回滚不完整，证据保留于:${transactionRoot}`,
      TRELLIS_CONTROL_ERROR_CODES.REPAIR_REQUIRED,
      { cause: error, path: transactionRoot, details: { rollbackFailures } },
    );
  }
}

function mergeJsonRestore(base, desired, current, pointer = "") {
  if (deepEqual(current, base)) return cloneJson(desired);
  if (deepEqual(current, desired) || deepEqual(base, desired)) return cloneJson(current);
  if (Array.isArray(base) && Array.isArray(desired) && Array.isArray(current)) {
    const next = cloneJson(current);
    const usedBase = new Set();
    for (let index = 0; index < desired.length; index += 1) {
      const desiredEntry = desired[index];
      const exactBase = findArrayEntry(base, usedBase, (entry) => deepEqual(entry, desiredEntry));
      if (exactBase >= 0) {
        usedBase.add(exactBase);
        continue;
      }
      const identity = arrayIdentity(desiredEntry);
      const identityBase = identity === null ? -1 : findArrayEntry(
        base,
        usedBase,
        (entry) => arrayIdentity(entry) === identity,
      );
      const currentIndex = identity === null
        ? -1
        : next.findIndex((entry) => arrayIdentity(entry) === identity);
      if (identityBase >= 0) {
        usedBase.add(identityBase);
        if (currentIndex < 0) {
          next.splice(Math.min(index, next.length), 0, cloneJson(desiredEntry));
        } else {
          next[currentIndex] = mergeJsonRestore(
            base[identityBase],
            desiredEntry,
            next[currentIndex],
            `${pointer}/${index}`,
          );
        }
        continue;
      }
      if (next.some((entry) => jsonContains(entry, desiredEntry))) continue;
      if (currentIndex >= 0) {
        next[currentIndex] = mergeJsonRestore(
          identityMergeBase(desiredEntry, next[currentIndex]),
          desiredEntry,
          next[currentIndex],
          `${pointer}/${index}`,
        );
      } else {
        next.splice(Math.min(index, next.length), 0, cloneJson(desiredEntry));
      }
    }
    return next;
  }
  if (isPlainObject(base) && isPlainObject(desired) && isPlainObject(current)) {
    const next = cloneJson(current);
    const keys = new Set([...Object.keys(base), ...Object.keys(desired)]);
    for (const key of keys) {
      const childPointer = `${pointer}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`;
      const hasBase = Object.hasOwn(base, key);
      const hasDesired = Object.hasOwn(desired, key);
      const hasCurrent = Object.hasOwn(current, key);
      if (!hasBase && hasDesired) {
        if (!hasCurrent) next[key] = cloneJson(desired[key]);
        else if (!deepEqual(current[key], desired[key])) {
          throw controlError(
            `共享 JSON 恢复冲突:${childPointer}`,
            TRELLIS_CONTROL_ERROR_CODES.CONFLICT,
            { path: childPointer },
          );
        }
        continue;
      }
      if (hasBase && !hasDesired) continue;
      if (!hasCurrent) {
        if (!deepEqual(base[key], desired[key])) next[key] = cloneJson(desired[key]);
        continue;
      }
      next[key] = mergeJsonRestore(base[key], desired[key], current[key], childPointer);
    }
    return next;
  }
  throw controlError(
    `共享 JSON 恢复冲突:${pointer || "/"}`,
    TRELLIS_CONTROL_ERROR_CODES.CONFLICT,
    { path: pointer || "/" },
  );
}

function managedBlockRestore(entry, current, original, disabled) {
  if (current === null) return original;
  if (current.content.equals(original)) return current.content;
  const text = current.content.toString("utf8");
  if (text.includes(TRELLIS_BLOCK_START) || text.includes(TRELLIS_BLOCK_END)) {
    throw controlError(
      `AGENTS.md 已存在不同的 Trellis 管理块:${entry.path}`,
      TRELLIS_CONTROL_ERROR_CODES.CONFLICT,
      { path: entry.path },
    );
  }
  if (current.content.equals(disabled)) return original;
  const { prefix, suffix, content } = entry.block;
  const uniqueIndex = (needle) => {
    if (!needle) return -1;
    const index = text.indexOf(needle);
    return index >= 0 && text.indexOf(needle, index + needle.length) < 0 ? index : -1;
  };
  const suffixIndex = uniqueIndex(suffix);
  if (suffixIndex >= 0) {
    return Buffer.from(`${text.slice(0, suffixIndex)}${content}${text.slice(suffixIndex)}`);
  }
  const prefixIndex = uniqueIndex(prefix);
  if (prefixIndex >= 0) {
    const index = prefixIndex + prefix.length;
    return Buffer.from(`${text.slice(0, index)}${content}${text.slice(index)}`);
  }
  const prefixLine = prefix.split(/\r?\n/).filter((line) => line.trim()).at(-1) || "";
  const suffixLine = suffix.split(/\r?\n/).find((line) => line.trim()) || "";
  const suffixLineIndex = uniqueIndex(suffixLine);
  if (suffixLineIndex >= 0) {
    return Buffer.from(`${text.slice(0, suffixLineIndex)}${content}${text.slice(suffixLineIndex)}`);
  }
  const prefixLineIndex = uniqueIndex(prefixLine);
  if (prefixLineIndex >= 0) {
    const lineEnd = text.indexOf("\n", prefixLineIndex + prefixLine.length);
    const index = lineEnd < 0 ? text.length : lineEnd + 1;
    return Buffer.from(`${text.slice(0, index)}${content}${text.slice(index)}`);
  }
  throw controlError(
    "AGENTS.md 管理块局部锚点已变化或不唯一",
    TRELLIS_CONTROL_ERROR_CODES.CONFLICT,
    { path: entry.path },
  );
}

function createMaterializePlan(projectRoot, manifest, options) {
  const conflicts = [];
  const plan = [];
  for (const entry of manifest.entries) {
    const original = readManifestMaterial(projectRoot, entry, "backupPath");
    const disabled = readManifestMaterial(projectRoot, entry, "disabledPath");
    const current = readFileIfExists(projectRoot, entry.path);
    let desired;
    try {
      if (entry.kind === "exclusive-file") {
        if (current && !current.content.equals(original) && !options.force) {
          throw controlError(
            `恢复目标已存在用户内容:${entry.path}`,
            TRELLIS_CONTROL_ERROR_CODES.CONFLICT,
            { path: entry.path },
          );
        }
        desired = original;
      } else if (entry.kind === "managed-block") {
        desired = managedBlockRestore(entry, current, original, disabled);
      } else if (current === null || current.content.equals(disabled)) {
        desired = original;
      } else {
        let merged;
        try {
          merged = mergeJsonRestore(
            JSON.parse(disabled.toString("utf8")),
            JSON.parse(original.toString("utf8")),
            JSON.parse(current.content.toString("utf8")),
          );
        } catch (error) {
          if (!options.force) throw error;
          merged = JSON.parse(original.toString("utf8"));
        }
        desired = Buffer.from(stringifyCanonicalJson(merged));
      }
    } catch (error) {
      conflicts.push({ path: entry.path, reason: error.message });
      continue;
    }
    plan.push({
      entry,
      current,
      desired,
      preserveConflict: Boolean(current && !current.content.equals(disabled || Buffer.alloc(0)) && (
        entry.kind === "exclusive-file" || options.force
      )),
    });
  }
  if (conflicts.length > 0) {
    throw controlError(
      `Trellis enable 发现 ${conflicts.length} 个冲突，未写入任何文件`,
      TRELLIS_CONTROL_ERROR_CODES.CONFLICT,
      { path: conflicts[0].path, details: { conflicts } },
    );
  }
  return plan;
}

/**
 * 临时恢复 Trellis 集成入口，但保留 control state 与 detached evidence。
 *
 * @param {string} projectRoot 项目根目录
 * @param {{dryRun?:boolean,force?:boolean,onOperation?:(event:object)=>void}} [options] 恢复选项
 * @returns {{status:"materialized"|"dry-run",changed:string[],manifestPath:string,warnings:string[]}} 恢复结果
 */
export function materializeTrellis(projectRoot, options = {}) {
  const target = assertProjectRoot(projectRoot);
  const bundle = loadControlBundle(target);
  if (bundle.controlState.status === "repair-required") {
    throw controlError(
      "Trellis 控制状态需要修复，拒绝恢复",
      TRELLIS_CONTROL_ERROR_CODES.REPAIR_REQUIRED,
      { path: bundle.controlState.manifestPath },
    );
  }
  const plan = createMaterializePlan(target, bundle.manifest, { force: options.force === true });
  if (options.dryRun) {
    return {
      status: "dry-run",
      changed: plan.map(({ entry }) => entry.path),
      manifestPath: bundle.controlState.manifestPath,
      warnings: [],
    };
  }

  const journalPath = `${DETACHED_ROOT}/${bundle.manifest.id}/restore-journal.json`;
  const completed = [];
  const warnings = [];
  const conflictId = crypto.randomBytes(8).toString("hex");
  const conflictRoot = `${DETACHED_ROOT}/${bundle.manifest.id}/conflicts/${conflictId}`;
  const conflictEntries = [];
  try {
    for (const item of plan) {
      if (!item.preserveConflict || !item.current) continue;
      const conflictPath = `${conflictRoot}/${encodedPath(item.entry.path)}.bin`;
      atomicWriteBuffer(target, conflictPath, item.current.content, 0o600);
      conflictEntries.push({ path: item.entry.path, backupPath: conflictPath, mode: item.current.mode });
    }
    if (conflictEntries.length > 0) {
      atomicWriteJson(target, `${conflictRoot}/manifest.json`, {
        schemaVersion: 1,
        createdAt: new Date().toISOString(),
        entries: conflictEntries,
      });
      warnings.push(`冲突现场已保留:${conflictRoot}`);
    }
    atomicWriteJson(target, journalPath, {
      schemaVersion: 1,
      operation: "enable",
      createdAt: new Date().toISOString(),
      completed,
    });
    for (let index = 0; index < plan.length; index += 1) {
      const item = plan[index];
      options.onOperation?.({ phase: "before-enable", path: item.entry.path, index });
      const actual = hashFileIfExists(resolveProjectPath(target, item.entry.path));
      const expected = item.current === null ? null : hashContent(item.current.content);
      if (actual !== expected) {
        throw controlError(
          `Trellis 恢复目标在计划后发生漂移:${item.entry.path}`,
          TRELLIS_CONTROL_ERROR_CODES.CONFLICT,
          { path: item.entry.path },
        );
      }
      atomicWriteBuffer(target, item.entry.path, item.desired, item.entry.mode);
      completed.push(item.entry.path);
      atomicWriteJson(target, journalPath, {
        schemaVersion: 1,
        operation: "enable",
        createdAt: new Date().toISOString(),
        completed,
      });
    }
    removeFileIfExists(target, journalPath);
    return {
      status: "materialized",
      changed: plan.map(({ entry }) => entry.path),
      manifestPath: bundle.controlState.manifestPath,
      warnings,
    };
  } catch (error) {
    const rollbackFailures = [];
    const byPath = new Map(plan.map((item) => [item.entry.path, item]));
    for (const completedPath of [...completed].reverse()) {
      const item = byPath.get(completedPath);
      try {
        options.onOperation?.({ phase: "rollback-enable", path: completedPath, index: 0 });
        if (item.current === null) removeFileIfExists(target, completedPath);
        else atomicWriteBuffer(target, completedPath, item.current.content, item.current.mode);
      } catch (rollbackError) {
        rollbackFailures.push({ path: completedPath, error: rollbackError.message });
      }
    }
    if (rollbackFailures.length === 0) {
      removeFileIfExists(target, journalPath);
      if (error instanceof TrellisControlError || error instanceof PluginError) throw error;
      throw controlError(
        "Trellis enable 事务失败，已恢复 disabled 状态",
        TRELLIS_CONTROL_ERROR_CODES.TRANSACTION_FAILED,
        { cause: error },
      );
    }
    try {
      bundle.store.writeTrellisControl({ ...bundle.controlState, status: "repair-required" });
    } catch {
      // detached evidence 与 journal 仍保留，可供人工恢复。
    }
    throw controlError(
      `Trellis enable 失败且回滚不完整，证据保留于:${journalPath}`,
      TRELLIS_CONTROL_ERROR_CODES.REPAIR_REQUIRED,
      { path: journalPath, cause: error, details: { rollbackFailures } },
    );
  }
}

/**
 * 完成 Trellis enable，删除控制状态并尽力清理 detach 恢复材料。
 *
 * @param {string} projectRoot 项目根目录
 * @returns {{status:"enabled"|"unchanged",warnings:string[]}} 完成结果
 */
export function finalizeTrellisEnable(projectRoot) {
  const target = assertProjectRoot(projectRoot);
  const store = new ProjectStore(target);
  const controlState = store.readTrellisControl();
  if (!controlState) return { status: "unchanged", warnings: [] };
  const transactionRoot = `${DETACHED_ROOT}/${controlState.transactionId}`;
  const conflictsRoot = `${transactionRoot}/conflicts`;
  const retainEvidence = fs.existsSync(resolveProjectPath(target, conflictsRoot));
  store.removeTrellisControl();
  const warnings = [];
  if (retainEvidence) {
    warnings.push(`强制恢复的冲突现场已保留:${conflictsRoot}`);
  } else {
    try {
      fs.rmSync(resolveProjectPath(target, transactionRoot), { recursive: true, force: true });
    } catch (error) {
      warnings.push(`恢复材料清理失败:${error.message}`);
    }
  }
  return { status: "enabled", warnings };
}

/**
 * 把仍可读取的 Trellis 控制状态持久化为 repair-required。
 *
 * @param {string} projectRoot 项目根目录
 * @returns {boolean} 是否成功写入 repair-required 状态
 */
export function markTrellisRepairRequired(projectRoot) {
  const target = assertProjectRoot(projectRoot);
  try {
    const store = new ProjectStore(target);
    const controlState = store.readTrellisControl();
    if (!controlState) return false;
    store.writeTrellisControl({ ...controlState, status: "repair-required" });
    return true;
  } catch {
    return false;
  }
}

/**
 * 精确恢复关闭前现场并完成 enable，不运行版本规范化。
 *
 * @param {string} projectRoot 项目根目录
 * @param {{dryRun?:boolean,force?:boolean}} [options] 恢复选项
 * @returns {{status:"enabled"|"dry-run"|"unchanged",changed:string[],manifestPath:string|null,warnings:string[]}} 恢复结果
 */
export function enableTrellisExact(projectRoot, options = {}) {
  const status = inspectTrellisControl(projectRoot);
  if (status.status === "enabled") {
    return { status: "unchanged", changed: [], manifestPath: null, warnings: [] };
  }
  if (status.status === "not-initialized") {
    throw controlError(
      "目标项目尚未初始化 Trellis",
      TRELLIS_CONTROL_ERROR_CODES.USAGE_ERROR,
      { path: ".trellis" },
    );
  }
  if (status.status === "repair-required") {
    throw controlError(
      status.reason || "Trellis 控制状态需要修复",
      TRELLIS_CONTROL_ERROR_CODES.REPAIR_REQUIRED,
      { path: status.manifestPath || CONTROL_FILE },
    );
  }
  const materialized = materializeTrellis(projectRoot, options);
  if (options.dryRun) return materialized;
  const finalized = finalizeTrellisEnable(projectRoot);
  return {
    status: "enabled",
    changed: materialized.changed,
    manifestPath: null,
    warnings: [...materialized.warnings, ...finalized.warnings],
  };
}

/**
 * 在 disabled 项目中临时恢复 Trellis，执行 Flower 写链后重新关闭。
 *
 * @template T
 * @param {string} projectRoot 项目根目录
 * @param {(context:{extendSnapshot:(targets:string[])=>string[]})=>Promise<T>|T} operation 已获授权的 Flower 写操作
 * @returns {Promise<T>} 原操作结果
 */
export async function runWithTrellisIntegrationEnabled(projectRoot, operation) {
  const target = assertProjectRoot(projectRoot);
  const status = inspectTrellisControl(target);
  if (["enabled", "not-initialized"].includes(status.status)) {
    return await operation({ extendSnapshot: () => [] });
  }
  if (status.status !== "disabled") {
    throw controlError(
      status.reason || `Trellis 控制状态不可执行写链:${status.status}`,
      status.status === "drifted"
        ? TRELLIS_CONTROL_ERROR_CODES.CONFLICT
        : TRELLIS_CONTROL_ERROR_CODES.REPAIR_REQUIRED,
      { details: { status } },
    );
  }
  const snapshot = createUpdateSnapshot(target);
  try {
    materializeTrellis(target);
    const result = await operation({
      extendSnapshot: (targets) => extendUpdateSnapshot(snapshot, targets),
    });
    disableTrellis(target, { force: true, replaceExisting: true });
    disposeUpdateSnapshot(snapshot);
    return result;
  } catch (error) {
    const recovery = restoreUpdateSnapshot(snapshot);
    if (recovery.ok) {
      disposeUpdateSnapshot(snapshot);
      throw error;
    }
    const controlStateMarked = markTrellisRepairRequired(target);
    throw controlError(
      `Flower 写链失败且 Trellis disabled 现场恢复不完整:${recovery.manifestPath}`,
      TRELLIS_CONTROL_ERROR_CODES.REPAIR_REQUIRED,
      {
        cause: error,
        path: recovery.manifestPath,
        details: { ...recovery, controlStateMarked },
      },
    );
  }
}
