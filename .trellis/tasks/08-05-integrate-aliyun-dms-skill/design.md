# 技术设计：集成阿里云 DMS Skill

## Architecture

分发链路保持现有 common Skill 模型：

```text
Claude 会话产物
  -> vendor/skill-garden/.common/{.claude,.codex}/skills/aliyun-dms-query
  -> npm run sync
  -> enhancements/common/.common/{.claude,.codex}/skills/aliyun-dms-query
  -> flower-trellis common Skill catalog
  -> 目标项目 .claude/skills 或 .codex/skills
```

不修改安装器或 catalog 逻辑。两者已经通过目录枚举自动发现 common Skill，新增目录和快照清单即可接入。

## Source Fidelity

- `scripts/dms.py` 与 `assets/env.example` 以会话产物为基线，不改 DMS API 行为。
- `SKILL.md` 保留已验证的安全模型、命令、排错经验和凭证纪律。
- 唯一必要的平台归一化是把 `S=~/.claude/skills/.../dms.py` 改成从当前 Skill
  目录执行 `python3 scripts/dms.py ...`，避免 Codex 文档指向不存在的 Claude 路径。
- Claude 与 Codex 的核心三文件保持逐字节一致。沿用 `aliyun-sls-query` 的双副本模型，
  本轮不额外引入仅 Codex 使用的 `agents/openai.yaml`，避免源 Skill 出现无需求的平台分叉。

## Safety Boundary

- `query` 只允许 `SELECT/SHOW/DESC/DESCRIBE/EXPLAIN/WITH` 入口；其余语句在本地返回退出码 `2`。
- 服务端仍是最终安全边界，DML 只能通过 `CreateDataCorrectOrder`。
- `order` 默认仅预览；`--yes` 是创建真实工单的显式确认。
- 测试使用假的 AK/SK 和显式 `--tid`，只覆盖本地分支，不发网络请求。
- 不把用户已有 `~/.config/aliyun-dms-query/env` 或 SLS ENV 文件复制进仓库/快照。

## Snapshot And Repository Ordering

skill-garden 是 Git 子模块，Flower 快照 manifest 记录子模块 `HEAD`。为保证溯源正确：

1. 先完成并验证 `vendor/skill-garden` 源改动。
2. 在提交阶段先提交 skill-garden 子仓。
3. 回到父仓运行 `npm run sync`，让 `sourceCommit` 指向新的子仓提交。
4. 再验证并提交 Flower 快照、父仓 README、测试与 submodule pin。

实现阶段可先生成工作快照跑测试，但最终提交前必须按上述顺序重跑同步。

## Test Design

- Skill 结构：断言源与快照都有预期文件、核心资产一致、脚本为 `755`。
- 凭证：断言 ENV 模板为空且无 AK 模式；目录中无缓存/字节码。
- Skill 元数据：断言 frontmatter、相对脚本调用和 DMS 安全关键字存在。
- CLI 本地行为：执行 `--help`、DML 查询拒绝、工单预览，禁止使用 `--yes`。
- Flower 集成：断言 manifest 登记、catalog 可发现、Claude/Codex 双平台安装正确。
- 全量回归：运行 `npm test`；因未修改 Patch catalog，无需刷新 compiled targets。

## Rollback

删除新增的两份 skill-garden 源目录、README 条目和 DMS 聚焦测试，再运行 `npm run sync`。
同步器会把消失的 Skill 名称写入 common `removedSkills` tombstone，使已安装旧版本可被精确清理。
