# CLI Output

> 终端输出、错误处理与退出码约定。flower-trellis 的输出风格与 Trellis 对齐,需保持一致。

---

## Overview

输出分两类:**品牌头部**(figlet ASCII + chalk 着色,仅交互场景打印)与**进度行**
(`console.log` 带统一前缀符号)。错误统一 `throw`,由 `cli.js` 顶层集中捕获并决定退出码。

---

## Banner & Color

- 品牌头部集中在 `src/lib/banner.js`:`figlet.textSync("Flower", { font: "ANSI Shadow" })`
  + `chalk.hex("#ff6fb5")` 粉色 logo + 灰色副标题 + 开发者身份行。
- **figlet 必须有兜底**:取字体失败时降级为纯文本,绝不让横幅炸掉主流程
  (`banner.js:13-17` 的 try/catch → `art = "flower-trellis"`)。
- 仅**交互模式**打印横幅:`init` 在非 `-y` 时打印,`update` 总打印;非交互/脚本场景不打扰
  (`src/commands/init.js:31-33`)。

---

## Progress Lines

进度用 `console.log`,前缀符号语义固定(见 `apply-enhancements.js`):

| 前缀 | 含义 | 示例 |
|------|------|------|
| `\n<标题>:` | 阶段标题(前置空行分隔) | `强化包变体:0.6(项目 Trellis 0.6.0-beta.8)` |
| `  ✓ ` | 成功完成一步 | `  ✓ 铺设 9 个强化技能 → .claude/skills + .agents/skills` |
| `  · ` | 跳过 / 提示性信息 | `  · workflow 注入跳过(目标无 .trellis/workflow.md)` |
| `🌸 ` | 命令最终完成行 | `🌸 flower-trellis init 完成 → <target>` |
| `❌ ` | 错误(走 stderr) | `❌ --enhance-only 与 --no-enhance 互斥` |

> 中文文案、表情前缀与缩进(两个空格)请沿用现有风格,保证多命令输出观感统一。

---

## Error Handling

- **命令/工具层只管 `throw new Error("中文原因")`**,带足够定位信息
  (如 `trellis init 失败(退出码 ${code}),已中止,未叠加强化包`)。
- **顶层集中捕获**在 `src/cli.js` 的 `main()` try/catch:

  ```js
  } catch (err) {
    console.error(`❌ ${err.message}`);
    if (process.env.DEBUG || process.env.FLOWER_DEBUG) console.error(err.stack);
    process.exit(1);
  }
  ```

  即:错误消息走 `console.error` + `❌` 前缀;**仅当** `DEBUG` / `FLOWER_DEBUG`
  置位时才打印堆栈,常规输出保持干净。
- 不要在深层 `console.error` 后又自己 `process.exit` —— 交回顶层统一处理。

---

## Exit Codes

| 退出码 | 场景 | 出处 |
|--------|------|------|
| `0` | 正常完成 | 各命令默认 |
| `1` | 捕获到异常 | `cli.js` 顶层 catch |
| `2` | flower 自有 flag 冲突(`--enhance-only` × `--no-enhance`) | `cli.js:124-127` |
| `130` | 用户 Ctrl+C(父进程 SIGINT) | `cli.js:106` |
| `128` | 透传的 trellis 子进程被信号终止 | `trellis-runner.js`(`signal → resolve(128)`) |
| 子进程码 | 兜底透传命令,原样回传 trellis 退出码 | `cli.js:141-142` |

---

## Interactive vs Non-Interactive

- **非 TTY 必须有回退**:`pick-platforms.js` 在 `!process.stdin.isTTY` 时直接返回默认
  `["--codex","--claude"]`,不阻塞等待输入。
- `-y` / `--yes`:跳过菜单走默认平台,并打印一行说明(`init.js:36-38`)。
- **联网探测同样判 `-y` / 非 TTY**:版本检测(`update-check.js`)发现新版时,交互 TTY 才
  弹 inquirer 询问升级;`-y` / 非 TTY 仅打印一行升级提示,不弹确认、不阻塞(降级模式)。
- 跑 trellis 原生交互时用 `node-pty` 保留其菜单/光标控制,只过滤开头重复的 banner
  (`trellis-runner.js` 的 `runTrellisPty`);一旦检测到 inquirer 渲染(`ESC[?25l`)
  立即停止过滤、整体透传,避免破坏交互。

---

## Common Mistakes

- 在非交互/脚本场景打印横幅或等待输入 —— 应先判 `isTTY` / `-y`。
- 让 figlet / git 读取失败抛到主流程 —— 这类装饰性/可选信息必须 try/catch 降级。
- 自定义新的前缀符号 —— 复用上表既有语义,别引入第四种风格。
