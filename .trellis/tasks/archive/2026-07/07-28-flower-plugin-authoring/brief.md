# Brief — Flower Plugin 作者工具、作者 Skill 与 rd-guide 注册契约

## Goal

- 交付不依赖 skill-garden 的作者 Plugin、确定性 scaffold/validate 和 rd-guide CI/MR 契约。

## Scope

- `flower/flower-plugin-author` standard builtin Plugin。
- 精简 `flower-plugin-author` Skill 与 manifest/capability/Patch/Marketplace/GitLab/CI references。
- `plugin init` 确定性 scaffold 和 `plugin validate` Runtime 真源校验。
- rd-guide Marketplace entry、CI JSON、CODEOWNERS/protected approval 契约模板。
- 两个隔离 forward-test。

## Non-Goals

- 不修改真实 rd-guide、创建 MR/tag，不实现 Codex Plugin、system scaffold、hook 或 adapter。

## Key Context

- Skill 负责工作流和解释，CLI 负责 schema、hash、依赖和 capability 的机器校验。
- SKILL.md 保持精简，references 一层直达，不创建 README 等冗余文档。
- 默认 scaffold 为 standard 且无 Patch；integration 示例仍需 Marketplace 上限和项目批准。
- CI 不使用本机 keyring，不泄漏凭据。

## Acceptance

- 无 Trellis/skill-garden 项目可安装作者 Plugin。
- scaffold 输出确定、保护已有文件并立即通过 validate。
- validate 复用 P1-P4 真源，稳定 JSON 可供 CI 消费。
- rd-guide fixture 拒绝可变 ref、摘要/依赖/权限错误并标记 integration review。
- Skill 校验和两个独立 forward-test 通过。

## Next Step

- P1-P4 契约稳定后实现 author Plugin、CLI 与 CI 模板，再进行隔离 forward-test。
