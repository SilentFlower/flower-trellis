# Implementation Plan

## Context To Load Before Editing

- `.trellis/spec/flower-trellis/cli/flower-plugin-contracts.md`
- `.trellis/spec/flower-trellis/cli/flower-plugin-runtime.md`
- `.trellis/spec/flower-trellis/cli/flower-plugin-gitlab.md`
- `.trellis/spec/flower-trellis/cli/module-guidelines.md`
- `.trellis/spec/guides/cross-layer-thinking-guide.md`
- `.trellis/spec/guides/code-reuse-thinking-guide.md`

## Steps

1. 更新公共合同和 schema。
   - 在 `src/plugin/contracts.js` 增加 `PluginContentSelection`，并挂到 `ProjectPluginDeclaration`、`ResolvedPlugin`、`PluginStateEntry`。
   - 在 `src/plugin/schemas/project-files.js` 增加 reusable schema，允许 `.flower/plugins.json`、`.flower/plugin-lock.json`、`.flower/state.json` 的 `contentSelection`。
   - 增加 schema 测试，覆盖合法 selection、重复项、未知字段和 source mismatch 不回退。

2. 打通 CLI 与 Application Service。
   - 在 `src/commands/plugin.js` 解析 `--content-skill`，复用平台参数的重复/逗号列表模式，输出稳定排序数组。
   - 限制该参数只用于 `plugin add` 和单个 `plugin update <id>`；与 `--widen` 或无 ID 的 update 混用时报 `PLUGIN_USAGE_ERROR`。
   - 在 `PluginApplicationService.add/update` 中写入或保留声明 selection，dry-run 保持零写入。
   - 更新 CLI help、parser 测试和生命周期测试。

3. 打通 Resolver、lock 与内容投影。
   - `resolvePluginGraph()` 从直接声明复制 selection 到 resolved root。
   - `buildPluginLock()` 保留 resolved node 的 `contentSelection`。
   - `projectPluginContent()` 对 `content.skills` 做 selection 过滤，校验 basename 唯一和 selection 存在性，并把实际 selection 写入 state。
   - 新增投影测试：manifest 有两个 Skill，只选择一个时只生成该 Skill 的 mutation；更新 selection 缩小时旧路径进入删除计划。

4. 扩展 verify。
   - 对 root declaration、lock node、state entry 的 selection 做一致性检查。
   - 读取固定包后校验 selected Skill 仍在 manifest `content.skills` 中。
   - 为选择不一致、选择项消失增加稳定 diagnostic 或 runtime error 测试。

5. 增加 TUI 普通 Marketplace Skill 选择。
   - 为 `runPluginInteractive()` 增加可注入的 `inspectPluginContentSkills` 依赖，默认通过 `plugin-remote.js` 准备被选 Plugin 包并读取 manifest。
   - 在发现页安装流程中，选定版本后读取 manifest skills，进入 checkbox 选择页，并把选择传入 dry-run 和真实 add。
   - 在已安装管理菜单中增加 Skill 选择管理动作，使用当前声明/state 作为默认勾选值，选择后走 update dry-run 和确认。
   - 保持 `flower/skill-garden` 的 `skill-manager` action 不变。

6. 验证与回归。
   - 运行定向测试：`node --test test/js/plugin-project-files-schema.test.js test/js/plugin-content-projector.test.js test/js/plugin-lifecycle-cli.test.js test/js/plugin-interactive.test.js`。
   - 运行相关远程测试：`node --test test/js/plugin-remote-cli.test.js test/js/plugin-gitlab-provider.test.js test/js/plugin-github-provider.test.js`。
   - 运行全量 `npm test`、`npm pack --dry-run --json`、`git diff --check`。

## Expected Code Touches

- `src/plugin/contracts.js`
- `src/plugin/schemas/project-files.js`
- `src/plugin/runtime-errors.js`
- `src/plugin/resolver/dependency-resolver.js`
- `src/plugin/resolver/lock-builder.js`
- `src/plugin/install/content-projector.js`
- `src/plugin/application-service.js`
- `src/commands/plugin.js`
- `src/commands/plugin-interactive.js`
- `src/commands/plugin-remote.js`
- `src/plugin/sources/gitlab-provider.js`
- `src/plugin/sources/github-provider.js`
- `test/js/plugin-project-files-schema.test.js`
- `test/js/plugin-content-projector.test.js`
- `test/js/plugin-lifecycle-cli.test.js`
- `test/js/plugin-interactive.test.js`
- 视实现影响补充远程 Provider 测试。

## Stop Conditions

- 如果发现 `plugin-lock.json` 写入 `contentSelection` 与现有 Project Store 或发布兼容性冲突，先回到 planning 更新设计，不直接改成只写 state。
- 如果 TUI inspection 需要在发现页批量下载包，停止并改为用户进入详情后按需准备。
- 如果 rd-guide manifest 尚未按 `content.skills` 声明 active Skill，本任务只用本地 fixture 验证，不修改 rd-guide 仓库。
