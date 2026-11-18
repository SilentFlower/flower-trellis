# Brief — 将工作流提示扩展到全部 GPT 模型

## Goal

- 让 Codex 中全部 GPT 模型默认获得现有工作流提示，自动覆盖后续型号。

## Scope

- 扩展 GPT 模型识别与提示生成。
- 增加 GPT 总开关，兼容三个既有独立开关。
- 同步测试、预算测量、说明和相关规范。

## Non-Goals

- 其他模型家族、工作流正文改写、审批规则调整和历史提示清理。

## Technical Overview

- 在既有 Codex SessionStart 的 state 分段识别合法 `gpt-…` 名称，共用当前提示正文，每次目标事件生成一份提示。
- 新增默认开启的 `codex.gpt_workflow_hint` 总开关；旧三个型号继续受各自独立开关控制。

## Context & Decisions

- 作者源为 `src/assets/flower_session_start.py`，沿既有资产投影链同步部署。
- 覆盖 5.x、6.x、版本后缀和未来 GPT 型号；沿用 startup、clear、compact 三种来源。
- 三个既有型号保留原标签；其他 GPT 型号使用通用标签。

## Risks

- 重点验证旧开关兼容、单次注入和上下文预算。

## Acceptance

- GPT 型号矩阵、非法输入、平台及事件边界、开关和异常诊断回归通过。
- 每个完整提示块不超过 2048 UTF-8 字节，关联专项和 strict 预算通过。
- 推送后对应提交的 Ubuntu/Windows、Python 3.8/3.12 必需 CI 成功，完成兼容验收。

## Next Step

- 激活任务，进入实现路由并修改提示源资产。
