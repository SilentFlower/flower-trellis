import fs from "node:fs";
import path from "node:path";

const SEVERITIES = new Set(["error", "warning", "info"]);
const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;
const ASSERTION_TYPES = new Set([
  "absent-literal",
  "required-literal",
  "max-occurrences",
]);

function readJson(file, label) {
  let value;
  try {
    value = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`${label} 无法读取:${error.message}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} 必须是 JSON 对象`);
  }
  return value;
}

function requireString(value, label) {
  if (typeof value !== "string" || !value) {
    throw new Error(`${label} 必须是非空字符串`);
  }
  return value;
}

function requireStringArray(value, label) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} 必须是非空字符串数组`);
  }
  return value.map((item, index) => requireString(item, `${label}[${index}]`));
}

function requireId(value, label) {
  const id = requireString(value, label);
  if (!ID_RE.test(id)) throw new Error(`${label} 必须是小写连字符 ID`);
  return id;
}

function validateCompatibility(raw) {
  if (raw.schemaVersion !== 1) throw new Error("compatibility schemaVersion 必须为 1");
  const variant = requireString(raw.variant, "compatibility.variant");
  const line = raw.compatibleLine;
  if (
    !line ||
    !Number.isInteger(line.major) ||
    line.major < 0 ||
    !Number.isInteger(line.minor) ||
    line.minor < 0
  ) {
    throw new Error("compatibility.compatibleLine 必须包含非负整数 major/minor");
  }
  if (variant !== `${line.major}.${line.minor}`) {
    throw new Error("compatibility.variant 必须匹配 compatibleLine");
  }
  const testedVersions = requireStringArray(
    raw.testedVersions,
    "compatibility.testedVersions",
  );
  if (new Set(testedVersions).size !== testedVersions.length) {
    throw new Error("compatibility.testedVersions 不能重复");
  }
  for (const [index, version] of testedVersions.entries()) {
    if (!SEMVER_RE.test(version)) {
      throw new Error(`compatibility.testedVersions[${index}] 必须是完整 semver`);
    }
  }
  if (raw.untestedPatchPolicy !== "warning") {
    throw new Error("compatibility.untestedPatchPolicy 当前只允许 warning");
  }
  if (raw.newLinePolicy !== "error") {
    throw new Error("compatibility.newLinePolicy 当前只允许 error");
  }
  return raw;
}

function validateConflictTarget(value, label) {
  const target = requireString(value, label);
  if (
    target.includes("\\") ||
    path.posix.isAbsolute(target) ||
    path.win32.isAbsolute(target) ||
    path.win32.parse(target).root
  ) {
    throw new Error(`${label} 必须是项目内 POSIX 相对路径`);
  }
  const parts = target.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error(`${label} 包含不安全路径片段`);
  }
  return target;
}

function validateAssertion(raw, label) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${label} 必须是对象`);
  }
  if (!ASSERTION_TYPES.has(raw.type)) {
    throw new Error(`${label}.type 非法:${raw.type}`);
  }
  if (raw.type === "max-occurrences") {
    requireString(raw.value, `${label}.value`);
    if (!Number.isInteger(raw.max) || raw.max < 0) {
      throw new Error(`${label}.max 必须是非负整数`);
    }
  } else {
    requireStringArray(raw.values, `${label}.values`);
  }
  return raw;
}

function validateConflicts(raw) {
  if (raw.schemaVersion !== 1) throw new Error("conflicts schemaVersion 必须为 1");
  if (!Array.isArray(raw.rules)) throw new Error("conflicts.rules 必须是数组");
  const ids = new Set();
  for (const [index, rule] of raw.rules.entries()) {
    const label = `conflicts.rules[${index}]`;
    const id = requireId(rule?.id, `${label}.id`);
    if (ids.has(id)) throw new Error(`conflict rule id 重复:${id}`);
    ids.add(id);
    if (!SEVERITIES.has(rule.severity)) {
      throw new Error(`${label}.severity 非法:${rule.severity}`);
    }
    validateConflictTarget(rule.target, `${label}.target`);
    requireStringArray(rule.whenOperations, `${label}.whenOperations`).forEach(
      (operationId, operationIndex) => requireId(
        operationId,
        `${label}.whenOperations[${operationIndex}]`,
      ),
    );
    validateAssertion(rule.assertion, `${label}.assertion`);
    requireString(rule.owner, `${label}.owner`);
    requireString(rule.reason, `${label}.reason`);
  }
  return raw;
}

