# Brief — Patch 顺序依赖与 Target 编译层

## Goal

- 为 skill-garden 0.6 Patch Engine 增加显式、稳定、可验证的 operation 顺序/依赖契约，并在 Skill-Garden 仓库生成可提交 Git 的 canonical full compiled targets，让维护者审查独立安装边界的声明组合、实际执行顺序和最终文件。

## Scope

- operation schema 支持 `after` 与 `dependsOn`，使用稳定拓扑排序和声明顺序 tie-breaker；未知引用、自引用、重复关系、selection closure 缺失和循环在写入前失败。
- catalog 使用稳定 ID 与 qualified identity，支持 catalog-local ID 复用、跨 catalog 依赖、Bundle 多归属、qualified policy/diagnostic 和 provenance v2。
- trellis-brainstorm dogfood 保留一条真实强依赖与一条真实纯顺序边，不给无关或不重叠 operation 建立虚假依赖。
- JS/Python consumer 保持 schema、顺序、错误、marker、plan 与 provenance 语义一致；内置 marker 保持字节兼容。
- Skill-Garden 新增独立 compiled target 生成/check 脚本，使用锁定 Trellis 的 Claude + Codex canonical fixture，只加载 `skill-garden` catalog。
- `full` 只表示选择全部 Skill-Garden Bundle/Patch；可提交目标覆盖 `.trellis/**`、`.agents/**`、`.claude/**` 与 `.codex/**`。
- 生成并提交 `vendor/skill-garden/compiled-targets/<trellis-version>/full/{plan.json,targets/}`；最终文件按原路径保存，changed target 的 `.diff` sidecar 与文件并排，只保留当前精确 Trellis 版本。
- 从 Flower 主仓移除顶层全平台 compiled files/diffs 与旧 Node 生成器；Flower 的全平台 Skill-Garden + Flower 双 catalog fixture 继续临时执行 coverage、adapter、compatibility 和 conflict 验证。
- Flower package scripts 作为开发期便利入口调用 Skill-Garden 生成器；AI context budget 的静态最终文件改读 canonical compiled files，运行时 Phase summary 与 SessionStart 继续真实执行。
- 保持现有 feature-oriented overrides 结构、Patch 粒度、Bundle、selector、baseline、content 与平台本地资产，不进行无关整理或去重。

## Non-Goals

- 不把全部 Trellis 平台的最终 files/diffs 提交到任一仓库；全平台只作为临时集成矩阵。
- 不生成 selected Bundle/alias 的独立 target 树，不同时保留多个历史 Trellis 版本。
- 不把 compiled targets 作为运行时输入、安装 fallback 或用户文件恢复源，也不保存完整原始 Trellis 文件树。
- 不增加 `before`、数值 priority 或“同 target 自动依赖”，不实现跨文件事务回滚。
- 不实现插件发现、安装、卸载、市场、权限 UI、公共 SDK 或动态第三方 adapter。
- 不合并、迁移或删除现有 trellis-brainstorm、workflow、SessionStart、missing-task 等 overrides 模块和资产。

## Key Context

- JS 核心位于 `src/lib/patch-engine.js`，Python 独立 consumer 位于 `vendor/skill-garden/scripts/apply-trellis-patches.py`。
- Skill-Garden README 将 0.6 Patch 正式独立安装边界描述为 Claude Code + Codex 双端通用；canonical fixture 应与该产品边界一致。
- 旧 Flower 全平台产物有 107 个最终文件、106 个 diff，共 214 个产物；65 个最终文件属于重复内容组，适合机器验证而不适合长期人工审阅。
- `src/lib/patch-fixture.js` 与 `scripts/check-patch-conflicts.mjs` 继续负责 Flower 全平台双 catalog 临时验证，不再生成可提交 matrix。
- Skill-Garden generator 必须直接复用 Python prepare/apply/policy 能力，并通过现有 JS/Python parity 测试约束协议一致性。
- canonical generator 必须使用 staging、严格 semver 目录边界、稳定序列化和稳定 unified diff，并拒绝最终文件与 sidecar 的路径冲突；异常不得破坏已提交产物。
- `npm run sync` 不得复制 Skill-Garden compiled targets，Flower npm tarball 也不得包含 vendor 子仓内容。

## Acceptance

- JS/Python 均支持 `after`、`dependsOn`、稳定拓扑排序和一致结构化错误；依赖错误在 preflight 阶段零写入失败。
- trellis-brainstorm 计划包含真实 `dependsOn` 与 `after` 边，无关 operation 维持稳定声明顺序。
- 两个 synthetic catalog 可复用相同本地 ID，并通过 qualified identity、marker、依赖、plan、diagnostic 与 provenance 隔离。
- Skill-Garden canonical full target 可从锁定 Trellis 版本重复生成逐字节一致的 plan 和同树 targets/sidecars；人为漂移或路径冲突使 check 失败并给出刷新命令。
- Flower 工作树不再保留全平台 matrix，但全平台双 catalog coverage、adapter、compatibility 与 conflict 验证继续通过。
- operation 顺序变化即使未改变最终文本，也反映在 `plan.json`；diff 使用稳定标签且不含临时路径。
- compiled targets 只提交到 Skill-Garden Git，不进入 Flower `enhancements/0.6` 或 npm tarball。
- Patch Engine、目录结构、AI context budget、测试矩阵、维护命令、任务文档和完整 `npm test` 同步通过。

## Next Step

- 进入 `trellis-route(implement)`，迁移 compiled target 生成器与产物归属，调整 Flower 临时全平台门禁、测试、预算输入和规范，然后重新执行完整 Check-All。
