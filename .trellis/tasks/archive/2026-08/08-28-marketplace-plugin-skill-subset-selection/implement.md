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
   - 把 manifest `content.skills` 从字符串路径列表改为 `{name,path,version,description?}` 对象数组；旧字符串形态直接 schema 失败，不做兼容。
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
   - `projectPluginContent()` 对 `content.skills` 做 selection 过滤，按 `content.skills[].name` 匹配，按 `path` 读取来源内容，按 `name` 写入目标 Skill 目录，并把实际 selection 写入 state。
   - 新增投影测试：manifest 有两个 Skill，只选择一个时只生成该 Skill 的 mutation；更新 selection 缩小时旧路径进入删除计划。

4. 扩展 verify。
   - 对 root declaration、lock node、state entry 的 selection 做一致性检查。
   - 读取固定包后校验 selected Skill 仍在 manifest `content.skills` 中。
   - 为选择不一致、选择项消失增加稳定 diagnostic 或 runtime error 测试。

5. 增加 TUI 普通 Marketplace Skill 选择。
   - 为 `runPluginInteractive()` 增加可注入的 `inspectPluginContentSkills` 依赖，默认通过 `plugin-remote.js` 准备被选 Plugin 包并读取 manifest。
   - 在发现页安装流程中，rd-guide 来源选中后跳过普通 Plugin 详情页，自动使用 Marketplace 最新版本读取 manifest skills，进入贴近 `flower-trellis skill` 的 checkbox 选择页，并把选择直接传入真实 add。
   - 在已安装页中，rd-guide 已存在显式 selection 时按 Enter 直接进入 Skill 管理；其它普通 Plugin 或旧式 rd-guide 安装仍保留管理菜单里的 Skill 选择动作。
   - Skill checkbox 默认勾选当前 selection 或 manifest 全量；rd-guide 首次安装默认不勾选，使用中文帮助文案；空选择由交互层返回取消/提示，不暴露英文 required 校验。
   - rd-guide Skill 管理不展示平台选择、dry-run 预览和二次确认；缺少平台证据时使用现有默认平台推断补齐 `--platform`。
   - rd-guide 已安装管理中取消部分 Skill 时直接更新剩余 selection；取消全部 Skill 时执行 `plugin remove <id>` 停用整个 RD Guide 插件。
   - rd-guide 聚合入口不显示 Marketplace 包版本；已安装且有显式 selection 时显示已启用 Skill 数量。
   - `plugin-remote.js` 在 inspection 中只按 manifest `content.skills` entry 生成可选项，description 和 version 只来自 entry 字段，不读取 `SKILL.md` frontmatter。
   - 为 GitLab Provider 增加 manifest-only inspection 入口，只读取当前/锁定 Marketplace 索引与固定 commit 上的 manifest，不下载 archive/tree、不写包缓存，并在 TUI 中缓存同一 Plugin/version/lock integrity 的 Skill 清单。
   - 保持 `flower/skill-garden` 的 `skill-manager` action 不变。

6. 支持 rd-guide 新发布结构。
   - 默认内置 GitLab Marketplace 路径改为 `.flower-plugin/marketplace.json`，source add/update 交互也使用该默认值。
   - Marketplace entry source 支持 `manifestPath: ".flower-plugin/plugin.json"`；`type:"path"` 可省略 `path` 表示从仓库根声明式构建。
   - GitLab Provider 下载/回退拿到仓库快照后，写出运行时包顶层 `plugin.json`，只拷贝 manifest 声明内容和匹配 platform override；`.flower-plugin/marketplace.json` 与未声明文件不进入包哈希。
   - Flower format Adapter 对根目录 `.flower-plugin/plugin.json` 做同样的声明式规范化，避免本地/GitHub 入口与 GitLab 行为分叉。

7. 验证与回归。
   - 运行定向测试：`node --test test/js/plugin-project-files-schema.test.js test/js/plugin-content-projector.test.js test/js/plugin-lifecycle-cli.test.js test/js/plugin-interactive.test.js`。
   - 运行相关远程测试：`node --test test/js/plugin-remote-cli.test.js test/js/plugin-gitlab-provider.test.js test/js/plugin-github-provider.test.js`；GitLab Provider 测试必须覆盖 manifest-only inspection 不下载 archive/tree、不写包缓存。
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
- `src/plugin/formats/adapters.js`
- `src/plugin/formats/normalized-package.js`
- `test/js/plugin-project-files-schema.test.js`
- `test/js/plugin-content-projector.test.js`
- `test/js/plugin-lifecycle-cli.test.js`
- `test/js/plugin-interactive.test.js`
- 视实现影响补充远程 Provider 测试。

## Stop Conditions

- 如果发现 `plugin-lock.json` 写入 `contentSelection` 与现有 Project Store 或发布兼容性冲突，先回到 planning 更新设计，不直接改成只写 state。
- 如果 TUI inspection 需要在发现页批量下载包，停止并改为用户进入详情后按需准备。
- 如果 rd-guide manifest 尚未按 `content.skills` 对象 entry 声明 active Skill，本任务只用本地 fixture 验证，不扫描仓库目录兜底。
