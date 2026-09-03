# Quality Guidelines

> 必守模式、禁用模式、测试现状与评审清单。

---

## Overview

flower-trellis 是装在别人项目上、会动其文件的工具,因此质量底线集中在三点:
**幂等**(可重复执行)、**不误伤**(只动自己铺的文件)、**容错降级**(装饰/可选环节失败
不拖垮主流程)。同时严格对齐上游 skill-garden / Trellis。

---

## Required Patterns

- **幂等**:所有写盘/叠加操作可重复执行而结果一致(覆盖式拷贝、内容相同不写盘、
  备份只建一次)。详见 [enhancements-model](./enhancements-model.md)。
- **精确清理**:删除目标文件只依据 manifest 记录的精确 `paths`、强化清单里**名字精确
  匹配**的条目，或已登记场景中带类型与真实路径复核的严格名称契约；升级备份清理见
  [Update Backup Retention](./config-and-state.md#scenario-update-backup-retention)。
- **容错降级**:非致命读取(figlet 字体、git user.name、version、manifest、目录列举)
  失败时 try/catch 返回中性值(`null` / `[]` / 占位串),不抛到主流程。
- **集中错误处理**:逻辑层 `throw new Error("中文原因")`,由 `cli.js` 顶层统一捕获并定退出码
  (见 [cli-output](./cli-output.md))。
- **忠实移植 + 溯源注释**:移植上游逻辑要保留出处注释并保持语义一致。
- **中文 JSDoc**:每个导出函数/模块都有中文文档注释。

---

## Forbidden Patterns

| 禁用 | 原因 |
|------|------|
| 凭猜测删除目标文件 | 只能按 manifest、强化清单或已登记的严格路径契约删除,绝不误伤用户文件 |
| 非幂等的写盘逻辑 | 升级/重装会产生残留或重复注入 |
| 让装饰性环节(banner / git 读取)抛错中断主流程 | 必须 try/catch 降级 |
| `require` / `__dirname` / default export | 纯 ESM,见 [module-guidelines](./module-guidelines.md) |
| 为小功能引入重依赖(如 commander) | 保持 KISS:argv 在 `src/lib/cli-args.js` 里手解析,依赖维持精简 |
| 用经典 `inquirer` 做交互 prompt | WSL/ConPTY 下整屏重绘闪屏,改用 `@inquirer/prompts`,见 [module-guidelines](./module-guidelines.md) |
| 把 flower 自有 flag 透传给 trellis | 必须在 `OWN_FLAGS` 登记并由 `parseCliArgs()` 消费 |
| 改移植逻辑而不核对上游 install.sh | 会导致升级行为与 skill-garden 漂移 |

---

## Testing

- 本项目使用零第三方测试基础设施：JavaScript 用 Node 内置 `node:test`，Python 用
  `unittest`，统一入口为 `npm test`。不要引入 Jest/Vitest/Pytest 等重依赖，除非另有明确决策。
- `npm test` 同时运行 Flower 全平台双 catalog Patch 冲突门禁、Skill-Garden canonical compiled targets 零漂移检查和默认 AI context budget checker；冲突 warning/大小超限只告警，结构错误、compiled 漂移与 conflict error 失败。
- 提交前执行**自动测试 + 语法校验 + dogfood 手测**:

  ```bash
  npm test
  node --check src/cli.js            # ESM 语法
  node --check scripts/extract-changelog.mjs
  node --check scripts/write-release-notes-metadata.mjs
  python3 -m py_compile src/assets/flower_update_hook.py
  python3 -m py_compile .trellis/scripts/flower_update_hook.py
  flower-trellis init   --target ./test-target -y
  flower-trellis update --target ./test-target -y --dry-run
  flower-trellis uninstall --target ./test-target --dry-run
  ```

  `test-target/`、`.trellis-tmp/` 已在 `.gitignore` 中,可作本地目标。
- 改动叠加逻辑后,记得 `npm run sync` 重建 `enhancements/` 快照再验证。
- 改动 Skill-Garden Patch catalog、顺序、policy 或 pinned Trellis 结果后，运行 `npm run patch:targets` 刷新子仓 canonical target 层，再用 `npm run patch:targets:check` 验证零漂移。Flower adapter/平台 catalog 改动由全平台冲突门禁覆盖，不生成可提交 matrix。
- 改动 Flower 命令帮助时，用真实 CLI 在不存在的 `--target` 和隔离用户配置目录运行帮助矩阵，
  断言退出码 `0`、stderr 为空且零写入；同时检查帮助分支先于联网、写盘、prompt 和子进程入口。
- 改动 Trellis Python 查询/helper 契约时，分别覆盖正常空状态、唯一/歧义任务引用、越界路径、
  自动机械字段与显式非法字段，不能只断言成功路径。
- 发布审计需要严格预算时显式运行 `node scripts/check-ai-context-budget.mjs --strict`；
  strict 不属于默认大小门禁。

---

## Code Review Checklist

- [ ] 写盘/叠加操作幂等?重复跑一次结果一致、无重复注入?
- [ ] 删除逻辑只动 manifest / 强化清单 / 已登记严格契约允许的精确路径?
- [ ] 装饰性 / 可选读取都有 try/catch 降级?
- [ ] 错误是 `throw new Error("中文")` 交顶层处理,而非深层 `process.exit`?
- [ ] 新增自有 flag 同步更新了 `OWN_FLAGS` 与 `cli-args.js parseCliArgs()`?
- [ ] 移植自上游的逻辑保留了溯源注释、与 install.sh 一致?
- [ ] 导出函数有中文 JSDoc(`@param` / `@returns`)?
- [ ] 纯 ESM(`node:` 前缀、命名导出、相对 import 带 `.js`)?
- [ ] 输出前缀符号沿用既有语义(`✓` / `·` / `❌` / `🌸`)?
- [ ] `-h/--help` 是否在目标校验、联网、写盘、prompt 和子进程之前返回 0?
- [ ] 查询型空状态是否返回 0 并用结构化字段表达，写入型错误仍保持非零?
- [ ] `npm test` 通过，context budget warning 已审阅且没有通过调高阈值掩盖重复内容?
- [ ] `check-patch-conflicts` 覆盖全部声明 target，旧互斥协议未复现，vendor/snapshot overrides 一致?
