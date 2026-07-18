import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PKG_ROOT } from "../src/lib/paths.js";

const KIB = 1024;
const BASELINES = {
  workflow: 56635,
  hub: 10757,
  statesTotal: 8546,
  phaseSummary: 17935,
  sessionStart: 17841,
};
const BUDGETS = {
  workflow: { target: 60 * KIB, review: 64 * KIB },
  hub: { target: 11 * KIB, review: 12 * KIB },
  state: { target: 2.5 * KIB, review: 3 * KIB },
  statesTotal: { target: 9 * KIB, review: 10 * KIB },
  phaseSummary: { target: 18 * KIB, review: 20 * KIB },
  sessionStart: { target: 18 * KIB, review: 20 * KIB },
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

function readRequired(file) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    throw new Error(`上下文预算目标不存在:${path.relative(PKG_ROOT, file)}`);
  }
  return fs.readFileSync(file, "utf8");
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
  const workflow = readRequired(path.join(PKG_ROOT, ".trellis", "workflow.md"));
  const hub = readRequired(
    path.join(
      PKG_ROOT,
      "vendor",
      "skill-garden",
      ".trellis",
      "0.6",
      "overrides",
      "workflow.md",
    ),
  );
  const stateDir = path.join(
    PKG_ROOT,
    "vendor",
    "skill-garden",
    ".trellis",
    "0.6",
    "overrides",
    "workflow-states",
  );
  if (!fs.existsSync(stateDir)) throw new Error("缺少 0.6 workflow-states 目录");
  const stateFiles = fs.readdirSync(stateDir)
    .filter((name) => name.endsWith(".md"))
    .sort();
  if (stateFiles.length === 0) throw new Error("0.6 workflow-states 为空");
  const stateValues = stateFiles.map((name) => ({
    name,
    value: readRequired(path.join(stateDir, name)),
  }));
  const metrics = [
    measureText("workflow", workflow, BUDGETS.workflow, BASELINES.workflow),
    measureText("hub", hub, BUDGETS.hub, BASELINES.hub),
    ...stateValues.map(({ name, value }) =>
      measureText(`state:${name}`, value, BUDGETS.state)
    ),
    measureText(
      "states-total",
      stateValues.map((item) => item.value).join(""),
      BUDGETS.statesTotal,
      BASELINES.statesTotal,
    ),
    measureText(
      "phase-summary",
      measurePhaseSummary(),
      BUDGETS.phaseSummary,
      BASELINES.phaseSummary,
    ),
    measureText(
      "session-start",
      measureSessionStart(),
      BUDGETS.sessionStart,
      BASELINES.sessionStart,
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
