# Flower Plugin Capability & Patch Runtime

> 本规范定义 Flower Plugin v1 的 capability 授权、可信来源、Integration Patch 子协议、项目批准摘要和统一事务写入边界。基础 DTO、schema 与 `.flower/` 状态格式仍以 [Flower Plugin Contracts](./flower-plugin-contracts.md) 为准；Patch selector、marker、qualified identity 与 policy 格式仍以 [Trellis Patch Engine](./trellis-patch-engine.md) 为准。

## 1. Scope / Trigger

以下改动必须先读本规范：

- 修改 `src/plugin/capabilities/**`、`src/plugin/install/patch-planner.js`、`install-planner.js`、`transaction-writer.js` 或 `PluginApplicationService` 的 Patch 接线。
- 改变 `standard/integration/system` 档位、可信 Provider 标记、Marketplace `maxProfile`、approval digest、Integration target/selector/operation 白名单。
- 让 Plugin catalog 进入现有 Patch Engine、改变 `PatchMutation`/`patchPayloads`、state provenance 或 dry-run 批准输出。

Runtime 不执行外部 Plugin JavaScript，不加载外部 adapter，也不为外部 Plugin 开放 hook、migration、replace、remove 或配置文件 Patch。

## 2. Signatures

```js
flower-trellis plugin add <plugin> [--dry-run] [--json]
flower-trellis plugin update [plugin] [--dry-run] [--json]

markBuiltinProviderTrusted(provider) -> provider
isBuiltinProviderTrusted(provider) -> boolean
markSourceProviderTrusted(provider, "standard" | "integration") -> provider
trustedSourceProviderProfile(provider) -> "standard" | "integration" | null

evaluateCapabilityRequest({
  pluginId,
  request,
  sourceType,
  marketplaceMaxProfile?,
  provider?,
  runtimeMaxProfile?,
}) -> CapabilityEvaluation

authorizeCapabilityGrant(evaluation, {
  approvalDigest?,
  approvedDigest?,
  approved?,
  nonInteractive?,
}?) -> { grant, reusedApproval }

createCapabilityApprovalDigest(input) -> "sha256:<hex>"
externalPluginCatalogId(canonicalId) -> string
inspectExternalPatchCatalog(entry) -> { catalog, operations }
preparePluginPatchPlan(target, entries, options?)
  -> { grants, approvalRequests, diagnostics, patchPlan,
       patchMutations, patchPayloads, patchReport }

createInstallPlan(graph, contentMutations, {
  projectRoot,
  currentState?,
  patchMutations?,
  diagnostics?,
}) -> InstallPlan

TransactionWriter.apply({
  plan,
  payloads,
  patchPayloads?,
  plugins,
  lock,
  state,
  directoryClaims?,
  directoryRemovals?,
  dryRun?,
}) -> TransactionResult
```

## 3. Contracts

### Capability And Trust

- `standard` 只包含 `content.skills/specs/assets/scripts/tests`；`integration` 只在此基础上增加 `patch.insert`；`system` 才能增加 `patch.replace/remove/hook/migration/adapter`。
- 最终 grant 是 Plugin 请求、来源上限、Runtime 硬限制和项目批准四层交集。required 被拒绝时整体失败；optional 被拒绝时保留 `PLUGIN_CAPABILITY_OPTIONAL_DENIED` 诊断。
- 外部来源的 Runtime 硬上限是 `integration`。`system` 只接受当前进程 `WeakSet` 中的 builtin Provider 实例；source ID、catalog ID、JSON、lock、CLI 参数和结构化克隆都不能携带该信任。
- local Provider 默认上限为 `standard`。宿主代码只有通过 `markSourceProviderTrusted(provider, maxProfile)` 登记当前实例，才能显式授予 `integration`；该上限保存在 `WeakMap`，不得写入用户配置或 lock。
- GitLab Provider 从已校验 Marketplace 条目把 `trust.maxProfile` 放入候选的运行时字段 `marketplaceMaxProfile`。该字段供授权和摘要计算使用，不进入 lock schema；缺失时必须降为 `standard`。
- `BuiltinSourceProvider` 构造时登记 builtin 信任根。外部 Plugin 数据不得调用或模拟该构造路径。
- builtin Provider 与 capability 模块的加载顺序不能改变授权结果：Provider 先构造时，Runtime 扩展点必须暂存实例，并在 `registerBuiltinTrustMarker()` 后逐个补登记；不同 marker 重复注册必须显式失败，不能静默替换信任根。

### Approval Digest

