# Implement — Flower Plugin 管理器体验与更新链路修复

## 实施顺序

按"低耦合 → 高耦合"推进，每步独立可验证。

### 步骤 1 · R1 延迟加载

- [ ] `src/commands/plugin.js`：删除顶层 `import { runWithTrellisIntegrationEnabled } from "../lib/trellis-control.js"`（`:20`）
- [ ] 在 `:691` 的分支内改为 `const { runWithTrellisIntegrationEnabled } = await import("../lib/trellis-control.js")`
- [ ] 验证：`node -e` 计时 `plugin list`，确认相对 676ms 基线明显下降
- [ ] 验证：模块图中不含 `trellis-control`

### 步骤 2 · R2 输出过滤

- [ ] `src/commands/plugin.js#printResult`：用 `new Set(result.transaction.changed)` 过滤 `result.changes`
- [ ] 隐藏项数 > 0 时打印一行 `  · 另有 N 项目标无变化`
- [ ] 确认 `--json` 分支在过滤逻辑之前 return
- [ ] 新增测试：`remove` 场景下无变化的 patch/write 不出现在人类可读输出，但 `--json` 的 `changes` 保持全量

### 步骤 3 · R5 CLI 侧放开 `--version`

- [ ] `parsePluginArgs`：拆分 `--source`（仅 `add`）与 `--version`（`add` + `update`）的守卫
- [ ] `updateOptions` 透传 `parsed.version`（注意不要覆盖 skill-garden 的内置版本分支）
- [ ] 更新 `printPluginHelp` 中 `update` 的用法行
- [ ] 新增测试：`plugin update <id> --version ^0.4.0 --dry-run` 能解析并进入服务层

### 步骤 4 · R3 去平台询问

- [ ] `installPlugin`：删除 `prompts.checkbox` 平台多选与 `withPlatforms` 调用
- [ ] `runChecked` 增加捕获最近失败错误的能力
- [ ] dry-run 因 `PLATFORM_SELECTION_REQUIRED` 失败时，弹平台多选并带 `--platform` 重试
- [ ] 保留 `defaultPlatforms` / `withPlatforms` 供兜底路径使用

### 步骤 5 · R4 发现页已安装态

- [ ] `state.discovery` 从缓存成品 items 改为缓存原始 entries
- [ ] `buildManagerModel` 把项目视图（declared + locked 版本索引）传给渲染逻辑
- [ ] 按 未安装 / 已安装最新 / 已安装可更新 三态渲染 badge、tone、meta
- [ ] 已安装条目 action 改为 `{type:"installed"}`，复用 `manageInstalledPlugin`
- [ ] 确认安装或卸载后回到列表，状态立即刷新且不重新联网

### 步骤 6 · R5 版本协商

- [ ] 新增纯函数 `planVersionUpdate({ declared, available })`，返回 `in-range` / `widen` / `unknown`
- [ ] `installPlugin` 改为写 `^<version>`
- [ ] 单版本时跳过"选择版本"提示（D3）
- [ ] `manageInstalledPlugin` update 分支接入协商结果，跨边界时合并为一次确认
- [ ] `updateAllPlugins` 先处理 `widen` 项再跑全量收敛
- [ ] `flower/skill-garden` 走原路径，不参与协商
- [ ] 失败时在当前流内打印错误摘要（R5.5）

### 步骤 7 · 收敛

- [ ] `npm test` 全绿
- [ ] 按 AC1–AC11 逐条核对

## 验证命令

```bash
# 单元与集成
node --test test/js/plugin-interactive.test.js
node --test test/js/plugin-lifecycle-cli.test.js
node --test test/js/plugin-remote-cli.test.js
node --test test/js/trellis-control.test.js

# 全量
npm test

# 启动耗时基线对照（改前 676ms）
time node bin/flower-trellis.js plugin list
```

## 风险文件与回滚点

| 文件 | 风险 | 回滚点 |
| --- | --- | --- |
| `src/commands/plugin-interactive.js` | 改动面最大，`state.discovery` 结构调整会牵动缓存与渲染 | 步骤 5 独立提交，可单独回退 |
| `src/commands/plugin.js` | `printResult` 与 `parsePluginArgs` 被多条命令共用 | 步骤 2、3 各自独立提交 |
| `.flower/plugins.json` | 本仓自举安装了 4 个 rd-guide Plugin，测试勿改动真实声明 | 所有验证走临时目录夹具，不碰仓库根 |

## `task.py start` 前的补充检查

- [ ] 确认本仓 `vendor/skill-garden` 的脏工作区不会让验证误判（该 lock 漂移已列入 Out of Scope）
- [ ] 确认 `plugin-interactive.test.js` 的既有 prompt 桩不因去掉 checkbox 而失配
- [ ] 确认 `check-patch-conflicts` / `patch:targets:check` 不受影响（本任务不动 patch 资产）
