# 集成阿里云 SLS 查询 Skill

## Goal

将现有 `aliyun-sls-query` 通用 Skill 纳入 Skill Garden 的可追溯分发链，使用户可以通过 Flower Trellis 现有 Skill 管理入口按需安装、停用和随版本刷新，同时保持凭证不进入仓库或发布快照。

## Background

- 当前 Skill 位于用户级 `/root/.codex/skills/aliyun-sls-query`，包含 `SKILL.md`、`assets/env.example` 和零第三方依赖的 `scripts/sls_get_logs.py`；`scripts/__pycache__` 是本地产物，不属于可分发内容。
- Skill 默认从 `~/.config/aliyun-sls-query/env` 或进程环境变量读取 AK/SK，要求私有配置文件权限为 `600`，不把真实凭证写入 Skill、仓库、命令行参数或标准输出。
- Skill Garden 已用 `.common/.codex/skills/<name>` 和 `.common/.claude/skills/<name>` 管理可选通用 Skill，并将其与 Trellis 工作流强化 Skill 分离。
- Flower Trellis 已从 `vendor/skill-garden/.common` 生成 `enhancements/common` 发布快照；`src/lib/skill-catalog.js` 会自动发现通用 Skill，并复用现有安装、停用和升级刷新逻辑。
- 用户可从 Plugin 管理器的内置 `flower/skill-garden` 入口或兼容命令 `flower-trellis skill` 勾选通用 Skill；Flower 当前没有面向 common skill 的非交互启用子命令，本任务不扩展该命令面。
- `vendor/skill-garden` 是独立 git submodule，Skill 源改动、submodule pin 和 Flower 发布快照必须分别保持可追溯一致。

## Requirements

- 在 Skill Garden `.common` 中新增名称保持为 `aliyun-sls-query` 的通用 Skill，保留现有自然语触发说明和阿里云 SLS 查询知识。
- 同时提供 Codex 与 Claude 两个平台副本；两端的 `SKILL.md`、脚本和示例配置保持一致，并分别安装到 `.codex/skills/aliyun-sls-query` 与 `.claude/skills/aliyun-sls-query`。
- 分发内容只包含 `SKILL.md`、`assets/env.example` 和 `scripts/sls_get_logs.py` 等源码资产，不包含 `__pycache__`、`.pyc`、真实 ENV 文件、AK/SK 或其它机器本地状态。
- `scripts/sls_get_logs.py` 继续使用 Python 标准库，支持现有 ENV 文件、参数覆盖、SLS V1 签名、gzip 响应、日志分页参数和 `x-log-progress` 提示，不在本任务中引入 SDK 运行时依赖。
- Skill Garden README 的通用 Skill 清单和新增 Skill 说明应包含 `aliyun-sls-query`，并明确它是可选安装而非默认铺设。
- Flower Trellis 通过现有 `npm run sync` 将 Skill 纳入 `enhancements/common` 和 `MANIFEST.json`，不得手工维护生成快照。
- Flower 的现有 Skill Garden 管理器和 `flower-trellis skill` 菜单应自动显示该 Skill 的中文名称/用途、已安装状态，并允许用户勾选启用或停用。
- 已启用的 `aliyun-sls-query` 在后续 `flower-trellis update` 中按现有 common skill 规则刷新；未启用的项目不得因更新而自动安装。
- 安装时按目标项目已启用的平台目录铺设；不得把用户级 `~/.config/aliyun-sls-query/env` 复制进项目，也不得自动创建或修改真实凭证配置。
- 增加覆盖 Skill Garden 源资产、Flower 快照、catalog 发现、按需安装、停用和更新刷新行为的测试或一致性检查。

## Out Of Scope

- 在本任务中扩展新的 SLS 写操作、日志下载服务、Web 管理页面或远程凭证管理。
- 将个人 AK/SK、project、logstore 等真实配置写入仓库或随 npm 包发布。
- 默认安装 `aliyun-sls-query`，或在用户未选择时修改目标项目。
- 重写 Flower 现有通用 Skill 安装协议、Plugin 管理器或快照结构。
- 把当前文档中的 metricstore 经验扩展成新的专用可执行工具；本轮以迁移和分发现有能力为主。

## Acceptance Criteria

- [ ] Skill Garden 的 Codex 与 Claude 通用 Skill 目录都包含完整且一致的 `aliyun-sls-query` 可分发源码，且不包含缓存文件或真实凭证。
- [ ] Skill Garden 独立安装器可使用 `--scope common ... aliyun-sls-query` 只安装该 Skill，并遵循目标平台目录规则。
- [ ] 执行 Flower 快照同步后，`enhancements/MANIFEST.json` 将 `aliyun-sls-query` 列入对应平台，快照内容与 Skill Garden 源一致。
- [ ] Flower Skill 管理入口能展示 `aliyun-sls-query`，用户选择后安装到目标平台目录，取消选择后只删除该受管 Skill。
- [ ] `flower-trellis update` 只刷新已经存在的 `aliyun-sls-query`，不会给未启用项目新增该 Skill。
- [ ] 安装、停用和更新流程均不读取、复制、打印或修改用户的真实 AK/SK 配置。
- [ ] 分发后的 `scripts/sls_get_logs.py --help` 可运行，脚本保持零第三方运行时依赖。
- [ ] Skill Garden 与 Flower Trellis 的相关测试、快照一致性检查和 `git diff --check` 通过。

## Notes

- 该任务涉及 Skill Garden 子仓、Flower 发布快照和安装行为，按复杂跨仓任务规划，最终需要 `design.md` 与 `implement.md`。
