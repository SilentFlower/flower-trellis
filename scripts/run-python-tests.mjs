import { spawnPythonSync } from "./python-runtime.mjs";
import path from "node:path";

// 避免 Windows Python 自带 test 包遮蔽仓库的无 __init__ 测试目录。
const args = process.argv.slice(2).map(arg => arg.replace(/^test[\\/]python[\\/](test_\w+)\.py$/, "$1"));
const result = spawnPythonSync(["-m", "unittest", ...(args.length ? args : ["discover", "-s", "test/python", "-p", "test_*.py"])], {
  stdio: "inherit", env: { ...process.env, FLOWER_NO_TELEMETRY: "1", PYTHONPATH: [path.resolve("test/python"), process.env.PYTHONPATH].filter(Boolean).join(path.delimiter) },
});
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
