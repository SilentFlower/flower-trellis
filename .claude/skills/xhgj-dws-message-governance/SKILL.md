---
name: xhgj-dws-message-governance
description: 管理 AI 通过 DWS 起草、审阅、预览、正式发送和回读钉钉群聊或单聊消息的组织级门禁。用于处理文本、图片或文件消息，判断草稿态与正式发送态、TO/CC/FYI、具名或全员提醒、载荷冻结、人工授权、幂等、防重复、Windows 多行传输、Markdown 可读性和结果不明时的停止；任何 AI 代发 DWS 消息前必须使用。本 Skill 不提供具体业务群或人员 ID，也不替代通用 dws 产品能力 Skill。
---

# XHGJ DWS 消息治理

只管理组织级消息治理和发送门禁，不复制消息规范正文，不充当 DWS 命令手册，也不授权任何一次真实发送。

## 执行流程

1. 读取 [references/source-map.md](references/source-map.md)，解析当前唯一有效的消息治理 Standard、DWS Playbook 和工具事实来源。当前真源不可达、角色冲突或状态无法确认时停止。
2. 判断请求处于草稿态还是正式发送态。起草、润色、分析、预览和 dry-run 都不构成真实发送授权。
3. 按当前 Standard 起草接收者可执行的消息，显式区分 TO、CC、FYI；具体命令、flag 和字段读取当前 DWS CLI help/schema 或通用 `dws` Skill。
4. 按 [references/message-plan-contract.md](references/message-plan-contract.md) 冻结发送计划，并运行：

   ```bash
   python scripts/preflight.py --input <message-plan.json> --json
   ```

5. 使用当前 DWS CLI 执行 dry-run。目标、标题、正文、类型、提醒、附件引用或 UUID 任一变化，都重新计算载荷 SHA-256、重新 dry-run 并重新 review。
6. 向负责人展示最终目标、TO/CC/FYI、标题、正文、附件、提醒参数、UUID、dry-run 结果和载荷 SHA-256。只有负责人明确批准这一完整冻结版本，才进入正式发送态。
7. 正式发送只执行一次。发送后按当前 Playbook 回读真实消息 ID、目标、标题、正文关键段、非首行内容、文件、AI 角标和具名提及。
8. 结果不明、回读不一致或没有真实消息 ID 时停止，不更换 UUID 自动重发，不宣称已通知或已送达。

## 状态边界

- **草稿态**：允许生成、比较和修改候选内容；禁止真实发送。
- **正式发送态**：当前治理来源可达且无冲突，DWS 版本/help/schema 已复核，完整载荷已 dry-run，载荷指纹一致，负责人明确批准，preflight 无 error。
- 正式载荷变更后，旧批准立即失效，退回草稿态。

## 必须停止

- 当前 canonical、required source 或 DWS help/schema 不可达，或同一范围出现双 canonical / authority 冲突。
- 用户只要求起草、分析或预览，或者没有明确授权当前冻结载荷的真实发送。
- 目标会话、人员标识、TO/CC/FYI、标题、正文、附件、提醒参数或 UUID 未确认。
- 人工 review、dry-run 和即将发送的载荷 SHA-256 不一致。
- 具名 TO/CC 没有同时对应发送计划、提醒参数和正文 `<@id>`。
- 全员提醒正文手写 `@所有人`、`@all` 或 `<@all>`，或 `--text` 内容以 `@` 开头。
- Windows 多行正文使用未验证的 `.cmd` shim，或没有安排非首行回读。
- Markdown 结构存在当前 Playbook 已确认的高置信渲染风险。
- 凭据、个人敏感信息、受限原文或接收者无权访问的唯一依据将进入消息或附件。
- 发送返回不明确、缺少真实消息 ID、回读不一致或无法排除重复发送。

## 领域与工具路由

- 本 Skill 不保存具体群 ID、人员 ID、业务模板、RCA 参数或事件事实。领域数据必须由相应 owner 或可访问来源明确提供。
- 命令路径、flag、认证、通讯录、群聊、云盘和消息查询能力由通用 `dws` Skill / 当前 CLI help/schema 提供。
- 当前 Standard 与工具现实冲突时停止真实发送，保留版本和 dry-run 证据，路由到 source-map 登记的 feedback 入口；不在本 Skill 内建立第二套规范。

## 输出契约

草稿或 review 输出至少说明：当前状态、目标与接收者角色、候选载荷、缺失事实、未执行动作和进入正式发送态还需满足的条件。

正式发送完成后只报告：目标、真实消息 ID、载荷 SHA-256、发送时间、回读核对项、未能证明的送达/已读边界。结果不明时改用停止报告，不输出成功结论。

## 个性化边界

- 推荐个性化：语气、段落顺序和不改变行动义务的表达风格。
- 谨慎个性化：新增 profile 或确定性检查时，补充用例并运行 `python scripts/self_check.py` 与声明的 unittest。
- 硬边界：不得放宽当前真源、人工发送授权、载荷指纹、TO/CC 提醒、防重、敏感信息、回读和结果不明停止条件；升级差异不得静默覆盖。

## 自检

```bash
python scripts/self_check.py
python scripts/self_check.py --expect-version <owner-approved-version>
python scripts/self_check.py --compare <installed-skill-directory>
python -m unittest discover -s tests -p "test_*.py" -v
```

`--expect-version` 只证明当前运行目录的版本。能力是否在某个客户端生效，仍以该客户端实际发现的安装副本和三层验证证据为准。
