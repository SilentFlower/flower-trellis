# 统一 Patch 注入引擎与 Overrides 目录重构

## Goal

将 skill-garden 0.6 当前分散在声明式 transform、Workflow 注入、Skill additive override、Hook override 和平台后处理中的目标文件修改，统一为一套只包含 `insert`、`replace`、`remove` 三种操作的 Patch 协议，并重构 `overrides/` 源目录，使注入内容、目标、用途和迁移关系可以直接从目录与声明中识别。

统一的是底层修改协议、预检、安全性和诊断能力；Workflow、Skill、Hook、平台配置等分类继续作为 Patch 的目标语义存在。

## Background

- `.trellis/spec/flower-trellis/cli/trellis-injection-transforms.md` 已定义 schema v1、三种 operation、required/optional、managed marker、首次备份、全量 preflight、并发复核和 JS/Python 双消费者一致性，但源目录仍命名为 `overrides/transforms/`，且协议明确不是通用 Patch 语言。
- `src/lib/apply-enhancements.js` 在声明式 transform 之后仍分别调用 `workflow-inject.js`、`skill-override-inject.js`、`hook-override-inject.js`、`codex-tweaks.js` 和 `claude-tweaks.js`，导致 alias、目标定位、幂等、备份和错误处理存在多处所有权。
- `src/lib/workflow-inject.js` 的 `replaceState()` 当前把 Skill-Garden guard 前置到上游 state body，而不是替换原 body；目标 `.trellis/workflow.md` 因而同时保留新门禁和已失效的旧 `Flow` / commit 文案。
- `vendor/skill-garden/.trellis/0.6/overrides/workflow-states/` 的 planning 与 in-progress 两组文件高度重复，inline/subagent 差异没有显式建模。
- 当前 0.6 源同时存在 `workflow.md`、`workflow-states/`、`skills/`、`hooks/`、`transforms/{matches,content}`，无法从同一位置看出一个 Patch 的声明、匹配基线和目标内容。
- 发布源仍以 `vendor/skill-garden` 为准，通过 `npm run sync` 生成 `enhancements/0.6`，独立 `install.sh` 与 flower-trellis 离线安装必须消费同一份 Patch 声明。

## Requirements

### R1. 统一 Patch 协议

- 所有目标文件修改只使用 `insert`、`replace`、`remove` 三种 operation。
- 原有 `workflow_hub`、`workflow_state`、`skill_override`、`hook_override`、`platform_config` 仅作为 `purpose`、目标类型或 selector 语义，不再各自维护完整注入引擎。
- Patch 必须显式声明目标路径、目标解析类型、selector、作用范围、required/optional、内容来源、别名和顺序。
- `replace` 至少能表达文件、受控区域、Markdown block/body、结构化配置字段或数组项；`insert` 必须有稳定身份，重复执行不得追加重复项；`remove` 必须保留可验证的幂等状态。

### R2. 0.6 现有修改路径迁移

- 迁移现有 `overrides/transforms/intent-routing.json` 及其 content/matches。
- Workflow Hub 通过 Patch 在 `## Phase Index` 的结构化锚点处插入或升级。
- `no_task`、`planning`、`planning-inline`、`in_progress`、`in_progress-inline` 使用 workflow-state body Patch，最终状态块不得继续保留与 Skill-Garden 冲突的上游旧 body。
- `trellis-update-spec` 与 `trellis-finish-work` 的 Skill override 使用 Patch 表达；允许 additive `insert`，也允许对已失效上游章节执行 `replace/remove`。
- shared `inject-workflow-state.py` Hook override 使用文件级或受控区域 `replace`。
- Codex/Claude 的 JSON Hook 合并、旧配置清理、matcher 归位、timeout 迁移和 dispatch 配置修改纳入 Flower 自有结构化 Patch catalog；必须保留用户无关配置，且独立 skill-garden consumer 不得引用 Flower 专属资产。
- 迁移完成后，0.6 正常路径不得再依赖独立的 Workflow、Skill、Hook 注入执行器；迁移期兼容适配器只能调用统一 Patch Engine，不能继续实现第二套修改规则。