- Integration `patch.insert` 首次使用必须获得项目批准。非交互模式只接受与本轮计划完全相等的 frozen `approvedDigest`，不能用 `approved=true` 自动接受。
- 摘要使用 canonical JSON + SHA-256，绑定 canonical Plugin ID、版本、包 integrity、source/reference/index commit、请求能力、来源上限、Runtime 上限、Runtime policy 版本和规范化 operation/selector/content/target 计划。
- `PluginApplicationService` 默认从旧 lock 的 `capabilities.approvalDigest` 构造 frozen approval；版本、integrity、来源、上限、能力或 Patch 计划变化后摘要必须失效并重新批准。
- dry-run 使用 preview 模式：返回 `approvalRequests`、grant、Patch target 与 report，但不得把未批准摘要持久化，也不得创建 `.flower/`。
- CLI 真实 add/update 首次遇到 `PLUGIN_CAPABILITY_APPROVAL_REQUIRED` 时，只能先执行一次零写入 preview，再向 human TTY 展示 Plugin、版本、来源、granted capability、operation、selector、target 与 missing policy；确认后以本轮 `pluginId[]` 重跑真实计划。
- `--json` 和非 TTY 场景不得弹出确认，也不得接受可序列化的 `--approve`/配置字段；它们保持 `PLUGIN_CAPABILITY_APPROVAL_REQUIRED` 失败，CI 可先用 `--dry-run --json` 审计 `approvalRequests`。

### Integration Catalog Boundary

- 外部 catalog ID 必须由 `externalPluginCatalogId(canonicalId)` 生成，使用 `plugin-<source>-<plugin>-<hash>` namespace；外部 descriptor、内置 catalog ID 和 legacy marker 均不可自报。
- 外部 Patch 只允许 `operation=insert`，selector 只允许 `literal`、`workflow-hub`、`markdown-section`，target 只允许 `.trellis/workflow.md` 或 `.trellis/spec/**/*.md`。
- `missing` 只允许 `skip|error`；只允许 HTML marker；拒绝 `create`、replace/remove、whole-file/custom selector、cleanup、adapter、hook/script、JSON/YAML/TOML、可执行文件、inline `content.value`、非本 catalog 依赖和未知字段。
- catalog、bundle、selector、content 目录必须位于固定 Plugin 包根内；软链、特殊文件、路径逃逸和预构造外部 descriptor 在进入 Patch Engine 前失败。
- 可信 system catalog 可传完整 descriptor、policy 和 Flower 内部 adapter；外部 catalog 永远使用空 adapter registry，不能提供任意 compatibility/conflict 路径。

### Unified Plan And Transaction

- 全部选中 catalog 稳定排序后只调用一次 `preparePatchPlan(target, catalogs, options)`。不得逐 Plugin 调用 `applyPatchPlan()`，也不得复制 selector 或 marker 实现。
- 可信 catalog 的 policy 通过 `loadPatchPolicies()` 加载；统一 plan 生成后必须调用 `buildPatchConflictReport()` 和 `assertNoPatchConflictErrors()`。版本不兼容、policy 引用错误和最终内容冲突都必须在事务创建前失败。
- `plan.files` 转换为按 owner 保留 qualified operation provenance 的 `PatchMutation[]`；最终文本转换为按 target 寻址的 `patchPayloads`。同一 Patch plan 可有多个 owner 修改同一 target，但 before/after hash 必须完全一致。
- `createInstallPlan()` 同时校验 `ContentMutation[]` 与 `PatchMutation[]` 的安全相对路径、父路径和文件/目录前缀。普通内容与 Patch 命中同一 target 必须返回 `PLUGIN_CONTENT_CONFLICT`，不能依赖写入顺序覆盖。
- `TransactionWriter` 把普通内容与 Patch 去重为同一 target 集合，共用 before-hash 漂移校验、payload hash、staging、backup、原子替换、project files 写入和 rollback。state 必须最后写入；任一失败时目标、plugins、lock、state 一起恢复。
- 成功计划把最终 grant 写入 lock，把 qualified operation、target、resultHash 写入对应 Plugin state `patches`；重复 update 复用 frozen approval，并保持目标和状态 changed-only。

## 4. Validation & Error Matrix

