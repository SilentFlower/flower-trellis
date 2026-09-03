import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";


const ROOT = path.resolve(".");
const CLI = path.join(ROOT, "bin/flower-trellis.js");

const HELP_CASES = [
  { args: ["init", "-h"], expected: /flower-trellis init/ },
  { args: ["update", "--help"], expected: /flower-trellis update/ },
  { args: ["self-check", "--help"], expected: /flower-trellis self-check/ },
  { args: ["self-update", "--help"], expected: /flower-trellis self-update/ },
  { args: ["update-check", "--help"], expected: /flower-trellis update-check/ },
  { args: ["update-check", "set", "--help"], expected: /--interval-hours/ },
  { args: ["telemetry", "--help"], expected: /flower-trellis telemetry/ },
  { args: ["telemetry", "enable", "--help"], expected: /FLOWER_NO_TELEMETRY/ },
  { args: ["trellis", "--help"], expected: /flower-trellis disable/ },
  { args: ["status", "--help"], expected: /flower-trellis status/ },
  { args: ["enable", "--help"], expected: /flower-trellis enable/ },
  { args: ["disable", "--help"], expected: /flower-trellis disable/ },
  { args: ["skill", "--help"], expected: /flower-trellis skill/ },
  { args: ["plugin", "--help"], expected: /flower-trellis plugin list/ },
  { args: ["plugin", "add", "--help"], expected: /flower-trellis plugin add/ },
  { args: ["worktree", "--help"], expected: /worktree <子命令> --help/ },
  { args: ["worktree", "create", "--help"], expected: /--branch 必须是尚不存在的新分支/ },
  { args: ["uninstall", "--help"], expected: /flower-trellis uninstall/ },
];

test("Flower 一级命令和独立子命令帮助在无效目标上零写入退出", () => {
  for (const item of HELP_CASES) {
    const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "flower-cli-help-"));
    try {
      const target = path.join(sandbox, "missing-target");
      const env = {
        ...process.env,
        HOME: path.join(sandbox, "home"),
        XDG_CONFIG_HOME: path.join(sandbox, "config"),
        APPDATA: path.join(sandbox, "appdata"),
        PATH: path.join(sandbox, "empty-path"),
      };
      const result = spawnSync(
        process.execPath,
        [CLI, ...item.args, "--target", target],
        { cwd: ROOT, env, encoding: "utf8" },
      );

      assert.equal(
        result.status,
        0,
        `${item.args.join(" ")}\n${result.stderr || result.stdout}`,
      );
      assert.equal(result.stderr, "", item.args.join(" "));
      assert.match(result.stdout, item.expected, item.args.join(" "));
      assert.deepEqual(fs.readdirSync(sandbox), [], `${item.args.join(" ")} 不应写入目标或用户配置`);
    } finally {
      fs.rmSync(sandbox, { recursive: true, force: true });
    }
  }
});

test("帮助分支位于联网、写盘、交互和子进程入口之前", () => {
  const cases = [
    ["src/commands/init.js", "export async function init", "fs.existsSync(target)"],
    ["src/commands/update.js", "export async function update", "runWithTrellisIntegrationEnabled("],
    ["src/commands/self-check.js", "export async function selfCheck", "buildSelfCheck("],
    ["src/commands/self-update.js", "export async function selfUpdate", "buildSelfCheck("],
    ["src/commands/update-check.js", "export async function updateCheck", "assertTrellisProject("],
    ["src/commands/telemetry.js", "export async function telemetry", "printStatus(process.env)"],
    ["src/commands/uninstall.js", "export async function uninstall", "planSkillGardenUninstall("],
  ];

  for (const [file, signature, firstSideEffect] of cases) {
    const source = fs.readFileSync(path.join(ROOT, file), "utf8");
    const body = source.slice(source.indexOf(signature));
    const helpIndex = body.indexOf("if (hasHelpFlag(");
    const sideEffectIndex = body.indexOf(firstSideEffect);
    assert.notEqual(helpIndex, -1, `${file} 缺少命令级帮助分支`);
    assert.notEqual(sideEffectIndex, -1, `${file} 缺少预期副作用边界`);
    assert.ok(helpIndex < sideEffectIndex, `${file} 帮助必须先于 ${firstSideEffect}`);
  }
});
