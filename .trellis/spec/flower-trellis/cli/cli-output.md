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
| `🌸 ` | 命令最终完成行 | `🌸 flower-trellis init 安装成功 → <target>` |
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
| `2` | flower 自有 flag 冲突或 Plugin/Trellis control usage error | 命令参数解析层 |
| `3` | Plugin/Trellis control 冲突、验证失败或 repair-required | 命令编排层 |
| `130` | 用户 Ctrl+C(父进程 SIGINT) | `cli.js:106` |
| `128` | 透传的 trellis 子进程被信号终止 | `trellis-runner.js`(`signal → resolve(128)`) |
| 子进程码 | 兜底透传命令,原样回传 trellis 退出码 | `cli.js:141-142` |

---

## Interactive vs Non-Interactive

- **交互 prompt 用 `@inquirer/prompts`**:flower 自身的多选 / 确认一律用 `@inquirer/prompts`
  的 `checkbox` / `confirm`(现代 `@inquirer/core` 内核),**不用经典 `inquirer`**——后者在
  WSL/ConPTY 下整屏重绘会闪屏;库选择与理由见 [module-guidelines](./module-guidelines.md)
  的「交互式 Prompt」节。
- **非 TTY 必须有回退**:`pick-platforms.js` 在 `!process.stdin.isTTY` 时直接返回默认
  `["--codex","--claude"]`,不阻塞等待输入(现代 prompt 在非 TTY 会抛错,回退须前置)。
- `-y` / `--yes`:跳过菜单走默认平台,并打印一行说明(`init.js`)。
- **init 复用已识别身份**:Flower 横幅从 `-u/--user` 或目标目录可见的 Git 配置识别开发者后，
  必须把该值显式透传给 `trellis init --user`；新目录即使尚无 `.git`，也不能再次询问同一个名字。
- **完成态有明确出口**:`init` / `update` 在交互 TTY 成功后先打印“安装成功 / 更新成功”，
  再显示单项 `退出` 选择；`update --dry-run` 必须打印“预览完成”，不能宣称已更新；`-y` 与
  非 TTY 只打印对应完成行并直接返回，不能阻塞脚本。Windows 下选择 `退出` 后必须先恢复
  stdin、光标和 Win32 Input Mode，再显式以退出码 0 结束 CLI；不能假设 ConPTY worker 的
  MessagePort / Socket 会随子进程自然退出而自动释放。
- **内嵌 Plugin 输出默认精简**:`init` / `update` 重放 Skill Garden 时只展示 Plugin、版本与变化总数，
  不逐行打印 `write` / `patch` / `remove` 路径；独立 `plugin` 命令与调试环境保留完整清单。
- **联网探测同样判 `-y` / 非 TTY**:版本检测(`update-check.js`)发现新版时,交互 TTY 才
  弹确认询问升级(`@inquirer/confirm`);`-y` / 非 TTY 仅打印一行升级提示,不弹确认、不阻塞(降级模式)。
- **交互页必须有清晰出口**:二级选择页不能只列业务动作。Plugin 来源类型页这类中间页必须提供
  `返回...` 和 `退出...` 动作,并在返回/退出时不执行后续命令。
- **慢操作先给状态**:联网检测、archive 下载、歧义选择后的二次检测、保存来源等可能超过 1 秒的步骤,
  先打印一行普通中文进度,例如 `正在检测 GitHub 来源:<repo>`、`正在保存 GitHub 来源:<id>`。
  进度行只说明当前动作,不要输出 token、临时 URL、cache 绝对路径或 header。
- **交互表单问用户能理解的 locator**:新增远程来源时优先询问 GitHub 仓库 URL、GitLab 项目 URL
  等可识别输入;内部 `sourceId`、`entryPath`、`format` 应由检测或默认规则生成,只有编辑/高级 CLI
  才暴露。
- 跑 trellis 原生交互时用 `node-pty` 保留其菜单/光标控制,只过滤开头重复的 banner
  (`trellis-runner.js` 的 `runTrellisPty`);一旦检测到 **子进程交互渲染**(`ESC[?25l`
  隐藏光标)立即停止过滤、整体透传,避免破坏交互。该检测针对 trellis 子进程输出,与 flower
  自己用哪个 prompt 库无关。

### Scenario: Windows ConPTY 输入模式隔离

#### 1. Scope / Trigger

- 触发:Flower 通过 `node-pty` 透传 Windows 子进程交互,或父 CLI 在同一 Windows Terminal
  标签页内继续运行 Inquirer / keypress 交互。
- 原因:子进程可能通过 `CSI ? 9001 h` 开启 Win32 Input Mode,让按键变成
  `CSI Vk;Sc;Uc;Kd;Cs;Rc _` 记录;该状态属于宿主终端,不会随 JS 函数返回自动隔离。