### R3. 清晰的 Overrides 源目录

- `transforms` 名称退出 0.6 主结构，统一使用 `patches` 术语。
- 同一个 Patch 的声明、selector 基线和目标 content 应相邻或可从声明路径直接定位，避免共享 `matches/`、`content/` 目录形成名称对照负担。
- Catalog 按目标类型组织：Skill-Garden 使用 `patches/workflow`、`patches/skills`、`patches/hooks`，Flower 自有 catalog 使用 `patches/platforms`；每个叶子目录自包含 `patch.json`、可选 selector 基线和 content。
- 跨目标产品能力通过 `bundles/<feature>.json` 组合 Patch ID、aliases 和启用条件；Bundle 不保存 selector、正文或另一套执行逻辑。
- 避免 `workflow.md`、`workflow-states/`、`skills/`、`hooks/` 与通用变换目录并列形成两套分类。
- 目录重构必须同步更新 `npm run sync`、快照 manifest、独立安装器、测试 fixture 和项目规范。

### R4. Patch 安全协议

- 所有 required Patch 必须在任何目标写入、资产复制、stale-path 清理和成功 manifest 更新前完成全量 preflight。
- required selector、结构或 fingerprint 漂移时整批零写入；optional 目标缺失或漂移必须返回结构化 skip 原因。
- 应用前复核目标未在 preflight 后变化，changed-only 写入，并保留 `.trellis/.backup-flower/` 首次备份语义。
- 路径必须限制在目标项目内，拒绝绝对路径、`..`、反斜杠和软链逃逸。
- Patch 必须记录可供后续 Doctor/审计使用的 ID、版本、目标、原始 fingerprint 和应用结果；本任务至少完成数据契约与可测试结果，不要求同时交付完整 Doctor 命令。

### R5. 双消费者与兼容性

- flower-trellis JS consumer 与 skill-garden 独立安装 consumer 必须读取同一 Core schema，并对共同消费的 Skill-Garden target adapter、operation、别名、required/optional、预检、备份、幂等和错误输出保持一致。
- Flower 平台配置通过同一 Patch Engine 注册受控扩展 adapter/resolver；独立 consumer 不加载 Flower catalog，遇到声明要求的未知能力必须失败，不能静默跳过。
- Skill-Garden catalog 由两个 consumer 共同消费；Flower 自有 catalog 只由 flower-trellis 加载。统一 schema 不等于强制每个 consumer 启用相同 Bundle。
- 0.6 采用一次性执行链切换：统一 Patch Engine 识别并迁移旧 transform marker、Workflow sentinel、Skill additive marker 和 Hook override 状态；迁移完成后的正常路径不再运行旧注入器。
- 旧状态识别属于兼容迁移输入，不形成长期双轨；新旧规则不得在同一目标上连续执行或互相覆盖。
- 0.5/old 变体保持现有行为，本轮不强制迁移到新 Patch 目录。
- `--skills` 精细安装继续按声明 aliases 过滤，不得触发全装 manifest 清理或无关平台 Patch。
- Patch 必须显式声明 missing policy。缺失的平台目录不得自动创建；已有平台目录中的 Flower 管理配置文件可以由声明显式允许创建；Skill-Garden 对既有上游入口的修改默认 `skip`，不得创建未启用平台。

### R6. 上下文与状态内容收敛

- Workflow State Patch 后只保留当前状态必须执行的短门禁、边界和指向；完整规则继续由 Workflow Hub 或目标 Skill 所有。
- planning/in-progress 的 inline 与 dispatch 版本通过声明式有序 `content.sources` 共享基础内容并显式表达差异，避免复制四份长文本；不得引入模板代码。
- Patch 后不得依靠“忽略下方旧规则”“下方流程无效”等文字处理已经可以删除的冲突内容。
- 上下文预算必须测量 Patch 应用后的最终 Workflow、各 workflow-state、Phase summary、SessionStart，以及被 Patch 修改的最终 Skill；不能只测 Patch content 源文件。
- 大小超出 target 默认输出 warning，超出 review ceiling 输出 high-warning；只有 `--strict` 才让 high-warning 非零退出，不通过提高阈值掩盖增长。

