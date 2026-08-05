# Brief — 集成阿里云 DMS Skill 到 skill-garden

## Goal

- 将 Claude 会话中已生成并实测的 `aliyun-dms-query` 通用 Skill 纳入 skill-garden，支持 Claude Code、Codex 与 flower-trellis 离线分发。

## Scope

- 在 skill-garden 的 `.common/.claude/skills` 与 `.common/.codex/skills` 新增 DMS Skill 的 `SKILL.md`、`scripts/dms.py`、`assets/env.example`。
- 保留实例/数据库发现、只读 SQL、数据变更工单、工单列表、RPC 签名、凭证加载与排错能力。
- 将硬编码的 Claude 用户目录调用改成 Skill 内相对脚本路径，使两平台核心资产保持一致。
- 更新 skill-garden 与 flower-trellis README、common 离线快照、manifest 和聚焦自动测试。
- 验证 Skill 结构、脚本权限、凭证模板、本地 DML 拦截、工单默认预览、catalog 发现、双平台安装及全量回归。

## Non-Goals

- 不修改 DMS API、审批规则或生产实例配置。
- 不执行真实生产查询，不运行 `order --yes`，不创建真实 DMS 工单。
- 不重构 `aliyun-sls-query`，不抽取共享签名库。
- 不发布 npm 包、不打版本标签。

## Key Decisions

- DMS Skill 作为 `.common` 可选 Skill 同时支持 Claude 与 Codex，不进入 Trellis 工作流 Skill 变体。
- 保留会话产物的 API 与安全语义，只修正平台绑定路径，不扩大功能范围。
- `query` 继续本地拒绝非只读 SQL；DML 只能通过 `CreateDataCorrectOrder`；`order` 默认只预览，显式 `--yes` 才提交。
- 两平台核心三文件逐字节一致，本轮不增加平台专属元数据文件。
- 最终提交顺序为先提交 skill-garden 子仓，再重跑 `npm run sync`，最后提交父仓，以保证 manifest `sourceCommit` 正确。

## Key Context

- 原始产物：`~/.claude/skills/aliyun-dms-query/`。
- skill-garden 源：`vendor/skill-garden/.common/{.claude,.codex}/skills/`。
- Flower 快照：`enhancements/common/.common/` 与 `enhancements/MANIFEST.json`。
- common catalog 通过目录枚举自动发现 Skill，无需修改技能名单常量。
- 测试使用假 AK/SK 与显式 Tid，只走本地分支，禁止网络调用和真实工单提交。

## Risks / Deferred

- 子模块未先提交就生成最终快照会让 `sourceCommit` 过期；提交阶段必须按既定顺序重跑同步。
- `order --yes` 的真实工单链路仍沿用原会话的人工验证结论，本任务不重复执行有副作用验证。

## Acceptance

- Claude/Codex 两份源 Skill 与 Flower 快照完整存在，核心资产一致，脚本权限为 `755`。
- 文档不再引用 `~/.claude` 固定路径，frontmatter 与使用说明能正确触发 DMS 查询和审批工单场景。
- ENV 模板无真实凭证，仓库无私有配置、缓存或字节码。
- 无网络测试证明 UPDATE 被 `query` 拒绝，`order` 未加 `--yes` 时只预览且不创建工单。
- manifest、catalog、双平台安装与 README 都包含 `aliyun-dms-query`。
- 两份 Skill 校验、Python 语法检查、聚焦测试与 `npm test` 全部通过。

## Next Step

- 确认 Brief 后运行 `task.py start`，再通过 `trellis-route(target=implement)` 进入实现。
