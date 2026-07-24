# Patch 顺序依赖与 Target 编译层设计

## 1. 设计目标

在不改变 Patch Engine 现有变换职责和 overrides 功能目录的前提下，建立三个可长期演进的边界：

1. operation 通过显式关系形成可验证、可审计的全局执行顺序。
2. catalog 具有稳定命名空间，使未来下游 Flower 插件能安全贡献声明式 Patch。
3. full install 的最终 target 结果成为确定性、可版本控制的维护产物。

本设计不把 compiled targets 变成运行时输入，也不提前实现插件发现或动态代码加载。

## 2. 总体架构

```text
catalog descriptors
  -> catalog load / schema normalize
  -> global qualified identity index
  -> Bundle selection + multi-membership
  -> dependency validation + stable topo sort
  -> existing target preflight / in-memory apply
  -> compatibility + conflict evaluation
  -> apply to user project
  -> provenance v2

Skill-Garden canonical fixture (Claude + Codex)
  -> Python consumer / Skill-Garden policy
  -> skill-garden/compiled-targets/<version>/full/{plan.json,targets/}

Flower full-platform fixture
  -> JS multi-catalog plan / adapters / policies
  -> ephemeral coverage + compatibility + conflict validation
```

顺序解析只发生一次，位于 catalog 加载与 target 计算之间。target apply 继续按解析后的 operation 列表顺序累积 `filePlan.next`，不在 selector、adapter 或单文件层重复处理依赖。

## 3. Catalog Descriptor 与身份模型

### 3.1 Descriptor

JS planner 的 catalog descriptor 收敛为：

```js
{
  id: "skill-garden",
  patchesDir: ".../patches",
  bundlesDir: ".../bundles",
  policy: {
    compatibilityFile: ".../compatibility.json",
    conflictsFile: ".../conflicts.json"
  },
  markerIdentity: "legacy"
}
```

- `id` 必填，使用小写连字符格式，同一次加载不可重复。
- 内置 catalog 固定为 `skill-garden`、`flower`。
- `policy` 可选，只接受 Core 已知的声明式 compatibility/conflict 文件路径；Flower catalog 当前可省略，Skill-Garden 指向现有两个 policy 文件。
- `markerIdentity` 是 Core 调用侧构造的内部信任属性，不进入第三方 catalog manifest；未来插件加载层只能为第三方构造 `qualified`。
- 现有自由文本 `name` 不再承担身份语义；如需日志展示，使用 `id`。

Python 独立安装器的公开 `prepare_patches(overrides_dir, target_root, skills)` 签名保持兼容，内部将 overrides 包装为固定 `skill-garden` descriptor。Python 实现相同的 identity/ref/order 规则；由于独立安装器只加载 Skill-Garden catalog，跨 catalog 引用会作为未知 catalog 失败。多 catalog 共存和第三方隔离由 Flower JS planner 覆盖测试。

### 3.2 Local 与 Qualified ID

- Patch、Bundle、operation ID 只要求在所属 catalog 内唯一。
- 全局身份统一为 `<catalog-id>/<local-id>`。
- Patch ref 路径继续只在 Bundle 所属 catalog 内解析，不改为跨 catalog 文件引用。
- `after`、`dependsOn` 的裸 ID解析为当前 operation 所属 catalog；含 `/` 的引用按 qualified operation ID 解析。
- catalog ID 与 local ID 各自都必须满足小写连字符格式；拒绝多余 `/`、空片段和路径语义。

规范化后的 operation 至少包含：

```js
{
  id: "brainstorm-planning-handoff",
  catalog: "skill-garden",
  qualifiedId: "skill-garden/brainstorm-planning-handoff",
  patchId: "trellis-brainstorm-planning",
  qualifiedPatchId: "skill-garden/trellis-brainstorm-planning",
  after: [],
  dependsOn: ["skill-garden/brainstorm-auto-task-create"],
  declarationIndex: 17
}
```

## 4. Schema 与兼容策略

### 4.1 Patch schema

Patch `schemaVersion` 保持 `2`。`after` 与 `dependsOn` 是 operation 的可选加法字段，未声明时等价于空数组，因此无需为兼容性引入新的 major schema。

字段校验：

- 必须是字符串数组，允许空数组但建议省略。
- 数组内不得重复。
- 同一引用不得同时出现在 `after` 与 `dependsOn`；强依赖已经隐含顺序。
- normalize 阶段验证引用语法；完整 catalog 索引建立后验证引用目标、自引用和循环。

### 4.2 Plan 与 provenance

`preparePatchPlan()` 保留现有本地展示字段，同时增加权威 qualified 字段：

