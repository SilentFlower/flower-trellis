# 来源路由

本文件只定义如何找到当前真源，不复制企业邮件执行 Playbook、邮箱产品文档、真实邮件或凭据事实。

## 当前治理来源

每次使用先读取 rd-guide 当前默认分支的以下事实面：

1. `docs/playbooks/enterprise-mail-delivery.md`，它是企业邮件执行门禁的唯一解释正文；
2. `catalog/sources.yaml` 中企业邮件交付 Playbook 与 `xhgj-governed-mail-distribution` source/target 条目；
3. `governance/migration-ledger.yaml` 中 `id=xhgj-governed-mail-distribution` 的状态、source pointer、target 和 activation；
4. 当前默认分支是否包含 Ledger 声明的 activation commit。

解析规则：

- A4 Playbook 的 canonical 归属不因本 Skill 迁移改变；Skill 只消费它，不复制其正文。
- GMD migration entry 不存在、尚未 activation、target 不是唯一 `canonical`，或 source/target 角色与 Ledger 状态不一致时，本目录只能用于构建、自检和离线测试，不得进入真实发送态。
- activation commit 已进入默认分支，但 Catalog 或 Ledger 仍保持激活前状态时，视为控制面冲突并 fail closed。
- 完成当前动作所必需的原始资料（required-source）不可达、同一范围出现双 canonical、authority 冲突或事实截止不足时 fail closed，不使用旧 ZIP、发行快照、安装副本、聊天记录或本地缓存补齐。
- `contract.yaml.status=incubating` 不改变上述解析，也不因仓内目录存在而自动获得发布、安装、激活或真实发送资格。

`migration_registered`、`target_canonical`、`activation_confirmed` 三个谓词的取值一律按上面第 1–4 项从当前默认分支解析，本文件不固化任何一次快照——写死的状态一旦落后于控制面，本身就构成上一条所说的冲突。任一谓词无法从当前默认分支读出确定取值时按未成立处理。

## 工具来源

邮箱检索、通讯录、已发送目录、SMTP/IMAP/POP3 参数、认证方式和返回字段依次读取：

1. 当前 Playbook 明确允许的能力与停止边界；
2. 当前客户端可发现的产品能力 Skill 或本机 CLI help/schema；
3. 运行时环境中由负责人配置的 credential reference。

工具现实与 Playbook 不一致时停止正式发送，保留不含秘密材料的版本与 preview 证据，反馈到 `issue:1`。本 Skill 不建立第二套产品文档。

## 明确不使用

- legacy `governed-mail-distribution` ZIP 的有效期、离线授权或安装资格；
- rd-goal 私有 Issue、MR、Note、治理快照或历史发行记录作为当前执行正文；
- 真实邮件地址、收件矩阵、正文、附件、回执、SMTP/IMAP 主机、账号、授权码或本机路径；
- DWS 邮件发送命令作为正式投递链路；
- `.agents`、`.claude`、`.codex` 安装副本或旧 checkout 作为治理 canonical。
