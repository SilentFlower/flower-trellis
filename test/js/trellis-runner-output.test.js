import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import {
  rewriteUpstreamUpgradeNotice,
  runTrellisPty,
} from "../../src/lib/trellis-runner.js";

/** 模拟可切换 raw/flowing 状态的 TTY 输入流。 */
class FakeInput extends EventEmitter {
  constructor() {
    super();
    this.isTTY = true;
    this.isRaw = false;
    this.readableFlowing = false;
  }

  /**
   * @param {boolean} value raw mode 状态
   * @returns {void} 无返回值
   */
  setRawMode(value) {
    this.isRaw = value;
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
  constructor() {
    super();
    this.isTTY = true;
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

/**
 * 构造可手工投喂输出、手工触发退出的伪 pty。
 *
 * @returns {object} 伪 pty 句柄
 */
function createFakePty() {
  let onData;
  let onExit;
  return {
    onData(listener) {
      onData = listener;
      return {
        dispose() {
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
  };
}

/**
 * 在 stripBanner 模式下跑一次伪 pty,返回宿主终端收到的完整文本。
 *
 * @param {string} data 子进程输出
 * @returns {Promise<string>} 过滤后的输出
 */
async function runWithBannerStrip(data) {
  const output = new FakeOutput();
  const child = createFakePty();
  const result = runTrellisPty(["update"], "/demo", {
    stripBanner: true,
    platform: "linux",
    stdin: new FakeInput(),
    stdout: output,
    ptySpawn: () => child,
  });
  child.emitData(data);
  child.emitExit({ exitCode: 0 });
  await result;
  return output.chunks.join("");
}

test("上游 npm 升级提示被替换成 Flower 的版本固定说明", () => {
  assert.equal(
    rewriteUpstreamUpgradeNotice("⚠️  Your CLI (0.6.14) is behind npm (0.6.15)."),
    "  · Trellis 版本由 Flower 固定(0.6.14),已忽略上游 npm 升级提示",
  );
  // 上游用 chalk 上色,去色后仍要命中
  assert.equal(
    rewriteUpstreamUpgradeNotice("\x1b[33m⚠️  Your CLI (0.7.0) is behind npm (0.8.0).\x1b[39m"),
    "  · Trellis 版本由 Flower 固定(0.7.0),已忽略上游 npm 升级提示",
  );
});

test("上游引导动作行被丢弃,降级分支的真实指引保持原样", () => {
  assert.equal(rewriteUpstreamUpgradeNotice("   Run: trellis upgrade"), null);
  // 降级分支的 `1. Update your CLI: trellis upgrade` 是真实错误指引,不能误伤
  assert.equal(
    rewriteUpstreamUpgradeNotice("  1. Update your CLI: trellis upgrade"),
    undefined,
  );
  assert.equal(
    rewriteUpstreamUpgradeNotice("❌ Cannot update: CLI version (0.6.13) < project version (0.6.14)"),
    undefined,
  );
  assert.equal(rewriteUpstreamUpgradeNotice("Scanning for changes..."), undefined);
});

test("PTY 正文阶段仍会改写上游版本提示,其余输出原样透传", async () => {
  const text = await runWithBannerStrip(
    "👤 Developer: silentflower\r\n"
    + "Trellis Update\r\n"
    + "══════════════\r\n"
    + "\r\n"
    + "Project version: 0.6.14\r\n"
    + "CLI version:     0.6.14\r\n"
    + "Latest on npm:   0.6.15\r\n"
    + "\r\n"
    + "\x1b[33m⚠️  Your CLI (0.6.14) is behind npm (0.6.15).\x1b[39m\r\n"
    + "\x1b[33m   Run: trellis upgrade\x1b[39m\r\n"
    + "\r\n"
    + "Scanning for changes...\r\n",
  );

  assert.equal(
    text,
    "Trellis Update\r\n"
    + "══════════════\r\n"
    + "\r\n"
    + "Project version: 0.6.14\r\n"
    + "CLI version:     0.6.14\r\n"
    + "Latest on npm:   0.6.15\r\n"
    + "\r\n"
    + "  · Trellis 版本由 Flower 固定(0.6.14),已忽略上游 npm 升级提示\r\n"
    + "\r\n"
    + "Scanning for changes...\r\n",
  );
});

test("inquirer 渲染后停止过滤,交互输出完全透传", async () => {
  const output = new FakeOutput();
  const child = createFakePty();
  const result = runTrellisPty(["update"], "/demo", {
    stripBanner: true,
    platform: "linux",
    stdin: new FakeInput(),
    stdout: output,
    ptySpawn: () => child,
  });

  child.emitData("Trellis Update\r\n");
  child.emitData("\x1b[?25l? 选择冲突处理方式");
  // 转入透传后,即便再出现同样文案也不再改写,避免干扰交互界面重绘
  child.emitData("⚠️  Your CLI (0.6.14) is behind npm (0.6.15).\r\n");
  child.emitExit({ exitCode: 0 });
  await result;

  const text = output.chunks.join("");
  assert.ok(text.includes("\x1b[?25l? 选择冲突处理方式"));
  assert.ok(text.includes("⚠️  Your CLI (0.6.14) is behind npm (0.6.15)."));
  assert.ok(!text.includes("由 Flower 固定"));
});

test("退出时补发缓冲区里未换行的最后一行", async () => {
  const text = await runWithBannerStrip("Trellis Update\r\nScanning for changes...");

  assert.equal(text, "Trellis Update\r\nScanning for changes...");
});