- `selectedBundles[]`：`{id,catalog,qualifiedId}`。
- `selectedPatches[]`：`{id,catalog,qualifiedId,bundles[]}`。
- `operationOrder[]`：按最终顺序记录 operation identity、Patch、Bundle 多归属和关系来源。
- `catalogOperations[]`：增加 catalog、qualified ID、qualified Patch 和 targets；冲突检查使用 qualified identity。
- `results[]`：保留 `id/patch/bundle`，增加 `catalog/qualifiedId/qualifiedPatch/bundles`。
- `files[].operationEntries[]`：成为 target provenance 的权威结构；现有 `operations/patches/bundles` 数组仅为迁移期兼容投影。

apply provenance 升级到 `schemaVersion: 2`：

```json
{
  "schemaVersion": 2,
  "catalogHash": "sha256:...",
  "applied": [
    {
      "id": "brainstorm-planning-handoff",
      "qualifiedId": "skill-garden/brainstorm-planning-handoff",
      "catalog": "skill-garden",
      "patch": "trellis-brainstorm-planning",
      "qualifiedPatch": "skill-garden/trellis-brainstorm-planning",
      "bundle": "intent-routing",
      "bundles": ["skill-garden/intent-routing"],
      "target": ".agents/skills/trellis-brainstorm/SKILL.md",
      "status": "applied",
      "resultHash": "sha256:..."
    }
  ]
}
```

`id`、`patch`、`bundle` 保持本地值，降低现有 manifest 审计与测试迁移成本；新逻辑不得再用这些字段做全局唯一判断。`bundle` 取稳定 Bundle 集合的第一项作为兼容投影，`bundles` 保存全部 qualified 归属。

## 5. Bundle 选择与多归属

catalog loader 先完整读取 Patch、operation 与 Bundle，再计算选择结果：

1. 每个 Bundle 的 Patch ref 只解析本 catalog 的 `patchByRef`。
2. 每个 Patch 记录所有引用它的 Bundle，用首次遇到顺序稳定去重。
3. full/selected 模式决定哪些 Bundle 被选择。
4. selected Patch 是所有已选 Bundle 的 Patch 并集，首次选择位置决定基础声明顺序。
5. 一个 Patch 被多个已选 Bundle 引用时只执行一次，但保留全部 Bundle membership。

此模型修复当前“最后一个 Bundle 覆盖 provenance”的问题，同时不删除合法的重复 Bundle 引用。

## 6. 稳定拓扑排序

### 6.1 建图阶段

在全部 catalog 完整加载并完成 Bundle selection 后：

1. 建立所有已声明 operation 的 `qualifiedId -> operation` 索引。
2. 为已选 operation 建立节点，基础优先序为 `declarationIndex`。
3. `dependsOn`：引用必须存在且被选择，建立 `dependency -> current` 边；未选择即 selection closure 错误。
4. `after`：引用必须在完整索引中存在；若双方均选择，建立 `referenced -> current` 边；引用存在但未选择则不建边。
5. 自引用、重复边和跨 catalog 循环在 target preflight 前失败。

未知 ID 即使出现在未选择 Patch 中也应在 catalog schema preflight 阶段失败，避免损坏 catalog 因当前过滤条件而被隐藏。`dependsOn` 是否被选择则只对已选 operation 判断。

### 6.2 排序算法

JS/Python 均使用稳定 Kahn 算法：

- 入度为 0 的候选按 `declarationIndex` 升序取出。
- 新变为入度 0 的节点插入同一有序候选集合。
- 输出数量小于节点数量时，从未输出节点和剩余边构造确定性 cycle path 诊断。

禁止用对象键、Set 迭代偶然顺序或数值 priority 决定结果。无关系节点的最终顺序必须逐项等于当前声明顺序。

### 6.3 排序来源审计

`operationOrder[]` 为每个 operation 记录：

- `declarationIndex`。
- 解析后的 `after[]`、`dependsOn[]` qualified ID。
- `incomingEdges[]`，每条包含 `from` 与 `type`。
- `resolvedIndex`。

不额外为“同 target”创建边。若多个 operation 修改同一 target 但区域不重叠，它们仅由稳定声明顺序决定。

## 7. Marker 与迁移

- `skill-garden` 和 `flower` 使用 `markerIdentity: legacy`，marker 继续是 `skill-garden patch <local-operation-id> v0.6`，保证已安装文件逐字兼容。
- 非内置 catalog 使用 `markerIdentity: qualified`，marker ID 使用 `<catalog-id>/<operation-id>`。
- Core 调用点维护内置 descriptor；未来外部插件 manifest 无权直接指定 legacy marker 模式。
- active marker、legacy marker、cleanup 和 baseline 逻辑继续在现有 Patch Engine 中执行，不因 catalog 扩展允许任意清理脚本。

