# Brief — Codex 默认使用同步用户交互

## Goal

- 让 Codex 的询问使用同步工具或主对话等待，避免留下异步窗口。

## Scope

- Flower 0.6 默认给项目 `.codex/config.toml` 补入 `default_mode_request_user_input = true`，包括安装、更新和当前项目。
- 为 Codex 各模型统一注入交互规则：询问用同步工具，进度和结果直接显示在对话里，不调用两个异步工具。

## Non-Goals

- 不修改用户全局配置、项目信任、Codex 程序或宿主工具；不扩展 old/0.5，不改变原有审批规则。

## Technical Overview

- 配置通过 Flower 平台 Patch 补默认值，保留已有明确值和其它配置，重复更新幂等。
- 交互规则集中放在 Codex 的 SessionStart state 中，启动、清空和压缩恢复各注入一次，不逐个修改 skill。

## Context & Decisions

- 已实测可信项目配置能开启该开关；当前项目已被信任且没有该键。
- 同步 `request_user_input` 受当前宿主工具规则约束；不可用时在主对话提问并结束本轮，等待回答，不切换模式或调用异步工具。
- 明确配置了 `false` 的用户保留其选择，该情形使用主对话等待。

## Risks

- 开关目前仍为开发中功能；项目配置需 Codex 重新加载，规则注入无法改写当前宿主的工具限制。

## Acceptance

- 缺失键默认写入 `true`，保留用户配置；配置歧义或目标结构损坏时零写入失败；再次更新无变化。
- Codex 正确注入同步交互规则，Claude 和其它分段不新增；原有模型提示和人工确认边界保持。
- 新规则完整块不超过 512 字节，展示实际注入与本地 token 增量；定向回归、全量测试和严格预算检查通过。

## Next Step

- 确认后启动任务，先实现项目配置 Patch。
