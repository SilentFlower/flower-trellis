# Brief — 集成阿里云 SLS 查询 Skill

## Goal

- 将现有 `aliyun-sls-query` 纳入 Skill Garden 的可追溯 common skill 分发链，使 Codex 和 Claude 用户可通过 Flower Trellis 现有 Skill Garden 管理入口按需安装、停用和随版本刷新，同时确保真实凭证不进入仓库或发布快照。

## Scope

- 以 `/root/.codex/skills/aliyun-sls-query` 的 `SKILL.md`、`assets/env.example`、`scripts/sls_get_logs.py` 作为迁移输入，在 Skill Garden `.common` 中新增 Codex 与 Claude 两份一致的 Skill 资产。
- 规范化文件权限：文档和模板 `0644`，Python 脚本 `0755`；排除 `__pycache__`、`.pyc`、私有 ENV 文件和其它本地状态。
- 保留现有 SLS V1 签名、logstore 查询、metricstore 经验、凭证纪律和故障排查内容，不新增第三方运行时依赖。
- 更新 Skill Garden README，将 `aliyun-sls-query` 标记为 Codex/Claude 双平台可选 common skill。
- 先提交 Skill Garden 源改动，再在 Flower 更新 submodule pin，并通过 `npm run sync` 生成 `enhancements/common` 和 `MANIFEST.json` 快照。
- Flower 继续复用现有 `listSkillCatalog()`、`installCommonSkills()`、`removeCommonSkills()` 和已安装 common skill 刷新逻辑，不新增单 Skill 安装分支。
- 在 Plugin 管理器的 `flower/skill-garden` 入口和兼容命令 `flower-trellis skill` 中显示该 Skill，支持交互启用和停用。
- 新增 Flower catalog 测试，覆盖双平台发现、中文简介、按平台安装、精确停用、已安装刷新和未安装不自动启用。
- 更新 Flower README 的可选通用 Skill 清单；本任务不自动执行 npm 发版。

## Non-Goals

- 不默认安装 `aliyun-sls-query`，不在用户未选择时修改目标项目。
- 不新增 Flower common skill 非交互启用子命令，也不重写 Plugin 管理器或快照协议。
- 不扩展 SLS 写操作、远程凭证管理、Web 页面、日志下载服务或 metricstore 专用可执行工具。
- 不读取、复制、打印或修改用户真实 AK/SK、project、logstore 和 `~/.config/aliyun-sls-query/env`。
- 不执行 `npm run release`、打 tag、push 或发布 npm。

## Key Context

- 集成完成后 Skill Garden `.common` 是源码真源，个人 Codex Skill 目录只作为本次迁移输入。
- Codex 与 Claude 两棵 Skill 目录没有平台特有内容，必须递归保持字节一致。
- 个人源文件当前权限均为 `0777`，不能原样继承；目标权限必须按 Skill Garden 现有 Python Skill 约定规范化。
- Flower 会自动从 `enhancements/common` 发现 common skill；现有 `--skills` 参数不负责非交互启用 common skill，本任务不扩大该命令语义。
- 已安装 common skill 在 Flower update 中以 shared ownership 刷新，未安装的新 Skill 不会被自动铺设。
- 最终来源顺序固定为 Skill Garden 源提交、Flower submodule pin、`npm run sync` 快照、Flower 提交。
- `node scripts/check-snapshot.mjs` 会拒绝 dirty Skill Garden 或未提交的 `enhancements/`，因此属于两仓提交后的最终可追溯性门禁。
- 测试不得访问真实 SLS；Python 校验使用无落盘 AST 解析、`--help` 和本地临时安装目标。

## Acceptance

- Skill Garden 的 Codex/Claude 目录均包含且只包含允许分发的三项资产，内容一致、权限正确、无缓存和真实凭证。
- Skill Garden 独立安装器可按名称只安装 `aliyun-sls-query`，并正确处理 Codex-only、Claude-only 和双平台目标。
- Flower 快照和 `MANIFEST.json` 在两个平台都包含 `aliyun-sls-query`，`sourceCommit` 与已提交 Skill Garden HEAD 一致。
- Flower Skill Garden 管理入口能显示中文用途和正确安装状态，选择后按平台安装，取消后只删除该 Skill。
- Flower update 刷新已安装的旧副本，但不会给未启用项目自动安装。
- 安装、停用、更新和测试过程均不接触用户真实凭证配置，分发脚本保持零第三方运行时依赖。
- Skill Garden 源检查、Flower catalog 测试、`npm test`、双仓 `git diff --check` 和提交后的 snapshot gate 通过。

## Next Step

- 用户确认本 Brief 后运行 `python3 ./.trellis/scripts/task.py start .trellis/tasks/07-31-skill-garden-sls-query`，再进入实现路由；首先修改并验证 Skill Garden 源，提交边界确认后再生成和验证 Flower 快照。
