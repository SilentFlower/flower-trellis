#!/usr/bin/env node
// flower-trellis CLI 入口。
// 仅做一件事:加载真正的 CLI 实现。保持极薄,便于 ESM 动态加载。
import("../src/cli.js");
