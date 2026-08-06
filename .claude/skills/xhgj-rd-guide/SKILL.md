---
name: xhgj-rd-guide
description: 为研发治理场景提供轻量路由，按任务识别适用的 rd-guide 文档、组织级 Skill、authority、source role、reference mode、安装副本状态与项目局部 .trellis/spec/，并在 required-source 不可达、authority 冲突、双 canonical 或安装版本未生效时停止。用于查询研发治理规则与建议强度、判断事实或规范由谁维护及哪份是 canonical、处理权限/披露/事实截止问题、核对组织级 Skill 的安装/升级/生效状态、不确定应读取哪篇 rd-guide 文档或 Skill，以及需要发现当前业务仓 .trellis/spec/ 的场景；普通代码实现、调试或业务讨论未命中这些问题时不要触发。
---

# XHGJ 研发治理路由

只做治理路由，不接管开发流程，不复制 rd-guide 全量正文，也不执行 GitLab、钉钉、邮件、权限或安装动作。

## 路由流程

1. 判断请求是否命中 frontmatter `description` 中的治理场景。
2. 未命中时不要读取 `references/` 或 rd-guide 文档，直接保留原工作流。
3. 命中时识别主要受众、任务目标、当前仓库、风险边界、事实截止、已知来源和当前 Agent 实际可发现的 Skill 安装副本。
4. 读取 [references/routing-map.md](references/routing-map.md)，只选择完成当前判断所需的最小入口。
5. 仅在涉及 authority、canonical、访问、披露、事实截止或来源冲突时，再读取 [references/authority-and-access.md](references/authority-and-access.md)。
6. 从 rd-guide 当前 canonical 读取被选中的正文、registry 或具体 Skill；安装副本只提供路由和机器边界，不是治理正文镜像。无法确认当前真源且正确性依赖它时停止。
7. 把实际读取的文档路径、Catalog/Registry 路径和稳定 locator 明确写入“路由结果”；不要只输出概念结论，也不要顺带加载同层其它文件。
8. 应用失败边界，输出最小结果。

## 当前真源与安装生效

- `rd-guide main` 上的 Skill 版本表示 canonical 已更新；当前 Agent 的行为是否变化，以它实际可发现的安装副本版本为准。
- 核对生效时读取安装副本自己的 `contract.yaml`，并在安装副本目录运行 `python scripts/self_check.py --expect-version <owner-approved-version>`；不要用仓内版本替代这一步。
- 安装、升级和差异处理读取 `docs/playbooks/skill-controlled-installation.md`。本 Skill 只路由和核对，不复制、覆盖、移动或删除任何安装目录。
- 读取治理正文时使用 rd-guide 当前 canonical 或 owner 明确冻结的版本。只剩旧 checkout、缓存或安装副本内索引时，不把它们冒充当前正文。

## 失败边界

- `required-source` 不可达：停止依赖该来源才能正确执行的动作，说明缺失资料和访问申请入口；面向用户称为“完成当前动作所必需的原始资料”，不要要求用户理解机器字段；不要用缓存、旧投影或猜测补齐。
- `optional-detail` 不可达：使用已获准摘要有限继续，并披露未读取详情。
- authority 冲突或同一 `authority + scope` 出现双 canonical：停止裁决，按双方登记的负责人、适用范围和 feedback locator 动态路由；只有现有 issue 明确可达且范围匹配时才使用它。没有合适 issue 时先建议双方轻量校准，无法达成一致或需要正式留痕时，再建议在承担最终决定的仓库创建专门 issue。不得自行发送消息或创建 issue。
- 事实截止不足且正确性依赖最新事实：重新读取；无法读取时停止。
- `.trellis/spec/`：只发现和读取当前业务仓已有规则。目录不存在时不要虚构；不要从外部业务系统同步或集中接管正文。
- 具体执行能力不在本 Skill 内：只给出目标 Skill 或责任 issue；能力不可用时明确停止，不自行代替执行。
- Skill 安装副本不存在、版本低于 owner 批准版本或无法运行自检：不得宣称能力已生效；保留现状并路由到受控安装 SOP，等待单独安装授权。

## 输出契约

只输出以下四个标题，每段只保留当前请求需要的内容，不写通用介绍：

```markdown
路由结果：<实际读取或需要读取的最小文档、Skill、Catalog/Registry、稳定 locator、项目局部路径，或“未命中，保持原工作流”>

生效约束：<本场景实际命中的 must / better / your taste；没有新增则写“无新增治理约束”>

未读取边界：<未读取、不可达、过期、无权确认的内容；没有则写“无”>

下一步：<继续、申请访问、联系负责人、共同校准、必要时创建专门 issue 或停止的具体动作>
```

面向终端用户时先写中文职责含义，例如“维护负责人”“适用范围”“当前唯一有效版本”“完成本次动作所必需的原始资料”。只有定位机器字段确有帮助时，才在中文含义后用括号保留 `owner`、`scope`、`canonical`、`required-source` 等术语。

## 个性化边界

- 推荐个性化：调整语言、排序和项目内常用 locator，不改变事实与行动强度。
- 谨慎个性化：增加团队别名或额外路由时，运行 `python scripts/self_check.py` 并保留升级差异。
- 硬边界：不得放宽 required-source、authority、双 canonical、权限、披露和外部动作授权规则；升级时先运行 `python scripts/self_check.py --compare <installed-skill-directory>`，发现差异后停止并要求显式选择，不静默覆盖。

## 自检

在 Skill 目录运行：

```bash
python scripts/self_check.py
python scripts/self_check.py --expect-version <owner-approved-version>
```

检查当前目录时离线运行，不需要网络、凭据或第三方依赖。`--expect-version` 必须在实际安装副本目录运行，用于证明接收侧版本已经生效；它不能由仓内 source copy 代跑。

真实使用 JSON 变化后运行 `python scripts/render_real_usage.py` 更新人读投影；`self_check.py` 会拒绝未生成或被手工修改的投影。
