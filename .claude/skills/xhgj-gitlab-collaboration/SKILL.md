---
name: xhgj-gitlab-collaboration
description: 以本人身份在公司 GitLab 上执行受控协作，覆盖无秘密材料的工作站 preflight、Issue/Note/Discussion/MR 的结构化创建或更新、本人确认后的工时写入、中文 UTF-8 冻结载荷、真实对象 ID 与全文回读、pipeline 和 mergeability 查询，以及身份、权限、分支工作面和写后结果异常的 fail-closed 处理。用于用户要求检查 glab/项目权限/remote/提交身份，或代为处理 GitLab Issue、Note、Discussion Reply、Issue Link、MR 创建更新与状态回读、以及本人已确认的 issue 工时录入的场景；不用于 token 生成或传递、Group/Project/成员权限管理、删除关闭、merge/auto-merge，工时写入只经 GraphQL timelogCreate，不透传 /spend 或任何其它 quick action。
---

# XHGJ GitLab 协作

只执行低影响、可全文回读的 GitLab 协作动作。本人承担账号责任和最终决定；本 Skill 不接管规则裁决、权限管理或 MR 合并权。

## 执行流程

1. 明确唯一目标 Project、对象类型、动作、期望结果和当前台账；目标不唯一时停止。
2. 读取目标仓的 `AGENTS.md`、`CLAUDE.md`、README 和当前任务需要的现行规则。按 [references/source-index.md](references/source-index.md) 选择最小 canonical locator，不把 references 当作第二真源。
3. 涉及工作站或本地仓库时，先运行离线自检；需要真实环境检查时，再使用带明确预期身份和目标项目的 live preflight：

   ```bash
   python scripts/self_check.py --live \
     --project <group/project> \
     --repo <repository-directory> \
     --expected-username <gitlab-username> \
     --expected-name <git-user-name> \
     --expected-email <git-user-email>
   ```

   live preflight 只输出选择后的非敏感事实，不转发 `glab` 原始认证输出，不读取 token 值。
4. 写入前重新读取最新 description、notes、discussion、关联状态和本地 git 状态；上下文过期、目录与分支不匹配或存在来源不明修改时保留现场并停止。正文含跨 Project 引用时，扫描是否存在裸 `!<iid>` / `#<iid>`——GitLab 永远在当前 Project 解析这些引用，指向其它 Project 时会被静默重定向。
5. 按 [references/execution-contract.md](references/execution-contract.md) 冻结结构化载荷。中文正文写入 UTF-8 临时文件或通过标准输入传递，不放进 PowerShell/Git Bash argv；`glab api --input` 必须显式声明 JSON content type，GitLab 文本字段回读只允许裁剪末尾 CR/LF 后比较。正文含 Project 引用、使用流水线作为 MR 准入证据或回读已合并 MR 时，还必须冻结操作证据 JSON，并运行 `python scripts/self_check.py --evidence <evidence.json>`；未通过不得写入或报告成功。
6. 只执行用户已授权的 Issue、顶层 Note、Discussion Reply、Issue Link、MR 创建/更新，或本人已确认的工时写入动作。MR 必须显式 source/target，默认关闭 squash 和 auto-merge；创建前检查目标项目 `only_allow_merge_if_pipeline_succeeds` 状态——项目设置未开启时，仅流水线成功不构成准入门禁。本 Skill 只回读 pipeline 与 mergeability，不执行 merge；但合并前须确认合并方式与项目设置一致，合并后须回读实际结果（`squash_commit_sha` 是否为空）。
7. 从写入响应取得真实 Project ID、IID、Note ID 或 Discussion ID，再按真实 ID 全文回读。载荷、对象、字段或关联关系任一不一致时，不报告成功、不自动重发。含跨 Project 引用的正文在全文回读后还须渲染回读：用 GitLab markdown 渲染接口带目标 `project` 参数，逐条核对链接的实际 Project——全文 round-trip 只能证明文本一致，不能证明链接指向正确。
8. 输出最小完成证据；遇故障时按 [references/troubleshooting.md](references/troubleshooting.md) 停止并给出可重试入口。

## 硬边界

- 不请求、读取、输出、记录或转发 PAT、OAuth token、cookie、credential helper 秘密材料；不得把凭据拼入 remote URL、命令参数、日志或临时文件。
- 不创建 Group/Project，不新增或修改成员、角色、权限和受保护分支，不删除或关闭对象，不执行 merge、auto-merge 或历史改写。
- 不把 ticket-ops 的 RCA 状态机、群 ID 或专用模板迁入公共流程。
- `record_worktime` 只经 GraphQL `timelogCreate` 写入，且必须先取得本人对时长、归属日期和 `summary` 的明确确认；提醒与草案都不构成授权。不发送 `/spend`、`/remove_time_spent` 或任何其它 quick action，将要写入的正文出现行首 slash 时停止，不做剥离后重试。
- required source 不可达、身份或权限不足、目标归属不唯一、上下文过期、载荷不一致或写后不可回读时 fail closed。含跨 Project 引用时，裸 `!<iid>` / `#<iid>` 指向其它 Project、渲染回读发现链接目标 Project 错误，同样 fail closed。

## 输出契约

成功时只保留：目标 locator、执行动作、真实对象 ID/URL、字段回读、pipeline/mergeability（适用时）、未执行的高影响动作。

失败时使用以下五段，不粘贴可能含秘密材料的原始认证输出：

```markdown
当前目标：<Project + 对象 + 动作>

已确认事实：<非敏感身份、权限、分支、对象状态与 locator>

停止条件：<确定性失败条件>

未执行动作：<写入、重发、高影响动作或清理>

下一步：<需要本人、Maintainer 或 Group Owner 确认的最小动作与重试入口>
```

## 个性化边界

- 推荐个性化：调整输出语言、项目常用 locator 和低影响字段默认值。
- 谨慎个性化：增加新的写入对象或 Git remote 形态前，补测试并运行 live preflight；不得把历史命令清单直接提升为现行动作。
- 硬边界：不得放宽凭据、身份、权限、source/target、全文回读、MR 人工合并和高影响动作限制。升级前运行 `python scripts/self_check.py --compare <installed-skill-directory>`；发现差异后停止并要求显式选择，不静默覆盖。

## 自检

在 Skill 目录运行：

```bash
python scripts/self_check.py
python -m unittest discover -s tests
python scripts/self_check.py --evidence <operation-evidence.json>
```

默认自检和 `--evidence` 门禁离线运行，不需要网络、凭据或第三方依赖。`--live` 是显式、只读的工作站检查，不是认证配置或写入动作。操作证据只允许记录非敏感回读事实；格式与人工判断边界见 [references/execution-contract.md](references/execution-contract.md)。

真实使用 JSON 变化后运行 `python scripts/render_real_usage.py` 更新人读投影；投影不得手工修改。