## Non-Goals

- 不把 skill、script、Flower 自有资产和 common skill 的文件复制改造成 Patch；这些是安装资产所有权，不是修改既有 Trellis 文件。
- 不改变 `.flower-manifest.json.paths` 驱动的 stale asset 清理和 uninstall 所有权。
- 不在本轮迁移 0.5/old 的 legacy 注入实现。
- 不引入可执行任意脚本、任意模板代码或无边界正则的通用补丁语言。
- 不在本轮实现完整的用户侧 enhancement Doctor 命令，但 Patch 结果必须为后续诊断保留结构化证据。

## Acceptance Criteria

- [x] AC1：skill-garden 0.6 所有既有目标文件修改均由统一 Patch Engine 使用 `insert/replace/remove` 表达，正常执行链不再运行独立 Workflow/Skill/Hook 注入规则。
- [x] AC2：0.6 源目录不再使用 `overrides/transforms/`，新目录能从单个 Patch 位置定位声明、selector 基线和 content。
- [x] AC3：五个运行时 workflow-state 的最终 body 无重复 Skill-Garden sentinel、无被新规则废弃的上游旧流程，inline/subagent 差异明确。
- [x] AC4：Workflow Hub、两个 Skill override、shared Hook override、Codex/Claude 平台配置修改均已迁移并保持既有产品行为。
- [x] AC5：全部 required Patch 在任何写入前预检；构造其中一个 required 漂移时，目标文件、复制资产、stale path 和 manifest 均不变化。
- [x] AC6：JS 与独立安装 consumer 对 Skill-Garden Core Patch 的三种 operation、literal/Markdown/file target、alias、skip、漂移、备份和重复安装输出等价结果；Flower 平台扩展由 JS 集成测试覆盖。
- [x] AC7：重复执行全装和精细安装均幂等，不重复 Hook、state、Skill override 或 marker，不覆盖用户无关配置。
- [x] AC8：0.5/old 的现有安装测试继续通过，缺失平台入口继续安全跳过。
- [ ] AC9：提交前确认 vendor 源、`enhancements/0.6` 快照和当前 dogfood 副本内容一致；Skill-Garden 源与父仓快照提交后、push 前运行 `node scripts/check-snapshot.mjs` 并通过。
- [x] AC10：相关 CLI/spec、目录说明、测试命令和迁移/回滚说明已更新，不再把 `transforms` 描述为 0.6 主注入机制。
- [x] AC11：上下文预算覆盖最终 Workflow 和最终 Patch Skill；默认模式保持 warning-first，strict 模式对 high-warning 失败。

## Decisions

- Overrides 采用“目标类型 + 薄 Bundle”结构：排查目标修改时进入 `patches/<target-kind>/`，查看完整产品能力时读取 `bundles/<feature>.json`。
- Workflow State 使用结构化 selector 定位 `[workflow-state:<name>]` 并替换最终 body；不再保留需要由高优先级 Guard 压制的旧 body。
- 0.6 最终只保留统一 Patch Engine 执行路径；升级时兼容识别并迁移旧注入状态，但不长期保留新旧双轨。
- Skill-Garden 与 Flower 自有 Patch 使用不同 catalog root、共享 schema 与 JS engine；独立 Python consumer 只加载 Skill-Garden catalog。
- `trellis-update-spec` 保留仍有效的上游知识模板，以 `insert/replace/remove` 删除 Interactive 冲突并加入自主判断；`trellis-finish-work` 的新协议完整接管旧 Step 1-4，使用 Markdown body `replace` 避免双流程。
- 上下文预算保持既有 warning-first 产品策略，并改为衡量 Patch 后的有效产物。
