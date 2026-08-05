# 集成阿里云 DMS Skill 到 skill-garden

## Goal

将 Claude 会话 `ac060d54-fe9a-46ac-b194-64a39f5b6740` 中生成并实测的
`aliyun-dms-query` 通用 Skill 纳入 skill-garden，使 Claude Code 与 Codex 项目都能按需安装，
并随 flower-trellis 离线快照稳定分发。

## Background

- 原始 Skill 位于 `~/.claude/skills/aliyun-dms-query/`，包含 `SKILL.md`、
  `scripts/dms.py` 和 `assets/env.example`。
- 会话中已验证 DMS `COMMON` 管控模式下：只读 SQL 可通过 `ExecuteScript` 查询，
  DML 不能在 SQL 控制台直跑，必须通过 `CreateDataCorrectOrder` 创建审批工单。
- skill-garden 的通用 Skill 源位于 `.common/.codex/skills/` 与
  `.common/.claude/skills/`；flower-trellis 通过 `npm run sync` 将其复制到
  `enhancements/common/.common/` 并登记到 `enhancements/MANIFEST.json`。
- 现有 Skill 文档把脚本路径硬编码为 `~/.claude/...`，直接复制到 Codex 会产生错误指引。

## Requirements

- `R1`：在 skill-garden 的 Claude 与 Codex 通用 Skill 目录中新增
  `aliyun-dms-query`，保留原 Skill 的 DMS RPC v1.0 签名、实例/数据库查询、只读 SQL、
  数据变更工单和工单列表能力。
- `R2`：Claude 与 Codex 的 `SKILL.md`、`scripts/dms.py`、`assets/env.example`
  核心资产保持一致；文档使用 Skill 内相对路径调用脚本，不绑定某个平台的用户目录。
- `R3`：安全模型不得弱化：AK/SK 只从环境变量或私有 ENV 文件读取，不写入仓库、不回显；
  `query` 本地拒绝非只读 SQL；`order` 不带 `--yes` 时只预览，只有显式 `--yes`
  才调用 `CreateDataCorrectOrder`。
- `R4`：skill-garden README 与 flower-trellis README 都要把
  `aliyun-dms-query` 列为可选通用 Skill，并准确说明其查询与审批工单边界。
- `R5`：运行 `npm run sync` 生成 flower-trellis 的 common 离线快照，确保
  `enhancements/MANIFEST.json` 的 Claude/Codex Skill 清单都包含该名称。
- `R6`：增加自动测试覆盖双平台源与快照、文件权限、空凭证模板、菜单可发现性、
  双平台安装、DML 查询拦截和工单默认预览；测试不得调用真实 DMS 或创建真实工单。
- `R7`：Skill 目录只包含运行所需文件，不加入 README、安装指南、真实查询结果、
  私有配置、缓存或字节码文件。

## Out Of Scope

- 不修改阿里云 DMS API 协议、审批规则或生产实例配置。
- 不执行真实生产查询，不运行 `order --yes`，不创建 DMS 工单。
- 不改造现有 `aliyun-sls-query` Skill，也不抽取共享签名库。
- 不在本任务中发布 npm 包或创建版本标签。

## Acceptance Criteria

- [ ] `vendor/skill-garden/.common/.codex/skills/aliyun-dms-query/` 与
  `.common/.claude/skills/aliyun-dms-query/` 均存在，核心三文件内容一致，脚本权限为 `755`。
- [ ] `SKILL.md` frontmatter 名称为 `aliyun-dms-query`，触发描述覆盖生产库查询、
  实例/DbId 定位、DML 审批工单和 DMS 报错排查，示例不再引用 `~/.claude` 固定路径。
- [ ] `env.example` 仅含空值变量模板，不包含 `LTAI...` 或任何真实凭证。
- [ ] 无网络测试证明：`query` 收到 UPDATE 时退出码为 `2` 并提示改用 `order`；
  `order` 不带 `--yes` 时退出码为 `0`、显示预览且不报告工单已创建。
- [ ] `npm run sync` 后，Flower common 快照包含 Claude/Codex 两份 DMS Skill，
  `enhancements/MANIFEST.json` 两个平台清单均登记 `aliyun-dms-query`。
- [ ] `flower-trellis skill` 的 catalog 能发现该 Skill，并能按目标项目已有平台精确安装。
- [ ] skill-garden README 与 flower-trellis README 的通用 Skill 说明已更新。
- [ ] 两份 Skill 通过 `quick_validate.py`，DMS 脚本语法检查、聚焦测试和 `npm test` 通过。
- [ ] Git diff 与自动测试确认没有真实 AK/SK、ENV 私有文件、`__pycache__` 或 `.pyc` 进入版本控制。
