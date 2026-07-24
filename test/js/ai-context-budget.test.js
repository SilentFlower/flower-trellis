import assert from "node:assert/strict";
import test from "node:test";

import {
  collectAiContextMetrics,
  evaluateAiContextMetrics,
  shouldFailAiContextBudget,
} from "../../scripts/check-ai-context-budget.mjs";


test("Auto-Loop 最终入口使用独立上下文预算", () => {
  const metrics = collectAiContextMetrics();
  const autoLoop = metrics.filter((metric) => metric.name.startsWith("auto-loop:"));

  assert.ok(autoLoop.length >= 1);
  for (const metric of autoLoop) {
    assert.equal(metric.target, 16 * 1024);
    assert.equal(metric.review, 18 * 1024);
    assert.equal(metric.baseline, 15600);
  }
  const control = metrics.find((metric) => metric.name === "control-context-total");
  assert.ok(control);
  assert.equal(control.baseline, 90397);
});


test("strict 只阻断超过 review ceiling 的指标", () => {
  const results = evaluateAiContextMetrics([
    { name: "ok", bytes: 10, lines: 1, target: 10, review: 20, baseline: 10 },
    { name: "warn", bytes: 15, lines: 1, target: 10, review: 20, baseline: 10 },
    { name: "high", bytes: 21, lines: 1, target: 10, review: 20, baseline: 10 },
  ]);

  assert.deepEqual(results.map((result) => result.status), ["ok", "warn", "high-warning"]);
  assert.equal(shouldFailAiContextBudget(results, false), false);
  assert.equal(shouldFailAiContextBudget(results, true), true);
});
