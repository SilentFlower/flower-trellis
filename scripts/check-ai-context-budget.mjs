import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PKG_ROOT } from "../src/lib/paths.js";

const KIB = 1024;
const COMPILED_TARGETS_ROOT = path.join(
  PKG_ROOT,
  "vendor",
  "skill-garden",
  "compiled-targets",
);
const BASELINES = {
  workflow: 46750,
  workflowControl: 12243,
  statesTotal: 7261,
  updateSpec: 13899,
  finishWork: 4556,
  phaseSummary: 12892,
  sessionStart: 12300,
  controlTotal: 90397,
};
const BUDGETS = {
  workflow: { target: 60 * KIB, review: 64 * KIB },
  workflowControl: { target: 28 * KIB, review: 32 * KIB },
  state: { target: 3 * KIB, review: 4 * KIB },
  statesTotal: { target: 12 * KIB, review: 14 * KIB },
  updateSpec: { target: 16 * KIB, review: 18 * KIB },
  finishWork: { target: 10 * KIB, review: 12 * KIB },
  phaseSummary: { target: 18 * KIB, review: 20 * KIB },
  sessionStart: { target: 18 * KIB, review: 20 * KIB },
  controlTotal: { target: 116 * KIB, review: 128 * KIB },
};

function measureText(name, value, budget, baseline = null) {
  return {
    name,
    bytes: Buffer.byteLength(value, "utf8"),
    lines: value ? (value.match(/\n/g) || []).length : 0,
    target: budget.target,
    review: budget.review,
    baseline,
  };
}

function measureTotal(name, bytes, budget, baseline = null) {
  return {
    name,
    bytes,
    lines: 0,
    target: budget.target,
    review: budget.review,
    baseline,
  };
}

function readRequired(file, displayRoot = PKG_ROOT) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    throw new Error(`上下文预算目标不存在:${path.relative(displayRoot, file)}`);
  }
  return fs.readFileSync(file, "utf8");
}

function resolveCompiledFullRoot() {
  if (!fs.existsSync(COMPILED_TARGETS_ROOT)) {
    throw new Error("compiled targets 不存在;请先运行 npm run patch:targets");
  }
  const versions = fs.readdirSync(COMPILED_TARGETS_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  if (versions.length !== 1) {
    throw new Error(`compiled targets 必须只保留一个版本:${versions.join(",")}`);
  }
  const fullRoot = path.join(COMPILED_TARGETS_ROOT, versions[0], "full", "targets");
  if (!fs.existsSync(fullRoot) || !fs.statSync(fullRoot).isDirectory()) {
    throw new Error(`compiled targets 缺少 full files:${versions[0]}`);
  }
  return fullRoot;
}

function extractSection(text, startHeading, endHeading) {
  const start = text.indexOf(startHeading);
  const end = text.indexOf(endHeading, start + startHeading.length);
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(`无法从最终 workflow 提取章节:${startHeading}`);
  }
  return text.slice(start, end);
}

function extractWorkflowStates(workflow) {
  const states = [];
  const pattern = /^\[workflow-state:([^\]\n]+)\]\n([\s\S]*?)^\[\/workflow-state:\1\]$/gm;
  let match;
  while ((match = pattern.exec(workflow)) !== null) {
    states.push({ name: match[1], value: match[2] });
  }
  if (states.length === 0) {
    throw new Error("最终 workflow 未包含 workflow-state body");
  }
  return states;
}

function readExistingTargets(root, relativePaths, label) {
  const targets = relativePaths
    .map((relativePath) => ({
      name: relativePath,
      file: path.join(root, relativePath),
    }))
    .filter(({ file }) => fs.existsSync(file))
    .map(({ name, file }) => ({ name, value: readRequired(file, root) }));
  if (targets.length === 0) {
    throw new Error(`缺少最终 ${label} 入口`);
  }
  return targets;
}

function copyIfExists(source, target) {
  if (!fs.existsSync(source)) return;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true });
}

function measurePhaseSummary() {
  return execFileSync(
    "python3",
    ["./.trellis/scripts/get_context.py", "--mode", "phase"],
    { cwd: PKG_ROOT, encoding: "utf8" },
  );
}

function measureSessionStart() {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "flower-context-budget-"));
  try {
    copyIfExists(
      path.join(PKG_ROOT, ".trellis", "workflow.md"),
      path.join(fixture, ".trellis", "workflow.md"),
    );
    copyIfExists(
      path.join(PKG_ROOT, ".trellis", "config.yaml"),
      path.join(fixture, ".trellis", "config.yaml"),
    );
    copyIfExists(
      path.join(PKG_ROOT, ".trellis", ".developer"),
      path.join(fixture, ".trellis", ".developer"),
    );
    copyIfExists(
      path.join(PKG_ROOT, ".trellis", "spec"),
      path.join(fixture, ".trellis", "spec"),
    );
    copyIfExists(
      path.join(PKG_ROOT, ".trellis", "scripts", "common"),
      path.join(fixture, ".trellis", "scripts", "common"),
    );
    fs.mkdirSync(path.join(fixture, ".trellis", "tasks"), { recursive: true });
    const hook = path.join(PKG_ROOT, ".codex", "hooks", "session-start.py");
    const output = execFileSync("python3", [hook], {
      cwd: PKG_ROOT,
      encoding: "utf8",
      input: JSON.stringify({
        cwd: fixture,
        session_id: "context-budget-fixture",
      }),
      env: {
        ...process.env,
        TRELLIS_CONTEXT_ID: "context-budget-fixture",
        TRELLIS_HOOKS: "1",
        TRELLIS_DISABLE_HOOKS: "0",
        CODEX_NON_INTERACTIVE: "0",
      },
    });
    const parsed = JSON.parse(output);
    const context = parsed?.hookSpecificOutput?.additionalContext;
    if (typeof context !== "string" || !context) {
      throw new Error("SessionStart fixture 未返回 additionalContext");
    }
    return context;
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
}

