# 修复平台多选菜单上下切换闪屏(迁移 @inquirer/prompts)

## Goal

`ft init` 的「平台多选页面」(`src/lib/pick-platforms.js`)在 WSL2 / Windows Terminal 下用上下键切换平台时会明显闪屏,影响交互观感。根因是该页面用的经典 `inquirer@9.3.8` 渲染内核每次重绘都「整块清屏 → 整块重写」。本任务把项目里的交互式 prompt 整体迁移到现代 `@inquirer/prompts`(`@inquirer/core` 增量重绘内核)以消除闪烁,并移除旧 `inquirer` 依赖。

## Background / Known Context

- 闪屏页面:`src/lib/pick-platforms.js` —— `inquirer.prompt([{ type: "checkbox", ... }])`,15 个平台项。
- 另一处交互:`src/lib/update-check.js:140` —— `inquirer.prompt([{ type: "confirm", ... }])` 询问是否升级(单行 confirm,本身不闪,但一并迁移以移除旧依赖)。
- `inquirer` 当前在 `package.json` 的 `dependencies`(`^9.3.8`),仅上述两处使用(`grep -rn "inquirer" src` 确认)。
- 调用时序:`init.js:46` 先在主进程弹 `pickPlatforms()`,**之后**才 `runTrellisPty(...)` 用 pty 跑子进程 `trellis init`。

## 根因(已坐实)

`node_modules/inquirer/lib/utils/screen-manager.js` 的 `render()`:每次重绘先 `this.clean(...)`(`util.clearLine` 清掉整块 `this.height` 行)再 `this.rl.output.write(fullContent)` 整体重写。WSL2 / ConPTY 下「清空」与「重画」之间有一帧空白 → 肉眼闪烁;菜单项越多越明显。属经典 inquirer 架构性重绘,调 `pageSize` 等参数无法消除。现代 `@inquirer/core` 改为带 diff 的增量重绘 + 同 tick 渲染合并,可显著改善。

## Requirements

- R1:`src/lib/pick-platforms.js` 的 checkbox 多选迁移到 `@inquirer/prompts` 的 `checkbox`;返回值仍为选中的 value 数组(`["--claude","--codex", ...]`),对 `init.js` 的契约不变。
- R2:保留非 TTY 前置回退 `if (!process.stdin.isTTY) return ["--codex", "--claude"]`(现代 prompt 在非 TTY 下会抛错,前置判断必须保留)。
- R3:`src/lib/update-check.js` 的 confirm 迁移到 `@inquirer/prompts` 的 `confirm`,返回 boolean,`message` 与 `default: true` 保持不变;其上游非交互短路(第 6 步)逻辑不动。
- R4:`package.json` 移除 `inquirer`,新增 `@inquirer/prompts`(取最新稳定大版本),并同步 `package-lock.json`。
- R5:可选体验优化——`checkbox` 设 `pageSize` 为平台项数量(15),一屏展示全部、避免滚动二次重绘;`loop: false` 保留。

## 非影响项(已澄清,非风险)

- `src/lib/trellis-runner.js` 中靠 `\x1b[?25l`(隐藏光标)判断「停止过滤、转透传」的逻辑,针对的是 **pty 子进程 `trellis` 自带的交互菜单**,与 flower 自己的 `pickPlatforms` 无关(时序上 pick 在 pty 之前、走不同管道)。迁移本项目 prompt **不影响**这段逻辑,无需改动。

## Acceptance Criteria

- [ ] AC1:`ft init`(交互 TTY)平台多选用上下键来回切换,不再出现明显整屏闪烁(WSL2 真实终端实测)。
- [ ] AC2:平台多选的勾选/取消、回车确认行为正常;默认勾选仍为 Claude Code + Codex;返回的 flag 正确透传给 `trellis init`。
- [ ] AC3:非交互(`-y`)默认平台行为不变,仍为 `--codex --claude`。
- [ ] AC4:`checkForUpdate` 的升级确认(发现新版时)正常弹出、回车默认「是」、可拒绝;非交互场景仍只打印不弹确认。
- [ ] AC5:`grep -rn "inquirer" src` 不再有对经典 `inquirer` 的 import;`package.json` 不含 `inquirer`、含 `@inquirer/prompts`;`node` 加载两个改动文件无报错。

## Definition of Done

- 上述 AC 勾选完成(AC1 由用户在 WSL2 真实终端确认)。
- `package.json` / `package-lock.json` 一致,依赖可正常安装。
- 行为无回归(banner 过滤、pty 子进程交互、非交互默认平台)。

## Out of Scope

- 不改动 `trellis-runner.js` 的 banner 过滤 / pty 透传逻辑。
- 不升级或改动 `@mindfoldhq/trellis` 子进程本身的交互。
- 不重写为自研 readline/ANSI 渲染(已在方案选择中排除)。
- 不调整平台清单内容、默认勾选项之外的产品行为。

## Decision (ADR-lite)

- **Context**:经典 inquirer 整屏清-重画导致 WSL 闪屏,属架构性问题,参数调不掉。
- **Decision**:整体迁移到 `@inquirer/prompts`(checkbox + confirm),移除经典 `inquirer`。已与用户确认采用「整体迁移 + 移除旧 inquirer」范围。
- **Consequences**:换渲染内核显著改善闪烁(WSL/ConPTY 终端特性决定不保证 100% 零闪,需真实终端实测);新增 `@inquirer/prompts` 依赖、移除 `inquirer`;API 由 `inquirer.prompt([...])` 改为按 prompt 类型直接调用,改动集中在 2 个文件 + package。

## 实现要点(参考)

- `pick-platforms.js`:`import { checkbox } from "@inquirer/prompts";` → `const tools = await checkbox({ message, choices: PLATFORMS.map(p => ({ name: p.name, value: p.value, checked: !!p.checked })), loop: false, pageSize: PLATFORMS.length }); return tools;`
- `update-check.js`:`import { confirm } from "@inquirer/prompts";` → `const doUpgrade = await confirm({ message: \`是否现在升级到 ${latest}?(升级后需重新运行命令)\`, default: true });`
- `package.json`:删 `inquirer`,加 `@inquirer/prompts`;运行 `npm install` 同步 lock。
