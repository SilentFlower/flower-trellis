import assert from "node:assert/strict";
import test from "node:test";

import {
  collectAiContextMetrics,
  evaluateAiContextMetrics,
  shouldFailAiContextBudget,
} from "../../scripts/check-ai-context-budget.mjs";


test("最终入口分别计量 Auto-Loop 与两平台实际 SessionStart 分段", () => {
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
  const parts = metrics.filter((metric) => metric.name.startsWith("session-start:"));
  assert.deepEqual(parts.map((metric) => metric.name), [
    "session-start:codex:state", "session-start:codex:rules", "session-start:codex:stages",
    "session-start:claude:state", "session-start:claude:rules", "session-start:claude:stages",
  ]);
  for (const metric of parts) {
    assert.equal(metric.unit, "characters");
    assert.ok(metric.characters > 0);
    assert.ok(metric.bytes >= metric.characters);
  }
  const platformTotals = ["codex", "claude"].map((platform) =>
    parts.filter((metric) => metric.name.includes(`:${platform}:`)).reduce((sum, metric) => sum + metric.bytes, 0)
  );
  assert.equal(metrics.find((metric) => metric.name === "session-start").bytes, Math.max(...platformTotals));
  const hint = metrics.find((metric) => metric.name === "astra-workflow-hint");
  assert.ok(hint.bytes > 0 && hint.bytes <= 2048);
  assert.equal(hint.target, 2048);
  assert.equal(hint.review, 2048);
  const scenarios = metrics.filter((metric) => metric.name.startsWith("session-start-case:"));
  assert.equal(scenarios.length, 8);
  const scenarioBytes = (name) => scenarios.find((metric) => metric.name === `session-start-case:${name}`).bytes;
  const baseline = scenarioBytes("codex:missing-model");
  for (const source of ["startup", "clear", "compact"]) {
    assert.equal(scenarioBytes(`codex:astra-${source}`), baseline + hint.bytes + 1);
  }
  assert.equal(scenarioBytes("codex:other-model"), baseline);
  assert.equal(scenarioBytes("codex:disabled"), baseline);
  assert.equal(scenarioBytes("claude:astra-startup"), scenarioBytes("claude:astra-compact"));
  assert.equal(metrics.find((metric) => metric.name === "session-start").bytes,
    Math.max(...scenarios.map((metric) => metric.bytes)));
});


test("strict 只阻断超过 review ceiling 的指标", () => {
  const results = evaluateAiContextMetrics([
    { name: "ok", bytes: 10, lines: 1, target: 10, review: 20, baseline: 10 },
    { name: "warn", bytes: 15, lines: 1, target: 10, review: 20, baseline: 10 },
    { name: "high", bytes: 21, lines: 1, target: 10, review: 20, baseline: 10 },
    { name: "unicode", bytes: 27000, characters: 9000, unit: "characters", target: 8000, review: 10000, baseline: null },
    { name: "long", bytes: 30003, characters: 10001, unit: "characters", target: 8000, review: 10000, baseline: null },
  ]);

  assert.deepEqual(results.map((result) => result.status), ["ok", "warn", "high-warning", "warn", "high-warning"]);
  assert.equal(shouldFailAiContextBudget(results, false), false);
  assert.equal(shouldFailAiContextBudget(results, true), true);
});
