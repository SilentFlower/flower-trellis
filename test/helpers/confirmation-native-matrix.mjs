/** 原版 TUI 回归；只使用回环模型和临时项目，不连接用户会话。 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const [codex = "codex", claude = "claude"] = process.argv.slice(2);
const common = [["open", "brief", 3], ["open", "check", 3], ["open", "commit-only", 3],
  ...["reply", "escape", "edge", "kill", "resume", "partial", "changed"].map(mode => [mode, "check", 3])];

function run(platform, cli, mode, gate, seconds) {
  return new Promise(resolve => {
    const probe = fileURLToPath(new URL(`./confirmation-native-${platform}-probe.mjs`, import.meta.url));
    const child = spawn(process.execPath, [probe, mode, gate, String(seconds), cli], { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    for (const stream of [child.stdout, child.stderr]) stream.on("data", data => { output = (output + data).slice(-18000); });
    const timer = setTimeout(() => child.kill("SIGTERM"), (seconds + 100) * 1000);
    child.once("error", error => { output += error.message; });
    child.once("close", code => {
      clearTimeout(timer);
      console.log(`${platform} ${mode} ${gate} ${seconds}s：${code === 0 ? "通过" : "失败"}\n${output.trim()}`);
      resolve(code === 0);
    });
  });
}

async function shortMatrix(platform, cli, extra = []) {
  let passed = true;
  for (const spec of [...common, ...extra]) {
    if (!await run(platform, cli, ...spec)) passed = false;
  }
  return passed;
}

const results = await Promise.all([
  run("codex", codex, "open", "push", 200),
  run("claude", claude, "open", "push", 200),
  shortMatrix("codex", codex, [["solo-close", "push", 3], ["late", "check", 3]]),
  shortMatrix("claude", claude, [["denied", "check", 3]]),
]);
if (results.some(result => !result)) process.exitCode = 1;
