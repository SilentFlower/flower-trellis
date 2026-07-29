# Trellis Meta Skill-Garden Overlay 设计

## 1. Architecture

本任务保留上游 `trellis-meta` 作为基础文档树，通过 Skill-Garden 0.6 Patch catalog 对冲突段落做受管变换：

```text
@mindfoldhq/trellis bundled trellis-meta
                  |
                  v
Skill-Garden schema v2 Patch + Bundle selection
                  |
                  v
Flower Plugin preflight / transaction / lock / state
                  |
                  v
各已启用平台中的最终 trellis-meta
```

上游文档继续提供通用 Trellis 能力；Flower/Skill-Garden Patch 只负责增加 managed mode 优先级、修正所有权分类、替换冲突操作建议，并把具体流程路由到现有 owner。

## 2. Source And Ownership

- 唯一修改源：`vendor/skill-garden/.trellis/0.6/overrides/`。
- 发布快照：`npm run sync` 生成 `enhancements/0.6/`。
- 当前 `.agents/skills/trellis-meta/**`、`.claude/skills/trellis-meta/**` 等目录只是 dogfood 最终产物，不作为作者源。
- 不修改 `node_modules/@mindfoldhq/trellis`，也不复制完整上游 `trellis-meta` 到 Skill-Garden skill 目录。
- Patch Engine 对 Markdown 普通文件不支持 `missing=create`，因此不新增 reference 文件；全部内容落入现有 `SKILL.md` 与既有 references 的精确 section。

## 3. Patch Decomposition

在 `overrides/patches/skills/trellis-meta/` 下按职责拆分四个 Patch 叶子，避免一个 operation 同时承担全部语义：

### 3.1 `managed-mode-precedence`

- 扩展 `SKILL.md` frontmatter description，使 Flower、Skill-Garden、Patch、Plugin ownership 类请求能触发 meta。
- 在 `SKILL.md` 入口增加简短的 Managed Mode Guard：先检查 `.flower/plugins.json`、`plugin-lock.json`、`state.json`；`flower/skill-garden` 已锁定时，受管合同优先于冲突的原生定制建议。
- 更新 How To Use 阅读顺序：先识别 ownership，再读取相应 reference。

### 3.2 `managed-architecture-and-ownership`

- 修改 `references/local-architecture/overview.md`：在 workflow、persistence、platform、channel 之外增加 Flower Plugin management layer。
- 修改 `generated-files.md`：把“通常可编辑”改为“先判断 ownership”；条件化 `.template-hashes.json` 的原生更新语义。
- 修改 `bundled-skills.md`：把二分类扩展为 upstream bundled、Skill-Garden managed、Flower managed、shared common、project-local，并保留官方 bundled skill 的原有说明。

### 3.3 `managed-customization-routing`

- 修改 `references/customize-local/overview.md`：普通项目仍可直接定制；受管目标必须回到 Plugin/Patch 作者源。
- 修改 `change-workflow.md`：`.trellis/workflow.md` 是运行时最终语义，不必然是增强内容作者源；0.6 Skill-Garden 修改进入 Patch Engine。
- 修改 `change-skills-or-commands.md`：取消“除官方 bundled 外均不受管理”的断言，增加 state ownership 与 Skill-Garden 双平台源规则。
- 修改 `platform-files/overview.md`：平台修改顺序从“直接找最近文件”升级为“先查 ownership，再选择 project-local edit 或 managed source”。

其它 customization references 继续保留原有操作细节，但受 `SKILL.md` Managed Mode Guard 和 customization overview 的优先级约束；不复制相同 guard 到每个文件。

### 3.4 `managed-workflow-owners`

- 修改 `references/local-architecture/workflow.md`：移除按平台能力直接派发 implement/check 的过时描述，改为读取当前 workflow owner index 和 `trellis-route`。
- 只描述 owner 类别与发现路径，不复制 Request Triage、Check-All、Auto-Loop、Push、Finish-Work 等完整流程。
- 实际能力从 `.trellis/workflow.md`、本地 skill 目录、`overrides/bundles/` 和 `.flower/state.json` 发现，不硬编码 skill 数量。

