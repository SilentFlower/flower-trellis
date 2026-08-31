import assert from "node:assert/strict";
import test from "node:test";
import { classifyLockReachability } from "../../src/plugin/lock-reachability.js";

test("lock 可达性以当前声明为入口并忽略陈旧 roots", () => {
  const result = classifyLockReachability(
    [{ id: "source/root" }],
    {
      roots: ["source/orphan"],
      plugins: [
        { id: "source/dependency", dependencies: {} },
        { id: "source/orphan", dependencies: {} },
        { id: "source/root", dependencies: { "source/dependency": "1.0.0" } },
      ],
    },
  );

  assert.deepEqual([...result.reachableIds].sort(), ["source/dependency", "source/root"]);
  assert.deepEqual([...result.orphanIds], ["source/orphan"]);
  assert.deepEqual([...result.missingIds], []);
});

test("lock 可达性单独报告声明或依赖缺失", () => {
  const result = classifyLockReachability(
    [{ id: "source/root" }, { id: "source/unlocked" }],
    {
      roots: ["source/root"],
      plugins: [{
        id: "source/root",
        dependencies: { "source/missing": "1.0.0" },
      }],
    },
  );

  assert.deepEqual([...result.reachableIds], ["source/root"]);
  assert.deepEqual([...result.orphanIds], []);
  assert.deepEqual([...result.missingIds].sort(), ["source/missing", "source/unlocked"]);
});