## 8. Compatibility 与 Conflict Policy

- 每个 catalog 可选携带声明式 compatibility/conflict policy，加载结果携带 owner catalog ID；policy 文件内容参与该 catalog hash。
- 多 catalog compatibility 共同预检目标 Trellis 版本：任一 error 阻断，warning/info 稳定聚合；未声明 compatibility 的 catalog 继承 Core 已通过的上游兼容边界，不自行扩大支持版本。
- `whenOperations` 裸 ID按 policy owner catalog 解析，qualified ID允许引用其它已加载 catalog。
- evaluator 先以 `catalogOperations[].qualifiedId` 验证所有引用，再判断选中 operation 和 target 归属。
- conflict rule 的全局身份使用 `<catalog-id>/<rule-id>`；不同 catalog 可复用相同本地 rule ID，diagnostic 同时保留本地与 qualified identity。
- 现有 Skill-Garden `conflicts.json` 无需批量改写 qualified ID，输出 diagnostic 增加 catalog 与 qualified operation evidence。
- 第三方 policy 仍只允许现有声明式 assertion 类型；本任务不开放自定义 evaluator 代码。

## 9. Catalog Hash

hash 输入按以下稳定键排序：

```text
<catalog-id>\0<catalog-relative-path>\0<file-bytes>
```

同时包含 Patch、Bundle 及 descriptor 声明的 catalog policy 文件；不得包含绝对路径。这样相同本地 ID、相同相对路径位于不同 catalog 时仍有不同审计身份，policy 变化也会使 compiled target check 发生漂移。

## 10. Compiled Targets

### 10.1 双验证边界

Flower 主仓的 `src/lib/patch-fixture.js` 集中提供全平台集成验证：

- pinned Trellis 全平台 init 参数。
- `createPinnedPatchFixture()` 与清理责任。
- 内置 catalog descriptors。
- full plan、compatibility、conflict report 和 coverage 构建。
- vendor 与 `enhancements/0.6` snapshot 一致性检查。

`scripts/check-patch-conflicts.mjs` 调用该 helper，但不保存全平台最终文件。Skill-Garden 独立生成器使用 Claude + Codex canonical fixture，并直接复用 `scripts/apply-trellis-patches.py` 的 prepare/apply/policy 能力。JS/Python parity 测试负责约束两条消费者的协议一致性，避免为了共享 fixture 而重新把产品边界耦合到 Flower。

### 10.2 输出结构

```text
vendor/skill-garden/compiled-targets/
└── 0.6.5/
    └── full/
        ├── plan.json
        └── targets/
            ├── <target-relative-path>
            └── <target-relative-path>.diff
```

- 只保留当前受测 Trellis 精确版本。
- `full` 表示选择全部 Skill-Garden Bundle/Patch；fixture 只初始化 Claude + Codex，目标集包含 Trellis core、`.agents`、`.claude` 与 `.codex`。
- `targets/` 保存所有实际进入 plan 且有最终内容的 target，不只保存 changed target。
- before/after 不同的 target 在最终文件旁保存 `<target>.diff` sidecar；未变化 target 不生成 sidecar。
- 生成器必须在写入前验证最终文件与 sidecar 的同名和文件/目录前缀冲突，不能假设真实 target 永远不会以 `.diff` 结尾。
- missing target 只进入 `plan.json`，不创建占位文件。
- 不保存 `original/` 树。

### 10.3 plan.json

独立使用 `schemaVersion: 1`，至少包含：

- Trellis version、mode=`full`、catalog hash。
- catalogs、selected Bundles/Patches、全局 operation order。
- 每个 target 的 before/after hash、changed、contributing operation entries。
- missing/optional 结果和 conflict summary。

序列化前移除 `targetFile`、`original`、`next`、临时路径等运行时字段。对象字段顺序固定，数组沿用已解析稳定顺序，JSON 以两个空格缩进并以换行结尾。

### 10.4 Unified diff

- 标准 unified diff，3 行上下文。
- 标签固定为 `a/<target>` 与 `b/<target>`。
- 新文件使用 `/dev/null` 语义，但逻辑目标标签保持稳定。
- 生成器可调用 `git diff --no-index --no-ext-diff --unified=3`，随后规范化 header；不引入 npm runtime dependency。
- diff 输出不得包含临时绝对路径。

### 10.5 生成与 check

新增 Skill-Garden 维护脚本 `scripts/generate-compiled-targets.py`：