## 4. Target Strategy

- 每个 operation 使用显式 target 列表，目标根与 `ENHANCEMENT_SKILL_TARGETS` 对齐。
- `targetPolicy` 使用 `each-existing`，各平台目标 `missing: skip`；未启用平台不创建目录。
- `.agents`、`.claude` 和其它已存在平台的最终语义必须一致；frontmatter 仅保留平台原有差异。
- selector 优先使用 `markdown-section` 或精确 `literal`；完整旧 section 写入 baseline，禁止模糊 fallback 或顶部追加。
- content 继承上游 meta 的英文风格；项目中文注释规则不翻译 selector、baseline 或英文目标内容。

## 5. Bundle Selection

新增 full-or-selected Bundle：

```json
{
  "schemaVersion": 1,
  "id": "trellis-meta",
  "aliases": ["meta-architecture", "trellis-create-command", "create-command"],
  "installMode": "full-or-selected",
  "patches": [
    "skills/trellis-meta/managed-mode-precedence",
    "skills/trellis-meta/managed-architecture-and-ownership",
    "skills/trellis-meta/managed-customization-routing",
    "skills/trellis-meta/managed-workflow-owners"
  ]
}
```

- 全量安装自动选择该 Bundle。
- `--skills trellis-meta` 通过 Bundle ID 选择。
- `trellis-create-command` / `create-command` 作为显式依赖别名，确保只安装该 skill 时也获得它声明依赖的增强 meta。
- 不把 meta Patch 挂入 `intent-routing` 等无关 Bundle，避免精细安装范围扩张。

## 6. Conflict Policy

在 `overrides/conflicts.json` 增加以下最终产物断言：

- required-literal：Managed Mode Guard、Plugin state ownership、真实源/快照顺序、owner discovery 路径存在。
- absent-literal：删除“所有非 bundled skill 均不受管理”“直接编辑部署副本即可”“按平台能力直接派发 trellis-check”等冲突原文。
- 至少覆盖 `.agents` 与 `.claude` canonical targets；其它平台由显式 target 完整性和集成矩阵覆盖。
- 所有新增 operation 必须被 conflict rule 覆盖，避免 catalog 只声明不验证最终语义。

## 7. Compatibility And Lifecycle

- baseline 固定对齐受测 Trellis `0.6.5`；上游文档漂移时由现有 compatibility/preflight 机制失败关闭。
- Flower update 先执行 Trellis update，再重新解析并事务化叠加 meta Patch。
- `--no-enhance` 冻结既有 Skill-Garden lock/state；冻结期间 meta 继续反映已锁定增强事实。
- Plugin remove/uninstall 依赖 state ownership 恢复或删除受管变换，不能留下声称增强仍存在的孤立正文。
- `.trellis/.backup-flower/` 保留首次修改前的上游 meta 字节，事务失败按现有 Plugin Runtime 回滚。

## 8. Validation

- JS 与 Python Patch consumer 对 Bundle 选择、operation 顺序、最终字节和 provenance 保持一致。
- 新增 `trellis-meta`、`meta-architecture`、`trellis-create-command`、`create-command` 精细选择测试。
- 验证缺少平台 root 时 skip，存在多个平台时语义一致，二次应用 unchanged。
- 刷新并检查 compiled targets，审阅最终 meta diff，而不是只检查 Patch content。
- 运行 context budget checker，确保本任务没有把重复流程塞进高频 workflow/state；不提高既有阈值。

## 9. Rollback

- 源码回退：还原四个 Patch 叶子、Bundle 和 conflict rules，重新 `npm run sync` 与生成 compiled targets。
- 已安装项目回退：通过 Plugin update/remove 的既有事务与 state ownership 恢复，不手工删除 marker。
- 首次上游字节仍保留在 `.trellis/.backup-flower/<trellis-meta target>`，仅作为诊断和恢复证据。