| 条件 | 错误 / 结果 |
| --- | --- |
| required capability 超出请求/来源/Runtime 交集 | `PLUGIN_CAPABILITY_DENIED`，零写入 |
| optional capability 被拒绝 | 跳过该能力并产生 `PLUGIN_CAPABILITY_OPTIONAL_DENIED` |
| 外部请求 `system` 或伪造 builtin/source/catalog 身份 | `PLUGIN_CAPABILITY_DENIED` 或 `PLUGIN_PATCH_POLICY_INVALID` |
| Integration approval 缺失、摘要变化或非交互自动批准 | `PLUGIN_CAPABILITY_APPROVAL_REQUIRED` |
| human TTY 拒绝首次 Integration 确认 | 保留 `PLUGIN_CAPABILITY_APPROVAL_REQUIRED`，目标与 `.flower/` 零写入 |
| 外部 catalog 含未知字段、越权 operation/selector/target/path | `PLUGIN_PATCH_POLICY_INVALID`，错误不得泄漏绝对路径 |
| required selector 漂移、版本不兼容或 conflict policy error | `PLUGIN_PATCH_POLICY_INVALID`，事务目录尚未创建 |
| ContentMutation 与 PatchMutation 同 target，或 Patch hash 不一致 | `PLUGIN_MUTATION_CONFLICT` 或 `PLUGIN_CONTENT_CONFLICT` |
| preflight 后 target/payload 漂移 | `PLUGIN_TARGET_DRIFT`，项目文件不写入 |
| 事务中途失败且回滚成功 | `PLUGIN_TRANSACTION_FAILED`，恢复目标和 project files |
| 回滚不完整 | `PLUGIN_TRANSACTION_REPAIR_REQUIRED`，保留事务证据 |

## 5. Good / Base / Bad Cases

### Good

- GitLab Marketplace 为 `rd-guide` 声明 `integration` 上限；用户首次批准规范化 insert 计划后，Runtime 一次 preflight 所有 catalog，并在同一事务中写 workflow、lock 和 state provenance。
- 同一 Plugin 未变更 update 时，候选来源上限、integrity、计划和 Runtime policy 均不变，旧 lock digest 精确匹配，非交互运行可复用批准且结果 `unchanged`。
- Flower builtin system Plugin 使用进程内可信 Provider 和内部 adapter，仍经过统一 plan、policy report 与 transaction writer。

### Base

- local Plugin 未被宿主标记：即使 manifest 请求 `integration`，required `patch.insert` 失败，optional `patch.insert` 降级跳过；普通 standard 内容仍可分发。
- dry-run 缺少首次批准：返回 approval request 和 Patch 预览，目标文件与 `.flower/` 均不变化。

### Bad

- 从 Plugin JSON 读取 `trusted:true`、`maxProfile:system`、catalog ID 或 adapter 路径并直接授予权限。
- 为每个 Plugin 分别调用 `preparePatchPlan()` / `applyPatchPlan()`，导致跨 catalog 顺序、冲突和事务原子性丢失。
- Patch 写完后再写 lock/state，失败时只回滚普通内容，留下不可审计的 marker 或 provenance。
- 使用旧 lock 中的摘要但不重算当前版本、integrity、来源上限和 Patch 计划。

## 6. Tests Required

- `plugin-capability-policy.test.js`：三档 capability、required/optional、builtin WeakSet、local WeakMap、序列化伪造与非交互批准。
- `plugin-source-registry.test.js`：在独立进程中先构造 `BuiltinSourceProvider`、后加载 capability 模块，断言实例被补登记为可信 builtin。
- `plugin-capability-approval.test.js`：canonical 排序、版本/integrity/source/index commit/上限/Runtime policy/operation/selector/target 变化导致摘要变化。
- `plugin-patch-planner.test.js`：外部子协议、qualified catalog、多 catalog 单次 preflight、system policy report、普通内容冲突、零写入、Application Service 真实事务链，以及 CLI human dry-run/非交互拒绝/交互批准链。
- `plugin-install-planner.test.js` 与 `plugin-transaction-writer.test.js`：跨 mutation target/前缀、before/payload 漂移、staging 顺序、rollback 与 retained evidence。
- 修改本契约后必须运行完整 `npm test`、`node scripts/check-patch-conflicts.mjs`、`npm run patch:targets:check`、`npm pack --dry-run --json`、`git diff --check` 和受影响文件 `node --check`。

## 7. Wrong vs Correct

### Wrong

```js
if (manifest.capabilities.profile === "system" || source.trusted) {
  applyPatchPlan(projectRoot, preparePatchPlan(projectRoot, [pluginCatalog], {
    adapters: plugin.adapters,
  }));
}
```

这会让可序列化输入授予 system、执行外部代码，并绕过跨 catalog preflight、approval digest 和项目事务。

### Correct

```js
const patchResult = preparePluginPatchPlan(projectRoot, entries, {
  contentMutations,
  approvedDigests,
  approvals,
  nonInteractive,
});
const plan = createInstallPlan(graph, contentMutations, {
  projectRoot,
  currentState,
  patchMutations: patchResult.patchMutations,
  diagnostics: patchResult.diagnostics,
});
writer.apply({ plan, payloads, patchPayloads: patchResult.patchPayloads, plugins, lock, state });
```

授权、catalog 子协议、Patch Engine、policy report 和事务写入均复用唯一公共入口，任何失败都发生在持久化前或进入统一 rollback。
