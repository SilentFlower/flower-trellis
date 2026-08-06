# 来源路由

本文件只定义如何找到当前真源，不复制钉钉消息治理正文、DWS 产品文档或业务领域数据。

## 当前治理来源

每次使用先读取 rd-guide 当前默认分支的以下机器事实面：

1. `catalog/sources.yaml` 中 `scope=dingtalk-message-governance` 的 source/target 条目；
2. `governance/migration-ledger.yaml` 中 `id=dingtalk-message-governance` 的当前状态、source pointer 与 activation；
3. `docs/standards/dingtalk-message-governance.md`；
4. `docs/playbooks/dws-message-delivery.md`。

解析规则：

- ledger 已 `activated` 或 `active`，且 rd-guide target 是唯一 `canonical` 时，读取 rd-guide Standard 与 Playbook。
- ledger 仍为 `preparing` 或 `pointer-ready` 时，按 Source Catalog 登记的 source `canonical + required-source` 读取当前原文；rd-guide target 只按 projection 理解。
- Catalog 角色、Ledger 状态和默认分支中的 activation 事实必须一致。目标 activation commit 已进入默认分支，但 Ledger 仍停留在激活前状态或 Catalog 仍保留激活前角色时，视为控制面冲突并 fail closed。
- required-source 不可达、source/target 角色与 ledger 状态不一致、同一范围出现双 canonical、authority 冲突或事实截止不足时 fail closed，不使用旧缓存、legacy Skill 快照或安装副本补齐。

本 Skill 的 `incubating` 状态不改变上述 canonical 解析，也不因仓内文件存在而自动获得真实发送资格。

## 工具来源

DWS 命令、flag、认证、产品字段和返回 schema 读取：

1. 当前客户端可发现的通用 `dws` Skill；
2. 当前安装的 DWS CLI `--help` / schema；
3. Source Catalog 登记的钉定上游 evidence，仅用于需要核对版本差异时。

rd-guide Playbook 记录的是有事实截止的已验证行为，不是 DWS 产品文档第二真源。当前 CLI 与 Playbook 不一致时停止正式发送，保存版本与 dry-run 证据并反馈到 `issue:1`。

## 明确不使用

- legacy `dws-message-governance` 离线包的有效期或正式发送授权；
- ticket-ops 的 RCA 群 ID、人员 ID、领域模板或项目路径；
- 本机 `.agents`、`.claude`、`.codex` 中通用 `dws` Skill 的内容副本作为治理 canonical；
- 安装副本、聊天记录、历史 Note 或本地缓存替代当前 required source。