function parseVersion(value) {
  if (typeof value !== "string") return null;
  const match = value.match(SEMVER_RE);
  if (!match) return null;
  return {
    value,
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] || null,
  };
}

function countOccurrences(value, needle) {
  let count = 0;
  let cursor = 0;
  while (true) {
    const index = value.indexOf(needle, cursor);
    if (index < 0) return count;
    count++;
    cursor = index + needle.length;
  }
}

function diagnostic(id, severity, target, owner, reason, evidence) {
  return { id, severity, target, owner, reason, evidence };
}

function summarize(diagnostics) {
  return diagnostics.reduce(
    (summary, item) => {
      if (item.severity === "error") summary.errors++;
      else if (item.severity === "warning") summary.warnings++;
      else summary.info++;
      return summary;
    },
    { errors: 0, warnings: 0, info: 0 },
  );
}

/**
 * 读取并校验 Skill-Garden Patch 的版本兼容与最终产物冲突声明。
 *
 * @param {string} overridesDir Skill-Garden 变体的 overrides 目录
 * @returns {{compatibility:object,conflicts:object}} 已校验 policy
 */
export function loadPatchPolicy(overridesDir) {
  const compatibility = validateCompatibility(
    readJson(path.join(overridesDir, "compatibility.json"), "compatibility policy"),
  );
  const conflicts = validateConflicts(
    readJson(path.join(overridesDir, "conflicts.json"), "conflict policy"),
  );
  return { compatibility, conflicts };
}

/**
 * 按声明的 tested 版本与兼容线评估目标 Trellis 版本。
 *
 * @param {string} version 目标项目 `.trellis/.version` 原值
 * @param {object} compatibility `compatibility.json` 内容
 * @returns {{version:{value:string,status:string},diagnostics:Array<object>}} 版本结果与诊断
 */
export function evaluatePatchCompatibility(version, compatibility) {
  const parsed = parseVersion(version);
  if (!parsed) {
    return {
      version: { value: version || "", status: "invalid" },
      diagnostics: [diagnostic(
        "invalid-upstream-version",
        "error",
        ".trellis/.version",
        "patch-compatibility",
        "0.6 Patch 需要可解析的 Trellis semver 版本。",
        [version || "<empty>"],
      )],
    };
  }
  if (compatibility.testedVersions.includes(parsed.value)) {
    return {
      version: { value: parsed.value, status: "tested" },
      diagnostics: [],
    };
  }
  if (
    parsed.major === compatibility.compatibleLine.major &&
    parsed.minor === compatibility.compatibleLine.minor
  ) {
    return {
      version: { value: parsed.value, status: "untested-compatible" },
      diagnostics: [diagnostic(
        "untested-upstream",
        "warning",
        ".trellis/.version",
        "patch-compatibility",
        "目标版本位于兼容线内但尚未登记 baseline；只有完整预检和冲突断言通过后才允许继续。",
        [parsed.value],
      )],
    };
  }
  return {
    version: { value: parsed.value, status: "unsupported" },
    diagnostics: [diagnostic(
      "unsupported-upstream-line",
      "error",
      ".trellis/.version",
      "patch-compatibility",
      "该 Trellis minor/major 尚无受支持 Patch baseline；请使用匹配的 Flower 版本或 --no-enhance。",
      [parsed.value],
    )],
  };
}

/**
 * 对 Patch 计划的内存最终文件执行确定性冲突断言。
 *
 * @param {object} plan `preparePatchPlan()` 返回的完整计划
 * @param {object} conflicts `conflicts.json` 内容
 * @returns {{diagnostics:Array<object>}} 最终产物诊断
 */
