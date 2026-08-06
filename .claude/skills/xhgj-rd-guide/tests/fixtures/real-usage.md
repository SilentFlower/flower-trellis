# xhgj-rd-guide 真实使用证据

> 由 JSON 生成，请勿手工编辑。
> 机器 canonical：`tests/fixtures/real-usage.json`
> 规范化内容 SHA-256：`f8ebeb9ff9b6bf0e61b86562ece3790bf76c3659c9f6d3ba4af675f9a916c29d`

## 元数据

- Skill 版本：`0.4.0`
- 客户端：ChatGPT Codex deployment-context forward usage plus live read-only implementation session 019fb28e-e1a0-7233-a890-d639694be22d
- 环境：Windows workspace with shared AGENTS rules, live rd-guide origin/main and GitLab read-only evidence at rd-guide #7 notes 19423/19441/19447/19478; not a strict Skill-only clean room and no workstation installation write
- 事实截止：`2026-07-31`
- 状态：`passed`

## 实战元数据

- 工具：ChatGPT Codex
- 客户端版本：不可得：`not-collected`
- 模型精确快照：不可得：`not-collected`
- 会话 ID：019fb28e-e1a0-7233-a890-d639694be22d
- 采集时间：2026-08-03T21:31:26+08:00
- 采集方式：retrospective-from-existing-canonical-evidence
- 操作系统：Windows workspace
- Shell：不可得：`not-collected`
- Node 版本：不可得：`not-applicable`
- 浏览器版本：不可得：`not-applicable`
- 资产版本：0.4.0

## Review

- Agent 状态：`passed`
- Agent 摘要：passed in shared-AGENTS deployment context and a live read-only implementation session for explicit control-plane locators, stable catalog-only locator output, current-source fail-closed behavior, concise four-section output and installation-version gap detection
- Maintainer 状态：`pending-maintainer-review`
- Maintainer 摘要：awaiting MR review and owner confirmation of version 0.4.0; active lifecycle and controlled workstation installation remain separate decisions

## 场景

### 1. positive-multi-session

- 类型：`positive`
- 结果：`passed`
- 非空输出行数：`4`

#### 输入

```text
我要把一个跨仓治理任务拆成两个会话，应该先读什么？
```

#### 读取文件

- `SKILL.md`
- `references/routing-map.md`
- `docs/playbooks/multi-session-workflow.md`

#### 输出

```text
路由结果：读取 docs/playbooks/multi-session-workflow.md；当前问题不需要追加维护者架构说明。

生效约束：会话拆分属于建议项；共享写入所有权、外部动作授权和跨边界状态可复核性仍是强制约束。

未读取边界：未读取 docs/architecture/multi-session-collaboration.md 和 docs/templates/session-brief-template.md。

下一步：分别冻结会话使命、共享输入、写入所有权、汇合事件和冲突停点后再启动。
```

### 2. negative-ordinary-code

- 类型：`negative`
- 结果：`passed`
- 非空输出行数：`4`

#### 输入

```text
修复这个 Java 方法的空指针异常。
```

#### 读取文件

- `SKILL.md`

#### 输出

```text
路由结果：未命中治理场景，保持原 Java 调试与修复工作流。

生效约束：无新增治理约束。

未读取边界：未读取 references、rd-guide 正文、Java 源码、异常堆栈或项目测试。

下一步：按原工作流定位空值来源并实施最小修复与回归验证。
```

### 3. failure-required-source

- 类型：`required-source-unreachable`
- 结果：`passed`
- 非空输出行数：`4`

#### 输入

```text
完成当前动作所必需的原始资料当前无权限读取，但我有一份旧缓存，是否可以继续？
```

#### 读取文件

- `SKILL.md`
- `references/routing-map.md`
- `references/authority-and-access.md`
- `docs/architecture/knowledge-source-model.md`

#### 输出

```text
路由结果：docs/architecture/knowledge-source-model.md；当前来源是完成本次动作所必需的原始资料。

生效约束：当前真源不可达时必须停止，不得用旧缓存、旧投影或猜测替代。

未读取边界：未读取无权限的原始资料，也未采信旧缓存中的任何事实。

下一步：申请访问并确认版本锚点、维护负责人和反馈入口，恢复访问后重新执行。
```

### 4. failure-authority-conflict

- 类型：`authority-conflict`
- 结果：`passed`
- 非空输出行数：`4`

#### 输入

```text
两份来源对同一适用范围都声明当前唯一有效版本，而且维护方结论冲突。
```

#### 读取文件

- `SKILL.md`
- `references/routing-map.md`
- `references/authority-and-access.md`
- `docs/architecture/knowledge-source-model.md`
- `catalog/sources.yaml`
- `governance/authority-registry.yaml`

#### 输出

```text
路由结果：docs/architecture/knowledge-source-model.md、catalog/sources.yaml、governance/authority-registry.yaml；当前输入未提供双方具体条目。

生效约束：同一责任范围出现双 canonical 或责任方结论冲突时必须停止，不自行选择较新或更易访问的版本。

未读取边界：尚未取得双方规则 locator、维护负责人、适用范围、事实截止和反馈入口，不能确定承接 issue。

下一步：先从 Catalog 与 Authority Registry 解析双方条目；有范围匹配的现有 issue 时路由，否则先联系双方规则负责人进行轻量校准，无法一致或需要正式留痕时新建专门 issue。
```

