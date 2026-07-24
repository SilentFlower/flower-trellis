# Patch Planner 扩展点调研

## 调研目标

确认 operation 显式依赖、catalog 命名空间和 compiled targets 应落在哪些现有边界中，并识别 JS/Python 双 consumer、冲突策略、marker、provenance 与发布流程的联动影响。

## 当前执行模型

- JS `preparePatchPlan(target, catalogs, options)` 已接受多个 catalog descriptor，但 descriptor 仅有 `name`、`patchesDir`、`bundlesDir`。
- `loadCatalog()` 按 catalog 列表、Bundle 文件、Bundle `patches` 数组和 Patch `operations` 数组形成声明顺序。
- `preparePatchPlan()` 按上述顺序逐 operation 计算 target 的 `filePlan.next`，所以当前顺序是隐式输入顺序，不是 Patch schema 契约。
- Patch 与 operation 的 `seen*Ids` 在全部 catalog 之间共享，因此本地 ID 目前必须全局唯一。
- 同一 Patch 被多个已选 Bundle 引用时，`Map` 去重记录 `{ ...patch, bundle: bundle.id }`，后一个 Bundle 会覆盖前一个 Bundle provenance。
- Python `prepare_patches()` 使用相同的声明顺序、全局 ID 集合和单 Bundle provenance，协议修改必须同步。

## 顺序与依赖的落点

- `after` 与 `dependsOn` 应在 operation normalize 时只做字段形状校验，在全部 catalog 加载完成后再解析引用；否则无法验证跨 catalog qualified reference。
- 基础顺序必须保存当前声明顺序索引，作为稳定拓扑排序的 tie-breaker，避免无依赖节点因 Map/集合实现细节重排。
- `dependsOn` 同时承担 selection closure 与排序边；依赖 operation 未进入当前计划时应在任何 target 计算前失败。
- `after` 只在双方均被选择时建立排序边；已知但未选择的引用不阻断精细安装。
- dependency 成功语义应绑定于 operation 进入合法 preflight 计划，而不是要求每个 target 都产生 `ready`。现有 `missing=skip`、optional target 和 targetPolicy 仍由原契约处理；required target 错误本来就会阻断整个计划。
- trellis-brainstorm 适合作为双语义 dogfood，但不是完整强依赖链：`auto-task-create` 明确读取 planning authorization source，适合 `dependsOn authorization`；`planning-handoff` 与 `planning-readiness` 共同修改 Quality Bar，前者依赖完整 baseline、后者会改变该 baseline，适合 `readiness after handoff`。任务可能预先存在，因此两组之间没有 selection 依赖。

## Catalog 命名空间影响

- catalog descriptor 需要稳定 `id`；Patch、Bundle、operation ID 改为 catalog 内唯一，全局身份为 `<catalog-id>/<local-id>`。
- 裸引用只在声明所属 catalog 中解析；qualified reference 可跨 catalog。引用解析必须在完整 catalog 索引建立后统一完成。
- 现有内置 catalog ID 固定为 `skill-garden` 和 `flower`，调用点不能继续使用仅供展示的自由文本 `name`。
- catalog hash 必须混入 catalog ID、catalog 内相对路径和内容；否则两个 catalog 使用相同目录结构与本地 ID 时可能产生审计歧义。
- compatibility/conflict policy 属于其 catalog；descriptor 需要可选 policy 文件入口并把内容纳入 hash。现有 `whenOperations` 裸 ID 应按 policy 所属 catalog 解析，未来第三方 policy 只能使用 Core 声明式规则并引用已加载、已验证的 qualified operation。

## Marker 兼容影响

- 现有 marker 文本是已安装用户文件中的升级协议，Skill-Garden/Flower 不能因 qualified identity 改写 marker，否则会造成重复注入或迁移漂移。
- 内置 catalog 继续用本地 operation ID 生成原 marker；非内置 catalog 使用 qualified operation ID 生成 marker，避免不同插件在同一 target 中碰撞。
- 是否为内置 catalog 必须由 Core 固定 allowlist 判断，不能由第三方 descriptor 自报“兼容模式”。
- legacy marker 与 cleanup 仍按 operation 声明执行；qualified identity 只改变 planner 身份和未来第三方新 marker，不扩大清理权限。

## Provenance 与诊断影响

