# Patch 顺序依赖与 Target 编译层

## Goal

为 skill-garden 0.6 Patch Engine 增加可验证的 operation 显式顺序/依赖契约，并生成受版本控制的最终 target 编译层，让维护者能够直接审查“Patch 声明如何组合”以及“受测 Trellis 基线最终会变成什么内容”。

## Background

- 当前 Patch 顺序由 Bundle `patches` 数组、Patch `operations` 数组以及 catalog 加载顺序共同决定；同一目标文件通过 `filePlan.next` 依次累积修改，但 operation 本身不能表达顺序或强依赖。
- `scripts/check-patch-conflicts.mjs` 已使用当前锁定的 `@mindfoldhq/trellis` 生成全平台临时项目，执行 Skill-Garden + Flower 完整 Patch plan 和冲突检查；该矩阵适合自动验证，但不适合作为人工审阅产物整体提交。
- 当前 catalog 包含 212 个 target 声明、117 个唯一 target 路径；dogfood 项目中实际存在的 24 个最终目标约 297 KiB。
- 当前 32 个 Skill-Garden Patch 叶子包含 131 个 selector/baseline/content 资产，全部都被声明引用，没有可直接删除的孤儿文件。
- `hooks/inject-workflow-state/shared-runtime` 同时被 `intent-routing` 与无 alias 的 `shared-hook-runtime` Bundle 引用；全量计划会去重执行，但 Bundle provenance 被后加载者覆盖。
- `hooks/session-start/pre-check-hold/claude-selector.py` 与 `codex-selector.py` 字节完全相同，是当前唯一重复资产。
- `trellis-brainstorm`、`workflow/intent-routing` 等目录按功能语义拆分 Patch；即使多个 Patch 由同一 Bundle 选择并修改同一目标，这种布局仍让维护者可以按具体规则定位 selector、baseline 和 content。
- `workflow/state-missing-task` 以完整缺失任务恢复能力为所有权边界，同时修改 workflow 与必要 Python helper；当前结构优先表达产品能力，而不是强制每个 Patch 只触碰一种文件类型。
- 已生成的 Flower 全平台结果包含 107 个最终文件与 106 个 diff，共 214 个产物；65 个最终文件属于重复内容组。全部提交会放大仓库体积和评审噪声，而不会同比增加人工审阅价值。
- Skill-Garden README 将 0.6 Patch 的正式独立安装边界描述为 Claude Code + Codex 双端通用；`.trellis/**`、`.agents/**`、`.claude/**`、`.codex/**` 是可提交审阅层应覆盖的核心 profile。
- JS `src/lib/patch-engine.js` 与 Python `vendor/skill-garden/scripts/apply-trellis-patches.py` 是正式双消费者，协议变化必须保持结构化结果与错误语义一致。

## Confirmed Direction

- operation 顺序不采用数值 `priority` 作为业务契约。
- operation 支持 `after` 纯顺序关系和 `dependsOn` 强依赖关系；不同时提供语义重复的 `before`。
- `dependsOn` 隐含执行顺序，并要求依赖 operation 被选中且成功；`after` 只影响同时被选中 operation 的相对顺序。
- 无依赖关系的 operation 使用现有声明顺序作为稳定 tie-breaker。
- 最终顺序通过拓扑排序解析；未知 ID、自依赖和循环依赖必须在任何目标写入前失败。
- target 编译层按最终目标文件集中保存，不在每个 Patch 叶子目录复制完整文件。
- target 编译层首版只生成全量安装的 `full` 最终形态；精细 Bundle 继续通过 plan、alias closure 与集成测试验证，不保存独立编译快照。
- target 编译层是生成产物，每次相关 Patch、Bundle、policy、adapter 或受测 Trellis 基线变化时自动刷新，并由 CI 校验无漂移。
- target 编译层提交到 Skill-Garden Git 供维护和评审，不进入 Flower `enhancements/0.6` 或 npm 发布包。
- compiled target 只提交结构化 plan，以及同一 `targets/` 树中并排保存的最终文件与 `.diff` sidecar，不重复保存完整原始 Trellis 文件树。
- compiled targets 工作树只保留当前项目锁定的 Trellis 精确版本；升级时替换旧版本目录，历史版本结果由 Git 历史保留。
- `full` 只表示选择 Skill-Garden catalog 的全部 Bundle/Patch，不再隐含初始化全部 Trellis 平台。
- 可提交 compiled target 使用 Skill-Garden 的 Claude/Codex 核心 profile，只加载 `skill-garden` catalog，展示独立安装器所拥有的最终状态。
- compiled target 位于 Skill-Garden 仓库 `compiled-targets/<trellis-version>/full/`；Flower 自有 catalog 不进入该产物。
- Flower 继续用全平台临时项目加载 Skill-Garden + Flower 两个 catalog，执行 coverage、compatibility、conflict 与最终计划验证，但不把该矩阵的 files/diffs 提交到 Git。
- compiled target 首版只提供仓库维护脚本，不增加用户可见的 flower-trellis CLI 子命令。
- 保持现有 feature-oriented overrides 目录和 Patch 粒度，不合并 `trellis-brainstorm`、`workflow/intent-routing`、SessionStart 等功能模块；显式 operation 顺序用于解决组合关系，而不是通过目录合并消除关系。
- 本任务不删除或去重现有 overrides 文件：多 Bundle 引用视为合法多归属，完全相同但分属平台 operation 的 selector 继续作为模块本地资产保留。
- `after`/`dependsOn` 只声明真实语义关系；修改同一 target 但作用区域互不重叠的 operation 不强制建立依赖边，仍由稳定声明顺序执行并在 plan 中展示。
- 本任务同步落地面向未来下游插件的最小 catalog namespace/qualified reference 扩展口，但不实现插件发现、安装、市场和动态代码 adapter。