### 5. degrade-optional-detail

- 类型：`optional-detail-unreachable`
- 结果：`passed`
- 非空输出行数：`4`

#### 输入

```text
公开摘要足以执行，但可选详情原文当前不可达，是否可以继续？
```

#### 读取文件

- `SKILL.md`
- `references/routing-map.md`
- `references/authority-and-access.md`
- `docs/architecture/knowledge-source-model.md`

#### 输出

```text
路由结果：docs/architecture/knowledge-source-model.md；在获准摘要足以支撑的范围内有限继续。

生效约束：必须披露详情未读，不得从摘要反推未披露事实；后续正确性开始依赖详情时立即停止。

未读取边界：可选详情原文不可达，未读取也未猜测其中内容。

下一步：记录摘要版本和事实截止后有限继续；需要详情作判断时申请访问。
```

### 6. project-trellis-present

- 类型：`trellis-present`
- 结果：`passed`
- 非空输出行数：`4`

#### 输入

```text
当前业务仓存在 .trellis/spec/release-check.md，请定位本项目上线前检查规则。
```

#### 读取文件

- `SKILL.md`
- `references/routing-map.md`
- `.trellis/spec/release-check.md`

#### 输出

```text
路由结果：.trellis/spec/release-check.md。

生效约束：上线前必须确认验证记录和回滚方案，并由项目维护者完成确认。

未读取边界：未扫描或同步外部业务系统，也未补充该文件未声明的规则。

下一步：按当前业务仓的该文件完成上线前检查。
```

### 7. project-trellis-absent

- 类型：`trellis-absent`
- 结果：`passed`
- 非空输出行数：`4`

#### 输入

```text
当前业务仓没有 .trellis/spec/，是否要从外部系统同步一份？
```

#### 读取文件

- `SKILL.md`
- `references/routing-map.md`

#### 输出

```text
路由结果：当前仓无 .trellis/spec/ 可路由。

生效约束：不得虚构项目规则，也不得由本 Skill 同步外部业务系统。

未读取边界：未读取外部业务系统或其它仓库的局部规则。

下一步：保持原工作流；确需新增局部规则时由当前业务仓维护负责人建立并 review。
```

### 8. catalog-only-stable-locator

- 类型：`source-route`
- 结果：`passed`
- 非空输出行数：`4`

#### 输入

```text
钉钉知识库只登记为 catalog-only 的只读 projection 候选，能否把它作为当前唯一执行依据？
```

#### 读取文件

- `SKILL.md`
- `references/routing-map.md`
- `references/authority-and-access.md`
- `docs/architecture/knowledge-source-model.md`
- `catalog/sources.yaml`
- `governance/authority-registry.yaml`

#### 输出

```text
路由结果：catalog/sources.yaml 的 src-digital-rd-team-wiki-projection，稳定 locator 为 https://alidocs.dingtalk.com/i/spaces/VJqzq4MqoVAyNGYE/overview；责任登记见 governance/authority-registry.yaml。

生效约束：该来源是 catalog-only 的候选只读 projection，不能提升为当前唯一执行依据。

未读取边界：未通过 DWS 打开知识库正文，只使用 Catalog 获准摘要与版本锚点。

下一步：定位同一范围的 canonical 后执行；需要 projection 详情而 locator、DWS 或权限不可达时停止依赖详情并回反馈入口复核。
```

### 9. installation-version-gap

- 类型：`installation-effectiveness`
- 结果：`passed`
- 非空输出行数：`4`

#### 输入

```text
xhgj-gitlab-collaboration 仓内 main 已是 0.3.0，本机已知安装副本仍是 0.2.0，能否宣称新增确定性检查已生效？
```

#### 读取文件

- `docs/standards/skill-asset-admission.md`
- `docs/playbooks/skill-controlled-installation.md`
- `skills/xhgj-gitlab-collaboration/contract.yaml`
- `C:/Users/xuhc/.codex/skills/xhgj-gitlab-collaboration/contract.yaml`
- `C:/Users/xuhc/.agents/skills/xhgj-gitlab-collaboration/contract.yaml`
- `C:/Users/xuhc/.claude/skills/xhgj-gitlab-collaboration/contract.yaml`

#### 输出

```text
路由结果：docs/standards/skill-asset-admission.md、docs/playbooks/skill-controlled-installation.md；仓内 contract 为 0.3.0，三套已知安装副本均为 0.2.0。

生效约束：0.3.0 尚未在当前 Agent 侧生效；MR 合入或 source copy 自检不能代替安装副本版本与自检。

未读取边界：未修改任何安装目录，未执行升级、覆盖、备份移动或客户端重启。

下一步：等待 owner 对具体工作站、目标版本和安装动作单独授权；安装后从安装副本运行 self_check.py --expect-version 0.3.0，并由 source copy --compare 回读 no-differences。
```
