import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { parse as parseToml } from "smol-toml";
import { resolveConfirmationHarness, createConfirmationHarnessLaunch, confirmationManualReason,
  supportsConfirmationHarness } from "../../src/lib/confirmation-harnesses.js";
import { parseCliArgs } from "../../src/lib/cli-args.js";
import { CONFIRMATION_SESSION_ENV } from "../../src/constants.js";

const descriptor = { version: 1, instance_id: "a0000000-0000-4000-8000-000000000000", platform: "codex",
  port: 12345, token: "a".repeat(64), server_name: "flower_confirmation_a0000000" };

test("session分隔符后的Harness选项和特殊字符原样保留", () => {
  const original = ["codex", "--target", "Harness目录", "中文 & % ! ^", "--model", "model"];
  const parsed = parseCliArgs(["session", "--target", "/project", "--", ...original]);
  assert.equal(parsed.command, "session");
  assert.equal(parsed.ctx.target, path.resolve("/project"));
  assert.deepEqual(parsed.ctx.forwarded, original);
});

test("Codex单次配置仅授权当前随机wait，TOML可解析且原权限参数保持原位", () => {
  const args = ["--ask-for-approval", "on-request", "中文 & % ! ^"];
  const env = { PATH: "test", HOME: process.env.HOME, EXISTING: "保留" };
  const launch = createConfirmationHarnessLaunch({ resolved: { executable: "codex", args: [], platform: "codex" }, args, descriptor, env });
  assert.deepEqual(launch.args.slice(-args.length), args);
  const overrides = launch.args.flatMap((value, index) => value === "-c" ? [launch.args[index + 1]] : []);
  const configuration = parseToml(overrides.join("\n"));
  const server = configuration.mcp_servers[descriptor.server_name];
  assert.deepEqual(JSON.parse(JSON.stringify(server.tools)), { wait: { approval_mode: "approve" } });
  assert.deepEqual(server.enabled_tools, ["wait"]);
  assert.ok(server.tool_timeout_sec > 86400);
  assert.deepEqual(Object.keys(configuration), ["mcp_servers", "shell_environment_policy"]);
  assert.deepEqual(JSON.parse(configuration.shell_environment_policy.set[CONFIRMATION_SESSION_ENV]), descriptor);
  assert.equal(launch.env.HOME, env.HOME);
  assert.equal(launch.env.EXISTING, "保留");
  assert.equal(env[CONFIRMATION_SESSION_ENV], undefined);
});

test("Claude保留已有配置，只叠加精确wait规则并关闭本次自动后台化", () => {
  const args = ["--model", "sonnet", "--permission-mode", "default"];
  const launch = createConfirmationHarnessLaunch({ resolved: { executable: "claude", args: [], platform: "claude" }, args, descriptor });
  assert.deepEqual(launch.args.slice(-args.length), args);
  assert.deepEqual(JSON.parse(launch.args[3]), { permissions: { allow: [`mcp__${descriptor.server_name}__wait`] },
    env: { CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS: "0" } });
  assert.deepEqual(Object.keys(JSON.parse(launch.args[1]).mcpServers), [descriptor.server_name]);
  assert.equal(launch.env.CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS, "0");
  for (const forbidden of ["--tools", "--strict-mcp-config", "--setting-sources"]) assert.ok(!launch.args.includes(forbidden));
});

test("不兼容模式与旧版本保留人工，版本探测为只读argv", () => {
  for (const [platform, args] of [["codex", ["exec"]], ["codex", ["--remote=ssh://host"]], ["claude", ["-p"]],
    ["claude", ["--settings", "custom.json"]], ["claude", ["--worktree=other"]]]) {
    assert.ok(confirmationManualReason(platform, args));
  }
  assert.equal(confirmationManualReason("codex", ["--resume", "abc"]), null);
  const resolved = { executable: "native", args: ["shim.js"], platform: "codex" };
  const execute = (file, args) => { assert.equal(file, "native"); assert.deepEqual(args, ["shim.js", "--version"]); return "codex-cli 0.167.0"; };
  assert.equal(supportsConfirmationHarness(resolved, { execute }), true);
  assert.equal(supportsConfirmationHarness(resolved, { execute: () => "0.166.9" }), false);
  assert.equal(supportsConfirmationHarness(resolved, { execute: () => "unknown" }), false);
  assert.throws(() => resolveConfirmationHarness("other-harness"), /只适配/);
});

test("原生命令路径解析不经过shell，真实特殊字符argv完整往返", t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "flower-harness-中文 & % ! ^ "));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const script = path.join(directory, "argv.mjs");
  fs.writeFileSync(script, "process.stdout.write(JSON.stringify(process.argv.slice(2)))");
  const args = ["中文 & % ! ^", "a b", 'quote"', "$(ignored)"];
  assert.deepEqual(JSON.parse(execFileSync(process.execPath, [script, ...args], { encoding: "utf8" })), args);
});

test("Windows npm原生shim严格核验后直接调用目标，篡改shim不能被绕过", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "flower-native-shim-中文 & % ! ^ "));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const packageRoot = path.join(root, "node_modules/@anthropic-ai/claude-code");
  const target = path.join(packageRoot, "bin/claude.exe");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(process.execPath, target);
  fs.chmodSync(target, 0o755);
  fs.writeFileSync(path.join(packageRoot, "package.json"), JSON.stringify({ name: "@anthropic-ai/claude-code", bin: { claude: "bin/claude.exe" } }));
  const shim = path.join(root, "claude.cmd");
  const text = ["@ECHO off", "GOTO start", ":find_dp0", "SET dp0=%~dp0", "EXIT /b", ":start", "SETLOCAL", "CALL :find_dp0",
    '"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*', ""].join("\r\n");
  fs.writeFileSync(shim, text);
  fs.writeFileSync(path.join(root, "claude"), "#!/bin/sh\n# npm同时生成的POSIX启动器\n");
  fs.chmodSync(path.join(root, "claude"), 0o755);
  assert.equal(resolveConfirmationHarness("claude", { platform: "win32", env: { PATH: root } }).executable, fs.realpathSync.native(target));
  const resolved = resolveConfirmationHarness(shim, { platform: "win32" });
  assert.equal(resolved.executable, fs.realpathSync.native(target));
  assert.deepEqual(resolved.args, []);
  assert.equal(execFileSync(resolved.executable, ["-p", "process.argv[1]", "中文 & % ! ^"], { encoding: "utf8" }).trim(), "中文 & % ! ^");
  fs.appendFileSync(shim, "rem 自定义逻辑\r\n");
  assert.throws(() => resolveConfirmationHarness(shim, { platform: "win32" }), /未找到可核验/);
});
