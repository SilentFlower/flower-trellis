# Trellis 0.6.12 升级实施计划

## 执行状态

- 已完成：依赖固定、Python 控制面重基线、workflow-state 局部 Patch、Codex `auto`、Phase 2 / Brief 合并、新平台与 Pi 迁移、compatibility / conflicts、canonical / snapshot / compiled target / dogfood 同步。
- 已验证：当前仓库从 `0.6.5` 真实升级到 `0.6.12` 成功；Patch target 检查、strict context budget、npm pack dry-run、post-upgrade update dry-run 和两仓 `diff --check` 通过。
- Check-All 修复完成：跨版本普通 dry-run 会延后 Skill-Garden 重放，已用真实 `0.6.5` 升级备份验证退出码为 `0`；README 已声明 tested `0.6.12` 并补充 OMP / Grok / Kimi / Snow；`trellis-meta` 通过三个受管 Patch operation 补全平台 root 与共享 `.agents/skills/` 消费者，source、snapshot、compiled target 和 dogfood 最终产物一致。
- 实施后审计 D10-D14 已修复：Codex 组合语义由 Flower policy 审计，Update 具备跨版本沙箱预演和失败补偿，Check-All 使用专用只读角色，平台 dispatch 使用结构化 catalog，任务 completed/reopen 生命周期已激活。
- 最新 full Check-All 已通过：Node 352 项、Python 189 项及其余独立门禁全部通过；Update-Spec 结论为 `no-op`，Skill-Garden 与 flower-trellis 业务改动已推送，任务进度同步后进入 `completed`。
- 完成后返工已实施：`Request Triage` 保留全局意图、知识发现和 Active Task Scope Guard 语义，状态相关的 begin / prepare-edit / adopt / discard 下沉到条件 workflow-state；canonical、snapshot、compiled target 与 dogfood 已同步。
- Task Brief 展示结构已收敛：恢复 `Key Decisions`，保留 `Key Context`，继续删除 `Artifact Status`；planning readiness 与 freshness 由既有 owner 负责。

## 前置门禁

- [x] 包含 D10-D14 的最新 `brief.md` 已生成、完整展示，并在后续消息得到用户明确批准。
- [x] 任务状态已为 `in_progress`；不得重复运行 `task.py start`。
- [x] 通过 `trellis-route(target=implement)` 选择本轮执行模式。
- [x] 记录父仓与 `vendor/skill-garden` 的初始 Git 状态，不覆盖无关改动。
- [x] 保存官方 `0.6.5`、`0.6.12` npm 包和当前 61 条 preflight 失败清单作为审计证据。

## 1. 固定依赖与 0.6.12 Fixture

- [x] 把 `package.json` 的 `@mindfoldhq/trellis` 精确版本从 `0.6.5` 改为 `0.6.12`。
- [x] 更新 `package-lock.json`，确认 Trellis 和 Trellis Core 均解析到 `0.6.12`。
- [x] 确认 `trellisVersion()`、bundled bin 和 `syncGlobalTrellis()` 使用包内精确版本。
- [x] 用官方 `0.6.12` 初始化覆盖全部受支持平台的临时 fixture。
- [x] 重新运行 Patch preflight，保存 operation 级失败清单，确保总数和已归类的 61 条一致或能解释差异。

## 2. Python 控制面与状态完整性

### 2.1 Active-task

- [x] 以上游 `0.6.12` `active_task.py` 为基线重写 `runtime-state-integrity` 局部 replacement。
- [x] 保留上游新增函数参数、环境/单 session fallback 开关和平台 context key。
- [x] 合并 `missing/corrupt/io_error`、原子 flush/fsync、`ClearActiveTaskResult` 和显式删除失败。
- [x] 合并 fallback `previous.context_key` 清理修复。
- [x] 更新 `workflow-state-missing-task`，确保 corrupt/io_error 不进入 missing/no-task 路径。

### 2.2 Task store