## Requirements

### R1. Operation 顺序声明

- Patch schema 支持可选 `after: string[]` 和 `dependsOn: string[]`；裸 ID 引用所属 catalog 的 operation，`<catalog-id>/<operation-id>` qualified ID 用于跨 catalog 引用。
- 字段必须是无重复的合法 local/qualified operation ID 数组；local ID 与 qualified ID 的每个片段均使用小写连字符格式。拒绝未知 ID、自引用、同一 ID 同时重复声明及循环依赖。
- `dependsOn` 必须校验 selection closure；依赖没有进入当前 full/selected plan 时阻断，而不是静默忽略。
- `after` 引用未被当前计划选择的 operation 时不阻断，只有双方同时选中时建立排序边。
- 拓扑排序必须稳定：没有依赖边约束的节点保持当前 Bundle/Patch/operation 声明顺序。
- 不根据相同 target 自动生成依赖边，也不要求同一文件的全部 operation 形成完整顺序链。
- `trellis-brainstorm` 作为正式 dogfood 案例同时覆盖两类关系：`brainstorm-auto-task-create dependsOn brainstorm-planning-authorization` 表达强 selection/语义依赖；`brainstorm-planning-readiness after brainstorm-planning-handoff` 表达同一 Quality Bar 变换的必要应用顺序。两组之间不建立虚假依赖，其它 catalog 也只在存在真实关系时增加边。

### R2. Plan 与 Provenance

- `preparePatchPlan()` / `prepare_patches()` 返回解析后的全局 operation 顺序。
- 每个 target 的 plan 必须记录实际 operation 顺序、所属 Patch、全部选中 Bundle 和排序来源。
- Patch 同时被多个 Bundle 引用时不得用最后一个 Bundle 覆盖 provenance；应保留稳定去重后的 Bundle 集合。
- JS/Python consumer 对成功顺序、未知依赖、selection closure、循环依赖和结构化诊断保持一致。

### R3. Compiled Target 生成

- 生成器归 Skill-Garden 所有，复用独立安装器的 Python Patch consumer、compatibility 和 conflict evaluator，不实现第二套变换逻辑。
- 输入使用项目锁定的受测 `@mindfoldhq/trellis`，以 Claude + Codex 参数生成干净核心 profile；Trellis core、`.agents`、`.claude` 与 `.codex` 共同构成可提交目标集。
- 输出包含 `plan.json` 和 `targets/`：最终文件按原相对路径保存，changed target 在同一路径旁增加 `<target>.diff` sidecar；所有输出必须确定性、机器无关且不包含临时绝对路径、时间戳或用户名。
- 首版只生成 Skill-Garden full catalog 的一套最终文件树，不为 `full-or-selected` Bundle、alias 或其它平台组合生成重复 target 树。
- `plan.json` 至少记录 Trellis 版本、catalog hash、生成模式、target before/after hash、operation 顺序、Patch 与 Bundle 来源。
- 只保存实际进入 plan 的最终 target；正常 missing target 记录在 plan 中，不创建虚假最终文件。
- 不保存完整 `original/` 文件树；原始基线由锁定 Trellis 包确定性生成，diff 使用稳定逻辑路径作为文件标签。
- 生成前必须验证最终文件路径与 `.diff` sidecar 不发生同名或文件/目录前缀冲突；冲突时失败，不覆盖真实 target。
- 生成器必须校验输出根下最多存在一个版本目录且与当前锁定 Trellis 版本一致；版本升级刷新时删除上一版本生成目录，再生成当前版本结果。

