/** 在原生Ubuntu/Windows上实际执行两个CLI；全部推理请求只发送到回环mock。 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const probe = fileURLToPath(new URL("./confirmation-native-probe.mjs", import.meta.url));
const rows = [
  ["timeout", "100"], ["timeout", "130"], ["timeout", "200"], ["human", "3"], ["kill", "3"],
];
// 两个平台独立运行，平台内保留顺序，避免多个Claude安装/首启状态相互干扰。
const results = await Promise.all(["codex", "claude"].map(async harness => {
  for (const [scenario, seconds] of rows) {
    const code = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [probe, "--run", "--harness", harness, "--scenario", scenario, "--seconds", seconds], { stdio: "inherit" });
      child.once("error", reject);
      child.once("exit", code => resolve(code ?? 1));
    });
    if (code !== 0) return false;
  }
  return true;
}));
if (results.some(result => !result)) process.exitCode = 1;
