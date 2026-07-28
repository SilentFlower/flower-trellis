# Brief — Flower Plugin Capability Policy 与 Patch Engine 集成

## Goal

- 建立不可绕过的 Plugin 能力授权层，并把外部受限 Patch 与内置完整 Patch 接入现有 Patch Engine 和统一事务。

## Scope

- 实现 standard、integration、system 与四层授权交集。
- 限制 integration 为白名单 Markdown 目标上的 insert 和有限 Core selector。
- 实现不可伪造的 builtin system 信任根、qualified catalog identity 和 approval digest。
- 合并全部 catalog 一次调用 `preparePatchPlan()`，转换为 PatchMutation 并接入 P2 InstallPlan。

## Non-Goals

- 不开放外部 lifecycle hook、adapter、replace/remove、配置文件 Patch 或 system 提权。
- 不实现 Provider、普通内容投影、transaction writer 或 skill-garden 迁移。

## Key Context

- integration 初始目标仅 `.trellis/workflow.md` 和 `.trellis/spec/**/*.md`，目标必须已存在，禁止 create。
- 外部 catalog 使用 Runtime 生成的 qualified ID，不能伪造内置 catalog 或 legacy marker。
- approval 绑定版本、内容摘要、来源上限、Runtime policy 和规范化 Patch 计划；任一变化重新确认。
- Plugin Runtime 不调用 `applyPatchPlan()`；P2 writer 统一写入，legacy enhancement 保持原入口。

## Acceptance

- 三档权限、四层交集、system 伪造和 integration 越权有正反例测试。
- 多 catalog 只做一次 preflight，跨 catalog 和普通内容冲突零写入。
- approval 首次确认、frozen 复用和漂移失效可验证。
- Patch Engine JS/Python parity、conflict、compiled targets 和完整测试不回归。

## Next Step

- P1 DTO 稳定后实现 policy；P2 InstallPlan/writer 稳定后完成事务接入。
