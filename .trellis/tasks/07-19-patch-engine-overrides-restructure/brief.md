# Brief — 统一 Patch 注入引擎与 Overrides 目录重构

## Goal

- 将 skill-garden 0.6 与 flower-trellis 当前分散的 Transform、Workflow、Skill、Hook 和平台配置修改统一为只包含 `insert`、`replace`、`remove` 的 Patch Engine，并把 Overrides 重构为可按目标和 Bundle 直接定位的目录。

## Scope

- 建立 Patch schema v2、Bundle 选择、Core Adapter、Flower 扩展 Adapter、全量 preflight、changed-only apply、首次备份、旧状态迁移和结构化结果。
- Skill-Garden 源采用 `overrides/patches/{workflow,skills,hooks}` + `overrides/bundles`；每个叶子目录自包含声明、selector 和 content，不再使用共享 `transforms/{matches,content}`。
- 迁移 intent-routing、Workflow Hub、五个 workflow-state、Update-Spec、Finish-Work、shared `inject-workflow-state.py`。
- Flower 自有 `src/patches/platforms` 迁移 Codex/Claude JSON Hook、TOML 清理、YAML dispatch mode 和 Flower update Hook 配置。
- 0.6 一次性切换为单 Patch 执行链，兼容迁移旧 marker/sentinel；0.5/old 保持 legacy 行为。
- flower JS 与独立 Python consumer 对 Skill-Garden Core Patch 保持 parity；独立 `install.sh` 删除 0.6 Workflow/Skill 内嵌 Python，只调用统一 Patch runner。
- manifest 增加 Patch provenance；同步脚本、快照、上下文预算、规范和测试同步升级。

## Non-Goals

- 不把 Skill、Script、Flower 自有资产、common skill 的复制和 stale asset 清理改造成 Patch。
- 不迁移 0.5/old legacy 注入实现。
- 不引入任意脚本、动态模板、无边界正则或通用编程式 Patch DSL。
- 不在本轮实现完整 enhancement Doctor UI，只保留其所需的结构化 provenance。
- 不承诺自动无损降级到旧执行器；降级失败保护后通过 `.trellis/.backup-flower/` 恢复。

## Key Context

- 当前 0.6 有五套修改路径：`enhancement-transform.js`、`workflow-inject.js`、`skill-override-inject.js`、`hook-override-inject.js`、Codex/Claude tweaks；独立安装器另有两段内嵌 Python。
- 当前 Workflow state 是“新 Guard + 上游旧 body”，会保留冲突流程；新方案按 `[workflow-state:<name>]` 结构化替换最终 body。
- planning/in-progress 的 dispatch 与 inline 通过 `content.sources` 组合 common + mode 差异，不复制四份长文本。
- Update-Spec 保留上游知识模板并替换 Interactive 冲突；Finish-Work 保留 frontmatter、完整替换旧 document body。
- Skill-Garden catalog 被两个 consumer 共享；Flower catalog 只由 flower JS 加载，避免独立安装器引用不存在的 `flower_update_hook.py`。
- 任务创建前 `workflow-request-triage.md` 已有一个孤立 `?` dirty baseline；迁移时只保留可追溯有效规则，不提前回退该文件，也不把无意义字符带入新 Patch。
- 所有 required Patch 必须在任何 Patch/资产/stale/manifest 写入前完成预检；结构化配置损坏时失败，不使用空壳覆盖用户内容。
- 上下文预算改测最终 Workflow、五个最终 state、Phase summary、SessionStart 和最终 Update-Spec/Finish-Work Skill；默认 warning-first，strict 才阻断 high-warning。
- 主要风险是 state/Skill 去重遗漏上游有效内容、JSON Hook 误覆盖、JS/Python 漂移和旧版降级；对应使用上游 fixture、结构化身份、共享测试 corpus 和首次备份控制。

## Acceptance

- 0.6 所有既有目标文件修改均由统一 Patch Engine 表达，正常日志和执行链不再运行多套注入器。
- 新 Overrides 目录不含 `overrides/transforms/`，单个叶子即可定位声明、selector 和 content，跨目标能力由薄 Bundle 组合。
- 五个 workflow-state、Update-Spec 和 Finish-Work 不再存在双流程、重复 sentinel 或“忽略下方旧规则”式覆盖文本。
- required 漂移时 Patch、资产、stale path、manifest 全部零变化；重复全装/精细安装幂等且不覆盖无关配置。
- JS/Python Core Patch parity、Flower 平台扩展、旧状态升级、缺失/损坏目标、0.5/old 回归均有测试证据。
- vendor、`enhancements/0.6` 和 dogfood 一致，`npm test`、默认/strict 上下文预算、`npm run sync`、`check-snapshot`、`git diff --check` 通过。
- Patch provenance、长期 Spec、目录说明、迁移与回滚说明已更新。

## Next Step

- 用户确认三件套与本 Brief 后运行 `task.py start`；进入 `trellis-route(implement)`，按路由结果由实现子代理或 inline 流程执行实施计划。
