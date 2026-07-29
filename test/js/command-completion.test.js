import assert from "node:assert/strict";
import test from "node:test";
import { showCommandCompletion } from "../../src/lib/command-completion.js";

test("交互完成态显示成功信息与退出选择", async () => {
  const logs = [];
  const prompts = [];

  await showCommandCompletion("init", "C:/demo", {
    interactive: true,
    output: { log: (message) => logs.push(message) },
    terminalExit: { platform: "linux" },
    selectPrompt: async (config) => {
      prompts.push(config);
      return "exit";
    },
  });

  assert.deepEqual(logs, ["\n🌸 flower-trellis init 安装成功 → C:/demo"]);
  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].message, "操作已完成");
  assert.deepEqual(prompts[0].choices, [{ name: "退出", value: "exit" }]);
  assert.equal(prompts[0].loop, false);
});

test("Windows 完成页选择退出后恢复终端并结束 CLI", async () => {
  const writes = [];
  const rawModes = [];
  const exitCodes = [];
  let paused = false;

  await showCommandCompletion("init", "C:/demo", {
    interactive: true,
    output: { log() {} },
    selectPrompt: async () => "exit",
    terminalExit: {
      platform: "win32",
      input: {
        isTTY: true,
        isRaw: true,
        setRawMode: (value) => rawModes.push(value),
        pause: () => { paused = true; },
      },
      output: {
        isTTY: true,
        write: (value) => writes.push(value),
      },
      schedule: (callback) => callback(),
      exitProcess: (code) => exitCodes.push(code),
    },
  });

  assert.deepEqual(rawModes, [false]);
  assert.equal(paused, true);
  assert.deepEqual(writes, ["\x1b[?25h", "\x1b[?9001l"]);
  assert.deepEqual(exitCodes, [0]);
});

test("非交互完成态只输出成功信息且不阻塞", async () => {
  const logs = [];
  let prompted = false;

  await showCommandCompletion("update", "/tmp/demo", {
    interactive: false,
    output: { log: (message) => logs.push(message) },
    selectPrompt: async () => {
      prompted = true;
      return "exit";
    },
  });

  assert.deepEqual(logs, ["\n🌸 flower-trellis update 更新成功 → /tmp/demo"]);
  assert.equal(prompted, false);
});

test("dry-run 完成态输出预览信息", async () => {
  const logs = [];

  await showCommandCompletion("update", "/tmp/demo", {
    interactive: false,
    outcome: "preview",
    output: { log: (message) => logs.push(message) },
  });

  assert.deepEqual(logs, ["\n🌸 flower-trellis update 预览完成 → /tmp/demo"]);
});