- [x] 退役 `task-create-active-warning` operation，保留上游 `--no-start` 和分阶段激活诊断。
- [x] 验证初始 task 写失败清理逻辑继续生效。
- [x] 验证 parent/child 双文件快照、补偿和人工恢复诊断继续生效。
- [x] 保留 archive、set-branch、set-base-branch、set-scope 写失败返回非零。
- [x] 为上游新增 `set-meta` 增加同等写失败 Patch 与测试。
- [x] 验证 decision log 损坏仍 fail closed。

### 2.3 Session Context 更新边界

- [x] 重基线 imports selector/content，删除更新提示专用 import，但保留上游新增 `sys`。
- [x] 把 helpers selector 更新为匹配 `run trellis update` 后继续 remove。
- [x] 保留 constants/output remove/replace 语义和 `session-context-no-legacy-update-check` 断言。
- [x] 验证最终文件保留 polyrepo 上限与 Git timeout 修复。

## 3. Workflow、Route 与 Brief

### 3.1 workflow-state 局部化

- [x] 退役 489 行 whole-file replacement。
- [x] 分别建立 missing-task、untracked helper/import、breadcrumb、main 分支的局部 required Patch。
- [x] 为 operation 声明稳定顺序或依赖，保持 required/zero-write。
- [x] 验证最终 hook 保留 ZCode、`no-trellis`、Codex `auto`、上游异常边界和新平台识别。
- [x] 扩展现有多平台 targets，缺失平台保持 `missing-target`，不得创建未启用目录。

### 3.2 Codex 能力基线

- [x] 把 Flower 管理配置输出从 `sub-agent` 改为 `auto`。
- [x] 对已有显式 `inline` 做 Flower managed normalization，避免关闭 JSONL seed/readiness。
- [x] 保留旧 `sub-agent` 作为兼容读取输入，不再写出。
- [x] 更新配置、hook、task readiness 和 route 测试，证明实际模式只由 `trellis-route` 决定。

### 3.3 Phase 2 所有权

- [x] 重基线 Active Task Routing、Phase 2.1 和 Phase 2.2 sections。
- [x] Workflow 只保留 Flower policy owner 和 `trellis-route`/Check-All 指向。
- [x] 为 OMP、Grok、Kimi、Snow、Pi 等平台补准确 dispatch recipe。
- [x] 保证上游 workspace-write `trellis-check` 不会作为 Flower Check-All 替代。
- [x] 对不支持只读 subagent Check-All 的平台明确要求 inline。

### 3.4 Planning consent 与 Brief

- [x] 合并上游 Brainstorm Planning Contract、decision tracking 和 convergence gate。
- [x] 删除额外 final summary approval，最终只通过 `trellis-task-brief` handoff。
- [x] Brief 模板保留独立 Non-Goals、Key Decisions、Key Context 和一跳 Next Step，Risks/Deferred 按需生成；Key Decisions 不复制完整决策台账。
- [x] 删除 Artifact Status 的计算与展示；readiness 检查继续由既有权威 owner 承担。
- [x] 保留窄预授权和 `task.py start` missing/stale brief 硬门禁。
- [x] 增加规划实质变化后必须刷新/重新批准的回归测试。

## 4. 新平台与 Pi 迁移

- [x] `PLATFORM_FLAGS` 增加 `--omp`、`--grok`、`--kimi`、`--snow`。
- [x] 平台选择 UI/帮助文案与上游名称保持一致。
- [x] 把 Pi 强化 Skill target 从 `.pi/skills` 迁到 `.agents/skills`。
- [x] 共享 `.agents/skills` target 的 platforms 增加 Pi/Kimi，确保 neutral 内容逐字节一致。
- [x] 新增 OMP `.omp/skills`、Grok `.grok/skills`、Snow `.snow/skills` target。
- [x] Kimi 私有 `.kimi-code/skills` 继续由上游 entry/agent role 模板拥有，Flower 不重复投影。
- [x] 更新 stale path 清理，只有 hash/ownership 证明为旧 Trellis/Flower 产物时才移除 `.pi/skills`。
- [x] 扩展 Patch fixture、平台检测、目录投影和更新幂等测试。
- [x] Grok/Kimi 不创建项目 hook；OMP/Snow/Pi 按上游真实机制验证上下文与 dispatch。

