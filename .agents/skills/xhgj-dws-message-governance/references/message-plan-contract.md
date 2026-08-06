# 发送计划机器契约

`scripts/preflight.py` 接收 UTF-8 JSON。它只验证可确定门禁，不执行 DWS 命令，也不替负责人作发送决定。

## 使用顺序

1. 先填写计划，`human_review.payload_sha256` 与 `dry_run.payload_sha256` 暂留空。
2. 运行 `python scripts/preflight.py --input <plan.json> --json`，取得输出中的 `payload_sha256`。此时因尚未 review，返回 error 是预期行为。
3. 使用同一载荷执行 DWS dry-run，核对目标、内容、消息类型和提醒参数。
4. 将同一个 SHA-256 写入 `dry_run.payload_sha256`，向负责人展示完整载荷并取得明确批准，再写入 `human_review.payload_sha256`。
5. 重跑 preflight。只有 `status=pass` 才具备进入一次正式发送的机器前置条件；它仍不替代当前会话中的明确发送授权。

普通正式发送使用 `message_state=send-ready`。某个 DWS 版本尚无具名提醒受控接收端证据时，首次测试必须改用独立的 `message_state=mention-bootstrap-ready` 与 `message_profile=mention-bootstrap`；不得给普通计划增加例外开关，也不得把测试授权写入普通发送的完成证据字段。

## 最小结构

```json
{
  "schema_version": 1,
  "message_state": "send-ready",
  "governance": {
    "standard_locator": "docs/standards/dingtalk-message-governance.md",
    "playbook_locator": "docs/playbooks/dws-message-delivery.md",
    "current_source_verified": true,
    "required_source_accessible": true,
    "conflict_detected": false
  },
  "dws_runtime": {
    "installed": true,
    "authenticated": true,
    "organization_confirmed": true,
    "version": "<current-version>",
    "commands_rechecked": true
  },
  "target": {
    "type": "group",
    "identifier": "<reviewed-target-id>",
    "confirmed": true
  },
  "recipients": {
    "to": [],
    "cc": [],
    "fyi": [{"label": "群内成员"}],
    "all_members_role": "none"
  },
  "message_profile": "notification",
  "profile_contract": {
    "change": "发生了什么",
    "impact": "影响范围",
    "action_requirement": "无需行动，仅知会"
  },
  "recipient_review": {
    "need_is_clear": true,
    "action_is_clear": true,
    "mobile_readable": true,
    "references_accessible": true,
    "sensitive_content_removed": true
  },
  "title": "通知标题",
  "message_type": "text",
  "text": "正文",
  "payload_ref": "",
  "ai_tag": true,
  "uuid": "stable-uuid",
  "explicit_send_authorization": true,
  "human_review": {
    "approved": true,
    "reviewer": "负责人",
    "payload_sha256": "<preflight-output>"
  },
  "dry_run": {
    "reviewed": true,
    "payload_sha256": "<preflight-output>"
  },
  "final_payload_frozen": true,
  "internal_notes_removed": true,
  "at_all": false,
  "at_open_dingtalk_ids": [],
  "mention_verification": {},
  "requires_response": false,
  "response": {},
  "transport": "single-line",
  "post_send_readback": {
    "planned": true,
    "method": "chat message list",
    "non_first_line_check": false
  }
}
```

真实目标、人员 ID、消息正文和附件路径只放任务临时计划，不进入 Skill、测试 fixture、MR 或 Issue。发送结束后按数据保留边界处理临时计划；本 Skill 不自动删除文件。

## 首次具名提醒 bootstrap

bootstrap 继续使用上面的根结构，但只允许以下组合：

- `message_state` 为 `mention-bootstrap-ready`；
- `message_profile` 为 `mention-bootstrap`；
- `target.type` 为 `group`，`at_all=false`，至少有一名具名 TO/CC；
- `mention_verification={}`，普通发送的 `controlled_recipient_test_confirmed` 与 `evidence_locator` 不得出现；
- `message_type=text` 且 `payload_ref` 为空；正文必须以 `【具名提醒受控测试】` 开头；
- `profile_contract` 必须精确包含以下字段：

```json
{
  "test_purpose": "named-mention-rendering",
  "authorization_locator": "<请求人授权 locator>",
  "test_recipient_open_dingtalk_ids": ["<参与测试的接收者 ID>"],
  "participants_confirmed": true,
  "minimum_disclosure_confirmed": true,
  "business_action_present": false,
  "pre_send_duplicate_check_completed": true,
  "duplicate_check_locator": "<按 UUID 查重证据>",
  "evidence_output_locator": "<结构化证据保存位置>",
  "recipient_delivery_confirmation_planned": true
}
```

`test_recipient_open_dingtalk_ids` 必须与 TO/CC、`at_open_dingtalk_ids` 和正文 `<@id>` 精确相等。缺授权、查重、回读计划、参与者确认、最小披露或证据输出位置，包含真实业务动作，提醒非测试成员，使用全员提醒，或正文未明确标记测试时，preflight 必须报错停止。

bootstrap 计划通过后，输出中包含 `bootstrap_evidence_template`。真实测试结束后另建结果 JSON，并运行：

```bash
python scripts/preflight.py \
  --input <bootstrap-plan.json> \
  --bootstrap-result <bootstrap-result.json> \
  --json
```

结果 JSON 的字段为：

```json
{
  "schema_version": 1,
  "message_id": "<真实消息 ID>",
  "sent_at": "<带时区的 ISO-8601 时间>",
  "technical_readback": {
    "status": "passed",
    "locator": "<发送侧回读证据>",
    "rendered_open_dingtalk_ids": ["<参与测试的接收者 ID>"]
  },
  "recipient_delivery_confirmation": {
    "status": "pending 或 confirmed",
    "locator": "<confirmed 时必填的接收者确认 locator>"
  }
}
```

输出 `bootstrap_evidence` 分别保留：

- `authorization`：测试已授权，只由请求人授权 locator 证明；
- `technical_readback`：具名提醒已正确渲染，只由发送侧回读证明；
- `recipient_delivery_confirmation`：红点/推送已确认，只由接收者确认 locator 证明。

只有接收端状态为 `confirmed` 且 locator 非空时，`eligible_for_ordinary_send` 才为 `true`。技术回读通过但接收端状态仍为 `pending` 时，结构化证据必须保持不可用于普通发送。
