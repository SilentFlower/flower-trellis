# 整合可扩展的阿里云运维查询 Skill

## Goal

将 skill-garden 中现有的 `aliyun-dms-query`、`aliyun-sls-query` 与已在真实排障会话中验证的阿里云 MSE/Nacos 查询能力整合为一个统一 Skill。统一入口应减少重复的凭证、安全和签名基础设施，同时保持各云产品协议隔离，并允许后续按同一结构扩展更多阿里云产品能力。

## Background

- 现有两个通用 Skill 位于 `vendor/skill-garden/.common`，分别提供 DMS 与 SLS 能力，并维护 Claude/Codex 双平台副本。
- Claude 会话 `4a2e84ab-b815-4d34-8914-0e50574fc9d0` 中临时实现并实跑了 MSE OpenAPI 查询脚本，用于定位生产 Nacos 配置差异和变更历史。
- 已验证的 MSE/Nacos 只读能力包括：列集群、列命名空间、列配置、查看当前配置、列配置历史、查看历史版本内容。
- 阿里云官方文档确认 MSE `2019-05-31` OpenAPI 使用 RPC 风格，且上述 Nacos 配置查询 API 均为正式能力；区域参数与最小 RAM 权限需要在正式实现中明确处理。

## Requirements

### R1. 统一入口

- skill-garden 对外只提供一个面向阿里云运维与排障的通用 Skill，命名为 `aliyun-ops`。
- Skill 的触发描述需覆盖 DMS、SLS、MSE、Nacos、线上数据库查询、日志/指标排查、配置与配置历史核对等自然语言场景。
- `SKILL.md` 只保留公共流程、能力路由和安全边界；产品专属细节按需加载，避免每次触发都占用全部上下文。

### R2. 保留现有 DMS 能力

- 支持列 DMS 实例、列数据库、执行只读 SQL、预览/提交数据变更工单、查看工单。
- DML/DDL 不得通过只读执行通道绕过审批；真实创建工单必须保留显式确认。
- 保留 table/json/csv 输出和现有错误诊断能力。

### R3. 保留现有 SLS 能力

- 支持查询 logstore 日志、metricstore 指标、时间窗口、查询语句、topic、分页与原始 JSON 输出。
- 保留 SLS 自有 LOG V1 签名实现及已有的日志/指标排障经验。
- 不得把 SLS 签名器与阿里云 RPC 风格签名器混用。

### R4. 纳入 MSE/Nacos 只读能力

- 支持列 MSE 集群、列 Nacos 命名空间、列配置、查看当前配置、列配置历史、查看指定历史版本。
- 正式命令必须支持区域参数，不依赖单一区域硬编码；endpoint 与 `RegionId` 的组合需符合官方 API 契约。
- 查看当前或历史配置时，默认不得直接输出整份配置内容；应支持关键字过滤，并在未指定过滤条件时只输出安全摘要。
- 本期不提供创建、更新、删除、导入、回滚 Nacos 配置等写操作。

### R5. 公共安全与凭证约束

- AK/SK 仅从进程环境变量或权限为 `600` 的私有 ENV 文件读取，不进入仓库、Skill、命令行参数或标准输出。
- 统一 Skill 提供 `~/.config/aliyun-ops/env` 主配置入口，并长期兼容读取现有 DMS/SLS 配置路径，避免升级后立即失效。
- 安装、升级和首次运行不得自动复制、合并、改写、改权限或删除旧 ENV 文件；凭证文件迁移完全由用户自行决定。
- 默认读取时，新统一配置优先，旧配置只补充尚未设置的变量，不得覆盖进程环境变量或新配置中的值。
- 显式指定的配置文件不存在时必须 fail-fast，避免误用其它凭证。
- 所有产品能力共享一致的凭证加载、脱敏和错误输出纪律。
- RAM 权限说明按产品拆分，默认推荐最小只读权限；DMS 工单权限单独说明。

### R6. 可扩展结构

- 新增阿里云产品时，应能通过增加产品专属脚本/参考资料并登记路由完成，不需要复制公共凭证和 RPC 签名代码。
- 共享 RPC v1 签名能力只服务协议相同的产品；产品响应解析、业务命令和专属安全规则保持隔离。
- 不将所有产品逻辑堆入单个超大脚本。

### R7. 双平台与发布一致性

- Claude 与 Codex 版本的 Skill 正文、脚本、参考资料和示例配置保持一致，仅平台元数据允许差异。
- 更新 skill-garden README、Flower common Skill 快照、manifest 与相关测试。
- 不直接修改 `enhancements/` 快照作为真实源；先修改 `vendor/skill-garden`，再通过现有同步流程生成快照。

### R8. 旧 Skill 自动迁移

- 已安装 `aliyun-dms-query`、`aliyun-sls-query` 中任意一个时，升级必须自动安装对应平台的 `aliyun-ops`，再精确删除旧 Skill 目录。
- 不保留旧名称的别名 Skill，避免菜单重复、触发冲突和后续内容漂移。
- 显式使用旧名称执行 skill-garden 安装时，应将其解析为 `aliyun-ops`，保证历史安装命令仍能完成迁移。
- 自动迁移规则应由一个受控清单统一声明，Flower 快照同步、Plugin 更新和 skill-garden 独立安装器共同消费，避免多处硬编码产生漂移。
- 只有新 Skill 已成功准备或写入时才删除旧目录；迁移不得影响其它用户自有 Skill。

## Acceptance Criteria

- [ ] skill-garden 与 Flower 的可选 Skill 列表中只出现一个统一阿里云 Skill。
- [ ] 统一 Skill 能路由并执行现有 DMS、SLS 能力以及新增 MSE/Nacos 六类只读查询能力。
- [ ] DMS 与 SLS 现有受测行为无回归，MSE 请求包含正确的区域与 API 参数。
- [ ] MSE 当前配置和历史配置默认不泄露整份潜在敏感内容。
- [ ] 统一配置入口可用，旧 DMS/SLS 私有配置文件能长期作为兼容回退来源，且安装/升级过程不会写入或删除任何真实 ENV 文件。
- [ ] Claude/Codex 源文件一致，发布快照与 manifest 同步一致。
- [ ] 已安装任一旧 Skill 的项目升级后自动获得 `aliyun-ops`，旧目录被精确删除；双旧 Skill、已同时安装新旧 Skill、无旧 Skill等场景均有自动化测试覆盖。
- [ ] skill-garden 独立安装器接受旧名称作为迁移别名，但最终只安装 `aliyun-ops`。
- [ ] Skill 基础校验、脚本单元/契约测试和项目相关 Node 测试通过。

## Notes

- 本任务按复杂任务执行，技术设计与实施计划分别记录在 `design.md`、`implement.md`。
- MSE 历史版本在控制台侧通常仅保留有限时间，Skill 不应承诺长期历史完整性。
- 参考官方文档：
  - https://help.aliyun.com/zh/mse/developer-reference/api-mse-2019-05-31-listclusters
  - https://help.aliyun.com/zh/mse/developer-reference/api-mse-2019-05-31-dir-nacos-configuration/