### R4. Source 与发布边界

- 编译层固定放在 Skill-Garden 仓库 `compiled-targets/<trellis-version>/full/`。
- 生成脚本与产物由 Skill-Garden 子仓提交；Flower 主仓只记录更新后的 submodule 指针。
- `npm run sync` 不得把 compiled targets 复制到 `enhancements/0.6`；Flower `package.json.files` 不包含 vendor 子仓，因此 npm tarball 不得携带该目录。
- 生成目录不得成为运行时输入或 Patch source of truth；运行时仍只消费 Patch、Bundle、policy 和 adapter。
- 可提交生成器只加载 Skill-Garden overrides。Flower 的多 catalog、adapter 与全平台组合继续由主仓临时 fixture 和冲突门禁验证。

### R5. Refresh 与校验

- 提供单一生成命令刷新 compiled targets，并提供 check 模式验证已提交结果与重新生成结果逐字节一致。
- Skill-Garden 提供独立生成/check 脚本；Flower package scripts 仅作为开发期便利入口调用子仓脚本并传入锁定 Trellis executable。
- `npm test` 或发布前检查必须包含 compiled target 漂移校验。
- `scripts/check-patch-conflicts.mjs` 继续复用 Flower 的全平台 pinned fixture；Skill-Garden target 生成器复用 Python consumer。两条路径分别验证集成矩阵与独立发布边界，并通过 parity 测试约束协议一致性。
- 修改 Patch 后未刷新 compiled targets 时，CI 必须给出明确修复命令。

### R6. Review 可读性

- 生成结果应允许维护者从 target 文件反查 contributing operations。
- 对同一目标的 operation 顺序变化，即使最终文本碰巧相同，也必须体现在 `plan.json` diff 中。
- 每个 changed target 在最终文件旁生成 `<target>.diff`，保留必要上下文并使用 `a/<target>`、`b/<target>` 稳定标签，便于在同一目录直接对照。
- Git diff 只包含真实变化；生成器重复运行必须零变化。

### R7. Overrides 结构稳定性

- 保持当前按 feature/owner 定位的 Patch 目录与叶子模块，不为了减少文件数执行跨模块合并、搬迁或统一命名重构。
- selector、baseline、content、compatibility 和 conflict policy 仍是必要输入；不得仅因 compiled target 可查看最终文件就删除这些安全契约。
- 同一 Patch 被多个 Bundle 引用时保留全部归属并在 plan/provenance 中稳定去重记录，不通过删除 Bundle 改写能力边界。
- 平台本地 selector/content 即使当前字节相同也保持自包含，不抽取跨 operation 共享资产。
- compiled targets 作为 Skill-Garden 仓库顶层独立生成层，不进入 `.trellis/0.6/overrides`、运行时 Patch catalog 或 Flower `enhancements/0.6` 发布快照，也不被 `npm run sync` 复制。

### R8. 下游插件扩展边界