## 10. Auto-Loop DOC Rebind Contract

`run_check_all` 和 `run_recheck` 的 `last_action` 增加内部逐文件 artifact baseline，不进入默认 action 输出。Check-All 完成自动文档修复后，通过 record 的重复参数声明精确 DOC 文件。

runner 在普通 artifact-drift 检查前执行以下顺序：

1. 复核 protected-retained 文件没有漂移。
2. 若声明 DOC remediation，验证 action 类型、目标文件白名单、action 发出时 baseline 和当前实际变化集合。
3. 实际变化与声明完全一致时，重算 planning/handoff hash，追加 `check-doc-remediation` manifest revision 和 item audit event。
4. 再执行通用 artifact-drift 检查；任何未被 DOC 或 pending decision 消费的变化继续失败关闭。

DOC 白名单只包含当前任务的 `implement.md` 与 `brief.md`。`prd.md`、`design.md` 涉及需求或技术语义，必须继续通过人工规划或 `decide --file`；`check.jsonl` 不参与 planning/handoff hash，不借本通道扩大权限。

## 11. Retryable Record Contract

Check record 阶段的 artifact drift 分成两类：

- **Check action 内可恢复漂移**：仅 `run_check_all` / `run_recheck` 保持 item=`running` 和原 `last_action`，增加 `attempts.artifact_reconcile`，写入结构化 `last_failure`，返回 `status=retryable`。agent 只能撤回自身误改、补充合法 DOC 声明后重录，或确认无法归因后显式 record blocked。
- **跨 action / action 发出前漂移**：`next` 在没有安全归因证据时继续按 terminal `artifact-drift` 处理，防止静默接受用户或其它进程改写 planning。

其它 action 的 record 漂移继续直接 blocked；实现、spec update 和 commit-only 不借 Check-All 的文档修复能力扩大权限。

默认 `MAX_ARTIFACT_RECONCILE=3`。第 1 至 3 次 record 漂移允许同 action 自恢复；第 4 次转为 blocked。成功 record 后计数归零。显式 `--result blocked --failure-type artifact-drift` 直接进入 blocked，不消耗剩余重录预算。

`retry-blocked` 的人工边界保持不变：只有已经终态 blocked 的队列项才使用它。修复的目标是减少错误进入终态，而不是自动绕过真正阻塞。

## 12. Owner And Distribution

- 行为 owner：`vendor/skill-garden/.trellis/0.6/scripts/auto_loop.py`。
- Agent 协议 owner：canonical `.agents/.claude/skills/trellis-auto-loop/SKILL.md`。
- DOC 调用 owner：canonical `trellis-check-all` 的文档漂移与 disposition references。
- 发布链：vendor 源 -> `npm run sync` -> `enhancements/0.6` -> Flower enhance-only dogfood。
- workflow hub/state 只保留 owner 指向，不复制 CLI 字段、重试矩阵或 DOC 白名单。

## 13. Meta Impact Review Gate

所有 Skill-Garden 管理能力的变更在完成前执行一次 meta 影响复核，但不引入新的 runtime helper、manifest 或状态文件。复核只产生两个结论：

- `no-op`：owner 身份、稳定职责边界、发现路径、作者源、分发面和定制入口仍准确。owner 内部 SOP、交互模板、命令字段或错误矩阵继续只保存在 owning capability。
- `patch-required`：上述任一稳定架构合同发生变化。必须更新 `vendor/skill-garden/.trellis/0.6/overrides/patches/skills/trellis-meta/` 的 canonical Patch 源，随后执行 sync、compiled targets、dogfood 和最终产物检查。

复核证据写入当前任务规格、实施清单或 Check-All 报告，不建立平行 catalog。自动化测试固定双态术语，并验证 Planning Brief owner 仍由 `trellis-task-brief` 与 task-start brief guard 承担；显式预授权属于 owner 内部交互合同，因此本次不修改 meta 正文。