/**
 * 收集 flower-trellis AI control-plane 的上下文大小指标。
 *
 * @returns {Array<{name:string,bytes:number,lines:number,target:number,review:number,baseline:number|null}>} 指标列表
 */
export function collectAiContextMetrics() {
  const compiledRoot = resolveCompiledFullRoot();
  const workflow = readRequired(path.join(compiledRoot, ".trellis", "workflow.md"), compiledRoot);
  const workflowControl = extractSection(
    workflow,
    "## Phase Index",
    "## Phase 1: Plan",
  );
  const stateValues = extractWorkflowStates(workflow);
  const updateSpecTargets = readExistingTargets(compiledRoot, [
    ".agents/skills/trellis-update-spec/SKILL.md",
    ".claude/skills/trellis-update-spec/SKILL.md",
    ".claude/commands/trellis/update-spec.md",
  ], "Update-Spec");
  const finishWorkTargets = readExistingTargets(compiledRoot, [
    ".agents/skills/trellis-finish-work/SKILL.md",
    ".claude/skills/trellis-finish-work/SKILL.md",
    ".claude/commands/trellis/finish-work.md",
  ], "Finish-Work");
  const phaseSummary = measurePhaseSummary();
  const sessionStart = measureSessionStart();
  const largestUpdateSpec = Math.max(
    ...updateSpecTargets.map(({ value }) => Buffer.byteLength(value, "utf8")),
  );
  const largestFinishWork = Math.max(
    ...finishWorkTargets.map(({ value }) => Buffer.byteLength(value, "utf8")),
  );
  const metrics = [
    measureText("workflow", workflow, BUDGETS.workflow, BASELINES.workflow),
    measureText(
      "workflow-control",
      workflowControl,
      BUDGETS.workflowControl,
      BASELINES.workflowControl,
    ),
    ...stateValues.map(({ name, value }) =>
      measureText(`state:${name}`, value, BUDGETS.state)
    ),
    measureText(
      "states-total",
      stateValues.map((item) => item.value).join(""),
      BUDGETS.statesTotal,
      BASELINES.statesTotal,
    ),
    ...updateSpecTargets.map(({ name, value }) =>
      measureText(
        `update-spec:${name}`,
        value,
        BUDGETS.updateSpec,
        BASELINES.updateSpec,
      )
    ),
    ...finishWorkTargets.map(({ name, value }) =>
      measureText(
        `finish-work:${name}`,
        value,
        BUDGETS.finishWork,
        BASELINES.finishWork,
      )
    ),
    measureText(
      "phase-summary",
      phaseSummary,
      BUDGETS.phaseSummary,
      BASELINES.phaseSummary,
    ),
    measureText(
      "session-start",
      sessionStart,
      BUDGETS.sessionStart,
      BASELINES.sessionStart,
    ),
    measureTotal(
      "control-context-total",
      Buffer.byteLength(workflow, "utf8") +
        largestUpdateSpec +
        largestFinishWork +
        Buffer.byteLength(phaseSummary, "utf8") +
        Buffer.byteLength(sessionStart, "utf8"),
      BUDGETS.controlTotal,
      BASELINES.controlTotal,
    ),
  ];
  return metrics;
}

/**
 * 评估上下文指标并生成分级结果。
 *
 * @param {ReturnType<typeof collectAiContextMetrics>} metrics 指标列表
 * @returns {Array<object>} 带 ok/warn/high-warning 状态的结果
 */
export function evaluateAiContextMetrics(metrics) {
  return metrics.map((metric) => ({
    ...metric,
    status: metric.bytes > metric.review
      ? "high-warning"
      : metric.bytes > metric.target
        ? "warn"
        : "ok",
    delta: metric.baseline === null ? null : metric.bytes - metric.baseline,
  }));
}

/**
 * 判断预算结果是否应让当前检查失败。
 *
 * 默认模式只把大小超限作为评审告警；strict 模式才把 high-warning 变成失败。
 *
 * @param {ReturnType<typeof evaluateAiContextMetrics>} results 已评估的指标
 * @param {boolean} strict 是否启用发布审计严格模式
 * @returns {boolean} 当前检查是否应非零退出
 */
export function shouldFailAiContextBudget(results, strict) {
  return strict && results.some((result) => result.status === "high-warning");
}

function formatBytes(value) {
  return `${value} B`;
}

function printResults(results) {
  console.log("AI context budget:");
  for (const result of results) {
    const delta = result.delta === null
      ? ""
      : ` baselineΔ=${result.delta >= 0 ? "+" : ""}${result.delta} B`;
    console.log(
      `  ${result.status.padEnd(12)} ${result.name.padEnd(28)} ` +
        `actual=${formatBytes(result.bytes)} lines=${result.lines} ` +
        `target=${formatBytes(result.target)} review=${formatBytes(result.review)}${delta}`,
    );
  }
}

function main() {
  const strict = process.argv.includes("--strict");
  const results = evaluateAiContextMetrics(collectAiContextMetrics());
  printResults(results);
  if (shouldFailAiContextBudget(results, strict)) {
    const high = results.filter((result) => result.status === "high-warning");
    console.error(`严格预算检查失败:${high.map((item) => item.name).join(", ")}`);
    process.exitCode = 1;
  }
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entry === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`上下文预算检查失败:${error.message}`);
    process.exitCode = 1;
  }
}