export function evaluatePatchConflicts(plan, conflicts) {
  if (Array.isArray(plan.catalogOperations)) {
    const operationTargets = new Map(
      plan.catalogOperations.map((operation) => [operation.id, new Set(operation.targets)]),
    );
    for (const rule of conflicts.rules) {
      for (const operationId of rule.whenOperations) {
        const targets = operationTargets.get(operationId);
        if (!targets) {
          throw new Error(`conflict rule ${rule.id} 引用未知 operation:${operationId}`);
        }
        if (!targets.has(rule.target)) {
          throw new Error(
            `conflict rule ${rule.id} target 未被 operation ${operationId} 修改:${rule.target}`,
          );
        }
      }
    }
  }
  const selectedOperations = new Set(
    plan.files.flatMap((file) => file.operations),
  );
  const files = new Map(plan.files.map((file) => [file.target, file.next]));
  const diagnostics = [];

  for (const rule of conflicts.rules) {
    // 精细安装只审计本次实际选中的能力，避免把未修改的上游入口误报为冲突。
    if (!rule.whenOperations.every((id) => selectedOperations.has(id))) continue;
    const value = files.get(rule.target);
    if (typeof value !== "string") continue;
    const assertion = rule.assertion;
    const evidence = [];
    if (assertion.type === "absent-literal") {
      for (const literal of assertion.values) {
        if (value.includes(literal)) evidence.push(`仍存在:${literal}`);
      }
    } else if (assertion.type === "required-literal") {
      for (const literal of assertion.values) {
        if (!value.includes(literal)) evidence.push(`缺少:${literal}`);
      }
    } else {
      const count = countOccurrences(value, assertion.value);
      if (count > assertion.max) {
        evidence.push(`出现 ${count} 次，允许最多 ${assertion.max} 次:${assertion.value}`);
      }
    }
    if (evidence.length > 0) {
      diagnostics.push(diagnostic(
        rule.id,
        rule.severity,
        rule.target,
        rule.owner,
        rule.reason,
        evidence,
      ));
    }
  }

  for (const item of plan.results) {
    if (item.status === "missing-target") {
      diagnostics.push(diagnostic(
        `missing-target:${item.id}:${item.target}`,
        "info",
        item.target,
        item.patch,
        "目标平台入口未安装，按声明跳过。",
        [item.id],
      ));
    } else if (item.status === "optional-skip") {
      diagnostics.push(diagnostic(
        `optional-skip:${item.id}:${item.target}`,
        "warning",
        item.target,
        item.patch,
        "可选 Patch 未应用，需要评审其漂移原因。",
        [item.reason || "unknown"],
      ));
    }
  }
  return { diagnostics };
}

/**
 * 合并版本兼容与最终产物诊断，生成稳定三态汇总。
 *
 * @param {{version:string,plan:object,policy:{compatibility:object,conflicts:object}}} input 评估输入
 * @returns {{version:object,diagnostics:Array<object>,summary:{errors:number,warnings:number,info:number}}} 完整报告
 */
export function buildPatchConflictReport({ version, plan, policy }) {
  const compatibility = evaluatePatchCompatibility(version, policy.compatibility);
  const conflicts = evaluatePatchConflicts(plan, policy.conflicts);
  const order = { error: 0, warning: 1, info: 2 };
  const diagnostics = [...compatibility.diagnostics, ...conflicts.diagnostics]
    .sort((a, b) =>
      order[a.severity] - order[b.severity] ||
      a.id.localeCompare(b.id) ||
      a.target.localeCompare(b.target)
    );
  return {
    version: compatibility.version,
    diagnostics,
    summary: summarize(diagnostics),
  };
}

/**
 * 当报告存在阻断级冲突时抛出聚合错误。
 *
 * @param {{diagnostics:Array<object>,summary:{errors:number}}} report 完整冲突报告
 * @returns {void}
 */
export function assertNoPatchConflictErrors(report) {
  if (report.summary.errors === 0) return;
  const detail = report.diagnostics
    .filter((item) => item.severity === "error")
    .map((item) => {
      const evidence = item.evidence.length > 0
        ? `;证据:${item.evidence.join(" | ")}`
        : "";
      return `${item.id}@${item.target}:${item.reason}${evidence}`;
    })
    .join("; ");
  const error = new Error(`Patch 冲突检查失败:${detail}`);
  error.patchConflictReport = report;
  throw error;
}

/**
 * 把单条 Patch diagnostic 格式化为包含规则、目标、原因和证据的稳定文本。
 *
 * @param {{id:string,severity:string,target:string,reason:string,evidence:Array<string>}} diagnostic 诊断项
 * @returns {string} 可直接用于 CLI 的诊断文本
 */
export function formatPatchDiagnostic(diagnostic) {
  const labels = { error: "错误", warning: "警告", info: "信息" };
  const evidence = diagnostic.evidence.length > 0
    ? diagnostic.evidence.join(" | ")
    : "<none>";
  return `Patch ${labels[diagnostic.severity] || diagnostic.severity}:` +
    `${diagnostic.id}@${diagnostic.target}(${diagnostic.reason};证据:${evidence})`;
}
