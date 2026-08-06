# 邮件发送计划机器契约

`scripts/preflight.py` 接收 UTF-8 JSON。它只验证可确定门禁、计算冻结载荷指纹，不读取仓库中的真实邮件实例，也不执行 SMTP、IMAP、POP3、DWS 或发送后回读。

## 使用顺序

1. 准备计划。`human_review` 与 `preview` 从未放行态起步：`approved` / `reviewed` 为 `false`，`approved_at` / `reviewed_at` 为 `null`，两个 `payload_sha256` 留空。这些字段不得由模板、配置默认值或上一轮残留值预置成已放行。
2. 运行 `python scripts/preflight.py --input <mail-plan.json> --json`，取得输出中的 `payload_sha256`。此时因尚未 review，返回 blocked 是预期行为。
3. 使用同一计划运行 `render_mail.py`，核对发件身份、TO/CC/BCC、主题、正文、附件、线程和呈现方式。
4. 展示完整冻结载荷之后，把同一个 SHA-256 写入 `preview.payload_sha256`，并把展示当刻的时间写入 `preview.reviewed_at`。
5. 负责人实际表态之后，才写入 `human_review.payload_sha256`、`approved: true` 和表态当刻的 `human_review.approved_at`；负责人未表态时保持未放行态，不先写通过再等人否决。`selftest-mail` 形式还需在负责人看过自测邮件之后写入 `selftest_evidence.reviewed_at`。
6. 重跑 preflight。只有 `status=pass` 才具备进入一次正式发送的机器前置条件；它仍不替代当前会话对同一冻结载荷的明确发送授权。
7. 真实发送前先运行 `send_mail.py` 默认 preview；只有当前会话再次确认后才使用 `--execute --receipt-dir <dir>`。

## 最小结构

```json
{
  "schema_version": "2.0",
  "plan_state": "send-ready",
  "purpose": "formal",
  "intent": "formal-delivery",
  "governance": {
    "playbook_locator": "docs/playbooks/enterprise-mail-delivery.md",
    "current_source_verified": true,
    "required_source_accessible": true,
    "conflict_detected": false,
    "migration_registered": true,
    "target_canonical": true,
    "activation_confirmed": true
  },
  "thread": {
    "kind": "new",
    "record_path": null,
    "in_reply_to": null,
    "references": []
  },
  "communication": {
    "addressing": {
      "selected": "已确认称呼",
      "source": "user-explicit",
      "previous": null,
      "override_reason": null
    }
  },
  "presentation": {
    "body_mode": "multipart",
    "style_strategy": "reviewed-template",
    "template_id": "governed-mail-v1"
  },
  "mail": {
    "from": "sender@example.invalid",
    "to": ["recipient-a@example.invalid"],
    "cc": [],
    "bcc": [],
    "subject": "[EXAMPLE v0.1] 示例材料交付",
    "material_id": "example-asset",
    "version": "v0.1",
    "body_markdown": "body.md",
    "footer_note": "示例 footer"
  },
  "attachments": [
    {"path": "example.bin", "size": 16, "sha256": "<发送前实测的 64 位摘要>"}
  ],
  "recipients_review": {
    "frozen_by_owner": true,
    "roles_confirmed": true,
    "unexpected_domain_confirmed": true,
    "bcc_justified": false
  },
  "transport": {
    "protocol": "smtp-ssl",
    "host": "smtp.example.invalid",
    "port": 465
  },
  "credentials": {
    "provider": "env",
    "account_ref": "EXAMPLE_MAIL_ACCOUNT",
    "token_ref": "EXAMPLE_MAIL_TOKEN"
  },
  "human_review": {
    "approved": false,
    "approved_at": null,
    "reviewer": "负责人",
    "review_form": "offline-preview",
    "payload_sha256": ""
  },
  "preview": {
    "reviewed": false,
    "reviewed_at": null,
    "payload_sha256": ""
  },
  "explicit_send_authorization": true,
  "final_payload_frozen": true,
  "internal_notes_removed": true
}
```

真实地址、正文、附件、线程记录、凭据值、发送回执和本机绝对路径只存在于任务运行目录，不进入 Skill、测试 fixture、MR、Issue 或其它仓库材料。

## 线程记录

- `thread.kind` 只允许 `new`、`reply`、`update`。
- `reply` 或 `update` 必须引用 `status=resolved` 的 `thread.record_path`；记录只保存 RFC 线程最小元数据，不保存正文或凭据。
- 记录可以来自当前会话复用、IMAP、POP3、DWS 只读结果、EML 或 JSON。DWS 内部 `messageId` 不能替代 RFC `Message-ID`。
- 候选不唯一时记录为 `ambiguous`，只展示最小元数据供负责人选择；不得在选择前进入发送态。

## 呈现与 review

- `plain + minimal + template_id=null` 用于短、低结构正文。
- `multipart + reviewed-template + governed-mail-v1` 用于结构化材料。
- `human_review.review_form` 只允许 `selftest-mail`、`offline-preview`、`inline-summary`。
- `selftest-mail` 仍是真实邮件动作，只能发送给发件人自己，并需要单独授权；其回执证据必须与当前冻结载荷一致。

## 放行门禁

preflight 在载荷绑定之后运行放行门禁，判断放行状态**能否**由本轮 review 产生。时间戳不能证明是谁写下这个值，因此本门禁是必要条件而非充分条件：它只排除不可能来自本轮 review 的放行状态，不替代负责人本人表态。

- `preview.reviewed_at`、`human_review.approved_at` 必须是带显式 UTC 偏移的 ISO-8601 时刻，缺失、无偏移或落在未来均阻止发送。
- `approved_at` 不得早于 `reviewed_at`：批准是展示之后的独立动作。
- `review_form=selftest-mail` 时另取自测回执里由 `send_mail.py` 写入的 `sent_at` 作为机器基准：`selftest_evidence.reviewed_at` 与 `human_review.approved_at` 都不得早于它，否则该放行状态属于上一轮残留；`approved_at` 与 `sent_at` 之间不足 300 秒时按停止条件处理，要求负责人重新确认。
- 其它 review 形式没有机器基准，只在批准紧跟展示时给出警告，由负责人判断该 review 时间是否真实。

## 指纹与防重

`payload_sha256` 覆盖治理状态、邮件意图、线程记录摘要、称呼、呈现方式、发件身份、TO/CC/BCC、主题、正文 SHA-256、附件名称/大小/SHA-256、SMTP 路径、credential reference、受众 review 和 review 形式。它不包含凭据值，也不把正文或附件内容写入输出。

每次执行发送前按 `material_id + version + purpose` 检查回执：

- `pending`、`uncertain_or_failed` 或不可读回执阻止发送；先查清状态并显式留痕。
- 已有 `sent` 回执时，只有负责人明确批准补发并使用 `--resend-authorized` 才允许再次发送。
- 结果不明时不得通过更换路径、标识或 UUID 自动重发。

## credential reference

计划只声明环境变量名，脚本只在 `--execute` 路径读取运行时值。变量缺失时停止，不打印值、不写文件、不回退到其它发送链路。不同环境可以使用不同变量名；真实主机和“已配置”事实由当前 Playbook 与运行环境解释，不在 Skill 中固化。