## 5. Compatibility、Conflict 与最终产物

- [x] 把 `overrides/compatibility.json.testedVersions` 更新为仅 `0.6.12`。
- [x] 保留 `compatibleLine=0.6`、同线未测试 warning 和 required preflight fail-closed。
- [x] 更新 conflicts：移除已退役 operation 引用，新增 `set-meta` 和局部 workflow-state 最终产物断言。
- [x] 确认所有 conflict `whenOperations` 都存在且确实修改目标。
- [x] 确认 61 条失败均映射到已确认的设计合并或机械重基线，不留未解释 skip。
- [x] 生成 `vendor/skill-garden/compiled-targets/0.6.12/full`，删除旧精确版本目录由生成器负责。

## 6. 同步 canonical、快照与 dogfood

- [x] 所有 Skill-Garden 改动先落在 `vendor/skill-garden/.trellis/0.6/`。
- [x] Flower 平台配置 Patch 只落在 `src/patches/` 与现有 adapter/target owner。
- [x] 运行 `npm run sync`，刷新 `enhancements/0.6` 和 `enhancements/MANIFEST.json`。
- [x] 运行 Flower update 刷新当前 dogfood 输出，保留项目本地 config、用户 hook 和无关文件。
- [x] 比较 vendor canonical、enhancements、compiled targets 与 dogfood 的关键最终语义。
- [x] 检查 package `files` 白名单，确保发布包包含更新后的 `src` 与 `enhancements`，不包含 vendor。

## 7. 定向测试

- [x] Active-task：missing/corrupt/io_error、原子 replace 失败、clear 失败、fallback 清理和新平台 session key。
- [x] Task store：初始写、pair compensation、rollback incomplete、archive/set-*、set-meta 和 decision log。
- [x] Session Context：无原生 update hint，保留 polyrepo/Git timeout。
- [x] workflow-state：Flower 分支唯一，上游新增能力仍存在，9+ 平台 target 行为正确。
- [x] Codex：`auto` 输出、legacy 输入、inline preference、JSONL readiness、SubagentStart。
- [x] Brief：精简栏目、freshness、一次批准和变更后重批。
- [x] 平台：OMP/Grok/Kimi/Snow/Pi 的 flags、Skill roots、hooks、agent/route 配方与 stale cleanup。
- [x] Patch Engine：JS/Python parity、required zero-write、conflict policy、provenance 和幂等。

## 8. 全量门禁

按仓库脚本的实际可用命令执行并记录结果，至少覆盖：

```bash
npm test
npm run sync
npm run patch:targets
npm run patch:targets:check
node scripts/check-ai-context-budget.mjs
node scripts/check-ai-context-budget.mjs --strict
node bin/flower-trellis.js -v
node bin/flower-trellis.js update --dry-run --no-update-check
npm pack --dry-run --json
git diff --check
git -C vendor/skill-garden diff --check
```

- [x] `node bin/flower-trellis.js -v` 显示 bundled Trellis `0.6.12`。
- [x] 0.6.12 full fixture required preflight 和 conflict 审计无 error。
- [x] `testedVersions` 只在完整验证通过后最终保留 `0.6.12`。
- [x] context budget 不通过提高阈值掩盖重复规则。
- [x] npm tarball 包含正确快照且不包含 vendor/临时 fixture。

## 9. 收尾前检查

- [x] 对照 `prd.md` 与 `design.md` 逐项复核 acceptance。
- [x] 使用 `trellis-check-all` 执行最终 full-scope 检查。
- [x] 如形成长期契约，使用 `trellis-update-spec` 更新对应 spec。
- [ ] 提交与推送必须通过 `trellis-push`，不得手写 Git 收尾替代。

## 10. 实施后审计修复 D10-D14

### 10.1 Codex dispatch 组合语义

