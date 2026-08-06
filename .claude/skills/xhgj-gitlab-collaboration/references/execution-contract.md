# GitLab 协作执行契约

仅在已经确定唯一 Project、对象和用户授权后使用本文件。规则强度与正文以 [source-index.md](source-index.md) 中的 canonical 为准。

## Preflight

1. 回读 `origin`、当前分支、ahead/behind、staged/unstaged/untracked、近期提交和提交姓名/邮箱。
2. 核对 `glab` 显式 host、当前用户、目标 Project、角色与 Group 继承来源。
3. Developer 是发起个人分支、push 和 MR 的权限底线；权限不足时不扩大 token scope、不改权限、不绕过受保护分支。
4. remote 只输出协议、host 形态和项目路径，不回显 userinfo 或完整凭据 URL。公司新 GitLab 的域名形态为推荐入口；已登记的 IP 形态只做识别和分流，不自行修改 remote。
5. 目录与分支不匹配、ahead/behind 异常或存在来源不明修改时保留现场，不切分支、不清理、不改写历史。

## 写入前冻结

1. 按 `docs/playbooks/gitlab-issue-collaboration.md` 的一页最小清单重新读取目标 Issue/MR 的 fields、description、assignee、reviewer、notes、discussion、结构化关系、关联对象、pipeline 和 mergeability；记录读取时间与真实 ID。
2. 冻结目标 Project、动作、对象 IID/ID、期望字段和完整正文。中文正文使用 UTF-8 文件载荷或标准输入，不进入 shell argv。Windows live preflight 由脚本按 UTF-8 显式解码 `glab` 字节输出，不依赖系统 GBK/UTF-8 locale。
3. 文本字段在冻结时只执行 `TrimEnd(CR/LF)`，同时保留原始正文与规范化正文 SHA-256；不得归一化正文内部换行、空白、编码、BOM 或其它字符。
4. 使用 `glab api --input` 发送 JSON 时必须同时提供 `--header "Content-Type: application/json"`。推荐通过标准输入传递冻结 JSON：`glab api --hostname <host> --method <POST|PUT|PATCH> --header "Content-Type: application/json" --input - <endpoint>`。
5. 比较“用户已确认输入”与“将要发送载荷”；不一致时停止，不能以局部关键词或摘要视为等价。
6. Issue Link、Discussion Reply 等关系型动作必须同时冻结两端真实 ID 和关系类型。
7. 正文含跨 Project 引用时，冻结前扫描裸 `!<iid>` / `#<iid>`。这些引用永远在当前 Project 解析——指向本仓对象时有效，指向其它 Project 时静默重定向（同号对象已存在）或降为纯文本（不存在时看不出异常）。跨 Project 引用必须使用 `group/project!<iid>`、`group/project#<iid>` 或完整 URL。判例："`rd-goal` checkpoint Note 用裸 `!3` 指代电商协作仓 MR，实际指向 `rd-goal` 自己的 `MR !3`"本身就是此类问题——当前仓已有的同号对象会接管引用。
8. 含跨 Project 引用的正文，全文 round-trip 通过后还须渲染回读。提交已写入内容的 markdown 渲染，带目标 `project` 参数，逐条核对链接的实际 Project 与期望目标是否一致。全文一致不能证明链接指向正确——这是两层独立性不同的检查。盲区包括 Note 头「覆盖」字段、章节标题和引用他人原文的引号内。

## 确定性操作证据

以下三类动作在写入或报告成功前，必须把非敏感事实冻结为 UTF-8 JSON，并运行：

```bash
python scripts/self_check.py --evidence <operation-evidence.json>
```

证据文件使用 `schema_version: 1` 和非空 `checks` 数组；每项包含唯一 `id`、`kind` 与 `input`。仓内正向样例见 `tests/fixtures/operation-evidence-v0.3.0.json`。

