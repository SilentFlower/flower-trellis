import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { preserveFirstBackup } from "./backup.js";
import { shouldInstallName } from "./skill-filter.js";
import { materializeTrellisPythonText } from "./trellis-python-command.js";

const PATCH_SCHEMA_VERSION = 2;
const BUNDLE_SCHEMA_VERSION = 1;
const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const LEGACY_ID_RE = /^[a-z0-9][a-z0-9_-]*$/;
const OPERATIONS = new Set(["insert", "replace", "remove"]);
const TARGET_KINDS = new Set([
  "workflow",
  "skill",
  "command",
  "hook",
  "markdown",
  "file",
  "json",
  "yaml",
  "toml",
]);
const CORE_SELECTORS = new Set([
  "literal",
  "workflow-state",
  "workflow-hub",
  "markdown-section",
  "markdown-document",
  "whole-file",
]);
const MISSING_POLICIES = new Set(["skip", "create", "error"]);
const CREATABLE_TARGET_KINDS = new Set(["json", "yaml", "toml"]);
const TARGET_POLICIES = new Set(["each-existing", "at-least-one", "required-all"]);
const INSERT_POSITIONS = new Set(["before", "after"]);
const MARKER_STYLES = new Set(["html", "hash", "slash", "none"]);
const INSTALL_MODES = new Set(["full-or-selected", "full-only"]);
const LEGACY_MARKER_CATALOGS = new Set(["skill-garden", "flower"]);

function escapeRe(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeText(value) {
  return value.replace(/\s+$/, "") + "\n";
}

function sha256(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} 必须是对象`);
  }
}

function assertId(value, label) {
  if (typeof value !== "string" || !ID_RE.test(value)) {
    throw new Error(`${label} 必须是小写连字符 ID`);
  }
}

function assertLegacyId(value, label) {
  if (typeof value !== "string" || !LEGACY_ID_RE.test(value)) {
    throw new Error(`${label} 必须是安全的历史 ID`);
  }
}

function assertOperationRef(value, label) {
  if (typeof value !== "string") {
    throw new Error(`${label} 必须是 operation ID`);
  }
  const parts = value.split("/");
  if (parts.length < 1 || parts.length > 2 || parts.some((part) => !ID_RE.test(part))) {
    throw new Error(`${label} 必须是 local ID 或 <catalog-id>/<operation-id>`);
  }
}

function qualifyId(catalogId, localId) {
  return `${catalogId}/${localId}`;
}

function resolveRelativePath(root, relativePath, label) {
  if (
    typeof relativePath !== "string" ||
    !relativePath ||
    relativePath.includes("\\") ||
    path.posix.isAbsolute(relativePath) ||
    path.win32.isAbsolute(relativePath)
  ) {
    throw new Error(`${label} 必须是 POSIX 相对路径`);
  }
  const parts = relativePath.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error(`${label} 包含不安全路径片段:${relativePath}`);
  }
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, ...parts);
  if (!resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`${label} 逃逸根目录:${relativePath}`);
  }
  return resolved;
}

function assertExistingPathInside(root, file, label) {
  const realRoot = fs.realpathSync(root);
  const realFile = fs.realpathSync(file);
  if (realFile !== realRoot && !realFile.startsWith(`${realRoot}${path.sep}`)) {
    throw new Error(`${label} 通过软链逃逸根目录:${file}`);
  }
}

function listRecursive(root, predicate) {
  const files = [];
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile() && predicate(file)) files.push(file);
    }
  }
  walk(root);
  return files.sort();
}

function readSourceFile(leafDir, relativePath, label) {
  const file = resolveRelativePath(leafDir, relativePath, label);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    throw new Error(`${label} 不存在:${relativePath}`);
  }
  assertExistingPathInside(leafDir, file, label);
  const value = fs.readFileSync(file, "utf8");
  if (!value) throw new Error(`${label} 不能为空:${relativePath}`);
  return value;
}

function readTextSources(leafDir, raw, label) {
  assertPlainObject(raw, label);
  const hasSource = Object.prototype.hasOwnProperty.call(raw, "source");
  const hasSources = Object.prototype.hasOwnProperty.call(raw, "sources");
  const hasValue = Object.prototype.hasOwnProperty.call(raw, "value");
  if ([hasSource, hasSources, hasValue].filter(Boolean).length !== 1) {
    throw new Error(`${label} 必须且只能声明 source、sources 或 value`);
  }
  if (hasValue) return raw.value;
  if (hasSource) return readSourceFile(leafDir, raw.source, `${label}.source`);
  if (!Array.isArray(raw.sources) || raw.sources.length === 0) {
    throw new Error(`${label}.sources 必须是非空数组`);
  }
  return raw.sources
    .map((source, index) => readSourceFile(leafDir, source, `${label}.sources[${index}]`))
    .map((value) => value.replace(/\s+$/, ""))
    .join("\n");
}

function countOccurrences(value, needle) {
  if (!needle) return 0;
  let count = 0;
  let offset = 0;
  while (true) {
    const index = value.indexOf(needle, offset);
    if (index === -1) return count;
    count++;
    offset = index + needle.length;
  }
}

function markerLines(namespace, id, markerStyle) {
  const label = `skill-garden ${namespace} ${id} v0.6`;
  if (markerStyle === "hash") return [`# BEGIN ${label}`, `# END ${label}`];
  if (markerStyle === "slash") return [`// BEGIN ${label}`, `// END ${label}`];
  return [`<!-- BEGIN ${label} -->`, `<!-- END ${label} -->`];
}

function markerParts(namespace, id, content, markerStyle = "html") {
  const [begin, end] = markerLines(namespace, id, markerStyle);
  const body = typeof content === "string" && content
    ? content.replace(/\s+$/, "") + "\n"
    : "";
  return {
    begin,
    end,
    block: `${begin}\n${body}${end}`,
    re: new RegExp(`${escapeRe(begin)}\n[\\s\\S]*?${escapeRe(end)}`, "g"),
  };
}