- [x] 把 Codex workflow-state hook banner 改为“`auto` 仅启用上下文/readiness 能力，执行位置由 `trellis-route` 决定”。
- [x] 同步 `.trellis/config.yaml` 注释、`trellis-meta` 和 route 文案，不再出现“auto 默认 subagent”或“inline 禁止 dispatch”的 Flower managed 表述。
- [x] 保留 managed `inline -> auto` normalization 与 legacy `sub-agent` 输入兼容。
- [x] 新增 conflict/assertion 与测试，组合校验 config、hook、route 语义，而不只校验单文件字面值。

### 10.2 Update 沙箱 dry-run 与补偿事务

- [x] 新建 Update snapshot/restore 模块，使用 Trellis `ALL_MANAGED_DIRS`、根 `AGENTS.md`、`.flower` 元数据和既有 Plugin state paths 构造安全路径闭包。
- [x] 透传 Plugin `onPreflight`，在 Transaction Writer 写入前把本轮 content/Patch mutation 外部路径扩展进 Flower 快照；原本不存在的父目录按最靠外缺失范围记录。
- [x] 与上游 backup 排除规则对齐，明确排除 task/spec/workspace/backlog/worktree、旧 backup、node_modules 和特殊文件；保存内容、存在性、mode 与 manifest。
- [x] 跨版本 `--dry-run` 在项目外沙箱执行真实 `trellis update`，再运行升级后 Plugin replay dry-run；目标项目和 `.flower` 保持逐字节不变。
- [x] 真实 update 在 Trellis 成功、Plugin replay 或后处理失败时自动恢复旧受管状态、删除本轮新增受管文件并恢复 `.flower`；保留新 `.trellis/.backup-*`。
- [x] config preserve 只在整链成功时落地；补偿失败输出未恢复路径、快照/备份位置和非零退出码。
- [x] 测试 same-version、cross-version、`--enhance-only`、`--no-enhance`、Plugin preflight failure、transaction failure、restore failure 和 zero-write。

### 10.3 专用 audit-only Check-All agent

- [x] 在 Skill-Garden canonical 中增加 Markdown、Codex TOML、Kiro JSON、Kimi/Reasonix frontmatter 等专用 `trellis-check-all` 角色模板。
- [x] 通过内容投影只向已启用且具备原生 agent discovery 的平台写入对应角色；新增 `.trellis/agents/check-all.md`。
- [x] 专用角色只读执行本地 `trellis-check-all`，返回 `CHK-*` / `DOC-*` 候选，禁止任何文件写入和普通问题自修。
- [x] 为所有既有 `trellis-check` 平台副本和 channel `check` 增加 Check-All intent guard，收到统一检查意图时拒绝并指向专用角色。
- [x] route subagent Check-All 只选择专用角色；实际 dispatch 时目标、launcher 或资格不可用则停止并让用户改选 inline，不使用通用/可写 agent 兜底。

### 10.4 结构化 dispatch catalog

- [x] 在 `trellis-route` canonical skill 中新增结构化平台能力清单，定义 schema 和稳定平台 ID。
- [x] 每个平台登记 implement launch、Check-All target/format、eligibility、inline-only reason 和 verification level。
- [x] 删除 route SKILL 中重复的手写全平台表，改为读取当前平台条目；保留统一 dispatch prompt contract。
- [x] 删除 `Step 0.25` 和路由前平台能力过滤；inline 不读取 catalog，subagent 选中后才解析当前平台条目。
- [x] 内容投影或闭包测试复用清单，校验所有声明 target 在官方 `0.6.12` full compiled target 中存在且格式可解析。
- [x] 平台新增长度测试改为集合/闭包断言，不再只断言静态 `ENHANCEMENT_SKILL_TARGETS.length`。

### 10.5 激活 completed 状态