- `cross-project-references`：冻结当前 Project、完整正文、已确认属于当前 Project 的裸引用 allowlist，以及 GitLab Markdown 渲染回读得到的 `locator -> 实际目标 Project`。未确认的裸 `!<iid>` / `#<iid>`、缺少渲染目标或实际 Project 不一致均 fail closed。代码块和行内代码不参与 GitLab 引用解析，检查器同样忽略。
- `merge-gate`：冻结是否以 CI 作为准入证据、流水线内容是否经 review 判定为足够、项目设置是否已回读、`only_allow_merge_if_pipeline_succeeds` 实际值与替代验收证据。以 CI 作为门禁时，内容可信、设置已回读且值为 `true` 三项缺一即失败；不使用 CI 时必须登记非空替代证据。
- `merge-result`：冻结项目 `squash_option`、MR `squash`、预期合并方式、比较是否完成，以及合并后的 `squash_commit_sha` 回读。项目强制选项与预期冲突、MR 字段与预期不一致、已合并但未回读或 SHA 有无与预期不一致均失败。

机器检查不替人判断“流水线覆盖内容是否足够”或“替代证据是否有业务说服力”，只强制这些判断显式形成输入，并机械核对平台设置、引用目标和合并结果之间的一致性。无法作出内容充分性判断时，`pipeline_content_trusted` 必须为 `false`，转入替代验收或人工 review，不能为了通过检查填写 `true`。

## 允许的 v0.3 动作

- Issue 创建或更新；不关闭。
- 顶层 Note 创建。
- 已存在 Discussion 的 Reply 创建。
- 已确认两端对象的 Issue Link 创建。
- MR 创建或更新、reviewer 设置，以及 pipeline 和 mergeability 的只读回读；不合并。
- 本人已确认的 issue 工时写入，只经 GraphQL `timelogCreate`；见下节。

每个动作均须从响应取得真实对象 ID/IID/URL，再按该 ID 回读完整字段。GitLab Note、description 等文本字段仅允许双方都执行 `TrimEnd(CR/LF)` 后进行全文比较；规范化 hash 一致且仅原始 hash 不同时，记录为 GitLab 尾换行规范化，不误判为内容漂移。其它任一差异继续 fail closed。创建 MR 时显式 source/target，默认关闭 squash 和 auto-merge。写后结果不一致或回读失败时不重发。

reviewer 与 assignee 必须分别处理：请求 MR review 时设置 reviewer；只有用户明确要求某人承接任务时才设置 assignee。不为通知、抄送或“可能会处理”设置 assignee，也不用 assignee 代替 reviewer。写后分别回读两个真实字段，任一不一致都不能报告整组设置成功。

## Commit 与 MR 本地契约

- commit 前核对本人真实姓名、企业邮箱和 diff，只提交明确路径。
- commit subject 与 MR title 使用 `[TAG] 中文一句话`；AI 参与的 trailer 按 `docs/standards/ai-generated-content-signature.md` §3.1 执行。
- 已 push 或已创建 MR 后使用增量 commit；没有本人明确授权时不 amend、不 force push。
- MR description 至少覆盖背景、改动、验证、风险与关联 Issue。关闭 squash 和 auto-merge；合并权归人。
- 创建 MR 前检查目标项目的 `only_allow_merge_if_pipeline_succeeds`：项目未开启该设置时，仅"这次流水线成功了"不构成可信准入门禁——有权限的人仍能合入流水线失败或缺失的 MR。项目没有 CI 或流水线校验不充分时，必须显式登记替代验收证据。
- 合并前确认合并方式与项目级 `squash_option` 一致；只看 MR 页面勾选状态不足以判断实际行为。合并后回读 `squash_commit_sha` 为空/非空与期望对比，不一致时记录差异但不改写已合入主干。

## 提交内容适配性检查

强度 `better`：本节是推荐默认值，命中时提示并要求本人显式选择，**不 fail closed，不阻断提交**。canonical 为 `docs/playbooks/gitlab-collaboration-onboarding.md` §4，本节只给执行侧动作，不复制正文。