function activeManagedMarker(value, operation) {
  if (operation.markerStyle === "none") return { active: null };
  const candidates = [
    {
      namespace: "patch",
      id: operation.markerId,
      style: operation.markerStyle,
      source: "managed-marker",
    },
    ...operation.legacyMarkers.map((item) => ({
      namespace: item.namespace,
      id: item.id,
      style: item.style || operation.markerStyle,
      source: "legacy-marker",
    })),
  ];
  if (operation.markerStyle !== "html") {
    candidates.push({
      namespace: "patch",
      id: operation.markerId,
      style: "html",
      source: "legacy-marker-style",
    });
  }

  const active = [];
  for (const candidate of candidates) {
    const marker = markerParts(candidate.namespace, candidate.id, operation.content, candidate.style);
    const beginCount = countOccurrences(value, marker.begin);
    const endCount = countOccurrences(value, marker.end);
    if (beginCount !== endCount) {
      return { error: `managed marker 不配对:${beginCount}/${endCount}` };
    }
    if (beginCount > 0) active.push({ ...candidate, marker, count: beginCount });
  }
  if (active.length > 1) return { error: "managed marker 同时存在多种新旧形式" };
  if (active.length === 0) return { active: null };
  if (active[0].count !== operation.expectedMatches) {
    return {
      error: `managed marker 数量 ${active[0].count} 不等于预期 ${operation.expectedMatches}`,
    };
  }
  return { active: active[0] };
}

function managedBlock(operation) {
  if (operation.markerStyle === "none") {
    const block = operation.operation === "remove"
      ? ""
      : operation.content.replace(/\s+$/, "");
    return { begin: "", end: "", block, re: null };
  }
  return markerParts("patch", operation.markerId, operation.content, operation.markerStyle);
}