- [x] 扩展 task progress 原子写入，支持正常 push 完成时同时写最终 progress、`status=completed` 和 `completedAt`。
- [x] `trellis-push` 先以 `in_progress` 写入并推送 final progress；只有 progress commit/push 成功后才本地请求 complete，partial、commit-only 和 auto-loop 内部提交保持 `in_progress`。
- [x] 本地 completed 变化由 finish-work archive bookkeeping commit 承接，不创建第二个 progress commit；完成态写失败只重试 helper。
- [x] `task.py archive` 改为只接受 completed，保留已有 completedAt，不再在移动前临时写 completed。
- [x] 增加显式 reopen 命令/路径：`completed -> in_progress`，清理 completedAt，保留可审计 progress。
- [x] 更新 `[workflow-state:completed]`、`trellis-continue`、`trellis-finish-work` 和 progress candidate scan。
- [x] 覆盖 complete 写失败、progress push 失败、session pointer 保留、completed candidate 恢复、reopen、archive 和 parent/child 行为。

### 10.6 同步与回归

- [x] 所有 managed template/skill/agent/script 改动先落 canonical，再 `npm run sync`、compiled target、dogfood update。
- [x] 更新 `enhancements-model.md`、`config-and-state.md`、Patch Engine 或 workflow-state contract 中对应长期契约。
- [x] 运行第 7、8 节全部门禁，并新增 update compensation、dispatch catalog、agent projection、completed lifecycle 的定向测试。
- [x] 最终 Check-All 必须证明 D10-D14 全部通过后，才能进入 Update-Spec 与 Push。

## 11. 升级后残余冲突复核

- [x] 修复 D14 顺序漂移：progress commit/push 失败时权威状态保持 `in_progress`，不再允许“本地已 completed 但未同步”。
- [x] 修复 D11 补偿闭包：Plugin preflight 新增的外部 owned path 在失败恢复时可还原旧内容或删除新文件/目录。
- [x] 修复 workflow 自定义说明：区分 native fork 与 Skill-Garden managed owner，移除直接编辑 managed dogfood 后运行上游 update 的误导。
- [x] 修复生命周期与 Check-All 文档：`completed` 不再标记 rare/dead，continue/meta route 指向 `trellis-route(target=check)` 和 `trellis-check-all`。
- [x] 为既有 managed dogfood 章节增加迁移 baseline，保证首次应用 fail-closed 且后续 marker 幂等。
- [x] 重跑 Patch conflict、compiled target、dogfood、上下文预算与全量测试，并把最终证据写回任务记录。

## 12. Git 收尾前平台检测修复 D15

- [x] 为共享 `.agents/skills` target 增加 Codex/Gemini/Pi/Kimi 各自的原生 implement 检测路径。
- [x] 修改 `detectPluginPlatforms()`，让自动检测按逻辑平台证据选择，同时保留显式平台选择和物理 target 去重。
- [x] 让 Skill-Garden compatibility fallback 复用同一检测结果，并让普通 Plugin 生命周期无显式选择时复用既有 state 平台。
- [x] 新增部分共享消费者与全共享消费者测试，并验证仅 Claude/Codex 时不创建 `.gemini`、`.pi`、`.kimi-code`。
- [x] dogfood state 已从五个平台收敛为 `claude/codex`，误投影文件按 Plugin ownership 删除，空目录精确清理，第二次更新 0 变化。
- [x] 重跑完整 Check-All，确认 D15 与测试契约修复无剩余 CHK。
- [x] 据最新文件集合重新生成并执行 Trellis Push 计划。

验证证据：最新重检中 352 个 Node 测试和 189 个 Python 测试全部通过；Patch conflict、compiled targets、strict context budget、真实 update dry-run、npm pack、双仓 diff check、canonical/snapshot 逐文件比较和 dogfood 平台 state/目录检查均通过。Skill-Garden 提交并同步快照后，`check-snapshot.mjs` 通过，确认 `enhancements` 与 submodule pin 一致。

## 13. 完成后返工：Request Triage 常驻上下文精简

