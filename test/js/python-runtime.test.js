import assert from "node:assert/strict";
import test from "node:test";
import { resolvePythonExecutable, execPythonSync } from "../../scripts/python-runtime.mjs";

test("Windows 失效别名继续探测 launcher 并保留参数", () => {
  const calls = [];
  const executable = resolvePythonExecutable({ env: {}, platform: "win32", probe: (command, args) => {
    calls.push([command, args]);
    return command === "py" ? { status: 0, stdout: "C:\\Python 38\\python.exe\n" } : { status: 9009 };
  } });
  assert.equal(executable, "C:\\Python 38\\python.exe");
  assert.deepEqual(calls.map(([command]) => command), ["python", "py"]);
  assert.deepEqual(calls[1][1].slice(0, 3), ["-3", "-X", "utf8"]);
});

test("显式解释器失效时不静默改用其它版本", () => {
  const calls = [];
  assert.throws(() => resolvePythonExecutable({ env: { FLOWER_TEST_PYTHON: '"C:\\missing python.exe"' }, probe: command => {
    calls.push(command);
    return { status: 9009 };
  } }), /未找到可运行的 Python/);
  assert.deepEqual(calls, ["C:\\missing python.exe"]);
});

test("真实 Python 参数数组保留中文与 shell 特殊字符", () => {
  const value = "中文 空格 %PATH% ! & ^";
  const output = execPythonSync(["-c", "import sys; print(sys.argv[1])", value], { encoding: "utf8" });
  assert.equal(output.trim(), value);
});