- 计划中的 Patch、Bundle、operation 需要同时保留 `id`、`catalog`、`qualifiedId`，方便兼容本地展示与全局审计。
- 同一 Patch 的 Bundle 来源应为稳定去重数组，顺序沿用首次选择顺序；不再由最后一次 Bundle 引用覆盖。
- target plan 需记录 operation 的实际解析顺序，以及关系来源 `declaration`、`after`、`dependsOn`，即使最终文本相同也能通过 `plan.json` 看出顺序变化。
- 未知 catalog、未知 operation、自引用、selection closure 和循环应返回可定位到 catalog/patch/operation 的结构化错误，并在 target 计算前阻断。

## Compiled Targets 复用点

- `scripts/check-patch-conflicts.mjs` 包含锁定 Trellis fixture、全平台 `trellis init` 参数、两个正式 catalog、Flower adapters、compatibility 与 conflict evaluator，适合作为 Flower 集成矩阵的临时验证边界。
- 已生成的全平台结果包含 107 个最终文件与 106 个 diff；107 个最终文件中只有 52 个唯一内容 hash，65 个文件处于重复内容组。该矩阵机器验证价值高，但不适合作为长期人工审阅产物整体提交。
- Skill-Garden README 将 0.6 Patch 的正式独立安装边界描述为 Claude Code + Codex 双端通用。可提交 compiled targets 应使用 Claude + Codex canonical fixture，只加载 `skill-garden` catalog，并覆盖 Trellis core、`.agents`、`.claude` 与 `.codex`。
- Flower `src/lib/patch-fixture.js` 继续集中管理全平台双 catalog coverage/compatibility/conflict 验证，但不再生成可提交 files/diffs。
- Skill-Garden 生成器应直接复用 Python consumer 的 prepare/apply/policy 能力，在临时目录生成完整结果，再以确定性排序写入子仓 `compiled-targets/<version>/full/`；check 模式在独立临时目录生成后逐字节比较。
- `plan.json` 需要去除绝对路径、临时目录、时间戳和用户名，仅保存稳定逻辑路径、hash、catalog identity、关系和结果状态。
- unified diff 可通过仓库维护脚本调用 Git `diff --no-index`，随后固定标签为 `a/<target>`、`b/<target>`；Git 已是维护环境前提，无需新增运行时依赖。

## 发布与目录边界

- 可提交 compiled targets 属于 Skill-Garden 独立 catalog，放在 Skill-Garden 仓库顶层；Flower 主仓只通过 submodule 指针引用该提交。
- Flower 全平台双 catalog 组合属于集成测试证据，只在临时目录生成，不保存 matrix 文件。
- `npm run sync` 只同步 `.trellis/0.6/overrides`，不得复制 Skill-Garden `compiled-targets/`；Flower `package.json.files` 不包含 vendor 子仓，npm 包自然排除该产物，但仍需发布清单测试固化边界。
- Skill-Garden 工作树仅保留当前锁定的 Trellis 精确版本目录；生成时先验证目标范围，再原子替换旧生成目录。版本历史由子仓 Git 保存。

## 长期插件边界

- 本任务只把 Patch Engine 的输入抽象为受验证 catalog descriptor，不实现插件发现、安装、卸载、市场或公共 SDK。
- 第三方 catalog 默认只可提供声明式 Patch、Bundle、policy，并使用 Core selectors；当前全局 adapter registry 不开放为动态第三方代码入口。
- 未来插件层的职责是验证来源和权限，再把 catalog descriptor 交给 planner。planner 本身不负责查找插件，也不执行 catalog 随附代码。

## 主要风险

- JS/Python 稳定拓扑排序实现细节不一致，导致完整计划漂移。
- 直接改用 qualified marker 会破坏现有安装幂等性，必须保留内置 marker 字节兼容。
- provenance schema 改动若只覆盖新字段而遗漏现有 manifest consumer，可能造成升级兼容回归；应优先采用加法字段并保留现有本地 ID。
- Skill-Garden generator 若绕过 Python consumer 自行实现变换会产生协议漂移；Flower 全平台 fixture 与 Skill-Garden canonical fixture 应分别复用各自正式 consumer，并由 parity 测试约束共同协议。
- 版本目录清理属于生成产物替换，必须限制在已验证的 `compiled-targets/<semver>/` 范围内，禁止宽泛递归删除。
