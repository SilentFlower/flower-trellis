import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import * as pty from "node-pty";
import {
  createFlowerCliCopy,
  createIsolatedFlowerEnv,
  runFlower,
  snapshotProjectFiles,
} from "./plugin-e2e-helpers.js";
import { createPluginTestRoot } from "./plugin-test-helpers.js";

const SOURCE_CLI = path.resolve("bin/flower-trellis.js");

/**
 * 移除终端 ANSI 控制序列，便于断言交互文本。
 *
 * @param {string} value 原始终端输出
 * @returns {string} 纯文本
 */
function stripAnsi(value) {
  return value.replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, "")
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
    .replaceAll("\r", "");
}

/**
 * 在真实伪终端中打开 Plugin 首页并选择退出。
 *
 * @param {string} project 项目根
 * @param {{cli?:string,env?:NodeJS.ProcessEnv}} [options] CLI 与隔离环境覆盖
 * @returns {Promise<{status:number,output:string}>} 退出状态和终端输出
 */
async function openAndExitPluginManager(project, options = {}) {
  const terminal = pty.spawn(process.execPath, [options.cli || SOURCE_CLI, "plugin", "--target", project], {
    cwd: project,
    cols: 120,
    rows: 36,
    env: createIsolatedFlowerEnv(path.join(path.dirname(project), "interactive-env"), options.env),
  });
  let output = "";
  let submitted = false;
  const result = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      terminal.kill();
      reject(new Error(`Plugin 交互首页超时:\n${stripAnsi(output)}`));
    }, 10_000);
    terminal.onData((chunk) => {
      output += chunk;
      if (!submitted && stripAnsi(output).includes("↑↓ 选择")) {
        submitted = true;
        setTimeout(() => terminal.write("\x1b"), 50);
      }
    });
    terminal.onExit(({ exitCode }) => {
      clearTimeout(timeout);
      resolve({ status: exitCode, output });
    });
  });
  return result;
}

test("真实 TTY 裸 plugin 打开管理首页并可零写入退出", async (t) => {
  const project = createPluginTestRoot(t, "flower-e2e-plugin-ui-");
  const runtime = createPluginTestRoot(t, "flower-e2e-plugin-ui-runtime-");
  const { cli, keyringFile } = createFlowerCliCopy(runtime);
  const before = snapshotProjectFiles(project);
  const result = await openAndExitPluginManager(project, {
    cli,
    env: { FLOWER_E2E_KEYRING_FILE: keyringFile },
  });
  const output = stripAnsi(result.output);
  assert.equal(result.status, 0, output);
  assert.match(output, /Flower Plugin/);
  assert.match(output, /发现 0.*已安装 0.*来源 1.*问题/);
  assert.match(output, /已退出 Plugin 管理/);
  assert.deepEqual(snapshotProjectFiles(project), before);
});

test("非 TTY 裸 plugin 保持 list，顶层 help 只展示一个 Plugin 入口", (t) => {
  const project = createPluginTestRoot(t, "flower-e2e-plugin-non-tty-");
  const bare = runFlower(project, ["plugin"]);
  assert.equal(bare.status, 0, `${bare.stdout}\n${bare.stderr}`);
  assert.match(bare.stdout, /当前项目未声明 Plugin/);
  assert.doesNotMatch(bare.stdout, /请选择操作/);

  const help = runFlower(project, ["--help"]);
  assert.equal(help.status, 0, help.stderr);
  const pluginLines = help.stdout.split("\n").filter((line) => line.includes("flower-trellis plugin"));
  assert.equal(pluginLines.length, 1);
  assert.doesNotMatch(help.stdout, /plugin <list\|add\|update\|remove\|verify>/);

  const advanced = runFlower(project, ["plugin", "--help"]);
  assert.equal(advanced.status, 0, advanced.stderr);
  assert.match(advanced.stdout, /plugin add/);
  assert.match(advanced.stdout, /plugin auth/);
  assert.equal(fs.existsSync(path.join(project, ".flower")), false);
});
