# Codex 默认使用同步用户交互

## Goal

让 Flower 项目中的 Codex 使用同步询问或主对话等待，不留下异步询问与通知窗口。

## Background

- 用户明确要求询问调用同步 `request_user_input`，避免 `request_user_input_async` 与 `send_user_message_async`，同时把项目配置默认改为支持同步询问。
- 本机 Codex CLI 为 0.162.1，识别 `features.default_mode_request_user_input`；该开关目前仍为开发中功能。
- 规划时通过真实 app-server `config/read` 验证：已信任项目中的 `.codex/config.toml` 可以使该开关生效；命令行显式值优先。规划基线中当前项目已被信任但没有该键；实现后已默认补入，并再次读取确认有效值为 `true`。

## Requirements

- R1：Flower 0.6 的 Codex 项目配置缺少该键时默认补入 `features.default_mode_request_user_input = true`，覆盖新安装、更新和当前项目投影；已有明确布尔值保留。
- R2：Codex 询问优先使用当前宿主允许的同步 `request_user_input`；该工具不可用或不允许用于当前问题时，在主对话展示问题并结束本轮，等待用户回答。
- R3：Codex 不使用 `request_user_input_async` 或 `send_user_message_async` 完成本项目交互。进度与结果直接通过普通对话输出。
- R4：继续遵守原有 Brief、人工选择和提交确认规则；不因启用同步询问而切换宿主 Plan 模式、增加确认次数或推定未回答的问题已获批准。
- R5：配置和规则由 Flower 的受管源码及 Plugin 生命周期分发；保留无关用户配置，缺失 Codex 平台不创建该平台，重复更新幂等。
- R6：交互规则对 Codex 各模型有效，限制在 Codex 平台；完整新增提示不超过 512 UTF-8 字节，并测量实际注入增量。

## Acceptance Criteria

- [x] AC1 / R1、R5：真实 init/update 为缺少该键的 Codex 项目补入 `true`；已有明确 `true/false` 保留；再次执行无新增变更；无关配置完整保留，目标结构损坏或存在歧义时零写入失败。
- [x] AC2 / R2、R3、R6：Codex 的启动、清空与压缩恢复注入同步交互规则；Claude 和其它平台不新增此规则，rules/stages 不重复注入。
- [x] AC3 / R2、R4：规则明确同步工具合法可用时调用，不可用时主对话等待，不调用异步工具、不强行切模式、不自动确认。
- [x] AC4 / R5：单独技能安装不启用平台配置；当前项目通过 Flower 更新获得一致结果；用户全局配置与项目信任设置不被修改。
- [x] AC5 / R6：记录新增提示的字节与本地 token 数；相关回归及严格上下文预算检查通过。

## Non-Goals

- 不修改 Codex 可执行文件、宿主工具 schema 或工具弹窗实现。
- 不扩展 old/0.5 的历史安装分支。
- 不自动修改用户级 `~/.codex/config.toml`、信任项目或升级 Codex。
- 不改变 Trellis 的人工决定、首次 Brief 审阅或提交确认边界。
- 不承诺提示词覆盖宿主更高优先级规则；行为遵循和配置成功分别核验。
