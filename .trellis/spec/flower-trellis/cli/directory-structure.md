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
│   ├── cli.js                 # help + 子命令分发 + 顶层 try/catch
│   ├── constants.js           # VARIANTS / PLATFORM_FLAGS / OWN_FLAGS / 默认值
│   ├── commands/              # 子命令编排层(一个命令一个文件)
│   │   ├── init.js
│   │   ├── update.js
│   │   └── uninstall.js
│   ├── builtin-plugins/skill-garden/ # 内置 manifest、Provider、payload adapter 与卸载规划
│   ├── plugin/                # Plugin schema/source/resolver/install/capability/state Runtime
│   └── lib/                   # 单一职责工具/逻辑模块与旧兼容 facade
│       ├── cli-args.js        # argv 解析、Flower 自有参数与 Trellis 透传隔离
│       ├── paths.js           # 包内路径定位(import.meta.url)
│       ├── fs-utils.js        # ensureDir / rmrf / copyPath / listDirs / listFiles
│       ├── versions.js        # 读自身与捆绑 trellis 版本
│       ├── variant.js         # 按 .trellis/.version 选强化包变体
│       ├── manifest.js        # update-check 新状态与旧 manifest/tmp 只读兼容
│       ├── trellis-runner.js  # spawn / node-pty 跑 trellis,过滤重复 banner
│       ├── banner.js          # figlet + chalk 品牌头部
│       ├── pick-platforms.js  # inquirer 平台多选菜单
│       ├── copy-skills.js     # 跟随平台铺设强化 skill / command
│       ├── apply-enhancements.js # 内置 skill-garden Runtime 兼容 facade
│       ├── patch-engine.js    # 0.6 Patch catalog/preflight/apply/provenance
│       ├── patch-conflicts.js # 0.6 版本兼容与最终产物冲突 evaluator
│       ├── patch-fixture.js   # pinned Trellis full Patch 维护夹具
│       ├── update-backups.js  # Trellis 时间戳升级备份发现、规划与安全清理
│       ├── platform-patch-adapters.js # JSON/YAML/TOML 结构 selector
│       ├── workflow-inject.js # 0.5/old workflow 兼容注入
│       ├── codex-tweaks.js    # 0.5/old Codex 平台后处理
│       └── legacy-blocks.js   # 0.5/old 变体的 workflow-state 文本常量
│   └── patches/               # Flower 自有平台 Patch catalog 与 Bundle
├── scripts/
│   ├── sync-enhancements.mjs  # 开发期:把 skill-garden 同步成 enhancements/ 快照
│   ├── check-patch-conflicts.mjs # pinned Trellis 完整 catalog 冲突门禁
│   └── run-skill-garden-compiled-targets.mjs # 调用子仓 canonical target 生成器
├── enhancements/<variant>/    # 随包发布的强化包快照 + MANIFEST.json
└── vendor/skill-garden/
    ├── scripts/generate-compiled-targets.py # 独立 Python consumer 的生成/check 入口
    └── compiled-targets/<version>/full/{plan.json,targets/} # canonical 最终文件与 diff sidecar
```

---

## Patch / Test Paths

- `src/lib/patch-engine.js`：统一 `insert / replace / remove`、Bundle 选择、preflight/apply 与 provenance。
- `src/lib/patch-conflicts.js`：读取共享 policy，评估 Trellis 版本和 `plan.files[].next` 最终产物；禁止执行变换。
- `src/patches/platforms/`、`src/patches/bundles/`：Flower 平台配置 Patch 与全装 Bundle。
- `scripts/check-ai-context-budget.mjs`：最终 workflow/state/skill、Phase summary、SessionStart 与控制面总量预算。
- `test/js/`：Node 内置 `node:test`。
- `test/python/`：Python 内置 `unittest`。
- `enhancements/0.6/overrides/compatibility.json`、`conflicts.json`、`patches/`、`bundles/`：随包发布的 Skill-Garden policy 与 Patch catalog 快照。
- `vendor/skill-garden/compiled-targets/<version>/full/{plan.json,targets/}`：由子仓生成器维护的 `all-platforms` canonical full 计划；最终文件按原路径保存，changed target 的 `<target>.diff` sidecar 与文件并排。禁止手工修改，vendor 子仓不进入 `package.json.files`。
- `vendor/skill-garden/scripts/apply-trellis-patches.py`：独立 `install.sh` 的 Python consumer；协议必须与 JS 引擎一致。
- `src/lib/patch-fixture.js`：Flower 全平台 Skill-Garden + Flower 双 catalog 临时 fixture；只用于 coverage、compatibility 与 conflict 门禁，不保存全平台 files/diffs。

## Module Organization

新增功能时按职责归位:

- **新子命令** → 在 `src/commands/` 下新建 `<name>.js`,导出同名 async 函数
  `(ctx) => {...}`,并在 `src/cli.js` 的分发处加一条动态 `import()` 分支
  (见 `src/cli.js:130-143`)。
- **新增 Flower 自有参数** → 同步更新 `src/constants.js#OWN_FLAGS` 与
  `src/lib/cli-args.js#parseCliArgs()`,确保参数不会进入 Trellis passthrough。
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
