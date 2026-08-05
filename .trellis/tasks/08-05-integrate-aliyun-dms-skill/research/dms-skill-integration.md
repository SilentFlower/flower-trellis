# DMS Skill 集成研究

## Source Conversation

- 会话：Claude `ac060d54-fe9a-46ac-b194-64a39f5b6740`
- 原始目录：`~/.claude/skills/aliyun-dms-query/`
- 文件：`SKILL.md`、`scripts/dms.py`、`assets/env.example`
- 会话结论：`instances`、`databases`、`query`、`orders`、DML 拦截和工单预览已实测；
  `order --yes` 因会创建真实工单而未执行。

## Confirmed DMS Contract

- DMS RPC 版本：`2018-11-01`，签名为 RPC v1.0 HMAC-SHA1。
- 只读查询：`ExecuteScript`，直接返回结果，不经过工单审批。
- 数据变更：`CreateDataCorrectOrder`，必须提供 `Comment`、`Param`、
  `EstimateAffectRows`，进入 DMS 审批流。
- COMMON 管控模式会阻止 DML 通过 SQL 控制台直接执行。
- 凭证来源：进程环境变量、DMS 私有 ENV 文件、SLS ENV 回退；不接受命令行 AK/SK。

## Repository Evidence

- 通用 Skill 源：`vendor/skill-garden/.common/.codex/skills/` 与
  `.common/.claude/skills/`。
- 安装器通过目录枚举自动发现并按名称复制，无需维护技能常量。
- Flower 发布快照由 `scripts/sync-enhancements.mjs` 从子模块 `.common` 全量复制到
  `enhancements/common/.common`，并更新 manifest 的平台清单和 `sourceCommit`。
- `src/lib/skill-catalog.js` 同样通过快照目录枚举 common Skill，可按目标项目存在的
  `.codex` / `.claude` 平台目录安装。
- 现有 `aliyun-sls-query` 在 Claude/Codex 两侧保持核心文件与权限完全一致，适合作为 DMS Skill 的集成基线。

## Planning Decisions

- 作为 `.common` Skill 同时分发到 Claude 与 Codex。
- 保留会话产物的 API 与安全语义，只修正平台绑定路径。
- 两平台核心资产一致，不增加与需求无关的平台专属文件。
- 新增无网络自动测试，不重复执行真实 DMS 查询或工单提交。
- 父仓最终快照必须在子模块提交后重新生成，确保 manifest 溯源 SHA 正确。