commit 前对将提交的路径做一次轻量检查，命中任一项时先向本人说明再继续：

| 检查面 | 提示要点 |
| --- | --- |
| 凭据形态 | 待提交内容出现疑似账号密码、连接串、token 或密钥形态时，提示"进入历史即视为泄露，需走凭据轮换而非删文件"，请本人确认后再提交 |
| 大文件与二进制 | 单文件超过约 1 MB，或后缀属 office 文档、图片包、压缩包、可执行文件时，提示 §4.4 的三条替代路径（`.gitignore` 目录 / 本机固定位置加薄指针 / 已有云盘介质），请本人确认是否仍要入仓 |
| 疑似业务数据导出 | 文件名或内容呈现名单、订单、联系方式等批量真实数据特征时，提示受众边界问题并请本人确认 |

三条约束：

- **只提示，不代替判断。** 本人选择继续提交时按原计划执行，并在会话中留下该次显式选择的记录。
- **不做内容级安全扫描。** 本检查是低成本形态判断，不承诺覆盖对抗性绕过、编码变体或压缩包内部；仓库级敏感信息扫描的根治方案见 rd-guide #5，在其 active 前本检查不得被表述为安全门禁。
- **不适用于人在 Web 界面直接上传的场景。** AI 未参与的提交路径不经过本检查，该缺口由 §4 的人读规则覆盖。

## 工时录入

触发时点、链路选择、估算口径与授权只读取 `docs/standards/work-hour-recording.md`、`docs/architecture/session-closure-behavior-baseline.md` 和 checkpoint 模板。`rd-guide #6 note 18234` 的 `record_worktime` 自 v0.2.0 起为正式动作，写入通道固定为 GraphQL `timelogCreate`：

1. 写前回读目标 Project、Issue、当前用户、阶段 locator、已有 Note 与既有 timelog；用 `Query.timelogs(startDate, endDate, username, projectId, groupId)` 按人、日期、时长和阶段 locator 查重。已记录在其它台账、归属不唯一、多 issue 分摊未确认或 canonical 不可达时 fail closed。
2. 冻结并展示目标 Issue、`timeSpent`、`spentAt`、完整 `summary` 和将要发送的 mutation 载荷，取得本人明确确认。**冻结展示前先完成第 3 条的 `summary` 长度预检**，不让本人确认一份注定被平台拒绝的载荷。提醒不等于授权，未确认不写入任何 timelog。
3. `summary` 必须同时保留 AI 估算初值、本人确认值和不一致时的校准原因。中文 `summary` 走 UTF-8 文件载荷，不进 shell argv。`summary` 上限 **255 字符**，超出时 `timelogCreate` 返回 `errors: ["概览过长（最长为255个字符）"]`，mutation 失败且不产生 timelog；写不下时 `summary` 保留结论性表述，展开材料放 issue 评论并在 `summary` 内指向。该上限只作用于本路径，但不得以「`/spend` 把说明留在 note 正文、不受此限」为由改走 quick action——本节只允许 `timelogCreate`。
4. 只允许 `timelogCreate` 一个写入动作。不发送 `/spend`、`/remove_time_spent` 或任何其它 quick action；将要写入的任何正文出现行首 slash 时停止，不做剥离后重试。
5. 写后三面回读一致才报告成功：mutation 回声的真实 Timelog GID、REST `GET /projects/:id/issues/:iid/time_stats`、GraphQL `Issue.timelogs` 的 `timeSpent`/`spentAt`/`summary`/`user`。GitLab REST 没有 timelog 列举端点，不把该路由的 404 当作环境故障。
6. 结果不明、回读失败或三面不一致时保留现场并交本人裁决，不自动重发。纠正误录只用 `timelogDelete` 单删后重录，不用 `/remove_time_spent` 或 REST `reset_spent_time` 整体清空。
