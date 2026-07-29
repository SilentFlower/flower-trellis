# Flower Plugin Capability Policy 与 Patch Engine 集成

## 目标

为 Flower Plugin 建立不可绕过的能力授权层，并把受限外部 Patch 与内置完整 Patch 统一接入现有 `preparePatchPlan()` 和 P2 InstallPlan/事务写入，使多 Plugin 在一次 preflight 中得到确定、可审计、零越权的结果。

本任务是父任务 P4，依赖 P1；与 P2 通过 `InstallPlan` 和 transaction writer 对接。GitLab 来源由 P3 提供，`skill-garden` system Plugin 由 P5 消费本任务能力。

## 需求

### R1. 能力档位

- `standard`：只允许声明式分发 Plugin 自有 skills、spec、assets 和被动 scripts，不修改既有核心文件。
- `integration`：包含 standard，并允许对 Runtime 硬编码白名单内的既有 Markdown 目标执行声明式 `insert`。
- `system`：允许完整 insert/replace/remove、受控 hook/migration 和 Flower 内部 adapter，只供内置信任根。
- 外部 Plugin、Marketplace、项目配置、lockfile 或 CLI 参数都不能授予 `system`。
- v1 外部 Plugin 不执行 lifecycle hook，不加载 JavaScript adapter。

### R2. 四层授权交集

- 有效 grant 必须是 Plugin 请求、Marketplace `maxProfile`、Runtime 硬限制、项目批准四层交集。
- 任一 required capability 不在交集内时安装失败；optional capability 可跳过并产生结构化诊断。
- Marketplace 缺失或篡改信任元数据不能提升权限；local 外部 Plugin 默认最高 `standard`，除非显式受信来源提供上限。
- `system` 只由 builtin provider 创建的不可序列化信任标记授予，不能通过伪造 source ID、catalog ID 或 JSON descriptor 获得。

### R3. Integration 硬限制

- 只允许 `operation=insert`，拒绝 replace、remove 和未知 operation。
- 只允许 Core selector 的 `literal`、`workflow-hub`、`markdown-section` 子集，拒绝 custom adapter、whole-file、workflow-state 等不适用 selector。
- target 必须是已存在的 Markdown 文本，初始硬白名单只覆盖 `.trellis/workflow.md` 与 `.trellis/spec/**/*.md`。
- `missing` 只允许 `skip|error`，拒绝 `create`。
- 拒绝 hook、script、JSON/YAML/TOML 配置、可执行文件、项目根敏感文件和白名单外目标。
- target、selector 和 content 必须继续通过现有 Patch Engine 的路径、匹配数、marker 和 preflight 校验。

### R4. Catalog 身份隔离

- 外部 Plugin catalog ID 由 Runtime 从 canonical Plugin ID 规范化生成，不能使用 manifest 自报的内置 ID。
- 外部 Patch、Bundle、operation 和 marker 使用 qualified identity，不能伪造 `skill-garden`、`flower` 或 legacy marker。
- Marketplace 内容不能提供 adapter、compatibility/conflict 文件的任意项目外路径。
- 内置 catalog 保持现有 local operation marker 兼容，避免现有安装结果产生字节变化。

### R5. 项目批准与锁定摘要

- integration 首次安装前展示 Plugin、版本、来源、operation、selector、目标和能力范围。
- 批准摘要绑定 Plugin version、content digest、请求能力、Marketplace 上限、Runtime 硬限制和规范化 Patch 计划。
- grant 与摘要写入 `plugin-lock.json`；未变化的 frozen lock 可复用批准。
- Plugin 版本、内容 digest、请求能力、来源上限、operation、selector 或目标变化时摘要失效并要求重新确认。
- 非交互 CI 遇到缺失或失效批准必须失败，不能自动接受。

### R6. 统一 Patch 计划

- 加载外部 catalog 后先按 grant 验证和裁剪 schema，再与内置 catalog 合并。
- 全部选中 Plugin catalog 必须一次调用现有 `preparePatchPlan(target, catalogs, options)`，不能逐 Plugin 应用。
- 复用 Patch Engine 的 qualified ID、拓扑顺序、selector、marker、before/after hash、compatibility 和 conflict report。
- 不调用外部 Plugin 提供的 `flowerPatchAdapters()` 或任意代码。
- 将 Patch plan 的文件变化转换为 P1 `PatchMutation`，与 P2 普通内容 mutation 合并后统一检查路径和所有权冲突。
- Runtime 成功链通过 P2 transaction writer 写入；旧 enhancement 链仍可继续调用 `applyPatchPlan()`，P4 不破坏兼容入口。

### R7. 诊断与验证

- capability 诊断必须包含稳定 code、Plugin canonical ID、requested/granted/denied 能力和来源层级，但不泄漏本地绝对路径。
- dry-run 和 JSON 输出展示 grant、需确认项、Patch 目标和冲突，不执行写入。
- 任一 required Patch 失败、catalog 冲突、普通内容冲突或批准失效时，目标、plugins、lock、state 全部零写入。

## 验收标准

- [ ] standard、integration、system 三档有正向、降级和越权拒绝测试。
- [ ] 外部 Plugin 无法通过 source/catalog/lock/CLI 伪造 system 信任根。
- [ ] integration 只允许白名单 Markdown insert；replace/remove/create/hook/adapter/配置文件均被拒绝。
- [ ] 多外部 catalog 使用 qualified identity，重复 local ID 和伪造 legacy marker 不冲突、不提权。
- [ ] 全部 Plugin catalog 只调用一次 `preparePatchPlan()`，跨 catalog 顺序与冲突结果稳定。
- [ ] Patch mutation 与普通内容 mutation 写同一目标时 preflight 失败且零写入。
- [ ] required selector 漂移、conflict policy 错误和批准摘要漂移均在事务前阻断。
- [ ] 首次 integration 需要确认；未变化 frozen lock 可复用；任一绑定字段变化重新确认。
- [ ] legacy enhancement 的 `applyPatchPlan()` 行为和现有 Patch Engine JS/Python parity 测试不回归。
- [ ] 完整 `npm test`、patch conflicts 和 compiled targets 检查通过。

## 非目标

- 不开放第三方 lifecycle hook、JavaScript adapter、replace/remove 或配置文件 Patch。
- 不实现 GitLab 信任运营、CODEOWNERS 或 Marketplace CI。
- 不实现普通内容投影、依赖求解或 transaction writer。
- 不迁移 `skill-garden` 或旧 manifest。
