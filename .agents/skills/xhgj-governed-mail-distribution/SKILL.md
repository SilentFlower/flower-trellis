---
name: xhgj-governed-mail-distribution
description: 管理 AI 起草、审阅、预览和受控投递企业邮件的组织级门禁。用于新发、回复或更新正式邮件，恢复 RFC 邮件线程，冻结发件身份、TO/CC/BCC、主题、正文、附件与载荷指纹，执行离线 preflight、默认 preview 的 SMTP 投递、回执防重和发送后回读；任何 AI 代发正式企业邮件前必须使用。本 Skill 不保存真实地址、正文、附件、凭据或发送回执，也不替代企业邮件交付 Playbook。
---

# XHGJ 受控邮件分发

只管理组织级邮件编排和确定性门禁，不复制邮件执行规范正文，不充当通用邮箱客户端，也不授权任何一次真实发送。

## 执行流程

1. 读取 [references/source-map.md](references/source-map.md)，解析当前唯一有效的企业邮件 Playbook、Skill 迁移状态和工具事实来源。完成当前动作所必需的原始资料不可达、角色冲突或迁移状态无法确认时停止。
2. 判断请求处于草稿态还是正式发送态。起草、润色、线程检索、渲染、preview 和自发自收测试都不构成正式发送授权。
3. 回复或更新邮件时，优先复用当前会话已经留存的 body-free thread record；没有记录时按标题和时间范围开始发现，候选不唯一再补发件人、收件人或附件名。只有可用读取路径耗尽后，才询问是否新建线程。
4. 按 [references/mail-plan-contract.md](references/mail-plan-contract.md) 准备发送计划，运行：

   ```bash
   python scripts/preflight.py --input <mail-plan.json> --json
   ```

5. 使用输出的 `payload_sha256` 冻结同一份计划。正文、附件、线程记录、发件身份、TO/CC/BCC、主题、呈现方式、SMTP 路径或 credential reference 任一变化，都重新生成指纹、preview 和人工 review。
6. 运行 `python scripts/render_mail.py --input <mail-plan.json> --outdir <preview-dir>` 生成预览。短纯文本可使用 `plain + minimal`；结构化材料可使用经测试的 `multipart + reviewed-template`。
7. 向负责人展示完整冻结载荷、preview 结果与载荷指纹。只有负责人明确批准这一版本，并且 preflight 无 error，才进入正式发送态。放行状态在负责人实际表态之后才写入计划，同时记录表态时刻；不得由模板、配置默认值或上一轮残留值预置成已放行。
8. `python scripts/send_mail.py --input <mail-plan.json>` 默认只返回 preview。真实投递必须额外提供 `--execute --receipt-dir <dir>`，并且当前会话已经获得对同一冻结载荷的明确发送授权。
9. 发送后按当前 Playbook 回读已发送目录或实际收件端，核对 RFC `Message-ID`、发件人、TO/CC、主题、线程关系、正文版本和附件。脚本回执不是送达或已读证明。
10. 返回状态不明、回读不一致、存在未处置回执或缺少 RFC `Message-ID` 时停止，不自动更换标识重发，不宣称已发送或已送达。

## 状态边界

- **草稿态**：允许发现线程、生成或修改候选计划、渲染预览和运行离线检查；禁止真实发送。
- **正式发送态**：当前治理来源可达且无冲突，GMD 迁移登记与 activation 已确认，完整载荷通过 preview 和 preflight，负责人明确批准同一 `payload_sha256`，并对本次发送单独授权。
- 正式载荷任一字段或引用文件内容变化后，旧批准立即失效，退回草稿态。
- `contract.yaml.status=incubating` 只表示仓内候选资产，不代表已发布、已安装、已激活或可真实发送。

## 必须停止

- `docs/playbooks/enterprise-mail-delivery.md` 不可达，或 Catalog、Migration Ledger、activation 与当前默认分支事实不一致。
- GMD 迁移尚未登记、目标不是唯一 canonical，或 activation 尚未确认。
- 用户只要求起草、分析、线程查找或预览，没有明确批准当前冻结载荷的真实发送。
- 发件身份、TO/CC/BCC、主题、正文、附件、线程关系、呈现方式、SMTP 路径或 credential reference 未确认。
- 人工 review、preview 与即将发送的 `payload_sha256` 不一致。
- 放行状态无法证明来自本轮 review：批准时刻缺失、落在未来、早于 preview 展示或早于所依据的自测投递，或自测投递与本次发送之间不存在足以支撑真实 review 的时间。
- 回复或更新缺少 `resolved` thread record，候选不唯一，RFC `Message-ID` 缺失，或显式线程字段与记录冲突。
- 收件地址来自猜测、机械扩张历史矩阵或未确认的意外域名；BCC 未给出明确理由。
- 正文、附件或记录将泄漏凭据、内部推理、个人敏感信息、受限原文或接收者无权访问的唯一依据。
- 附件大小或 SHA-256 与冻结值不一致，或正式正文残留测试措辞。
- 运行时 credential reference 缺失；不得把凭据写入计划、命令行、日志或仓库，也不得回退到其它发送链路。
- 同一材料、版本和用途存在 `pending`、`uncertain_or_failed` 或不可读回执；状态查清前禁止重发。
- 被要求使用 DWS 邮件发送命令替代当前 Playbook 规定的正式投递链路。

## 领域与工具路由

- 当前邮件执行规则、人工放行、可信传输、线程恢复原则和最小发送证据只由 `docs/playbooks/enterprise-mail-delivery.md` 解释。
- 本 Skill 只保存 locator、计划契约和确定性实现，不保存真实 SMTP/IMAP 主机、账号、地址、正文、附件、回执或“已配置”事实。
- 邮箱读取、通讯录、已发送目录和实际收件端回读使用当前可用工具及其 help/schema；工具现实与 Playbook 冲突时停止正式发送。
- 钉钉群聊或单聊消息走 `xhgj-dws-message-governance`，不走本 Skill。

## 输出契约

草稿或 review 输出至少说明：当前状态、线程解析结果、发件身份与 TO/CC/BCC、候选主题和正文、附件摘要、载荷 SHA-256、缺失事实、未执行动作，以及进入正式发送态仍需满足的条件。

正式发送完成后只报告：SMTP 接受或拒收结论、RFC `Message-ID`、载荷 SHA-256、发送时间、回执位置、发送后回读结果和未能证明的送达/已读边界。结果不明时输出停止报告，不输出成功结论。

## 个性化边界

- 推荐个性化：称呼、语气、段落顺序和不改变行动义务的表达风格。
- 谨慎个性化：新增意图、模板、读取适配器或确定性门禁时，补充用例并运行 `python scripts/self_check.py` 与声明的 unittest。
- 硬边界：不得放宽当前真源、人工发送授权、载荷指纹、地址可信来源、线程记录、凭据、防重、敏感信息、发送后回读和结果不明停止条件；升级差异不得静默覆盖。

## 自检

```bash
python scripts/self_check.py
python scripts/self_check.py --expect-version <owner-approved-version>
python scripts/self_check.py --compare <installed-skill-directory>
python -m unittest discover -s tests -p "test_*.py" -v
```

`--expect-version` 只证明当前运行目录的版本。能力是否在某个客户端生效，仍以实际安装副本和 discovery、routing、constraints 三层验证证据为准。
