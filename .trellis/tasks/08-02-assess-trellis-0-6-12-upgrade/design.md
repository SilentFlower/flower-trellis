# Trellis 0.6.12 升级设计

## 目标边界

把 flower-trellis 捆绑的 Trellis 从 `0.6.5` 升级到 `0.6.12`，完整吸收上游安全修复、平台运行时和上下文机制，同时保留 Flower 已确认的策略所有权。

本任务不是把当前 dogfood 文件直接替换成上游模板。长期结构仍分为四层：

1. Flower npm wrapper：`package.json`、`src/`、`bin/`。
2. Skill-Garden canonical 源：`vendor/skill-garden/.trellis/0.6/`。
3. npm 发布快照：`enhancements/0.6/`。
4. 当前仓库 dogfood 输出：`.trellis/`、`.agents/`、`.claude/`、`.codex/` 及其它已启用平台目录。

所有 0.6 workflow、skill、hook 和脚本差异必须通过现有 Patch Engine 表达。不得新增旁路注入器，也不得只修改发布快照或 dogfood 副本。

## 升级数据流

```text
Flower npm 精确依赖 @mindfoldhq/trellis@0.6.12
  -> syncGlobalTrellis() 同步全局 Trellis
  -> trellis update 刷新上游模板、迁移与 template hash
  -> Skill-Garden / Flower catalog 统一 required preflight
  -> conflict policy 审计最终产物
  -> Plugin Transaction Writer 写入目标、lock、state
  -> npm run sync 生成 enhancements/0.6
  -> dogfood update 验证当前仓库最终输出
```

任一 compatibility、required selector、baseline 或 conflict error 必须在目标文件和 `.flower/` 状态写入前失败。首次备份、provenance、changed-only 和事务规则沿用现有 Patch Engine。

### Update 预演与补偿边界

跨版本 dry-run 使用项目外临时沙箱，不再把“旧模板无法应用新 Patch”作为跳过 Skill-Garden 的理由：

```text
目标项目只读快照
  -> 临时沙箱复制 Trellis 管理面、.flower 元数据、既有 Plugin-owned paths
  -> 沙箱内真实 trellis update
  -> 升级后树执行 Plugin replay dry-run
  -> 输出联合预演结果
  -> 删除沙箱，目标项目 zero-write
```

真实更新则使用补偿事务：更新前在项目外保存路径清单、内容和 mode；Plugin 生命周期在 Transaction Writer 写入前通过 `onPreflight` 暴露 content/Patch mutation targets，Flower 把尚未覆盖的精确外部路径补入快照。若目标父目录原本不存在，快照记录最靠外的缺失目录，以便失败时同时清理本轮新文件和空目录，不扫描或覆盖已有用户目录。`trellis update` 与 Plugin replay 整链成功后才提交 config preserve 和备份清理。Plugin replay 或后处理失败时，先依赖 Plugin Transaction Writer 回滚其本轮事务，再由 Flower 恢复 Trellis 管理面和 `.flower` 旧状态、移除本轮新增受管文件。补偿不触碰 Trellis 明确排除的 task/spec/workspace/backlog/worktree 等用户数据，并保留本轮 `.trellis/.backup-*` 作为人工恢复证据。

受管根从精确依赖 `@mindfoldhq/trellis@0.6.12` 导出的 `ALL_MANAGED_DIRS` 获取，根 `AGENTS.md` 单独纳入；既有 Plugin-owned paths 来自有效 `.flower/state.json`。任何快照、复制或恢复遇到软链、特殊文件、路径越界或 I/O 错误均 fail closed。

## 所有权模型

### 上游 Trellis 所有

- Python/Node 运行时的正式函数签名与平台 context key。
- 文件系统安全、Python 3.9-3.11 兼容、Git probe timeout、polyrepo 扫描上限。
- channel 错误传播、idle timeout、context 大小限制、二进制检测和 journal merge union。
- 平台安装产物、agent 定义、hook/context injection 及原生 dispatch 工具。
- `trellis update` 的模板 hash、迁移和冲突处理。
- `trellis upgrade` 的全局 CLI npm 安装机制。

### Flower 所有

