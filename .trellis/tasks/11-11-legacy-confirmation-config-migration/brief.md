# Brief — 升级时清理旧自动确认项目配置

## Goal

- 让已安装 Flower 的项目在升级时清理历代自动确认方案遗留在项目中的配置和资产。

## Scope

- 清理符合历史签名的旧确认 MCP、配套引用、Claude 插件注册、旧 CLI 确认 Hook 和退役脚本。
- 验证曾调用旧 CLI 的后台确认 Hook 通过现有升级收敛到当前项目内 Python 实现。

## Non-Goals

- 用户级配置、全局旧 CLI、其他仓库、历史备份、运行时证据、实验探针和当前确认策略及 Push 门禁均在范围外。

## Technical Overview

- 在内置 Skill-Garden 的全量升级计划中检查指定项目文件。配置按历史命令和结构识别，退役脚本按历史内容或旧受管证据识别。预演、写入与回滚沿用现有事务。

## Context & Decisions

- 旧 MCP 的临时启动参数本身无需迁移；项目里实际落盘的注册属于迁移范围。
- 旧前台方案曾使用 `ftl confirm hook` 和 `confirmation.py`。后台方案沿用了 `flower_confirmation_hook.py` 路径；当前版本仍需要这个入口。

## Risks

- 旧方案与现行方案可能使用相同的文件名或 Hook 事件。保留现行 Hook、自定义配置、用户改过的退役脚本，以及来源不明或经软链接访问的文件。

## Acceptance

- 升级后确认归属的旧注册、退役 Hook 和脚本消失；现行 Hook、自定义配置、`codex_tui` 和 `confirmation_timeout` 保留。
- 预演零写入；失败可回滚；再次升级没有迁移变更。覆盖 Ubuntu 和 Windows 的跨版本安装回归。

## Next Step

- 用历史版本的脱敏样本验证现有升级行为，确定仍需要补齐的清理规则。
