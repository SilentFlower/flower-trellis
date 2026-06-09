# Module Guidelines

> ESM 模块、导出与文档约定。本项目模块风格高度一致,新增代码必须沿用。

---

## Overview

全仓是纯 ESM(`package.json` 的 `"type": "module"`)。模块以**命名导出**对外提供能力,
入口靠 `import.meta.url` 定位路径,每个导出都有中文 JSDoc。逻辑模块保持无状态、可单测,
状态落在目标项目磁盘而非进程内存。

---

## ES Modules

- **只用 ESM**:`import` / `export`,禁止 `require` / `module.exports`。
- **Node 内置模块带 `node:` 前缀**:`import fs from "node:fs"`、`node:path`、
  `node:child_process`、`node:url`、`node:module`、`node:readline`(全仓统一,见
  `src/lib/trellis-runner.js:1-7`)。
- **没有 `__dirname`**:用 `import.meta.url` 推导,集中在 `src/lib/paths.js`:

  ```js
  const here = path.dirname(fileURLToPath(import.meta.url)); // .../src/lib
  export const PKG_ROOT = path.resolve(here, "..", "..");
  ```

- **延迟加载子命令**:`cli.js` 用动态 `import()` 按需加载命令模块,避免启动时全量加载
  (`src/cli.js:131`)。
- **解析依赖包**:用 `createRequire(import.meta.url)` + `require.resolve(...package.json)`
  定位捆绑依赖(`versions.js`、`trellis-runner.js`),不要假设 `node_modules` 布局。

---

## Exports & Imports

- **命名导出**,不用 default export:`export function applyEnhancements(...)`。
- **显式 import**,列出具体符号:`import { listDirs, listFiles, rmrf } from "./fs-utils.js"`;
  禁止整包通配后再深层取用。相对 import **必须带 `.js` 后缀**(ESM 要求)。
- **常量集中**:跨模块共享的名单放 `src/constants.js`(`VARIANTS` / `PLATFORM_FLAGS` /
  `OWN_FLAGS`),其它模块 import,不复制粘贴。

---

## Function Conventions

- **单一职责**:一个 lib 模块聚焦一件事;命令层(`src/commands/`)负责把多个 lib 编排起来。
- **返回结果对象**:有多个结果维度时返回结构体而非裸值,便于调用方按需取用并打印,例如
  `apply-enhancements.js` 返回 `{ variant, installed }`、`codex-tweaks.js` 返回
  `{ applied, tomlChanged, hooksWritten }`、`copy-skills.js` 返回 `{ installed, paths }`。
- **容错读取返回空值**:非致命的读取失败应吞掉异常并返回中性值(`listDirs`/`listFiles`
  失败返回 `[]`,`readManifest` 失败返回 `null`),让上层继续跑。
- **大段文本独立成模块**:注入用的长字面量抽到 `legacy-blocks.js`,与正则/逻辑分离。

---

## Documentation (Mandatory)

- 每个**导出函数 / 模块**顶部写中文 JSDoc:说明用途,`@param` 标注参数、`@returns`
  标注返回结构。范例见 `src/lib/fs-utils.js:14-23` 的 `copyPath`。
- 复杂或「移植自上游」的逻辑要写 **Why** 注释,解释为什么这么做、对齐了哪段上游
  (例:`fs-utils.js` 里「移植 skill-garden install.sh 的 install_one 语义」、
  `variant.js` 里「逐字符移植 install.sh 263-274」)。

---

## Forbidden Patterns

| 禁用 | 原因 / 替代 |
|------|------|
| `require` / `module.exports` / `__dirname` | 纯 ESM,用 `import` / `import.meta.url` |
| default export | 统一命名导出 |
| 内置模块裸名(`import fs from "fs"`) | 一律 `node:` 前缀 |
| 相对 import 漏写 `.js` 后缀 | ESM 解析会失败 |
| 在 `cli.js` / 命令层堆通用逻辑 | 下沉到 `src/lib/` |
| 复制常量名单到多处 | 收敛到 `src/constants.js` |