- 损坏 runtime 不得被当成 missing 的状态完整性契约。
- `trellis-route` 的逻辑模式选择和平台执行配方。
- Phase 2 的任务门禁、untracked/auto-loop/pre-check 顺序与完成链。
- audit-only、collect-all 的 `trellis-check-all`。
- `brief.md` 最终规划 handoff 和 `task.py start` freshness gate。
- Flower update/self-update 的用户确认、Plugin 重放和更新后 Push 链。
- parent/child 跨文件写入补偿、decision log fail-closed 等控制面完整性增强。

### 合并边界

- 以 `0.6.12` 上游实现为基线，仅在局部 required Patch 中保留 Flower 差异。
- 不保留上游已经覆盖且更完整的 Flower Patch，例如 task create 激活 warning。
- 不复制上游可复用机制到 Flower helper；只在 Flower policy owner 处表达必要差异。

## 控制面合并设计

### Active-task 状态

以 `0.6.12` 的 `resolve_active_task()` 参数、新平台 session key、fallback 开关和清理修复为基础，合并 Flower 的结构化状态：

- `missing`、`corrupt`、`io_error` 必须可区分。
- corrupt/io_error 不得进入 no-task 或 stale-pointer 自动清理路径。
- runtime 写入继续使用同目录临时文件、flush、`fsync` 和原子替换。
- 清理返回 `ClearActiveTaskResult`，删除失败显式诊断。
- fallback 清理吸收上游 `previous.context_key` 修复。

旧 replacement 不能直接移植，因为它会丢失 `0.6.12` 的新参数和平台行为。

### Task store

- 退役 `task-create-active-warning` operation，保留上游分阶段激活诊断和 `--no-start`。
- 保留 Flower 初始 task 写失败清理、parent/child 双文件快照补偿、archive/set-* 写失败返回非零。
- 对 `0.6.12` 新增 `set-meta` 应用相同的写失败契约。
- decision log 损坏继续 fail closed。

### Session Context 更新提示

维持当前 Flower owner，不改变产品行为：

- 删除上游 Session Context 内 `_get_update_hint()` 相关 imports、constants、helpers 和输出。
- imports 重基线时保留 `0.6.12` 新增且被 polyrepo 警告使用的 `sys`。
- helpers selector 接受上游已修正的 `run trellis update` 文本后继续移除整段。
- 最终文件保留上游 polyrepo/Git timeout 修复，但不包含原生更新提示。

## Workflow 与规划门禁

### Workflow-state Patch 粒度

退役共享 `inject-workflow-state` 的 whole-file replacement，以上游 `0.6.12` 文件为最终主体，拆分局部 Patch：

- stale active-task 到 `missing_task` 的映射。
- `untracked_flow` helper 与 import。
- breadcrumb subject label/summary 扩展。
- `main()` 中 task、untracked、no-task 的 Flower 分支。
- Codex bootstrap、更新提示等其它 owner 继续独立 Patch。

局部 Patch 必须声明顺序、严格 selector/baseline 和 zero-write 行为。上游新增的 ZCode 检测、`no-trellis`、Codex `auto`、异常边界和其它未触及逻辑自然保留。

### Codex dispatch

- Flower 管理项目统一把 `codex.dispatch_mode` 规范化为上游正式值 `auto`。
- `auto` 只声明原生 subagent 能力可用；实际 inline/subagent 由 `trellis-route` 决定。
- 旧值 `sub-agent` 只作为兼容输入，不再输出。
- 用户希望始终 inline 时使用 route preference，不通过平台配置关闭 JSONL seed/readiness。
- config 注释、workflow-state hook banner、`trellis-meta` 和 `trellis-route` 必须复用同一语义：hook 只报告能力已准备，不从 `auto` 推导默认执行位置。
- conflict policy 增加跨文件组合断言，不能只验证 `auto` 字面值存在。

### Phase 2

- Workflow 只保留 Flower 的策略门禁和 owner 指向，不维护静态平台直接 dispatch 列表。
- `trellis-route` 返回逻辑模式和当前平台的准确执行配方。
- 上游 workspace-write `trellis-check` 不得替代 Flower audit-only Check-All。
- 平台没有兼容只读 subagent 时，Check-All 只能选择 inline，不静默改用可写 agent。

### Audit-only Agent 与 Dispatch Catalog

Skill-Garden 增加两类 canonical 产物：