#### 2. Signatures

- `disableWindowsTerminalWin32InputMode(options?) -> boolean`
- `installWindowsTerminalInputRecovery(options?) -> () => void`
- `scheduleWindowsTerminalExit(options?) -> boolean`
- `runTrellisPty(args, cwd, { stripBanner?, ptySpawn?, stdin?, stdout?, platform? }) -> Promise<number>`

#### 3. Contracts

- `disableWindowsTerminalWin32InputMode` 只在 `platform === "win32"` 且 `output.isTTY` 时向
  `output` 写 `CSI ? 9001 l`;非 Windows、非 TTY 或输出流关闭时返回 `false` 且不改变命令结果。
- `installWindowsTerminalInputRecovery` 在 CLI 启动时立即恢复一次,并注册一次 `exit` 恢复,
  用于自愈旧版、Ctrl+C 或异常退出遗留的终端状态。
- `runTrellisPty` 退出时必须先停止子进程输出订阅,再移除 input/resize 监听、恢复 stdin
  原有 raw/flowing 状态,最后关闭 Win32 Input Mode;信号退出仍返回 `128`。
- PTY spawn 同步失败也要执行终端恢复;恢复失败属于退出期 best-effort,不能覆盖原异常。
- `scheduleWindowsTerminalExit` 仅在 Windows 完成页已经选择 `退出` 后生效；它必须恢复
  raw/input、显示光标、关闭 Win32 Input Mode，并延后一轮显式退出 0，避免 node-pty
  自然退出后残留的 worker / socket 让命令永久挂起。

#### 4. Validation & Error Matrix

| 条件 | 结果 |
|------|------|
| Windows + TTY | 写 `CSI ? 9001 l`,返回 `true` |
| 非 Windows 或非 TTY | 零输出,返回 `false` |
| 输出流 `write` 抛错 | 吞掉恢复异常,返回 `false` |
| PTY 正常退出 | 清理监听与输入状态,恢复终端,返回子进程退出码 |
| PTY 信号退出 | 完成同样清理,返回 `128` |
| PTY spawn 抛错 | 恢复终端后 reject 原异常 |
| Windows 完成页选择 `退出` | 恢复终端后显式退出 0，不等待残留 PTY 句柄自然释放 |

#### 5. Good / Base / Bad Cases

- Good:子进程输出过 `CSI ? 9001 h`,退出后父级 `select` 仍能识别回车与方向键。
- Good:父级 `select` 显示已选择 `退出` 后，Windows CLI 在有残留 PTY worker / socket 时仍结束。
- Base:Linux、macOS、CI 管道和重定向输出不出现额外控制序列。
- Bad:只恢复 `stdin.setRawMode(false)` 或只在完成菜单前补一次 reset;前者没有关闭宿主模式,
  后者遗漏更新确认、Plugin、Skill 交互和异常退出路径。

#### 6. Tests Required

- 单元测试断言 Windows TTY 精确写出 `\x1b[?9001l`,非目标平台/非 TTY 零输出。
- PTY 回归测试模拟 `9001h` 后退出,断言 data/input/resize 监听已移除、raw/flowing 状态恢复、
  最后输出为 `9001l`,并立即调用父级完成菜单验证接管顺序。
- 分别覆盖正常退出、信号退出、spawn 异常和输出流关闭。
- 完成页测试注入 Windows 终端和退出函数，断言选择 `退出` 后按 raw mode、光标、Win32
  Input Mode、退出码 0 的顺序完成收尾；发版前在真实 Windows ConPTY 中断言进程按时结束。

#### 7. Wrong vs Correct

**Wrong**:只恢复 Node stdin,把 ConPTY 子进程改过的宿主终端模式留给后续 prompt。

```js
child.onExit(() => {
  stdin.setRawMode(false);
  resolve(0);
});
```

**Correct**:先断开迟到输出,完整恢复父进程资源,最后幂等关闭宿主 Win32 Input Mode。

```js
child.onExit(() => {
  dataSubscription.dispose();
  stdin.off("data", onStdin);
  stdout.off("resize", onResize);
  disableWindowsTerminalWin32InputMode({ platform, output: stdout });
  resolve(0);
});
```

---

## Common Mistakes

- 在非交互/脚本场景打印横幅或等待输入 —— 应先判 `isTTY` / `-y`。
- 让 figlet / git 读取失败抛到主流程 —— 这类装饰性/可选信息必须 try/catch 降级。
- 自定义新的前缀符号 —— 复用上表既有语义,别引入第四种风格。
- 在交互新增流程里直接询问 `Source ID`、`entryPath` 等内部字段 —— 先问 URL/项目路径,再自动检测和生成。
- 慢速网络步骤没有进度行,或失败后直接退出到 shell —— 应把失败记录到当前管理器的问题视图并保持零写入。
