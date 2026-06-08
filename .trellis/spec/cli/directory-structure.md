# Directory Structure

> flower-trellis 的代码组织方式。

---

## Overview

这是一个 ESM 包(`package.json` 含 `"type": "module"`),通过 `bin` 字段暴露
`flower-trellis` / `ftl` 两个命令。代码按「**入口 → 编排 → 工具**」三层组织:
入口极薄,命令层只做编排,真正的逻辑沉到 `src/lib/` 的单一职责模块。

---

## Directory Layout

```
flower-trellis/
├── bin/
│   └── flower-trellis.js      # 入口:仅 import("../src/cli.js"),带 shebang
├── src/
│   ├── cli.js                 # argv 解析 + 子命令分发 + 顶层 try/catch
│   ├── constants.js           # VARIANTS / PLATFORM_FLAGS / OWN_FLAGS
│   ├── commands/              # 子命令编排层(一个命令一个文件)
│   │   ├── init.js
│   │   ├── update.js
│   │   └── uninstall.js
│   └── lib/                   # 单一职责工具/逻辑模块
│       ├── paths.js           # 包内路径定位(import.meta.url)
│       ├── fs-utils.js        # ensureDir / rmrf / copyPath / listDirs / listFiles
│       ├── versions.js        # 读自身与捆绑 trellis 版本
│       ├── variant.js         # 按 .trellis/.version 选强化包变体
│       ├── manifest.js        # 读写 .flower-manifest.json 安装清单
│       ├── trellis-runner.js  # spawn / node-pty 跑 trellis,过滤重复 banner
│       ├── banner.js          # figlet + chalk 品牌头部
│       ├── pick-platforms.js  # inquirer 平台多选菜单
│       ├── copy-skills.js     # 跟随平台铺设强化 skill / command
│       ├── apply-enhancements.js # 叠加流水线总编排
│       ├── workflow-inject.js # 向 workflow.md 注入/替换强化块
│       ├── codex-tweaks.js    # codex 平台后处理(config.toml / hooks.json)
│       └── legacy-blocks.js   # 0.5/old 变体的 workflow-state 文本常量
├── scripts/
│   └── sync-enhancements.mjs  # 开发期:把 skill-garden 同步成 enhancements/ 快照
└── enhancements/<variant>/    # 随包发布的强化包快照 + MANIFEST.json
```

---

## Module Organization

新增功能时按职责归位:

- **新子命令** → 在 `src/commands/` 下新建 `<name>.js`,导出同名 async 函数
  `(ctx) => {...}`,并在 `src/cli.js` 的分发处加一条动态 `import()` 分支
  (见 `src/cli.js:130-143`)。
- **可复用逻辑** → 放 `src/lib/`,一个文件聚焦一件事;命令层从这里 import,
  不要在命令文件里堆通用工具。
- **新名单/常量** → 进 `src/constants.js`,不要散落在各处硬编码。
- **大段字面量文本** → 抽到独立模块(参照 `legacy-blocks.js` 把注入文本与逻辑分离)。

---

## Naming Conventions

- 文件名一律 **kebab-case**(`copy-skills.js`、`apply-enhancements.js`)。
- 随包发布、被包内 import 的代码用 `.js`(包级 ESM);独立运行的开发期脚本用
  `.mjs`(`scripts/sync-enhancements.mjs`),与包代码区分。
- 子命令文件名 = 命令名(`init.js` ↔ `flower-trellis init`)。
- 导出函数用 camelCase 动词短语(`applyEnhancements`、`selectVariant`、`copyPath`)。

---

## Examples

- 编排层范例:`src/commands/init.js`(校验目标 → 平台菜单 → pty 跑 trellis → 叠加)。
- 工具层范例:`src/lib/fs-utils.js`(一组无副作用/幂等的小函数,容错返回空数组)。
- 入口范例:`bin/flower-trellis.js`(只有 4 行,保持极薄)。