1. `trellis-check-all` 专用角色模板：按 Markdown、Codex TOML、Kiro JSON、Kimi/Reasonix skill frontmatter 等现有平台格式投影；channel runtime 使用 `.trellis/agents/check-all.md`。
2. `trellis-route` 结构化平台能力清单：记录平台 ID、implement launch contract、Check-All agent target、subagent eligibility、inline-only 原因和验证等级。

现有 `trellis-check` 仍是自修复 agent，但其所有平台副本与 channel role 增加 intent guard：Check-All/全面检查/提交前统一检查必须拒绝并转交专用角色。route 不再使用“通用 agent + 长 prompt”作为默认兼容推断，只在能力清单和当前 host 工具同时证明可用时提供 subagent Check-All。

结构化清单随 route skill 分发，Markdown 只保留算法与 prompt 合同。测试以清单为输入校验平台全集、agent 目标存在、格式正确、compiled target 闭包和 inline-only 原因；运行时工具是否真实可用仍由主会话检查，清单不能替代 host capability probe。

### Planning consent 与 Brief

上游 Planning Contract、Requirement Convergence 和 final review 原则合并进 Flower Task Brief Handoff：

- planning task 创建只授权规划。
- 逐项设计确认不构成实施批准。
- 最终只展示和批准一次 Brief，不额外增加上游 final summary gate。
- `brief.md` 固定包含 Goal、Scope、独立 Non-Goals、Key Decisions、Key Context、Acceptance、Next Step；Risks/Deferred 按需生成。
- Artifact Status 在展示时动态计算，不写入持久文件。
- 规划实质变化后刷新 Brief 并重新批准。

## 平台矩阵

### 目录映射

| 平台 | Flower 强化 Skill 目标 | 运行时边界 |
| --- | --- | --- |
| Pi | `.agents/skills` | 保留 `.pi/agents`、prompts、extension；不再写 `.pi/skills` |
| Oh My Pi | `.omp/skills` | 使用上游 agents、commands、extension/hook |
| Grok | `.grok/skills` | pull-based，无项目 hook 注入 |
| Kimi | `.agents/skills` | 私有 entry/agent role 由上游放在 `.kimi-code/skills`；使用内置 subagent |
| Snow | `.snow/skills` | 使用上游 `.snow/hooks` 和项目 agent discovery |

`PLATFORM_FLAGS` 增加 `--omp`、`--grok`、`--kimi`、`--snow`。共享 `.agents/skills` 目标必须合并 Pi/Kimi 平台声明并保持 neutral 字节一致，不能为同一 root 生成不同内容。

物理投影和逻辑启用检测必须分层：共享 target 仍只产生一套 mutation，但 `detectPluginPlatforms()`
按 Codex、Gemini、Pi、Kimi 各自的上游 `trellis-implement` 入口选择逻辑平台。不能仅因
`.agents/skills` 存在就把四个平台全部写入 state，也不能让 Plugin 新建的 Check-All agent
成为下一次自动检测证据。

Plugin 生命周期不能在每次 update/remove 时重新猜测平台。优先级为本轮显式平台、既有 state
实际平台、首次安装自动检测；Skill-Garden wrapper 会显式传入最新原生检测结果，以便收窄当前
dogfood 的错误 state，而普通 Plugin 可以在原生入口未落盘时继续更新和卸载。

Patch target 和 fixture 只覆盖已启用平台。无 hook 能力的 Grok/Kimi 不创建 Flower hook；OMP/Snow 等平台按上游真实能力接入。

## 兼容策略

- `package.json` 精确依赖 `@mindfoldhq/trellis@0.6.12`，lockfile 中 Trellis Core 随之对齐。
- `compatibility.json.testedVersions` 只声明 `0.6.12`。
- `compatibleLine` 继续是 `0.6`；未测试 patch 版本仍必须通过完整 required preflight 和 conflict 审计。
- 新版 Flower 保证从旧项目升级到 `0.6.12` 的正常 update/self-update 路径，不保证新版 Patch 直接作用于仍停留在 `0.6.5` 的项目。
- `0.7.0-beta.*` 不在本任务兼容范围。

## 完成状态设计

激活现有 `completed` 状态作为 Phase 3.4 与归档之间的机器可读边界，不新增 `ready_to_archive` 近义枚举：

```text
in_progress
  -> 全部业务 push 成功
  -> final task progress 写入、commit、push（仍为 in_progress）
  -> 同一份 progress 本地原子写 completed/completedAt
  -> completed（活动指针保留）
  -> trellis-finish-work
  -> archive（目录移动、指针清理）
```

