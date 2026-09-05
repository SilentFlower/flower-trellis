import fs from "node:fs";
import { spawnSync } from "node:child_process";

// 普通测试及其子进程默认关闭遥测；专项测试显式注入隔离目录和本地 HTTP 依赖。
const files = fs.readdirSync("test/js").filter(name => name.endsWith(".test.js")).sort().map(name => `test/js/${name}`);
const result = spawnSync(process.execPath, ["--test", ...files], {
  stdio: "inherit", env: { ...process.env, FLOWER_NO_TELEMETRY: "1" },
});
process.exitCode = result.status ?? 1;
