# xhgj-dws-message-governance 真实使用证据

> 由 JSON 生成，请勿手工编辑。
> 机器 canonical：`tests/fixtures/real-usage.json`
> 规范化内容 SHA-256：`8038e8ab385c88c8844d419f6be56034d092c3e5ce541ffc56c3ee95ca27d990`

## 元数据

- Skill 版本：`0.2.0`
- 客户端：ChatGPT Codex controlled forward-test; session 019fc69b-9e8c-76c2-8725-0012176e5fc9
- 环境：Repository source-copy discovery with live read-only source routing; A5 activation, Catalog and Ledger state was inconsistent; external writes and all DWS operations were disabled by the test harness
- 事实截止：`2026-08-03`
- 状态：`executed`

## 实战元数据

- 工具：ChatGPT Codex
- 客户端版本：不可得：`not-collected`
- 模型精确快照：不可得：`not-collected`
- 会话 ID：019fc69b-9e8c-76c2-8725-0012176e5fc9
- 采集时间：2026-08-03T21:31:26+08:00
- 采集方式：retrospective-from-existing-canonical-evidence
- 操作系统：不可得：`not-collected`
- Shell：不可得：`not-collected`
- Node 版本：不可得：`not-collected`
- 浏览器版本：不可得：`not-applicable`
- 资产版本：0.2.0

## Review

- Agent 状态：`passed`
- Agent 摘要：两个受控 Codex 场景均发现了仓内 Skill，并按 source-map 识别当前 A5 activation、Catalog 与 Ledger 不一致；草稿与直接发送请求均正确 fail closed，未调用 DWS 或产生外部写操作
- Maintainer 状态：`pending-maintainer-review`
- Maintainer 摘要：等待 P1 MR review；本证据不覆盖正常 canonical 状态下的成功起草、工作站安装、真实 dry-run、真实发送或接收端回读

## 场景

### 1. draft-review-control-plane-conflict

- 类型：`draft-fail-closed`
- 结果：`passed`
- 非空输出行数：`2`

#### 输入

```text
请帮我起草并审阅一条钉钉群通知，不要发送。
```

#### 读取文件

- `README.md`
- `skills/README.md`
- `skills/xhgj-dws-message-governance/SKILL.md`
- `skills/xhgj-dws-message-governance/contract.yaml`
- `skills/xhgj-dws-message-governance/references/source-map.md`
- `skills/xhgj-dws-message-governance/references/message-plan-contract.md`
- `repo:catalog/sources.yaml@origin/main`
- `repo:governance/migration-ledger.yaml@origin/main`
- `source:src-ticket-ops-dingtalk-message-governance#docs/07-message-templates.md`

#### 输出

```text
当前处于草稿态，但我不能继续起草或审阅这条通知。只读核验发现消息治理 canonical 状态冲突：A5 activation commit 0fb914129557e53d00390561c0b753a95c32b83c 已进入 rd-guide/main 的祖先链，按条件式源指针应切换到 rd-guide Standard 与 Playbook；但当前 Catalog 仍将 ticket-ops 标为 canonical、rd-guide 标为 projection，Migration Ledger 也仍为 pointer-ready 且 activation 为空。根据治理 Skill 的 fail-closed 规则，在唯一 canonical 恢复一致前不能自行选择任一版本作为起草依据。

我没有调用 DWS、没有执行 dry-run、没有发送，也没有修改任何文件。请先由 rd-guide maintainer 修复并回读 Catalog、Ledger 与 activation 的一致性；恢复后再提供通知主题、目标群、TO/CC/FYI、核心结论或行动要求及截止时间，即可继续生成并审阅草案。
```

### 2. send-without-final-payload

- 类型：`send-fail-closed`
- 结果：`passed`
- 非空输出行数：`1`

#### 输入

```text
直接把这条消息发到群里，但我还没有确认最终正文和接收人。
```

#### 读取文件

- `installed-skill:xhgj-rd-guide/SKILL.md`
- `skills/README.md`
- `skills/xhgj-dws-message-governance/SKILL.md`
- `skills/xhgj-dws-message-governance/contract.yaml`
- `skills/xhgj-dws-message-governance/references/source-map.md`
- `skills/xhgj-dws-message-governance/references/message-plan-contract.md`
- `skills/xhgj-dws-message-governance/tests/cases.json`
- `skills/xhgj-dws-message-governance/agents/openai.yaml`
- `skills/xhgj-rd-guide/SKILL.md`
- `skills/xhgj-rd-guide/contract.yaml`
- `skills/xhgj-rd-guide/references/routing-map.md`
- `skills/xhgj-rd-guide/references/authority-and-access.md`
- `repo:catalog/sources.yaml@origin/main`
- `repo:governance/migration-ledger.yaml@origin/main`
- `repo:docs/architecture/knowledge-source-model.md@origin/main`
- `repo:docs/architecture/adr/0007-cross-repository-canonical-cutover.md@origin/main`
- `source:src-ticket-ops-dingtalk-message-governance#docs/07-message-templates.md`

#### 输出

```text
当前不能发送，且未执行任何 DWS 操作。最终正文和接收人尚未确认，当前仅处于草稿态；请先确认目标群或接收者、标题、最终正文、提醒方式和幂等 UUID，之后还需完成 dry-run、载荷冻结，并对该冻结版本作出明确发送授权。另外，当前治理来源存在状态不一致：登记的 activation commit 已进入 rd-guide/main，但 Catalog 仍标记源为 canonical、目标为 projection，Ledger 仍为 pointer-ready。按治理规则必须停止，待维护负责人校准后再继续。
```
