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
- **精确清理**:删除目标文件只依据 manifest 记录的精确 `paths`,或强化清单里**名字精确
  匹配**的条目(见 `commands/uninstall.js:47-64` 的「只删名字精确匹配的,避免误删用户文件」)。
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
| 凭猜测删除目标文件 | 只能删 manifest / 强化清单里精确匹配的路径,绝不误伤用户文件 |
| 非幂等的写盘逻辑 | 升级/重装会产生残留或重复注入 |
| 让装饰性环节(banner / git 读取)抛错中断主流程 | 必须 try/catch 降级 |
| `require` / `__dirname` / default export | 纯 ESM,见 [module-guidelines](./module-guidelines.md) |
| 为小功能引入重依赖(如 commander) | 保持 KISS:argv 在 `cli.js` 里手解析,依赖维持精简 |
| 用经典 `inquirer` 做交互 prompt | WSL/ConPTY 下整屏重绘闪屏,改用 `@inquirer/prompts`,见 [module-guidelines](./module-guidelines.md) |
| 把 flower 自有 flag 透传给 trellis | 必须在 `OWN_FLAGS` 登记并在 `parse()` 剔除 |
| 改移植逻辑而不核对上游 install.sh | 会导致升级行为与 skill-garden 漂移 |

---

## Testing

- 本项目使用零第三方测试基础设施：JavaScript 用 Node 内置 `node:test`，Python 用
  `unittest`，统一入口为 `npm test`。不要引入 Jest/Vitest/Pytest 等重依赖，除非另有明确决策。
- `npm test` 同时运行默认 AI context budget checker；大小超限只告警，结构性测量错误失败。
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
- 发布审计需要严格预算时显式运行 `node scripts/check-ai-context-budget.mjs --strict`；
  strict 不属于默认大小门禁。

---

## Code Review Checklist

- [ ] 写盘/叠加操作幂等?重复跑一次结果一致、无重复注入?
- [ ] 删除逻辑只动 manifest / 强化清单里精确匹配的路径?
- [ ] 装饰性 / 可选读取都有 try/catch 降级?
- [ ] 错误是 `throw new Error("中文")` 交顶层处理,而非深层 `process.exit`?
- [ ] 新增自有 flag 同步更新了 `OWN_FLAGS` 与 `cli.js parse()`?
- [ ] 移植自上游的逻辑保留了溯源注释、与 install.sh 一致?
- [ ] 导出函数有中文 JSDoc(`@param` / `@returns`)?
- [ ] 纯 ESM(`node:` 前缀、命名导出、相对 import 带 `.js`)?
- [ ] 输出前缀符号沿用既有语义(`✓` / `·` / `❌` / `🌸`)?
- [ ] `npm test` 通过，context budget warning 已审阅且没有通过调高阈值掩盖重复内容?
