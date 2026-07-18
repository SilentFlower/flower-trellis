import fs from "node:fs";
import path from "node:path";
import { preserveFirstBackup } from "./backup.js";
import { listFiles } from "./fs-utils.js";
import { shouldInstallName } from "./skill-filter.js";

const SCHEMA_VERSION = 1;
const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const OPERATIONS = new Set(["insert", "replace", "remove"]);
const TARGET_KINDS = new Set(["workflow", "skill", "command", "hook"]);
const INSERT_POSITIONS = new Set(["before", "after"]);
const MARKER_STYLES = new Set(["html", "hash", "slash"]);

function escapeRe(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeText(value) {
  return value.replace(/\s+$/, "") + "\n";
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
  if (!realFile.startsWith(`${realRoot}${path.sep}`)) {
    throw new Error(`${label} 通过软链逃逸根目录:${file}`);
  }
}

function readSourceFile(transformDir, relativePath, label) {
  const file = resolveRelativePath(transformDir, relativePath, label);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    throw new Error(`${label} 不存在:${relativePath}`);
  }
  assertExistingPathInside(transformDir, file, label);
  const value = fs.readFileSync(file, "utf8");
  if (!value) throw new Error(`${label} 不能为空:${relativePath}`);
  return value;
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

function markerParts(operationId, content, markerStyle = "html") {
  const marker = markerStyle === "hash"
    ? [`# BEGIN skill-garden transform ${operationId} v0.6`, `# END skill-garden transform ${operationId} v0.6`]
    : markerStyle === "slash"
      ? [`// BEGIN skill-garden transform ${operationId} v0.6`, `// END skill-garden transform ${operationId} v0.6`]
      : [
          `<!-- BEGIN skill-garden transform ${operationId} v0.6 -->`,
          `<!-- END skill-garden transform ${operationId} v0.6 -->`,
        ];
  const [begin, end] = marker;
  const body = content ? content.replace(/\s+$/, "") + "\n" : "";
  return {
    begin,
    end,
    block: `${begin}\n${body}${end}`,
    re: new RegExp(`${escapeRe(begin)}\\n[\\s\\S]*?${escapeRe(end)}`, "g"),
  };
}

function replaceAllLiteral(value, needle, replacement) {
  return value.split(needle).join(replacement);
}

function applyOperationToText(value, spec) {
  const managed = markerParts(spec.id, spec.content, spec.markerStyle);
  const variants = spec.markerStyle === "html"
    ? [managed]
    : [managed, markerParts(spec.id, spec.content, "html")];
  const active = [];
  for (const variant of variants) {
    const beginCount = countOccurrences(value, variant.begin);
    const endCount = countOccurrences(value, variant.end);
    if (beginCount !== endCount) {
      return { error: `managed marker 不配对:${beginCount}/${endCount}` };
    }
    if (beginCount > 0) active.push({ variant, count: beginCount });
  }
  if (active.length > 1) {
    return { error: "managed marker 同时存在多种 style" };
  }
  if (active.length === 1) {
    const [{ variant, count }] = active;
    if (count !== spec.expectedMatches) {
      return {
        error: `managed marker 数量 ${count} 不等于预期 ${spec.expectedMatches}`,
      };
    }
    return {
      value: value.replace(variant.re, managed.block),
      source: "managed-marker",
    };
  }

  const matches = countOccurrences(value, spec.selector);
  if (matches !== spec.expectedMatches) {
    return { error: `selector 匹配 ${matches} 次,预期 ${spec.expectedMatches} 次` };
  }

  if (spec.operation === "replace" || spec.operation === "remove") {
    return {
      value: replaceAllLiteral(value, spec.selector, managed.block),
      source: "selector",
    };
  }
  const replacement = spec.position === "before"
    ? `${managed.block}\n${spec.selector}`
    : `${spec.selector}\n${managed.block}`;
  return {
    value: replaceAllLiteral(value, spec.selector, replacement),
    source: "selector",
  };
}

function normalizeOperation(raw, transformDir, declarationId, seenIds) {
  assertPlainObject(raw, `transform ${declarationId} operation`);
  assertId(raw.id, `transform ${declarationId} operation.id`);
  if (seenIds.has(raw.id)) throw new Error(`重复 transform operation id:${raw.id}`);
  seenIds.add(raw.id);
  if (!OPERATIONS.has(raw.operation)) {
    throw new Error(`transform ${raw.id} operation 不支持:${raw.operation}`);
  }
  if (!Array.isArray(raw.targets) || raw.targets.length === 0) {
    throw new Error(`transform ${raw.id} targets 不能为空`);
  }
  assertPlainObject(raw.selector, `transform ${raw.id} selector`);
  const expectedMatches = raw.selector.expectedMatches;
  if (
    typeof expectedMatches !== "number" ||
    !Number.isInteger(expectedMatches) ||
    expectedMatches < 1
  ) {
    throw new Error(`transform ${raw.id} expectedMatches 必须是正整数`);
  }
  const selector = readSourceFile(
    transformDir,
    raw.selector.source,
    `transform ${raw.id} selector.source`,
  ).replace(/\s+$/, "");
  if (!selector) throw new Error(`transform ${raw.id} selector 不能为空`);

  let content = "";
  if (raw.operation === "remove") {
    if (raw.content !== undefined) {
      throw new Error(`transform ${raw.id} remove 不能声明 content`);
    }
  } else {
    assertPlainObject(raw.content, `transform ${raw.id} content`);
    content = readSourceFile(
      transformDir,
      raw.content.source,
      `transform ${raw.id} content.source`,
    ).replace(/\s+$/, "");
  }
  if (raw.operation === "insert" && !INSERT_POSITIONS.has(raw.position)) {
    throw new Error(`transform ${raw.id} insert position 必须是 before 或 after`);
  }

  const targets = raw.targets.map((target, index) => {
    assertPlainObject(target, `transform ${raw.id} targets[${index}]`);
    if (!TARGET_KINDS.has(target.kind)) {
      throw new Error(`transform ${raw.id} target.kind 不支持:${target.kind}`);
    }
    const markerStyle = target.markerStyle || "html";
    if (!MARKER_STYLES.has(markerStyle)) {
      throw new Error(`transform ${raw.id} target.markerStyle 不支持:${markerStyle}`);
    }
    if (target.kind === "hook" && target.markerStyle === undefined) {
      throw new Error(`transform ${raw.id} hook target 必须显式声明 markerStyle`);
    }
    return { kind: target.kind, path: target.path, markerStyle };
  });
  return {
    id: raw.id,
    operation: raw.operation,
    required: raw.required !== false,
    targets,
    selector,
    expectedMatches,
    content,
    position: raw.position,
  };
}

function loadDeclarations(variantDir, skills) {
  const transformDir = path.join(variantDir, "overrides", "transforms");
  const files = listFiles(transformDir, ".json").sort();
  const seenDeclarationIds = new Set();
  const seenIds = new Set();
  const operations = [];
  const declarations = [];
  for (const file of files) {
    const declarationFile = path.join(transformDir, file);
    const raw = JSON.parse(fs.readFileSync(declarationFile, "utf8"));
    assertPlainObject(raw, `transform declaration ${file}`);
    if (raw.schemaVersion !== SCHEMA_VERSION) {
      throw new Error(`transform declaration ${file} schemaVersion 不支持:${raw.schemaVersion}`);
    }
    assertId(raw.id, `transform declaration ${file} id`);
    if (seenDeclarationIds.has(raw.id)) {
      throw new Error(`重复 transform declaration id:${raw.id}`);
    }
    seenDeclarationIds.add(raw.id);
    if (raw.aliases !== undefined && !Array.isArray(raw.aliases)) {
      throw new Error(`transform declaration ${file} aliases 必须是非空字符串数组`);
    }
    const aliases = raw.aliases || [];
    if (!aliases.every((item) => typeof item === "string" && item)) {
      throw new Error(`transform declaration ${file} aliases 必须是非空字符串数组`);
    }
    if (!shouldInstallName(raw.id, skills, aliases)) continue;
    if (!Array.isArray(raw.operations) || raw.operations.length === 0) {
      throw new Error(`transform declaration ${file} operations 不能为空`);
    }
    declarations.push(raw.id);
    for (const operation of raw.operations) {
      operations.push(normalizeOperation(operation, transformDir, raw.id, seenIds));
    }
  }
  return { declarations, operations };
}

/**
 * 预检 skill-garden 声明式变换，并在内存中计算全部目标结果。
 *
 * required 失败会在任何目标写入前汇总抛错；不存在的平台入口只记录 missing，
 * 不会创建新文件。
 *
 * @param {string} target 目标 Trellis 项目根目录
 * @param {string} variantDir 当前强化变体目录
 * @param {string[]} skills 用户通过 --skills 指定的过滤名
 * @returns {{declarations:string[],files:Array<object>,results:Array<object>}} 可直接应用的变换计划
 */
export function prepareEnhancementTransforms(target, variantDir, skills = []) {
  const targetRoot = path.resolve(target);
  const { declarations, operations } = loadDeclarations(variantDir, skills);
  const files = new Map();
  const results = [];
  const errors = [];

  for (const operation of operations) {
    for (const targetSpec of operation.targets) {
      let targetFile;
      try {
        targetFile = resolveRelativePath(
          targetRoot,
          targetSpec.path,
          `transform ${operation.id} target.path`,
        );
      } catch (error) {
        errors.push({ id: operation.id, target: targetSpec.path, reason: error.message });
        continue;
      }
      if (!fs.existsSync(targetFile)) {
        results.push({
          id: operation.id,
          target: targetSpec.path,
          status: "missing-target",
          required: operation.required,
        });
        continue;
      }
      try {
        assertExistingPathInside(targetRoot, targetFile, `transform ${operation.id} target`);
      } catch (error) {
        errors.push({ id: operation.id, target: targetSpec.path, reason: error.message });
        continue;
      }

      let filePlan = files.get(targetSpec.path);
      if (!filePlan) {
        const original = fs.readFileSync(targetFile, "utf8");
        filePlan = {
          target: targetSpec.path,
          targetFile,
          original,
          next: original,
          operations: [],
        };
        files.set(targetSpec.path, filePlan);
      }
      const applied = applyOperationToText(filePlan.next, {
        ...operation,
        markerStyle: targetSpec.markerStyle,
      });
      if (applied.error) {
        const result = {
          id: operation.id,
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
      results.push({
        id: operation.id,
        target: targetSpec.path,
        status: "ready",
        required: operation.required,
        source: applied.source,
      });
    }
  }

  if (errors.length > 0) {
    const detail = errors
      .map((item) => `${item.id}@${item.target}:${item.reason}`)
      .join("; ");
    const error = new Error(`声明式强化变换预检失败:${detail}`);
    error.transformErrors = errors;
    throw error;
  }

  return {
    declarations,
    files: [...files.values()].map((file) => {
      // optional skip 没有实际应用任何 operation 时必须逐字保留原文，不能仅因
      // 结尾换行不同就把未命中的目标改写。
      const next = file.operations.length > 0 ? normalizeText(file.next) : file.original;
      return {
        ...file,
        next,
        changed: next !== file.original,
      };
    }),
    results,
  };
}

/**
 * 应用已经通过预检的声明式变换计划。
 *
 * 写入前会再次验证全部目标原文，防止 preflight 与 apply 之间发生并发漂移。
 *
 * @param {string} target 目标 Trellis 项目根目录
 * @param {{files:Array<object>,results:Array<object>}} plan prepareEnhancementTransforms 返回的计划
 * @returns {{changed:number,unchanged:number,skipped:number,targets:string[],backupNotes:string[],results:Array<object>}} 应用结果
 */
export function applyPreparedTransforms(target, plan) {
  for (const file of plan.files) {
    const current = fs.readFileSync(file.targetFile, "utf8");
    if (current !== file.original) {
      throw new Error(`声明式强化变换目标在应用前发生漂移:${file.target}`);
    }
  }

  let changed = 0;
  let unchanged = 0;
  const targets = [];
  const backupNotes = new Set();
  for (const file of plan.files) {
    targets.push(file.target);
    if (!file.changed) {
      unchanged++;
      continue;
    }
    const { backupNote } = preserveFirstBackup(target, file.targetFile);
    if (backupNote) backupNotes.add(backupNote);
    fs.writeFileSync(file.targetFile, file.next);
    changed++;
  }
  return {
    changed,
    unchanged,
    skipped: plan.results.filter((item) =>
      item.status === "missing-target" || item.status === "optional-skip"
    ).length,
    targets,
    backupNotes: [...backupNotes],
    results: plan.results,
  };
}
