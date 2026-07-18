import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateAiContextMetrics,
  shouldFailAiContextBudget,
} from "../../scripts/check-ai-context-budget.mjs";

test("上下文预算按 target/review 分级且默认不硬失败", () => {
  const results = evaluateAiContextMetrics([
    { name: "ok", bytes: 100, lines: 1, target: 100, review: 120, baseline: 90 },
    { name: "warn", bytes: 110, lines: 1, target: 100, review: 120, baseline: 90 },
    { name: "high", bytes: 121, lines: 1, target: 100, review: 120, baseline: null },
  ]);

  assert.deepEqual(
    results.map((result) => result.status),
    ["ok", "warn", "high-warning"],
  );
  assert.deepEqual(
    results.map((result) => result.delta),
    [10, 20, null],
  );
  assert.equal(shouldFailAiContextBudget(results, false), false);
  assert.equal(shouldFailAiContextBudget(results.slice(0, 2), true), false);
  assert.equal(shouldFailAiContextBudget(results, true), true);
});