function stripLegacySkillOverride(value, id) {
  const beginPrefix = `<!-- BEGIN skill-garden skill override ${id}`;
  const endPrefix = `<!-- END skill-garden skill override ${id}`;
  const lines = value.split("\n");
  const begin = lines.findIndex((line) => line.startsWith(beginPrefix));
  if (begin === -1) return { value, changed: false };
  const end = lines.findIndex((line, index) => index >= begin && line.startsWith(endPrefix));
  if (end === -1) throw new Error(`legacy skill override marker 不配对:${id}`);
  let start = begin;
  while (start > 0 && !lines[start - 1].trim()) start--;
  if (start > 0 && /^#{2,4} HIGHEST PRIORITY: skill-garden /.test(lines[start - 1])) start--;
  lines.splice(start, end - start + 1);
  while (start > 0 && lines[start - 1] === "" && lines[start] === "") lines.splice(start, 1);
  while (lines[start] === "" && lines[start + 1] === "") lines.splice(start, 1);
  return { value: lines.join("\n"), changed: true };
}

function stripLegacyWorkflowHub(value) {
  const beginPrefix = "<!-- BEGIN skill-garden overrides";
  const endPrefix = "<!-- END skill-garden overrides";
  const lines = value.split("\n");
  const begin = lines.findIndex((line) => line.startsWith(beginPrefix));
  if (begin === -1) return { value, changed: false };
  const end = lines.findIndex((line, index) => index >= begin && line.startsWith(endPrefix));
  if (end === -1) throw new Error("legacy workflow hub marker 不配对");
  let start = begin;
  while (start > 0 && !lines[start - 1].trim()) start--;
  if (start > 0 && /^#{2,4} HIGHEST PRIORITY: skill-garden overrides/.test(lines[start - 1])) start--;
  lines.splice(start, end - start + 1);
  while (start > 0 && lines[start - 1] === "" && lines[start] === "") lines.splice(start, 1);
  while (lines[start] === "" && lines[start + 1] === "") lines.splice(start, 1);
  return { value: lines.join("\n"), changed: true };
}

function applyCleanup(value, cleanup) {
  let next = value;
  let changed = false;
  for (const item of cleanup) {
    let result;
    if (item.type === "skill-override") result = stripLegacySkillOverride(next, item.id);
    else if (item.type === "workflow-hub") result = stripLegacyWorkflowHub(next);
    else throw new Error(`不支持的 legacy cleanup:${item.type}`);
    next = result.value;
    changed = changed || result.changed;
  }
  return { value: next, changed };
}

function replaceAllLiteral(value, needle, replacement) {
  return value.split(needle).join(replacement);
}

function applyLiteral(value, operation) {
  const active = activeManagedMarker(value, operation);
  if (active.error) return active;
  const managed = managedBlock(operation);
  if (active.active) {
    return {
      value: value.replace(active.active.marker.re, managed.block),
      source: active.active.source,
    };
  }
  if (
    operation.markerStyle === "none"
    && operation.operation !== "remove"
    && countOccurrences(value, managed.block) === operation.expectedMatches
    && countOccurrences(value, operation.selectorText) === 0
  ) {
    return { value, source: "desired-content" };
  }
  const matches = countOccurrences(value, operation.selectorText);
  if (matches !== operation.expectedMatches) {
    return { error: `selector 匹配 ${matches} 次,预期 ${operation.expectedMatches} 次` };
  }
  if (operation.operation === "replace" || operation.operation === "remove") {
    return {
      value: replaceAllLiteral(value, operation.selectorText, managed.block),
      source: "selector",
    };
  }
  const replacement = operation.position === "before"
    ? `${managed.block}\n${operation.selectorText}`
    : `${operation.selectorText}\n${managed.block}`;
  return {
    value: replaceAllLiteral(value, operation.selectorText, replacement),
    source: "selector",
  };
}

function workflowStateParts(value, name) {
  const re = new RegExp(
    `^(\\[workflow-state:${escapeRe(name)}\\]\\n)([\\s\\S]*?)(^\\[/workflow-state:${escapeRe(name)}\\])`,
    "m",
  );
  const match = re.exec(value);
  return match ? { re, match } : null;
}

function applyWorkflowState(value, operation) {
  if (operation.operation !== "replace" || operation.scope !== "body") {
    return { error: "workflow-state 只支持 replace body" };
  }
  const parts = workflowStateParts(value, operation.selector.name);
  if (!parts) return { error: `未找到 workflow-state:${operation.selector.name}` };
  const body = parts.match[2];
  const active = activeManagedMarker(body, operation);
  if (active.error) return active;
  let source = active.active?.source || null;
  if (!source) {
    const baselineMatch = operation.baselines.some(
      (baseline) => baseline.replace(/^\n+|\s+$/g, "") === body.replace(/^\n+|\s+$/g, ""),
    );
    const legacyMatch = operation.legacyMarkers.some((item) => {
      const styles = [...new Set([item.style || operation.markerStyle, "html"])]
        .filter((style) => style !== "none");
      return styles.some((style) => body.includes(markerLines(item.namespace, item.id, style)[0]));
    });
    if (!baselineMatch && !legacyMatch) {
      return { error: `workflow-state:${operation.selector.name} body fingerprint 漂移` };
    }
    source = legacyMatch ? "legacy-marker" : "baseline";
  }
  const managed = managedBlock(operation);
  const replacement = `${parts.match[1]}${managed.block}\n${parts.match[3]}`;
  return { value: value.replace(parts.re, replacement), source };
}

function findHeadingSection(value, heading) {
  const lines = value.split("\n");
  const startLine = lines.findIndex((line) => line === heading);
  if (startLine === -1) return null;
  const level = heading.match(/^#+/)?.[0].length;
  if (!level) return null;
  let endLine = lines.length;
  for (let i = startLine + 1; i < lines.length; i++) {
    const match = /^(#+)\s/.exec(lines[i]);
    if (match && match[1].length <= level) {
      endLine = i;
      break;
    }
  }
  const before = lines.slice(0, startLine).join("\n");
  const section = lines.slice(startLine, endLine).join("\n");
  const after = lines.slice(endLine).join("\n");
  return { before, section, after };
}

function applyMarkdownSection(value, operation) {
  const active = activeManagedMarker(value, operation);
  if (active.error) return active;
  const managed = managedBlock(operation);
  if (active.active) {
    return {
      value: value.replace(active.active.marker.re, managed.block),
      source: active.active.source,
    };
  }
  const found = findHeadingSection(value, operation.selector.heading);
  if (!found) return { error: `未找到 Markdown section:${operation.selector.heading}` };
  if (operation.baselines.length > 0 && !operation.baselines.some(
    (baseline) => baseline.replace(/\s+$/, "") === found.section.replace(/\s+$/, ""),
  )) {
    return { error: `Markdown section fingerprint 漂移:${operation.selector.heading}` };
  }
  const replacement = operation.operation === "insert"
    ? operation.position === "before"
      ? `${managed.block}\n${found.section}`
      : `${found.section}\n${managed.block}`
    : managed.block;
  const chunks = [found.before, replacement, found.after].filter((item, index) => item || index === 1);
  return { value: chunks.join("\n"), source: "selector" };
}

function frontmatterEnd(value) {
  const match = /^---\n[\s\S]*?\n---\n/.exec(value);
  return match ? match[0].length : 0;
}

function applyMarkdownDocument(value, operation) {
  if (operation.operation !== "replace" || operation.scope !== "body") {
    return { error: "markdown-document 只支持 replace body" };
  }
  const offset = frontmatterEnd(value);
  if (operation.selector.preserveFrontmatter === true && offset === 0) {
    return { error: "目标缺少 Markdown frontmatter" };
  }
  const body = value.slice(offset).replace(/^\n+/, "");
  const active = activeManagedMarker(body, operation);
  if (active.error) return active;
  if (!active.active && operation.baselines.length > 0 && !operation.baselines.some(
    (baseline) => baseline.replace(/^\n+|\s+$/g, "") === body.replace(/^\n+|\s+$/g, ""),
  )) {
    return { error: "Markdown document body fingerprint 漂移" };
  }
  const prefix = value.slice(0, offset).replace(/\s+$/, "");
  const managed = managedBlock(operation);
  return {
    value: `${prefix}\n\n${managed.block}\n`,
    source: active.active?.source || "baseline",
  };
}

function applyWorkflowHub(value, operation) {
  if (operation.operation !== "insert") return { error: "workflow-hub 只支持 insert" };
  const active = activeManagedMarker(value, operation);
  if (active.error) return active;
  const managed = managedBlock(operation);
  if (active.active) {
    return {
      value: value.replace(active.active.marker.re, managed.block),
      source: active.active.source,
    };
  }
  const heading = operation.selector.heading;
  const index = value.indexOf(`${heading}\n`);
  if (index === -1 || countOccurrences(value, `${heading}\n`) !== operation.expectedMatches) {
    return { error: `workflow hub 锚点匹配异常:${heading}` };
  }
  const end = index + heading.length + 1;
  return {
    value: `${value.slice(0, end)}\n${managed.block}\n\n${value.slice(end).replace(/^\n+/, "")}`,
    source: "selector",
  };
}

function applyWholeFile(value, operation) {
  if (operation.operation !== "replace") return { error: "whole-file 只支持 replace" };
  const desired = normalizeText(operation.content);
  if (normalizeText(value) === desired) return { value: desired, source: "desired-content" };
  if (operation.baselines.length > 0 && !operation.baselines.some(
    (baseline) => normalizeText(baseline) === normalizeText(value),
  )) {
    return { error: "whole-file fingerprint 漂移" };
  }
  return { value: desired, source: "baseline" };
}

function applyCoreOperation(value, operation) {
  if (operation.selector.type === "literal") return applyLiteral(value, operation);
  if (operation.selector.type === "workflow-state") return applyWorkflowState(value, operation);
  if (operation.selector.type === "workflow-hub") return applyWorkflowHub(value, operation);
  if (operation.selector.type === "markdown-section") return applyMarkdownSection(value, operation);
  if (operation.selector.type === "markdown-document") return applyMarkdownDocument(value, operation);
  if (operation.selector.type === "whole-file") return applyWholeFile(value, operation);
  return { error: `不支持的 Core selector:${operation.selector.type}` };
}

function normalizeLegacyMarkers(raw, label) {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new Error(`${label} 必须是数组`);
  return raw.map((item, index) => {
    assertPlainObject(item, `${label}[${index}]`);
    if (typeof item.namespace !== "string" || !item.namespace) {
      throw new Error(`${label}[${index}].namespace 必须是非空字符串`);
    }
    assertLegacyId(item.id, `${label}[${index}].id`);
    if (item.style !== undefined && !MARKER_STYLES.has(item.style)) {
      throw new Error(`${label}[${index}].style 不支持:${item.style}`);
    }
    return { namespace: item.namespace, id: item.id, style: item.style };
  });
}

function normalizeCleanup(raw, label) {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new Error(`${label} 必须是数组`);
  return raw.map((item, index) => {
    assertPlainObject(item, `${label}[${index}]`);
    if (!new Set(["skill-override", "workflow-hub"]).has(item.type)) {
      throw new Error(`${label}[${index}].type 不支持:${item.type}`);
    }
    if (item.type === "skill-override") assertId(item.id, `${label}[${index}].id`);
    return { type: item.type, id: item.id };
  });
}

function normalizeBaselines(raw, leafDir, label) {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length === 0) throw new Error(`${label} 必须是非空数组`);
  return raw.map((source, index) => readSourceFile(leafDir, source, `${label}[${index}]`));
}

function normalizeTarget(raw, patchId, operationId, index) {
  assertPlainObject(raw, `patch ${patchId} operation ${operationId} targets[${index}]`);
  if (!TARGET_KINDS.has(raw.kind)) {
    throw new Error(`patch ${operationId} target.kind 不支持:${raw.kind}`);
  }
  const markerStyle = raw.markerStyle || (
    raw.kind === "hook" ? "hash" : raw.kind === "file" ? "none" : "html"
  );
  if (!MARKER_STYLES.has(markerStyle)) {
    throw new Error(`patch ${operationId} target.markerStyle 不支持:${markerStyle}`);
  }
  const missing = raw.missing || "skip";
  if (!MISSING_POLICIES.has(missing)) {
    throw new Error(`patch ${operationId} target.missing 不支持:${missing}`);
  }
  if (missing === "create" && !CREATABLE_TARGET_KINDS.has(raw.kind)) {
    throw new Error(`patch ${operationId} missing=create 只允许 json/yaml/toml target`);
  }
  const requires = raw.requires || [];
  if (!Array.isArray(requires) || !requires.every((item) => typeof item === "string" && item)) {
    throw new Error(`patch ${operationId} target.requires 必须是字符串数组`);
  }
  return { kind: raw.kind, path: raw.path, markerStyle, missing, requires };
}

function normalizeSelector(raw, leafDir, patchId, operationId, allowedSelectors) {
  assertPlainObject(raw, `patch ${patchId} operation ${operationId} selector`);
  if (typeof raw.type !== "string" || !allowedSelectors.has(raw.type)) {
    throw new Error(`patch ${operationId} selector.type 不支持:${raw.type}`);
  }
  const expectedMatches = raw.expectedMatches ?? 1;
  if (!Number.isInteger(expectedMatches) || expectedMatches < 1) {
    throw new Error(`patch ${operationId} expectedMatches 必须是正整数`);
  }
  const selector = { ...raw, expectedMatches };
  if (raw.type === "literal") {
    selector.text = readSourceFile(leafDir, raw.source, `patch ${operationId} selector.source`)
      .replace(/\s+$/, "");
    if (!selector.text) throw new Error(`patch ${operationId} selector 不能为空`);
  }
  if (raw.type === "workflow-state") {
    if (typeof raw.name !== "string" || !raw.name) {
      throw new Error(`patch ${operationId} workflow-state name 必须是非空字符串`);
    }
  }
  if (raw.type === "workflow-hub") {
    if (typeof raw.heading !== "string" || !/^##\s/.test(raw.heading)) {
      throw new Error(`patch ${operationId} workflow-hub heading 必须是二级标题`);
    }
  }
  if (raw.type === "markdown-section") {
    if (typeof raw.heading !== "string" || !/^#+\s/.test(raw.heading)) {
      throw new Error(`patch ${operationId} markdown-section heading 非法`);
    }
  }
  return selector;
}

function normalizeOperationRefs(raw, label, catalogId) {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new Error(`${label} 必须是字符串数组`);
  raw.forEach((item, index) => assertOperationRef(item, `${label}[${index}]`));
  const qualified = raw.map((item) => item.includes("/") ? item : qualifyId(catalogId, item));
  if (new Set(qualified).size !== qualified.length) throw new Error(`${label} 不能重复`);
  return raw;
}

function normalizeOperation(raw, leafDir, patch, seenOperationIds, allowedSelectors) {
  assertPlainObject(raw, `patch ${patch.id} operation`);
  assertId(raw.id, `patch ${patch.id} operation.id`);
  if (seenOperationIds.has(raw.id)) throw new Error(`重复 patch operation id:${raw.id}`);
  seenOperationIds.add(raw.id);
  const after = normalizeOperationRefs(raw.after, `patch ${raw.id} after`, patch.catalog);
  const dependsOn = normalizeOperationRefs(
    raw.dependsOn,
    `patch ${raw.id} dependsOn`,
    patch.catalog,
  );
  const dependsOnIds = new Set(dependsOn.map((item) =>
    item.includes("/") ? item : qualifyId(patch.catalog, item)
  ));
  const duplicatedRelation = after.find((item) => dependsOnIds.has(
    item.includes("/") ? item : qualifyId(patch.catalog, item),
  ));
  if (duplicatedRelation) {
    throw new Error(`patch ${raw.id} 同一依赖不能同时声明 after 和 dependsOn:${duplicatedRelation}`);
  }
  if (!OPERATIONS.has(raw.operation)) {
    throw new Error(`patch ${raw.id} operation 不支持:${raw.operation}`);
  }
  if (!Array.isArray(raw.targets) || raw.targets.length === 0) {
    throw new Error(`patch ${raw.id} targets 不能为空`);
  }
  const selector = normalizeSelector(raw.selector, leafDir, patch.id, raw.id, allowedSelectors);
  const required = raw.required ?? patch.required ?? true;
  if (typeof required !== "boolean") throw new Error(`patch ${raw.id} required 必须是布尔值`);
  const targetPolicy = raw.targetPolicy || "each-existing";
  if (!TARGET_POLICIES.has(targetPolicy)) {
    throw new Error(`patch ${raw.id} targetPolicy 不支持:${targetPolicy}`);
  }
  let content = "";
  if (raw.operation === "remove") {
    if (raw.content !== undefined) throw new Error(`patch ${raw.id} remove 不能声明 content`);
  } else {
    content = readTextSources(leafDir, raw.content, `patch ${raw.id} content`);
  }
  if (raw.operation === "insert" && !INSERT_POSITIONS.has(raw.position)) {
    throw new Error(`patch ${raw.id} insert position 必须是 before 或 after`);
  }
  const targets = raw.targets.map((target, index) =>
    normalizeTarget(target, patch.id, raw.id, index)
  );
  return {
    id: raw.id,
    catalog: patch.catalog,
    qualifiedId: qualifyId(patch.catalog, raw.id),
    markerId: patch.markerIdentity === "legacy"
      ? raw.id
      : qualifyId(patch.catalog, raw.id),
    patchId: patch.id,
    qualifiedPatchId: patch.qualifiedId,
    purpose: patch.purpose,
    operation: raw.operation,
    required,
    targetPolicy,
    targets,
    selector,
    selectorText: selector.text,
    expectedMatches: selector.expectedMatches,
    content: typeof content === "string" ? content.replace(/\s+$/, "") : content,
    position: raw.position,
    scope: raw.scope,
    legacyMarkers: normalizeLegacyMarkers(raw.legacyMarkers, `patch ${raw.id} legacyMarkers`),
    cleanup: normalizeCleanup(raw.cleanup, `patch ${raw.id} cleanup`),
    baselines: normalizeBaselines(raw.baselines, leafDir, `patch ${raw.id} baselines`),
    afterRefs: after,
    dependsOnRefs: dependsOn,
  };
}

/**
 * 校验 catalog descriptor 的 policy 文件边界并返回规范化绝对路径。
 *
 * @param {{id:string,patchesDir:string,policy?:object}} catalog catalog descriptor
 * @returns {{compatibilityFile?:string,conflictsFile?:string}|null} 已校验 policy 路径
 */
export function resolvePatchCatalogPolicy(catalog) {
  if (catalog.policy === undefined) return null;
  assertPlainObject(catalog.policy, `catalog ${catalog.id} policy`);
  if (typeof catalog.patchesDir !== "string" || !catalog.patchesDir) {
    throw new Error(`catalog ${catalog.id} patchesDir 必须是目录路径`);
  }
  const catalogRoot = path.dirname(path.resolve(catalog.patchesDir));
  if (!fs.existsSync(catalogRoot) || !fs.statSync(catalogRoot).isDirectory()) {
    throw new Error(`catalog ${catalog.id} 根目录不存在:${catalogRoot}`);
  }
  const policy = {};
  for (const key of ["compatibilityFile", "conflictsFile"]) {
    const value = catalog.policy[key];
    if (value === undefined) continue;
    if (typeof value !== "string" || !value) {
      throw new Error(`catalog ${catalog.id} policy.${key} 必须是文件路径`);
    }
    const file = path.resolve(value);
    if (!file.startsWith(`${catalogRoot}${path.sep}`)) {
      throw new Error(`catalog ${catalog.id} policy.${key} 必须位于 catalog 根目录内`);
    }
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      throw new Error(`catalog ${catalog.id} policy.${key} 不存在:${value}`);
    }
    assertExistingPathInside(catalogRoot, file, `catalog ${catalog.id} policy.${key}`);
    policy[key] = file;
  }
  return policy;
}

function resolveCatalogPolicy(catalog, catalogFiles) {
  const policy = resolvePatchCatalogPolicy(catalog);
  if (policy) catalogFiles.push(...Object.values(policy));
  return policy;
}

function resolveCatalogPythonCommand(catalog) {
  if (catalog.textMaterialization === undefined) return null;
  assertPlainObject(catalog.textMaterialization, `catalog ${catalog.id} textMaterialization`);
  const keys = Object.keys(catalog.textMaterialization);
  if (keys.length !== 1 || keys[0] !== "trellisPythonCommand") {
    throw new Error(`catalog ${catalog.id} textMaterialization 只支持 trellisPythonCommand`);
  }
  const command = catalog.textMaterialization.trellisPythonCommand;
  if (typeof command !== "string" || !command.trim()) {
    throw new Error(`catalog ${catalog.id} textMaterialization.trellisPythonCommand 必须是非空字符串`);
  }
  return command;
}

function materializeOperationPythonCommand(operation, command) {
  if (!command) return operation;
  const selectorText = typeof operation.selectorText === "string"
    ? materializeTrellisPythonText(operation.selectorText, command)
    : operation.selectorText;
  return {
    ...operation,
    selector: {
      ...operation.selector,
      ...(typeof operation.selector.text === "string" ? { text: selectorText } : {}),
    },
    selectorText,
    content: typeof operation.content === "string"
      ? materializeTrellisPythonText(operation.content, command)
      : operation.content,
    baselines: operation.baselines.map((baseline) =>
      materializeTrellisPythonText(baseline, command)
    ),
  };
}

function loadCatalog(catalog, skills, allowedSelectors) {
  assertPlainObject(catalog, "Patch catalog");
  assertId(catalog.id, "Patch catalog.id");
  const pythonCommand = resolveCatalogPythonCommand(catalog);
  const patchesDir = path.resolve(catalog.patchesDir);
  const bundlesDir = path.resolve(catalog.bundlesDir);
  const catalogRoot = path.dirname(patchesDir);
  if (!bundlesDir.startsWith(`${catalogRoot}${path.sep}`)) {
    throw new Error(`catalog ${catalog.id} bundlesDir 必须位于 catalog 根目录内`);
  }
  if (!fs.existsSync(patchesDir)) {
    return {
      id: catalog.id,
      bundles: [],
      patches: [],
      allPatches: [],
      catalogEntries: [],
      policy: null,
    };
  }
  const patchByRef = new Map();
  const catalogFiles = [];
  const seenPatchIds = new Set();
  const seenOperationIds = new Set();
  const markerIdentity = LEGACY_MARKER_CATALOGS.has(catalog.id) ? "legacy" : "qualified";
  for (const file of listRecursive(patchesDir, (candidate) => path.basename(candidate) === "patch.json")) {
    const leafDir = path.dirname(file);
    const ref = path.relative(patchesDir, leafDir).split(path.sep).join("/");
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    assertPlainObject(raw, `patch declaration ${ref}`);
    if (raw.schemaVersion !== PATCH_SCHEMA_VERSION) {
      throw new Error(`patch declaration ${ref} schemaVersion 不支持:${raw.schemaVersion}`);
    }
    assertId(raw.id, `patch declaration ${ref} id`);
    if (seenPatchIds.has(raw.id)) throw new Error(`重复 patch id:${raw.id}`);
    seenPatchIds.add(raw.id);
    if (typeof raw.purpose !== "string" || !raw.purpose) {
      throw new Error(`patch declaration ${ref} purpose 必须是非空字符串`);
    }
    if (!Array.isArray(raw.operations) || raw.operations.length === 0) {
      throw new Error(`patch declaration ${ref} operations 不能为空`);
    }
    const patch = {
      id: raw.id,
      ref,
      purpose: raw.purpose,
      required: raw.required,
      operations: [],
      catalog: catalog.id,
      qualifiedId: qualifyId(catalog.id, raw.id),
      markerIdentity,
    };
    patch.operations = raw.operations.map((operation) => materializeOperationPythonCommand(
      normalizeOperation(operation, leafDir, patch, seenOperationIds, allowedSelectors),
      pythonCommand,
    ));
    patchByRef.set(ref, patch);
    catalogFiles.push(file, ...listRecursive(leafDir, (candidate) => candidate !== file));
  }

  const bundles = [];
  const seenBundleIds = new Set();
  const referenced = new Set();
  const selectedPatches = new Map();
  const selectedMemberships = new Map();
  for (const file of listRecursive(bundlesDir, (candidate) => candidate.endsWith(".json"))) {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    const label = path.relative(bundlesDir, file).split(path.sep).join("/");
    assertPlainObject(raw, `bundle ${label}`);
    if (raw.schemaVersion !== BUNDLE_SCHEMA_VERSION) {
      throw new Error(`bundle ${label} schemaVersion 不支持:${raw.schemaVersion}`);
    }
    assertId(raw.id, `bundle ${label} id`);
    if (seenBundleIds.has(raw.id)) throw new Error(`重复 bundle id:${raw.id}`);
    seenBundleIds.add(raw.id);
    const aliases = raw.aliases || [];
    if (!Array.isArray(aliases) || !aliases.every((item) => typeof item === "string" && item)) {
      throw new Error(`bundle ${label} aliases 必须是字符串数组`);
    }
    const installMode = raw.installMode || "full-or-selected";
    if (!INSTALL_MODES.has(installMode)) {
      throw new Error(`bundle ${label} installMode 不支持:${installMode}`);
    }
    if (!Array.isArray(raw.patches) || raw.patches.length === 0) {
      throw new Error(`bundle ${label} patches 不能为空`);
    }
    const selected = skills.length === 0 || (
      installMode !== "full-only" && shouldInstallName(raw.id, skills, aliases)
    );
    const patches = raw.patches.map((ref) => {
      if (typeof ref !== "string" || !patchByRef.has(ref)) {
        throw new Error(`bundle ${label} 引用未知 patch:${ref}`);
      }
      referenced.add(ref);
      return patchByRef.get(ref);
    });
    if (selected) {
      const bundle = {
        id: raw.id,
        catalog: catalog.id,
        qualifiedId: qualifyId(catalog.id, raw.id),
        aliases,
        installMode,
        patches,
      };
      bundles.push(bundle);
      for (const patch of patches) {
        if (!selectedPatches.has(patch.id)) selectedPatches.set(patch.id, patch);
        const memberships = selectedMemberships.get(patch.id) || [];
        memberships.push(bundle);
        selectedMemberships.set(patch.id, memberships);
      }
    }
    catalogFiles.push(file);
  }
  for (const ref of patchByRef.keys()) {
    if (!referenced.has(ref)) throw new Error(`未被 bundle 引用的 patch:${ref}`);
  }
  const policy = resolveCatalogPolicy(catalog, catalogFiles);
  const patches = [...selectedPatches.values()].map((patch) => {
    const memberships = selectedMemberships.get(patch.id) || [];
    return {
      ...patch,
      bundle: memberships[0]?.id,
      bundleIds: memberships.map((item) => item.id),
      bundles: memberships.map((item) => item.qualifiedId),
    };
  });
  return {
    id: catalog.id,
    bundles,
    patches,
    allPatches: [...patchByRef.values()],
    catalogEntries: [...new Set(catalogFiles)].sort().map((file) => ({
      catalog: catalog.id,
      path: path.relative(catalogRoot, file).split(path.sep).join("/"),
      content: fs.readFileSync(file),
    })),
    policy,
  };
}

function resolveOperationRef(ref, operation, operationById) {
  const qualifiedId = ref.includes("/") ? ref : qualifyId(operation.catalog, ref);
  if (!operationById.has(qualifiedId)) {
    throw new Error(`patch operation ${operation.qualifiedId} 引用未知 operation:${ref}`);
  }
  if (qualifiedId === operation.qualifiedId) {
    throw new Error(`patch operation ${operation.qualifiedId} 不能依赖自身`);
  }
  return qualifiedId;
}

function stableTopologicalSort(operations, includeEdge) {
  const baseIndex = new Map(operations.map((operation, index) => [operation.qualifiedId, index]));
  const operationById = new Map(operations.map((operation) => [operation.qualifiedId, operation]));
  const outgoing = new Map(operations.map((operation) => [operation.qualifiedId, new Set()]));
  const indegree = new Map(operations.map((operation) => [operation.qualifiedId, 0]));

  for (const operation of operations) {
    for (const relation of [
      ...operation.after.map((from) => ({ from, type: "after" })),
      ...operation.dependsOn.map((from) => ({ from, type: "dependsOn" })),
    ]) {
      if (!operationById.has(relation.from) || !includeEdge(operation, relation)) continue;
      const targets = outgoing.get(relation.from);
      if (targets.has(operation.qualifiedId)) continue;
      targets.add(operation.qualifiedId);
      indegree.set(operation.qualifiedId, indegree.get(operation.qualifiedId) + 1);
    }
  }

  const ready = operations
    .filter((operation) => indegree.get(operation.qualifiedId) === 0)
    .sort((left, right) => baseIndex.get(left.qualifiedId) - baseIndex.get(right.qualifiedId));
  const resolved = [];
  while (ready.length > 0) {
    const operation = ready.shift();
    resolved.push(operation);
    for (const targetId of [...outgoing.get(operation.qualifiedId)].sort(
      (left, right) => baseIndex.get(left) - baseIndex.get(right),
    )) {
      indegree.set(targetId, indegree.get(targetId) - 1);
      if (indegree.get(targetId) === 0) {
        ready.push(operationById.get(targetId));
        ready.sort((left, right) => baseIndex.get(left.qualifiedId) - baseIndex.get(right.qualifiedId));
      }
    }
  }
  if (resolved.length !== operations.length) {
    const cycle = operations
      .filter((operation) => indegree.get(operation.qualifiedId) > 0)
      .map((operation) => operation.qualifiedId);
    throw new Error(`Patch operation 依赖循环:${cycle.join(" -> ")}`);
  }
  return resolved;
}

function resolveOperationOrder(loaded) {
  const allOperations = loaded.flatMap((catalog) =>
    catalog.allPatches.flatMap((patch) => patch.operations)
  );
  const operationById = new Map();
  for (const operation of allOperations) {
    if (operationById.has(operation.qualifiedId)) {
      throw new Error(`重复 qualified patch operation id:${operation.qualifiedId}`);
    }
    operationById.set(operation.qualifiedId, operation);
  }
  for (const operation of allOperations) {
    operation.after = operation.afterRefs.map((ref) =>
      resolveOperationRef(ref, operation, operationById)
    );
    operation.dependsOn = operation.dependsOnRefs.map((ref) =>
      resolveOperationRef(ref, operation, operationById)
    );
  }

  // 全 catalog 先验证潜在关系图，避免损坏的未选 Bundle 被过滤条件长期隐藏。
  stableTopologicalSort(allOperations, () => true);

  const selectedOperations = loaded.flatMap((catalog) =>
    catalog.patches.flatMap((patch) => patch.operations.map((operation) => ({
      ...operation,
      bundle: patch.bundle,
      bundleIds: patch.bundleIds,
      bundles: patch.bundles,
    })))
  );
  const selectedIds = new Set(selectedOperations.map((operation) => operation.qualifiedId));
  for (const operation of selectedOperations) {
    for (const dependency of operation.dependsOn) {
      if (!selectedIds.has(dependency)) {
        throw new Error(
          `patch operation ${operation.qualifiedId} dependsOn 未进入当前计划:${dependency}`,
        );
      }
    }
  }
  const sorted = stableTopologicalSort(
    selectedOperations,
    (operation, relation) => relation.type === "dependsOn" || selectedIds.has(relation.from),
  );
  const resolvedIndex = new Map(sorted.map((operation, index) => [operation.qualifiedId, index]));
  return {
    allOperations,
    selectedOperations: sorted,
    operationOrder: sorted.map((operation) => ({
      id: operation.id,
      catalog: operation.catalog,
      qualifiedId: operation.qualifiedId,
      patch: operation.patchId,
      qualifiedPatch: operation.qualifiedPatchId,
      bundle: operation.bundle,
      bundles: operation.bundles,
      declarationIndex: selectedOperations.findIndex(
        (item) => item.qualifiedId === operation.qualifiedId,
      ),
      resolvedIndex: resolvedIndex.get(operation.qualifiedId),
      after: operation.after,
      dependsOn: operation.dependsOn,
      incomingEdges: [
        ...operation.after
          .filter((from) => selectedIds.has(from))
          .map((from) => ({ from, type: "after" })),
        ...operation.dependsOn.map((from) => ({ from, type: "dependsOn" })),
      ],
    })),
  };
}

function prepareFilePlan(files, targetRoot, targetSpec, operation) {
  for (const requiredPath of targetSpec.requires) {
    const required = resolveRelativePath(
      targetRoot,
      requiredPath,
      `patch ${operation.id} target.requires`,
    );
    if (!fs.existsSync(required)) return { status: "missing-target" };
  }
  const targetFile = resolveRelativePath(
    targetRoot,
    targetSpec.path,
    `patch ${operation.id} target.path`,
  );
  const exists = fs.existsSync(targetFile);
  if (!exists) {
    if (targetSpec.missing === "skip") return { status: "missing-target" };
    if (targetSpec.missing === "error") return { error: "目标不存在" };
    const parent = path.dirname(targetFile);
    if (!fs.existsSync(parent)) return { status: "missing-target" };
    assertExistingPathInside(targetRoot, parent, `patch ${operation.id} target.parent`);
  } else {
    assertExistingPathInside(targetRoot, targetFile, `patch ${operation.id} target`);
  }
  let filePlan = files.get(targetSpec.path);
  if (!filePlan) {
    const original = exists ? fs.readFileSync(targetFile, "utf8") : null;
    filePlan = {
      target: targetSpec.path,
      targetFile,
      original,
      originalExists: exists,
      next: original ?? "",
      operations: [],
      patches: [],
      bundles: [],
      operationEntries: [],
    };
    files.set(targetSpec.path, filePlan);
  }
  return { filePlan };
}

/**
 * 读取选中的 Patch catalog，并在内存中计算全部目标文件结果。
 *
 * @param {string} target 目标 Trellis 项目根目录
 * @param {Array<{id:string,patchesDir:string,bundlesDir:string,policy?:object}>} catalogs Patch catalog 列表
 * @param {{skills?:string[],adapters?:Record<string,Function>}} [options] 精细安装过滤和扩展 Adapter
 * @returns {{bundles:string[],patches:string[],selectedBundles:Array<object>,selectedPatches:Array<object>,operationOrder:Array<object>,files:Array<object>,results:Array<object>,catalogHash:string,catalogOperations:Array<object>}} 可应用计划
 */
export function preparePatchPlan(target, catalogs, options = {}) {
  const targetRoot = path.resolve(target);
  const skills = options.skills || [];
  const adapters = options.adapters || {};
  const allowedSelectors = new Set([...CORE_SELECTORS, ...Object.keys(adapters)]);
  const seenCatalogIds = new Set();
  for (const catalog of catalogs) {
    assertPlainObject(catalog, "Patch catalog");
    assertId(catalog.id, "Patch catalog.id");
    if (seenCatalogIds.has(catalog.id)) throw new Error(`重复 Patch catalog id:${catalog.id}`);
    seenCatalogIds.add(catalog.id);
  }
  const loaded = catalogs.map((catalog) => loadCatalog(catalog, skills, allowedSelectors));
  const { allOperations, selectedOperations, operationOrder } = resolveOperationOrder(loaded);
  const bundles = loaded.flatMap((item) => item.bundles.map((bundle) => bundle.id));
  const patches = loaded.flatMap((item) => item.patches);
  const files = new Map();
  const results = [];
  const errors = [];

  for (const operation of selectedOperations) {
    let readyTargets = 0;
    let existingTargets = 0;
    for (const targetSpec of operation.targets) {
      let prepared;
      try {
        prepared = prepareFilePlan(files, targetRoot, targetSpec, operation);
      } catch (error) {
        prepared = { error: error.message };
      }
      if (prepared.status === "missing-target") {
        results.push({
          id: operation.id,
          catalog: operation.catalog,
          qualifiedId: operation.qualifiedId,
          patch: operation.patchId,
          qualifiedPatch: operation.qualifiedPatchId,
          bundle: operation.bundle,
          bundles: operation.bundles,
          target: targetSpec.path,
          status: "missing-target",
          required: operation.required,
        });
        continue;
      }
      if (prepared.error) {
        const result = {
          id: operation.id,
          catalog: operation.catalog,
          qualifiedId: operation.qualifiedId,
          patch: operation.patchId,
          qualifiedPatch: operation.qualifiedPatchId,
          bundle: operation.bundle,
          bundles: operation.bundles,
          target: targetSpec.path,
          status: operation.required ? "error" : "optional-skip",
          required: operation.required,
          reason: prepared.error,
        };
        results.push(result);
        if (operation.required) errors.push(result);
        continue;
      }
      existingTargets++;
      const { filePlan } = prepared;
      let cleaned;
      try {
        cleaned = applyCleanup(filePlan.next, operation.cleanup);
      } catch (error) {
        cleaned = { error: error.message };
      }
      let applied;
      if (cleaned.error) applied = cleaned;
      else {
        const operationForTarget = { ...operation, markerStyle: targetSpec.markerStyle };
        if (CORE_SELECTORS.has(operation.selector.type)) {
          applied = applyCoreOperation(cleaned.value, operationForTarget);
        } else {
          applied = adapters[operation.selector.type]({
            value: cleaned.value,
            operation: operationForTarget,
            targetSpec,
            targetRoot,
            targetFile: filePlan.targetFile,
          });
        }
      }
      if (applied.error) {
        const result = {
          id: operation.id,
          catalog: operation.catalog,
          qualifiedId: operation.qualifiedId,
          patch: operation.patchId,
          qualifiedPatch: operation.qualifiedPatchId,
          bundle: operation.bundle,
          bundles: operation.bundles,
          target: targetSpec.path,
          status: operation.required ? "error" : "optional-skip",
          required: operation.required,
          reason: applied.error,
        };
        results.push(result);
        if (operation.required) errors.push(result);
        continue;
      }
      filePlan.next = applied.value;
      filePlan.operations.push(operation.id);
      filePlan.patches.push(operation.patchId);
      filePlan.bundles.push(operation.bundle);
      filePlan.operationEntries.push({
        id: operation.id,
        catalog: operation.catalog,
        qualifiedId: operation.qualifiedId,
        patch: operation.patchId,
        qualifiedPatch: operation.qualifiedPatchId,
        bundle: operation.bundle,
        bundles: operation.bundles,
      });
      readyTargets++;
      results.push({
        id: operation.id,
        catalog: operation.catalog,
        qualifiedId: operation.qualifiedId,
        patch: operation.patchId,
        qualifiedPatch: operation.qualifiedPatchId,
        bundle: operation.bundle,
        bundles: operation.bundles,
        target: targetSpec.path,
        status: "ready",
        required: operation.required,
        source: cleaned.changed && applied.source === "selector"
          ? "legacy-cleanup"
          : applied.source,
      });
    }
    if (
      operation.required &&
      operation.targetPolicy === "at-least-one" &&
      readyTargets === 0
    ) {
      errors.push({
        id: operation.id,
        qualifiedId: operation.qualifiedId,
        target: "<target-group>",
        reason: "at-least-one target 未命中",
      });
    }
    if (
      operation.required &&
      operation.targetPolicy === "required-all" &&
      existingTargets !== operation.targets.length
    ) {
      errors.push({
        id: operation.id,
        qualifiedId: operation.qualifiedId,
        target: "<target-group>",
        reason: "required-all target 不完整",
      });
    }
  }
  if (errors.length > 0) {
    const detail = errors
      .map((item) => `${item.id}@${item.target}:${item.reason}`)
      .join("; ");
    const error = new Error(`Patch 预检失败:${detail}`);
    error.patchErrors = errors;
    throw error;
  }

  const catalogHash = sha256(
    loaded
      .flatMap((item) => item.catalogEntries)
      .sort((a, b) => (
        a.catalog.localeCompare(b.catalog) || a.path.localeCompare(b.path)
      ))
      .map((entry) => `${entry.catalog}\0${entry.path}\0${entry.content}`)
      .join("\0"),
  );
  return {
    bundles,
    patches: patches.map((patch) => patch.id),
    catalogs: loaded.map((item) => ({ id: item.id })),
    selectedBundles: loaded.flatMap((item) => item.bundles.map((bundle) => ({
      id: bundle.id,
      catalog: bundle.catalog,
      qualifiedId: bundle.qualifiedId,
    }))),
    selectedPatches: patches.map((patch) => ({
      id: patch.id,
      catalog: patch.catalog,
      qualifiedId: patch.qualifiedId,
      bundle: patch.bundle,
      bundles: patch.bundles,
    })),
    operationOrder,
    files: [...files.values()].map((file) => {
      const next = file.operations.length > 0 ? normalizeText(file.next) : file.original;
      return {
        ...file,
        next,
        changed: file.originalExists ? next !== file.original : file.operations.length > 0,
        beforeHash: file.originalExists ? sha256(file.original) : null,
        afterHash: next === null ? null : sha256(next),
      };
    }),
    results,
    catalogHash,
    catalogOperations: allOperations.map((operation) => ({
      id: operation.id,
      catalog: operation.catalog,
      qualifiedId: operation.qualifiedId,
      patch: operation.patchId,
      qualifiedPatch: operation.qualifiedPatchId,
      targets: operation.targets.map((target) => target.path),
    })),
    policies: loaded
      .filter((item) => item.policy)
      .map((item) => ({ catalog: item.id, ...item.policy })),
  };
}

/**
 * 应用已经通过预检的 Patch 计划，并复核目标未发生并发漂移。
 *
 * @param {string} target 目标 Trellis 项目根目录
 * @param {ReturnType<typeof preparePatchPlan>} plan 预检计划
 * @returns {{changed:number,unchanged:number,skipped:number,missingTargets:number,optionalSkipped:number,targets:string[],backupNotes:string[],results:Array<object>,provenance:object}} 应用结果
 */
export function applyPatchPlan(target, plan) {
  for (const file of plan.files) {
    const exists = fs.existsSync(file.targetFile);
    if (exists !== file.originalExists) {
      throw new Error(`Patch 目标在应用前发生存在性漂移:${file.target}`);
    }
    if (exists && fs.readFileSync(file.targetFile, "utf8") !== file.original) {
      throw new Error(`Patch 目标在应用前发生内容漂移:${file.target}`);
    }
    if (!exists) {
      const parent = path.dirname(file.targetFile);
      if (!fs.existsSync(parent)) {
        throw new Error(`Patch 目标父目录在应用前发生存在性漂移:${file.target}`);
      }
      assertExistingPathInside(target, parent, `Patch 目标父目录:${file.target}`);
    }
  }

  let changed = 0;
  let unchanged = 0;
  const backupNotes = new Set();
  for (const file of plan.files) {
    if (!file.changed) {
      unchanged++;
      continue;
    }
    if (file.originalExists) {
      const { backupNote } = preserveFirstBackup(target, file.targetFile);
      if (backupNote) backupNotes.add(backupNote);
    } else {
      fs.mkdirSync(path.dirname(file.targetFile), { recursive: true });
    }
    fs.writeFileSync(file.targetFile, file.next);
    changed++;
  }
  const missingTargets = plan.results.filter((item) => item.status === "missing-target").length;
  const optionalSkipped = plan.results.filter((item) => item.status === "optional-skip").length;
  const skipped = missingTargets + optionalSkipped;
  const provenance = {
    schemaVersion: 2,
    catalogHash: plan.catalogHash,
    applied: plan.files.flatMap((file) => file.operationEntries.map((entry) => ({
      ...entry,
      target: file.target,
      status: "applied",
      resultHash: file.afterHash,
    }))),
  };
  return {
    changed,
    unchanged,
    skipped,
    missingTargets,
    optionalSkipped,
    targets: plan.files.map((file) => file.target),
    backupNotes: [...backupNotes],
    results: plan.results,
    provenance,
  };
}
