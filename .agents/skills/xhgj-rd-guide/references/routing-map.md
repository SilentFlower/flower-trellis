# 最小路由图

只读取命中行的入口。路径相对 rd-guide 仓库根；独立安装时先使用仓库入口 `http://gitlab.xhgjdev.com/digital-rd-governance/rd-guide` 定位当前 canonical 的同路径，不把本文件、安装副本或旧 checkout 当作正文替代品。正确性依赖当前事实但 current source 不可达时停止。

| 任务信号 | 最小入口 | 何时追加读取 |
| --- | --- | --- |
| 六原则、治理边界、自主度、可信准入 | `docs/foundations/ai-native-governance-model.md` | 需要术语或行动强度时追加 `docs/foundations/governance-philosophy.md` |
| 决策、会话、受众协作边界 | `docs/foundations/ai-native-collaboration.md` | 需要具体会话动作时追加对应 Playbook |
| canonical、projection、source role、reference mode、披露 | `docs/architecture/knowledge-source-model.md` | 需要核对真实登记时追加 `catalog/sources.yaml` 与 `governance/authority-registry.yaml` |
| 文档边界、frontmatter、受众或内容分层 | `docs/architecture/document-unit-contract.md`、`docs/architecture/frontmatter-contract.md`、`docs/standards/audience-writing.md`、`docs/standards/content-layering.md` | 只选与当前编辑动作直接相关的文件和模板 |
| Issue 当前面、Note、checkpoint | `docs/standards/note-contract.md` | 需要模板时追加 `docs/templates/checkpoint-template.md` |
| GitLab Issue 最小清单、角色、载体、关系、提醒与 Agent 调用边界 | `docs/playbooks/gitlab-issue-collaboration.md` | Note / checkpoint 细节追加 `docs/standards/note-contract.md`；身份、分支、commit 与 MR 追加 `docs/playbooks/gitlab-collaboration-onboarding.md` |
| 多会话拆分、并行、交接 | `docs/playbooks/multi-session-workflow.md` | 维护者需要模型依据时追加 `docs/architecture/multi-session-collaboration.md`；需要起草时追加 `docs/templates/session-brief-template.md` |
| AI-Native 人机分工、MR/Issue/通知收口顺序、文档回填 | `docs/playbooks/ai-native-delivery-workflow.md` | GitLab 具体操作追加 `docs/playbooks/gitlab-collaboration-onboarding.md`；消息发送追加当前 active 的钉钉治理 Standard 与 DWS Playbook |
| Agent 操作坑、共享踩坑准入、已知 shell/CLI 失败模式 | `docs/playbooks/agent-gotcha-registry.md` | 规则本身需要修正时改读对应 Standard/Playbook；需要回流新经验时追加 `docs/playbooks/experience-backflow.md` |
| 经验、事故、首次真实使用结果回流 | `docs/playbooks/experience-backflow.md` | 只按目标责任 issue 补充证据 locator |
| 组织级 Skill 准入、版本、升级保护 | `docs/standards/skill-asset-admission.md` | 核对当前 Skill 时读取其 `contract.yaml` 和 `self_check.py` |
| Skill 安装、升级、`--compare`、是否已生效 | `docs/playbooks/skill-controlled-installation.md` | 同时读取目标 Skill 安装副本的 `contract.yaml`；当前副本不存在或版本不符时停止宣称生效 |
| 跨仓 canonical 切换 | `docs/architecture/adr/0007-cross-repository-canonical-cutover.md` | 实施单资产迁移时追加 `docs/templates/canonical-cutover-template.md`、Catalog 与 Migration Ledger |
| GitLab Issue/MR/Note 执行 | 先读 `docs/playbooks/gitlab-issue-collaboration.md`，再使用目标能力 `xhgj-gitlab-collaboration`，责任入口 `issue:6` | 该 Skill 未安装或未 active 时只报告不可用，不由本 Skill 代执行 |
| 企业正式邮件新发、回复、转发、带附件交付 | 先读 `docs/playbooks/enterprise-mail-delivery.md`，再使用目标能力 `xhgj-governed-mail-distribution`，责任入口 `issue:1` | 附件是能力资产或离线包时追加 `docs/standards/capability-asset-distribution.md`；该 Skill 未安装或仍为 `incubating` 时只按 Playbook 门禁报告不可用，不由本 Skill 代执行，也不改用其它通道代发 |
| 规则对本部门是否适用、部门能否自定规则、覆盖与逃生边界 | `docs/standards/rule-scope-and-department-autonomy.md` | 需要行动强度语义时追加 `docs/foundations/governance-philosophy.md`；要建本部门 guide 仓时追加 `docs/playbooks/department-guide-start-here.md` |
| 当前业务仓局部规则 | `<repo>/.trellis/spec/` | 仅当目录存在且任务需要项目规则时读取命中文件；不存在时不扩张 |

## 选择规则

- 优先读取面向主要受众的当前正文；reviewer 才追加 ADR/证据，maintainer 才追加 schema/registry。
- 一次先选一个入口；只有第一个入口明确指向额外依赖，或当前判断缺少必要字段时再扩张。
- Source Catalog、Authority Registry、Relationship Registry 和 Migration Ledger 是机器事实面；不要从 README 或历史 note 推断其当前值。
- authority 冲突或双 canonical 场景必须把实际使用的 `catalog/sources.yaml` 与 `governance/authority-registry.yaml` 明确写入路由结果；缺任一项都不能只靠结论继续。
- `catalog-only` 场景必须回显 Source Catalog 中实际采用的稳定 locator，并明确它不是唯一执行依据；只写 source id 或“已查看 Catalog”不够。
- 核对 Skill 生效时必须读取安装副本版本；`main` 版本、MR 合并状态或 source checkout 自检不能代替安装副本自检。
- `skills/xhgj-rd-guide/` 之外的组织级 Skill 只有在本地可发现或 rd-guide 已登记时才可作为可执行下一步。