最终 progress 先以 `in_progress` 状态独立 commit/push；progress push 成功后，才用同一份 progress 原子写入本地 `status=completed` 和 `completedAt`。该本地生命周期变化由后续 archive bookkeeping commit 承接，不生成第二个 progress commit。progress commit/push 失败时状态仍为 `in_progress`；若只有本地完成态写入失败，则只重试 helper，不重做已成功的业务或 progress push。`task.py archive` 只接受 completed，保留 `completedAt`；旧的 archive 内部“先写 completed 再立即移动”逻辑退役。显式 reopen 支持尚未归档任务回到 `in_progress`，并清理完成时间；partial push、用户 commit-only 和 auto-loop 内部 commit-only 不触发 completed。

workflow-state、`trellis-continue`、task progress candidates、`trellis-push` 和 `trellis-finish-work` 必须同步理解该边界。这样正常流程可真实触发 `[workflow-state:completed]`，session 丢失时也能通过 completed candidate 恢复，而不会把 progress 文本当作状态替代品。

## Canonical 与同步边界

修改顺序固定为：

1. 修改 `vendor/skill-garden/.trellis/0.6/` canonical 源和 Flower `src/patches`/adapter。
2. 运行 `npm run sync` 生成 `enhancements/0.6`。
3. 生成并检查 `vendor/skill-garden/compiled-targets/0.6.12/full`。
4. 通过 Flower update 刷新当前 dogfood 输出。
5. 比较 canonical、发布快照、compiled targets 和 dogfood 的最终语义。

禁止直接编辑 `enhancements/0.6` 或只修当前 `.trellis/.agents/.claude`。

## 风险与回滚

### 主要风险

- 局部 Patch 拆分顺序不完整，导致同一 hook 局部重复或 selector 漂移。
- 新平台共享 Skill root 写出不同字节，触发 template drift。
- route 配方与平台真实 subagent API 不一致。
- Brief 扩展造成高频上下文重复或超过预算。
- 兼容声明先于完整 fixture/compiled target 验证更新，形成虚假 tested 状态。
- 补偿恢复范围若和上游 `ALL_MANAGED_DIRS` 或排除规则漂移，可能漏掉新增受管文件或误触用户数据。
- 专用 Check-All agent 的平台格式正确但 host 未实际发现，可能产生“文件存在即能力可用”的假阳性。
- completed 转换若早于 progress push，可能把部分完成误标为待归档。
- 共享 Skill root 若同时承担逻辑平台检测，会在 Codex 项目中自发创建 Gemini/Pi/Kimi 私有目录，并由 Plugin state 形成错误的持续启用状态。

### 回滚点

- 依赖回滚：恢复 `package.json`/lockfile 的 `0.6.5` 精确依赖。
- Patch 回滚：恢复 vendor canonical 和 Flower platform catalog，再运行 `npm run sync`。
- dogfood 回滚：仅回滚本任务生成的已跟踪输出，不触碰用户其它工作区改动。
- compiled targets 回滚：重新用回滚后的依赖和 catalog 生成，不手工修改产物。

## 验证策略

验证必须覆盖：

- 官方 `0.6.12` pinned fixture 的 required Patch preflight 和 conflict 审计。
- JS/Python Patch consumer parity。
- active-task 损坏、I/O、fallback 清理和新平台 context key。
- task store 初始写、pair compensation、set-meta、archive 和 decision log。
- workflow-state 上游能力保留与 Flower 分支唯一性。
- Codex `auto`、JSONL readiness 和 route preference。
- OMP/Grok/Kimi/Snow/Pi 目录、hook 和 dispatch 能力矩阵。
- Brief 结构、freshness guard、动态 Artifact Status 和单一批准点。
- canonical/snapshot/compiled target/dogfood 一致性。
- AI context budget、npm pack 和升级 dry-run。
- Codex config/hook/route 组合语义与 managed normalization。
- 跨版本沙箱预演 zero-write、Plugin 失败自动补偿和补偿失败诊断。
- 专用 Check-All agent 投影、可写 check intent guard 与结构化 dispatch catalog 闭包。
- 共享 Skill root 的部分消费者检测、显式全消费者选择、未启用平台零目录和 dogfood state 收敛。
- `in_progress -> completed -> archive`、partial/commit-only/reopen 和 session candidate 恢复。
