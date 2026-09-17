import assert from "node:assert/strict";
import test from "node:test";
import { beginOperationTiming, timeOperation } from "../../src/lib/operation-timing.js";

test("计时默认关闭，不读时钟、不写输出、保留同步结果", () => {
  const result = timeOperation("测试", "阶段", () => 42, {
    env: {}, now: () => assert.fail("不应读时钟"), output: { write: () => assert.fail("不应输出") },
  });
  assert.equal(result, 42);
});

test("计时先开始再执行，成功/异常/退出码保留且无原异常内容", async () => {
  const lines = [];
  let clock = 0;
  const options = { env: { FLOWER_TIMING: "1" }, now: () => clock, output: { write: (value) => lines.push(value) } };
  assert.equal(timeOperation("测试", "同步", () => { assert.match(lines[0], /开始/); clock = 12; return 0; }, options), 0);
  assert.match(lines[1], /完成 12 ms/);
  const error = new Error("不应输出的敏感信息");
  await assert.rejects(timeOperation("测试", "异步", async () => { throw error; }, options), (value) => value === error);
  assert.match(lines.at(-1), /失败/);
  const recovery = { ok: false, failedPaths: [] };
  assert.equal(timeOperation("测试", "恢复", () => recovery, options), recovery);
  assert.match(lines.at(-1), /失败/);
  assert.equal(timeOperation("测试", "网络探测", () => null, options), null);
  assert.match(lines.at(-1), /失败/);
  assert.doesNotMatch(lines.join(""), /敏感/);
  assert.equal(timeOperation("测试", "子进程", () => 3, options), 3);
  assert.match(lines.at(-1), /失败/);
  const finish = beginOperationTiming("测试", "总计", options);
  finish(); finish(false);
  assert.equal(lines.filter((line) => /总计.*完成/.test(line)).length, 1);
});

test("诊断输出失效不改变原操作结果", () => {
  assert.equal(timeOperation("测试", "阶段", () => 0, {
    env: { FLOWER_TIMING: "1" }, output: { write: () => { throw new Error("输出关闭"); } },
  }), 0);
});
