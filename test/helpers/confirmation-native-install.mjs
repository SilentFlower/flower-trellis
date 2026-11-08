/** 隔离旧版 CLI、Claude 缓存与 npm prefix，实测正常升级和卸载。 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const scratch = path.join(repo, ".trellis-tmp");
fs.mkdirSync(scratch, { recursive: true });
const root = fs.mkdtempSync(path.join(scratch, "confirmation-upgrade-"));
const old = path.join(root, "old");
const home = path.join(root, "home");
const project = path.join(root, "project");
const prefix = path.join(root, "npm");
for (const dir of [old, home, project, path.join(prefix, "bin"), path.join(prefix, "lib/node_modules/@mindfoldhq")]) {
  fs.mkdirSync(dir, { recursive: true });
}
const trellis = path.join(repo, "node_modules/@mindfoldhq/trellis");
fs.symlinkSync(path.join(repo, "node_modules"), path.join(old, "node_modules"));
fs.symlinkSync(trellis, path.join(prefix, "lib/node_modules/@mindfoldhq/trellis"));
fs.symlinkSync(path.join(trellis, "bin/trellis.js"), path.join(prefix, "bin/trellis"));
const env = {
  PATH: [path.join(prefix, "bin"), process.env.PATH].join(path.delimiter), HOME: home,
  CLAUDE_CONFIG_DIR: path.join(root, "claude"), CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  FLOWER_NO_TELEMETRY: "1", DISABLE_AUTOUPDATER: "1", DISABLE_TELEMETRY: "1",
  GIT_CONFIG_GLOBAL: path.join(root, "gitconfig"), GIT_CONFIG_NOSYSTEM: "1", npm_config_prefix: prefix,
};
const run = (command, args, options = {}) => execFileSync(command, args, {
  cwd: project, env, timeout: 60000, maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"], ...options,
});
const cli = (base, args) => run(process.execPath, [path.join(base, "bin/flower-trellis.js"), ...args, "--target", project]);
const commit = message => {
  run("git", ["add", "--all"]);
  run("git", ["-c", "user.name=native-test", "-c", "user.email=native@example.invalid", "commit", "-qm", message]);
};
const file = relative => path.join(project, relative);
const read = relative => JSON.parse(fs.readFileSync(file(relative), "utf8"));
const localSettings = ".claude/settings.local.json";
const original = { env: { USER_ONLY: "unchanged" }, hooks: { UserPromptSubmit: [] } };
const projectSettings = ".claude/settings.json";
const hookEvents = ["UserPromptSubmit", "PreToolUse", "PostToolUseFailure", "SessionEnd"];
const handlers = (settings, event) => (settings.hooks?.[event] || []).flatMap(group => group.hooks)
  .filter(hook => hook.command === "ftl confirm hook");
const mcp = { mcpServers: { userOnly: { command: "keep-my-command" } } };
const policy = "confirmation_timeout:\n  check:\n    base_seconds: 127\n  push:\n    enabled: false\n";

try {
  const archive = path.join(root, "beta.tar");
  run("git", ["archive", "--output", archive, "v0.6.13-beta.2"], { cwd: repo });
  run("tar", ["-xf", archive, "-C", old]);
  run("git", ["init", "--quiet"]);
  cli(old, ["init", "-y", "--claude", "--codex", "-u", "native-test", "--no-update-check"]);
  fs.appendFileSync(file(".trellis/config.yaml"), "\n" + policy);
  fs.writeFileSync(file(localSettings), JSON.stringify(original));
  fs.writeFileSync(file(".mcp.json"), JSON.stringify(mcp));
  commit("隔离 beta.2 基线");
  for (let attempt = 0; attempt < 2; attempt++) {
    cli(repo, ["update", "--force", "--no-update-check"]);
    assert.ok(fs.readFileSync(file(".trellis/config.yaml"), "utf8").includes(policy));
    assert.doesNotMatch(fs.readFileSync(file(".trellis/scripts/confirmation.md"), "utf8"), /ftl session/);
    assert.deepEqual(read(localSettings), original);
    for (const event of hookEvents) assert.equal(handlers(read(projectSettings), event).length, 1);
    assert.deepEqual(read(".mcp.json"), mcp);
  }
  assert.doesNotMatch(String(cli(repo, ["--help"])), /flower-trellis session/);
  const edited = read(projectSettings);
  const userHook = { matcher: "Bash", hooks: [{ type: "command", command: "echo user-hook", timeout: 4 }] };
  edited.hooks.PreToolUse.push(userHook);
  fs.writeFileSync(file(projectSettings), JSON.stringify(edited));
  commit("隔离升级完成");
  cli(repo, ["uninstall", "-y"]);
  assert.deepEqual(read(localSettings), original);
  assert.deepEqual(read(".mcp.json"), mcp);
  if (fs.existsSync(file(projectSettings))) {
    for (const event of hookEvents) assert.equal(handlers(read(projectSettings), event).length, 0);
    assert.ok(read(projectSettings).hooks.PreToolUse.some(group => group.hooks.some(hook => hook.command === "echo user-hook")));
  }
  process.stdout.write(`${JSON.stringify({ root, beta: "0.6.13-beta.2", updates: 2, uninstalled: true, userSettingsPreserved: true })}\n`);
} catch (error) {
  const detail = String(error.stderr ?? "").trim() || String(error.stdout ?? "").trim() || error.message;
  process.stderr.write(`${root}: ${detail.split("\n").slice(-10).join("\n")}\n`);
  process.exitCode = 1;
}