- 默认生成模式：调用传入或自动发现的 Trellis executable 初始化 canonical fixture，在临时 staging 目录构建完整输出，验证只包含当前 semver 目录后替换 Skill-Garden `compiled-targets/`。
- `--check` 模式：在临时目录重新生成并与已提交目录做逐文件、逐字节比较；失败输出漂移文件和刷新命令。
- 替换前必须验证删除目标严格位于 Skill-Garden `compiled-targets/` 下且现有一级目录均为 semver，禁止宽泛路径删除。
- 重复生成应保持 Git 零变化。

Flower package scripts 作为开发期便利入口：

```json
{
  "patch:targets": "python3 vendor/skill-garden/scripts/generate-compiled-targets.py --trellis-bin <locked-bin>",
  "patch:targets:check": "python3 vendor/skill-garden/scripts/generate-compiled-targets.py --check --trellis-bin <locked-bin>"
}
```

实际 package command 使用稳定的本地 resolver 传递锁定 Trellis executable，不把 shell 占位符写进最终脚本。`npm test` 串入 `patch:targets:check`。`npm pack --dry-run --json` 测试确认 vendor compiled targets 不在发布文件中；`npm run sync` 不复制该目录。Flower 全平台 fixture 继续由冲突门禁运行，不再生成可提交 matrix。

## 11. Overrides 实际依赖声明

trellis-brainstorm 作为正式 catalog 的 dogfood 案例，同时覆盖强依赖和纯顺序，但不把整个规划流程误建成一条依赖链：

```text
brainstorm-planning-authorization
  --dependsOn--> brainstorm-auto-task-create

brainstorm-planning-handoff
  --after--> brainstorm-planning-readiness
```

`auto-task-create` 的内容需要根据新版 planning authorization source 选择任务创建入口，因此强制其依赖 authorization Patch 被选择。`planning-handoff` 先用完整 Quality Bar baseline 插入 handoff section，`planning-readiness` 随后替换该 section 内的旧确认语句；二者位于同一 Patch、始终共同选择，只需要 `after` 保证变换顺序。任务可能预先存在或手动创建，因此 auto-task-create 与 planning-handoff 之间没有依赖边。不为其它不重叠 operation 自动补边，不调整现有目录或资产。

## 12. 测试策略

### JS 单元/集成

- `after`、`dependsOn`、稳定 tie-breaker、未知引用、自引用、重复关系、selection closure、跨 catalog cycle。
- 两个 synthetic catalog 使用相同本地 Patch/Bundle/operation ID，可同时加载、应用并产生隔离 marker/provenance。
- 内置 marker 与现有 fixture 字节一致；第三方 marker 使用 qualified ID。
- 多 Bundle membership 保留首次顺序且只执行一次。
- compatibility/conflict policy 的多 catalog 聚合、qualified rule identity 与 catalog-local/qualified operation 引用。
- Skill-Garden canonical compiled target 连续生成两次一致，check 对人为漂移失败。
- Flower 全平台双 catalog fixture 继续覆盖全部声明 target、adapter 和 conflict，但工作树不产生 matrix 文件。

### Python

- 与 JS 共享单 catalog fixture，比较 operation order、qualified fields、错误语义和 provenance v2。
- 裸引用解析到 `skill-garden`；未知 qualified catalog 阻断。
- 现有独立安装入口签名和完整测试保持通过。

### 回归

- compatibility、required/optional、targetPolicy、alias 精细安装、legacy migration、幂等、首次备份、并发漂移和零写入。
- pinned full conflict check 与 AI context budget。
- npm pack 文件清单不含 `compiled-targets/`。

## 13. 风险与回滚

- 排序错误的主要回滚点是 schema normalize/graph resolve；target apply 不应同时重构，便于隔离问题。
- provenance v2 保留本地兼容字段；若下游发现兼容问题，可暂时继续输出 v1 投影，但 qualified plan 不回退。
- Skill-Garden compiled targets 只是生成产物，可删除后由锁定 canonical fixture 重新生成；运行时不依赖它。
- 生成器替换版本目录前使用 staging 和严格路径验证，异常时保留已提交结果。
- 若 JS/Python fixture 不一致，阻断合入，不允许以 consumer 特例绕过协议。

## 14. 明确不做

- 不实现 plugin manifest、扫描目录、安装/卸载、市场、权限 UI 或公共 SDK。
- 不允许第三方动态 JS/Python adapter。
- 不增加用户 CLI preview。
- 不生成 selected Bundle/alias 的 target 树。
- 不重构现有 overrides feature 目录，不去重本地 selector/content。
- 不把 compiled targets 用作 apply fallback 或恢复源。
