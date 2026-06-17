#!/usr/bin/env node
import { syncGlobalTrellis } from "../src/lib/global-trellis-sync.js";

/**
 * npm postinstall 入口:安装 flower-trellis 后同步全局 trellis 命令。
 *
 * 生命周期脚本失败应让 npm install 失败,否则用户会得到 flower-trellis 已更新、
 * 但 `trellis` 命令仍指向旧版本的半同步环境。
 */
try {
  if (process.env.npm_config_global !== "true") {
    console.log("\n同步全局 Trellis:");
    console.log("  · 非全局安装:跳过全局 Trellis 同步");
    process.exit(0);
  }

  console.log("\n同步全局 Trellis:");
  syncGlobalTrellis();
} catch (err) {
  console.error(`❌ ${err.message}`);
  process.exit(1);
}