- [x] 把 canonical `Request Triage` 从 15 条压缩为 7 条，保留 discuss / inspect、direct_edit / task_plan、Project Knowledge Discovery、Active Task Scope Guard 和最新显式 switch 的全局语义。
- [x] 把 `untracked_flow.py begin`、`prepare-edit`、`task_intent.py adopt` 与 `discard` 的确定性命令移入 no-task、untracked 和 planning 状态，避免所有 SessionStart 常驻加载。
- [x] 保留 Active Task Scope Guard 的全局 owner，避免历史上仅由 active state 承担时 planning 入口漏检的回归。
- [x] 更新 Hub owner、conflict policy、JS/Python owner 测试和 `enhancements-model.md` 长期契约。
- [x] 运行 `npm run sync`、Patch conflict、compiled target 生成/检查和 dogfood Plugin replay。
- [x] strict context budget 通过；`Request Triage` 从 5303 B / 15 行降到 2934 B / 7 行。
- [x] 全量验证通过：Node 352 项、Python 189 项、Patch conflict、compiled target、strict context budget、source/snapshot diff、dogfood 二次 replay 0 变化和 npm pack dry-run 均通过。
- [x] 首轮 Check-All 发现 `CHK-001`：迁移命令时遗漏了 `same-item`、`active-work-conflict`、`prepare-edit` 失败关闭、知识查询构造和状态提示触发语义。
- [x] 在保持 `Request Triage` 7 行的前提下补回全局查询/提示规则，并在 no-task、untracked state 补齐结构化结果与失败关闭规则；最终大小为 3090 B，仍比原版缩小约 42%。
- [x] 强化 conflict policy 与 JS/Python owner/consumer 测试；Patch conflict、compiled target、strict context budget、source/snapshot diff、Python 20 项和定向 Node 23 项均通过，dogfood 二次 replay 0 变化。
- [x] 运行本轮最终 Check-All；三件套实现、实现假设、完整性与规范均通过，无剩余 `CHK-*`。

## 14. 完成后返工：删除 route 平台能力前置探测

- [x] 删除 canonical `trellis-route` 的 `Step 0.25` 及其路由前 host/agent 能力探测。
- [x] route 选项不再按平台能力裁剪，已有 subagent 偏好也不因预探测失败变成 miss。
- [x] 保留结构化 dispatch catalog，仅在 subagent 已选中后读取当前平台条目并尝试启动。
- [x] launcher、target 或资格不可用时在 dispatch 边界明确停止并让用户改选 inline，禁止静默 fallback。
- [x] 同步 snapshot、compiled target 和 dogfood 输出，并确认二次 replay 为 0 变化。
- [x] 运行 route/catalog 定向测试、Patch conflict、strict context budget 和双仓 diff check。

验证证据：Node route/catalog 定向测试 11 项通过，Python Patch 测试 20 项通过；Patch conflict、compiled target check、strict context budget、canonical/snapshot/dogfood 逐字节比较和双仓 `diff --check` 通过。发布级 `check-snapshot.mjs` 因 `vendor/skill-garden` 尚有本任务未提交改动而按设计拒绝执行，需两仓提交并更新 submodule pin 后再运行。

## 15. 完成后返工：精简 Task Brief 展示结构

- [x] 当时从 canonical `trellis-task-brief` 的提取规则、模板和重述格式中删除 `Key Decisions`，保留 `Key Context`；该决定随后在第 16 节复核并恢复。
- [x] 删除 `Artifact Status` 的动态计算、对话展示和 Brainstorm handoff 文案。
- [x] 保留 Brainstorm Quality Bar、Open Questions、JSONL readiness 和 `task.py start` freshness guard 的原有 owner 边界。
- [x] 更新 Brief 预授权测试、conflict policy、长期规范与当前任务三件套。
- [x] 同步 snapshot、compiled target 和 dogfood，并确认二次 replay 为 0 变化。
- [x] 运行 Brief 定向测试、Patch conflict、strict context budget 和双仓 diff check。

验证证据：Brief/Workflow/应用链 Node 定向测试 20 项通过，task start 与 Skill-Garden Patch Python 测试 32 项通过；Patch conflict、compiled target check、strict context budget、canonical/snapshot/dogfood 逐字节比较和双仓 `diff --check` 通过。首次 dogfood replay 更新 4 项，第二次为 0 变化。

