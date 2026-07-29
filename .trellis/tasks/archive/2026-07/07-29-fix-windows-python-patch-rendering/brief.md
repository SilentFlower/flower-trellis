# Brief — 修复 Windows Python 命令导致的 Patch 漂移

## Goal

- 让 `flower-trellis init` / `--enhance-only` 在 Trellis 0.6.5 使用 `python3`、`python` 或
  `py -3` 时都能通过严格 Patch 预检，并保持最终内容与事务状态一致。

## Scope

- 从目标项目已生成文件中解析 Trellis 实际 Python 命令，支持环境显式值和安全的平台回退。
- 为可信 builtin catalog 增加受控的运行时文本物化，统一处理 selector、content 和 baselines，
  不改变 Patch / Bundle schema。
- 让 0.6 Skill/Command 文本投影使用同一命令，保持内容投影与 Patch overlap 最终 hash 一致。
- 在 Skill-Garden Python Patch runner 中实现等价语义，补齐 `python`、`python3`、`py -3`、幂等、
  atomicity、外部 Plugin 隔离和 JS/Python parity 测试。
- 按 `vendor/skill-garden` 源优先规则同步发布快照，并运行 compiled targets 与完整质量检查。
- 修复升级同步重新引入的旧 Session Context 更新检查，并把约束固化为 full-only Patch，保证后续
  `trellis update` 不会再次覆盖回来。

## Non-Goals

- 不升级 Trellis，不改变 `old` / `0.5` 变体。
- 不放宽 selector、fingerprint、required Patch 或事务零写入门禁。
- 不在 Patch schema 中加入变量、表达式或普通 Plugin 可用的模板能力。
- 不全面改写第三方 common skill，也不顺带处理 CRLF 等无直接证据的平台差异。
- 不盲目替换 Python 源文件中的 subprocess argv；`py -3` 的结构化执行问题不由文本替换掩盖。

## Key Context

- 已通过 `TRELLIS_PYTHON_CMD=python` 对已发布 `flower-trellis@0.5.1` 精确复现用户报告的 9 项失败，
  默认 `python3` 安装成功，根因证据充分。
- `src/lib/patch-engine.js` 当前直接加载 canonical `python3` selector/content/baseline 并匹配目标原文。
- `src/builtin-plugins/skill-garden/provider.js` 同时提供 Skill-Garden 与 Flower builtin catalog；该可信
  Provider 是传递目标命令的正确边界。
- `src/builtin-plugins/skill-garden/content-adapter.js` 计算内容 mutation hash；若只修 Patch，Windows
  会在内容/Patch hash 一致性门禁再次失败。
- `vendor/skill-garden/scripts/apply-trellis-patches.py` 是独立安装器的 Patch 语义实现，必须保持 parity。
- canonical catalog hash 继续基于未物化资产，最终 before/after hash 基于目标平台实际字节。

## Acceptance

- `python3` target 无回归且二次安装幂等。
- `python` target 不再出现原 9 项错误，Workflow、Skill、Command 与 Hook 最终命令一致。
- `py -3` target 通过预检并生成正确的 Markdown / Hook 命令。
- 非命令内容的未知漂移仍失败关闭，Patch、内容资产、lock、state 均零写入。
- 内容投影与 Patch overlap 不绕过门禁，外部 Plugin 无法启用 builtin materialization。
- JS/Python parity、快照同步、compiled targets 和完整 `npm test` 通过。

## Current Status

- Windows Python 命令物化、Session Context full-only Patch、发布快照、compiled targets 和
  当前仓库 dogfood 均已完成并保持幂等。
- Phase 2.2 full Check-All 已通过：JS 295 项、Python 147 项、Patch policy、compiled targets、
  发布包边界、上下文预算和静态检查全部通过。

## Next Step

- 进入 Phase 3.3，评估是否需要把本次可执行契约补充到项目 spec，然后等待提交确认。
