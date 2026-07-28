import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const MATRIX = path.resolve("test/fixtures/plugin/evidence-matrix.json");

test("父任务与 P7 的每条验收标准都有机器可读证据映射", () => {
  const matrix = JSON.parse(fs.readFileSync(MATRIX, "utf8"));
  const expected = [
    ...Array.from({ length: 27 }, (_, index) => `PARENT-AC-${String(index + 1).padStart(2, "0")}`),
    ...Array.from({ length: 10 }, (_, index) => `P7-AC-${String(index + 1).padStart(2, "0")}`),
  ];
  const ids = matrix.evidence.map(({ id }) => id);
  assert.deepEqual([...ids].sort(), [...expected].sort());
  assert.equal(new Set(ids).size, ids.length);
  for (const entry of matrix.evidence) {
    assert.equal(["automated", "hybrid", "manual"].includes(entry.type), true, `${entry.id} 类型无效`);
    assert.equal(typeof entry.summary === "string" && entry.summary.length > 0, true, `${entry.id} 缺少摘要`);
    if (entry.type !== "manual") {
      assert.equal(Array.isArray(entry.files) && entry.files.length > 0, true, `${entry.id} 缺少自动证据`);
      for (const file of entry.files) assert.equal(fs.existsSync(path.resolve(file)), true, `${entry.id} 缺少 ${file}`);
    }
    if (entry.type !== "automated") {
      assert.equal(Array.isArray(entry.manualSteps) && entry.manualSteps.length > 0, true, `${entry.id} 缺少人工步骤`);
    }
  }
});
