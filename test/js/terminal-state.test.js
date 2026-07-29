import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { showCommandCompletion } from "../../src/lib/command-completion.js";
import {
  disableWindowsTerminalWin32InputMode,
  installWindowsTerminalInputRecovery,
} from "../../src/lib/terminal-state.js";
import { runTrellisPty } from "../../src/lib/trellis-runner.js";

/** 模拟可切换 raw/flowing 状态的 TTY 输入流。 */
class FakeInput extends EventEmitter {
  /** @param {{flowing?:boolean}} [options] 初始流动状态 */
  constructor({ flowing = false } = {}) {
    super();
    this.isTTY = true;
    this.isRaw = false;
    this.readableFlowing = flowing;
    this.rawModes = [];
  }

  /**
   * @param {boolean} value raw mode 状态
   * @returns {void} 无返回值
   */
  setRawMode(value) {
    this.isRaw = value;
    this.rawModes.push(value);
  }

  /** @returns {void} 恢复流动状态 */
  resume() {
    this.readableFlowing = true;
  }

  /** @returns {void} 暂停输入流 */
  pause() {
    this.readableFlowing = false;
  }
}

/** 模拟带窗口尺寸和写入记录的 TTY 输出流。 */
class FakeOutput extends EventEmitter {
  /** @param {{isTTY?:boolean}} [options] 是否模拟交互终端 */
  constructor({ isTTY = true } = {}) {
    super();
    this.isTTY = isTTY;
    this.columns = 120;
    this.rows = 36;
    this.chunks = [];
  }

  /**
   * @param {string} value 输出内容
   * @returns {boolean} 写入成功
   */
  write(value) {
    this.chunks.push(value);
    return true;
  }
}

function createFakePty() {
  let onData;
  let onExit;
  let dataDisposed = false;
  return {
    onData(listener) {
      onData = listener;
      return {
        dispose() {
          dataDisposed = true;
          onData = undefined;
        },
      };
    },
    onExit(listener) {
      onExit = listener;
      return { dispose() {} };
    },
    write() {},
    resize() {},
    emitData(value) {
      onData?.(value);
    },
    emitExit(event) {
      onExit?.(event);
    },
    get dataDisposed() {
      return dataDisposed;
    },
  };
}

test("Windows TTY 会写出 Win32 输入模式关闭序列", () => {
  const output = new FakeOutput();

  const changed = disableWindowsTerminalWin32InputMode({
    platform: "win32",
    output,
  });

  assert.equal(changed, true);
  assert.deepEqual(output.chunks, ["\x1b[?9001l"]);
});

test("非 Windows 或非 TTY 不输出终端控制序列", () => {
  const linuxOutput = new FakeOutput();
  const pipedOutput = new FakeOutput({ isTTY: false });

  assert.equal(disableWindowsTerminalWin32InputMode({
    platform: "linux",
    output: linuxOutput,
  }), false);
  assert.equal(disableWindowsTerminalWin32InputMode({
    platform: "win32",
    output: pipedOutput,
  }), false);
  assert.deepEqual(linuxOutput.chunks, []);
  assert.deepEqual(pipedOutput.chunks, []);
});

test("CLI 启动和退出都会恢复 Windows 终端输入模式", () => {
  const output = new FakeOutput();
  const processEvents = new EventEmitter();

  const dispose = installWindowsTerminalInputRecovery({
    platform: "win32",
    output,
    processEvents,
  });

  assert.deepEqual(output.chunks, ["\x1b[?9001l"]);
  assert.equal(processEvents.listenerCount("exit"), 1);

  processEvents.emit("exit");
  assert.deepEqual(output.chunks, ["\x1b[?9001l", "\x1b[?9001l"]);
  assert.equal(processEvents.listenerCount("exit"), 0);
  dispose();
});

test("PTY 退出后停止迟到输出并恢复 Windows 宿主终端", async () => {
  const input = new FakeInput();
  const output = new FakeOutput();
  const child = createFakePty();
  const result = runTrellisPty(["init"], "C:/demo", {
    stripBanner: false,
    platform: "win32",
    stdin: input,
    stdout: output,
    ptySpawn: () => child,
  });

  child.emitData("\x1b[?9001hTrellis prompt");
  child.emitExit({ exitCode: 0 });

  assert.equal(await result, 0);
  assert.equal(child.dataDisposed, true);
  assert.deepEqual(input.rawModes, [true, false]);
  assert.equal(input.readableFlowing, false);
  assert.equal(input.listenerCount("data"), 0);
  assert.equal(output.listenerCount("resize"), 0);
  assert.equal(output.chunks.join(""), "\x1b[?9001hTrellis prompt\x1b[?9001l");

  child.emitData("\x1b[?9001h迟到输出");
  assert.equal(output.chunks.at(-1), "\x1b[?9001l");

  await showCommandCompletion("init", "C:/demo", {
    interactive: true,
    output: { log() {} },
    selectPrompt: async () => {
      assert.equal(output.chunks.at(-1), "\x1b[?9001l");
      return "exit";
    },
  });
});

test("PTY 信号退出返回 128 并恢复原先流动状态", async () => {
  const input = new FakeInput({ flowing: true });
  const output = new FakeOutput();
  const child = createFakePty();
  const result = runTrellisPty(["update"], "C:/demo", {
    platform: "win32",
    stdin: input,
    stdout: output,
    ptySpawn: () => child,
  });

  child.emitExit({ exitCode: 1, signal: 2 });

  assert.equal(await result, 128);
  assert.equal(input.readableFlowing, true);
  assert.equal(output.chunks.at(-1), "\x1b[?9001l");
});

test("PTY 启动异常也会兜底恢复 Windows 宿主终端", async () => {
  const output = new FakeOutput();

  await assert.rejects(
    runTrellisPty(["init"], "C:/demo", {
      platform: "win32",
      stdin: new FakeInput(),
      stdout: output,
      ptySpawn() {
        throw new Error("spawn failed");
      },
    }),
    /spawn failed/,
  );
  assert.equal(output.chunks.at(-1), "\x1b[?9001l");
});

test("终端输出流关闭时恢复失败不会覆盖原流程", () => {
  const changed = disableWindowsTerminalWin32InputMode({
    platform: "win32",
    output: {
      isTTY: true,
      write() {
        throw new Error("output closed");
      },
    },
  });

  assert.equal(changed, false);
});
