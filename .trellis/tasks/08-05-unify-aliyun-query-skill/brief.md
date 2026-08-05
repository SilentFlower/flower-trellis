# Brief — 整合可扩展的阿里云运维查询 Skill

## Goal

- 将 skill-garden 中现有 DMS、SLS 能力与已实跑验证的 MSE/Nacos 查询能力整合为单一 `aliyun-ops` Skill，并建立可继续扩展其它阿里云产品的结构。

## Scope

- 新建 Claude/Codex 双平台一致的 `aliyun-ops` Skill，使用精简 `SKILL.md` 路由到 DMS、SLS、MSE 三份按需 reference。
- 提取公共 ENV/凭证加载、结果渲染和阿里云 RPC v1 签名模块；SLS LOG V1 签名保持独立。
- 原样保留 DMS 的实例/数据库查询、只读 SQL、工单预览与提交、工单列表能力，以及 SLS 的日志/指标查询能力。
- 新增 MSE/Nacos 六类只读命令：集群、命名空间、配置列表、当前配置、配置历史、历史版本详情。
- 新增单一 Skill 迁移清单，使 Flower 更新与 skill-garden 独立安装器都能把旧 DMS/SLS Skill 自动迁移为 `aliyun-ops`。
- 更新 skill-garden README、Flower common Skill 快照、manifest 和相关自动化测试。

## Non-Goals

- 不提供创建、更新、删除、导入或回滚 Nacos 配置等 MSE 写操作。
- 不改变 DMS 的审批安全模型；真实创建工单仍必须显式使用 `--yes`。
- 不把 SLS 签名器并入 RPC v1 公共模块。
- 不自动创建、复制、合并、改写、改权限或删除任何真实 ENV/凭证文件。
- 不保留 `aliyun-dms-query`、`aliyun-sls-query` 别名 Skill。

## Key Decisions

- 统一 Skill 名称为 `aliyun-ops`，产品能力使用独立脚本和 reference，不建设单一巨型 CLI。
- `~/.config/aliyun-ops/env` 为新主配置；旧 DMS/SLS 配置路径长期只读兼容，仅补充新配置中缺失的变量。
- 进程环境变量优先；显式指定的 ENV 文件必须存在且作为唯一文件读取，避免静默使用其它凭证。
- 旧 Skill 自动迁移采用受控 `skill-migrations.json` 单一清单；先确认新 Skill 可写入，再精确删除旧目录。
- 无旧 Skill 的项目普通更新不自动启用新 Skill，继续遵守只刷新已启用 common Skill 的现有原则。
- MSE 默认根据 region 生成 endpoint，并显式传 `RegionId`；当前与历史配置默认只输出摘要或 `--grep` 命中行。

## Key Context

- Skill 真实源：`vendor/skill-garden/.common`；Flower 发布快照由 `scripts/sync-enhancements.mjs` 生成到 `enhancements/common/.common`。
- 现有 Skill：`aliyun-dms-query`、`aliyun-sls-query`；MSE 实跑原型：`/tmp/aliyun_mse.py`。
- Flower common Skill 同步入口：`src/lib/skill-catalog.js`；builtin Plugin 通过 `src/builtin-plugins/skill-garden/content-adapter.js` 消费同一同步描述。
- skill-garden 独立安装入口：`vendor/skill-garden/scripts/install.sh`。
- 现有删除机制会把旧名称写入 `removedSkills`，但不会自动安装替代 Skill，因此本任务必须补充迁移映射和“先新增后删除”逻辑。
- MSE 使用 `2019-05-31` RPC API；SLS 使用独立 LOG V1；DMS 使用 RPC v1 POST。

## Risks / Deferred

- 两个旧 Skill 可能同时存在或与新 Skill 并存，迁移写入必须去重且保持事务顺序。
- 旧 DMS/SLS ENV 可能使用不同 AK/SK，禁止自动合并；不同产品按自己的旧路径优先级读取。
- MSE 配置可能含敏感值，默认输出必须保持摘要化；服务端历史保留期不由 Skill 保证。
- MSE 写操作和更多阿里云产品留待后续独立需求扩展。

## Acceptance

- skill-garden 与 Flower 菜单只出现一个 `aliyun-ops`，Claude/Codex 源与快照一致且不含凭证或缓存。
- DMS/SLS 现有受测行为无回归，MSE 六类只读查询按官方区域/API 契约工作。
- 旧 ENV 文件继续可用，且任何安装、升级或默认运行都不会写入或删除凭证文件。
- 已安装任一或两个旧 Skill 的项目升级后获得 `aliyun-ops` 并移除旧目录；无旧 Skill、已有新旧 Skill及各平台路径均有测试。
- 独立安装器接受旧名称作为迁移别名，最终只留下 `aliyun-ops`。
- Skill 校验、聚焦脚本/迁移测试和项目完整质量门全部通过。

## Current Status

- 统一 Skill、双平台源、Flower 快照、迁移清单和自动化测试已经落地。
- Check-All 发现的 DMS 只读边界、MSE 错误码、ENV 不变性、全量安装迁移测试、旧别名去重和无效迁移声明 fail-closed 问题已修复。
- 聚焦测试、Skill 校验与完整 `npm test` 已通过，当前等待进入规范更新和提交计划。