- 每个 catalog descriptor 必须具有稳定小写连字符 `id`；内置 ID 固定为 `skill-garden` 与 `flower`。
- Patch、Bundle、operation ID 改为 catalog 内唯一；全局身份使用 `<catalog-id>/<local-id>` qualified ID。
- `after`/`dependsOn` 中裸 ID 只解析当前 catalog，qualified ID 显式引用其它 catalog；未知 catalog、未知 operation、自引用和跨 catalog 循环均在 preflight 阶段失败。
- plan、diagnostic、catalog hash 与 provenance 必须携带 catalog 和 qualified identity，避免不同插件使用相同本地 ID 时冲突或产生不稳定审计结果。
- 当前 Skill-Garden/Flower managed marker 必须保持逐字兼容；未来非内置 catalog 的新 marker 使用带 catalog 前缀的 qualified operation ID，防止多个插件修改同一 target 时 marker 冲突。
- Bundle 多归属、精细选择和 conflict rule 引用必须能区分 catalog；现有未限定 ID 在所属内置 catalog 中继续兼容解析。
- catalog descriptor 可携带可选的声明式 compatibility/conflict policy 文件；policy 参与 catalog hash，规则 ID 和 operation 引用按所属 catalog namespace 解析，多 catalog policy 共同预检并聚合诊断。
- 第三方插件默认只能贡献声明式 Patch/Bundle/policy，并使用 Core selector；不得默认加载任意 JS/Python adapter 代码绕过 Patch Engine 安全契约。
- synthetic 第三方 catalog 测试必须证明两个 catalog 可复用相同本地 Patch/Bundle/operation ID，并通过 qualified identity、marker、依赖、plan 和 provenance 正确隔离。
- 插件发现、安装、卸载、市场分发、公开 SDK、动态 adapter 加载和权限授权不进入本任务；未来插件层只负责验证来源并把 catalog descriptor 交给 Patch planner。

## Acceptance Criteria

- [x] AC1：JS/Python consumer 均支持 `after`、`dependsOn` 和稳定拓扑排序，且共享 fixture 对完整结构化计划结果一致。
- [x] AC2：未知依赖、自依赖、循环依赖及未满足的 `dependsOn` selection closure 在 preflight 阶段失败并保持全部目标零写入。
- [x] AC3：`trellis-brainstorm` 的最终计划明确包含 `authorization -> auto-task-create` 的 `dependsOn` 边和 `planning-handoff -> planning-readiness` 的 `after` 边，并证明两组无关 operation 仍按稳定声明顺序执行。
- [x] AC4：Skill-Garden full catalog 可从锁定的 Trellis 版本和 Claude/Codex 核心 profile 生成确定性的 `plan.json` 与最终 target 文件树，连续生成两次文件树不变。
- [x] AC5：任意 Skill-Garden Patch/content/Bundle 顺序变化导致相关 compiled target 或 plan 发生可审查 diff；未刷新时 check 命令失败并给出刷新命令。
- [ ] AC6：compiled targets 提交到 Skill-Garden Git；Flower 仓库不保留全平台 files/diffs，`npm pack --dry-run --json` 与 `enhancements/0.6` 快照均不包含该目录。（目录与发布边界已验证，待 Phase 3.4 提交）
- [x] AC7：现有 compatibility、conflict、required/optional、alias 精细安装、legacy migration、幂等和零写入契约保持通过。
- [x] AC8：Patch Engine 规范、目录规范、测试矩阵和维护命令同步更新到新的仓库归属与平台边界。
- [x] AC9：两个 synthetic catalog 可复用相同本地 Patch、Bundle、operation ID，并通过 qualified identity、依赖解析、marker、plan、conflict evidence 与 provenance 保持隔离；现有内置 marker 保持字节兼容。

## Out Of Scope

- 用数值优先级替代显式依赖关系。
- 同时提供 `before` 和 `after` 两套等价方向语法。
- 把 compiled targets 作为安装输入、运行时 fallback 或用户项目自动恢复来源。
- 为任意用户自定义文件保存通用最终快照；编译层只针对受测、确定性的 Trellis 基线。
- 为精细 Bundle 或 alias 组合保存独立 compiled target 文件树。
- 把全部 Trellis 平台的最终 files/diffs 提交到任一仓库；全平台组合只作为临时集成验证。
- 保存完整原始 Trellis target 文件树。
- 在工作树同时保留多个历史 Trellis 版本的 compiled target 目录。
- 增加公开的 `flower-trellis patch preview` 或其它用户 CLI/API。
- 实现插件发现、安装、卸载、市场分发、公开 SDK 或动态第三方 adapter 加载。
- 本任务不顺带实现 Patch apply 的跨文件事务回滚。
- 不把所有修改同一物理文件的 operation 强行合并成一个超大 Patch；仍保留独立 Bundle、独立兼容边界和独立产品所有权。
- 不合并或迁移现有 `trellis-brainstorm`、`workflow/intent-routing`、SessionStart、missing-task 等 Patch 模块。
- 不删除、合并或抽取现有 Bundle、selector、baseline、content 资产。