## 16. 完成后返工：恢复 Brief Key Decisions

- [x] 在 canonical `trellis-task-brief` 的提取规则、模板和 in-progress 重述中恢复 `Key Decisions`。
- [x] `Key Decisions` 只提炼影响实施批准的最终选择及其影响，不复制完整决策台账。
- [x] 更新 Brainstorm summary shape、conflict policy、Brief 定向测试、长期规范和当前任务材料。
- [x] 同步 snapshot、compiled target 和 dogfood，并确认二次 replay 为 0 变化。
- [x] 运行 Brief 定向测试、Patch conflict、strict context budget 和双仓 `diff --check`。

验证证据：首次 dogfood 重放更新 4 项，第二次为 0 变化；Brief Node 定向测试 2 项、Skill-Garden Patch Python 测试 20 项、task start Brief gate Python 测试 12 项通过；完整 `npm test` 通过，Patch conflict、compiled target check 和 strict context budget 均通过。

## 17. 完成后返工：补齐 trellis-meta 生命周期语义

- [x] 在 `task-system.md` 补入 `brief.md` 的规划交接角色，并明确 `task.json.status`、planning artifacts、progress recovery evidence 的权威边界。
- [x] 补齐正常完成、completed candidate 恢复、显式 reopen 与 finish-work/archive 的状态链；候选恢复禁止自动绑定 session。
- [x] 更新 `change-task-lifecycle.md`，把 Brief 激活、progress、push completion、continue recovery、reopen 和 archive 路由到真实 owner。
- [x] 删除 `change-workflow.md` 中固定的旧 continue route table，改为读取当前 workflow、`trellis-continue` 和 `task_progress.py` owner。
- [x] 更新 workflow owner map、conflict policy、Meta JS/Python 测试与长期规范，防止静态 route table、旧 Check 文案或完成态语义再次漂移。
- [x] 从 Skill-Garden canonical 源同步 snapshot、compiled targets 和当前 `.agents` / `.claude` dogfood，第二次 replay 为 0 变化。
- [x] 运行 Meta 定向测试、Patch conflict、compiled target check、strict context budget、canonical/snapshot/dogfood 一致性和双仓 diff check。

验证证据：Meta Node 专项 4 项、Python Patch 专项 3 项通过；Patch conflict 检查覆盖 43 个 Patch、131 个 operation、829 个 ready target 且 0 warning；compiled target 749 个文件、374 个变更 target 无漂移；strict context budget 通过；8 个 dogfood Meta 关键文件与 `0.6.12` compiled target 逐字节一致，第二次 enhance-only replay 为 0 变化。

## 18. Check-All 修复：Meta owner 路由对齐

- [x] 把 untracked task adoption 的稳定 owner 从旧 Request Triage 路由改为 `workflow-state:untracked`、`trellis-brainstorm` 与 `task_intent.py adopt`。
- [x] 区分候选恢复的用户决策、候选证据与 session pointer 写入：分别由 `trellis-continue`、`task_progress.py`、`task.py start` / `common/active_task.py` 所有。
- [x] 把 completed-task reopen 独立路由到 `task_progress.py reopen`，不再与 candidate rebind 合并成一个模糊 owner 行。
- [x] 强化 shared/Claude conflict policy 与 JS/Python final-output 测试，并禁止旧 owner 行重新出现。
- [x] 同步 snapshot、compiled target 和 dogfood，完成定向验证与 full Check-All 重检。

验证证据：Meta Node 专项 4 项、Python Patch 专项 3 项通过；完整 `npm test` 通过 352 个 Node 测试和 189 个 Python 测试；Patch conflict 覆盖 43 个 Patch、131 个 operation、829 个 ready target 且 0 warning；compiled target、strict context budget、真实 update dry-run、npm pack、canonical/snapshot、8 个 dogfood Meta 文件 hash 和双仓 `diff --check` 均通过，第二次 enhance-only replay 为 0 变化。`check-snapshot.mjs` 仅因子仓存在本任务未提交改动而命中预期 Git-stage 门禁。
