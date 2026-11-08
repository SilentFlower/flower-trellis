# Brief — 原版会话使用 `ftl confirm` 前台确认

## Goal

- 让助手在原版 Codex 和 Claude 的既有确认点直接调用 `ftl confirm`，原窗口关闭后撤销旧决定。

## Scope

- 保留 Brief、Check-All、Push 的现有策略、动作与项目配置。
- 原版 Codex 本机共享 App Server 和普通 Claude 共用唯一的 `ftl confirm` 流程；移除旧 `ftl session`。

## Non-Goals

- 不给 Codex 打补丁，不使用确认 MCP，不替换现用程序或擅自接管共享连接。
- 不接管独立权限审批、风险接受、Spec 歧义或 auto-loop。

## Technical Overview

- 先冻结并完整展示正文，再在同一次 `ftl confirm <id>` 中等待、复核与领取。Codex 用本机签名文件和原连接绑定，Claude 用真实前台与宿主 Hook。

## Context & Decisions

- 由助手直接调用命令。隔离实测：共享 Codex 会话即使只有一个窗口，关窗后原后台仍会继续，因此用原连接核验窗口。
- Brief 为 100 秒起、超出 1000 字后每 500 字加 30 秒；检查首项 100 秒、后续每项加 30 秒；Push 200 秒，沿用展示模式。

## Risks

- 缺少原窗口、完整展示或预算时保持人工。普通安装不改变现用共享服务。

## Acceptance

- 两端实际原版入口验证展示、关闭、重开、输入抢先和单次动作；三个门禁、两种 Git 模式及升级卸载通过。

## Next Step

- 以正式 CLI 的原版终端和 beta.2 升级结果进入 Check-All。
