# Skill-Garden 与上游 Trellis 冲突处理设计

## 1. 设计目标

在不改变 Patch Engine `insert / replace / remove` 基础协议的前提下，完成两件事：

1. 把当前最终产物中仍靠 Hub 优先级压制的上游互斥协议改为结构化 section replacement。
2. 在 JS/Python 两条正式安装链中，对版本兼容和最终产物冲突执行同一套确定性写前检查。

最终判断对象是 Patch 应用后的内存结果，不是单独的 Patch content，也不是聊天层的优先级说明。

## 2. 权威来源与所有权

| 层 | 权威内容 | 本任务处理 |
|---|---|---|
| 上游 Trellis | 已登记版本的原始 Workflow/Skill/Hook 模板 | 作为 baseline 与保留行为来源 |
| Patch leaf | 必要产品差异及精确 selector/content | 删除上游冲突正文，不复制完整 Skill 协议 |
| Conflict policy | 最终产物必须满足/不得出现的已知签名 | 只做确定性断言，不修改文件 |
| Hub | 跨阶段短门禁与唯一能力指向 | 删除“下层无效/完全覆盖”说明 |
| Workflow Phase/State | 当前阶段/状态的一跳动作 | Phase walkthrough 指向真实 Skill，State 保留最短状态门禁 |
| Skill | 完整交互、结果和错误协议 | 继续由 trellis-route/check-all/update-spec/push/finish-work 所有 |

所有权原则为“上游优先、Patch 仅保留必要差异”。如果上游将来原生提供等价行为，删除对应 Patch operation 和 conflict rule，而不是继续覆盖同义正文。

## 3. Shared Policy Layout

Skill-Garden 0.6 源增加两个共享声明，随 `npm run sync` 进入发布快照：

```text
overrides/
├── compatibility.json
├── conflicts.json
├── bundles/
└── patches/
```

### 3.1 compatibility.json

```json
{
  "schemaVersion": 1,
  "variant": "0.6",
  "compatibleLine": { "major": 0, "minor": 6 },
  "testedVersions": ["0.6.5"],
  "untestedPatchPolicy": "warning",
  "newLinePolicy": "error"
}
```

版本解析只提取 semver 主、次、patch 与预发布后缀，不引入外部 semver 依赖。

| 目标版本 | 结果 |
|---|---|
| `0.6.5` | tested，正常继续 |
| `0.6.6` / `0.6.5-beta.N` 未登记值 | `warning: untested-upstream`，继续完整 Patch 与冲突检查 |
| `0.7.x` / `1.x` | `error: unsupported-upstream-line`，Patch/资产/manifest 零写入 |
| 缺失或不可解析版本但强制使用 0.6 | `error: invalid-upstream-version` |

用户要使用未支持的新 minor/major 时走 `--no-enhance`；本任务不增加静默 force 参数。

### 3.2 conflicts.json

该文件只描述最终产物断言，不执行变换：

```json
{
  "schemaVersion": 1,
  "rules": [{
    "id": "workflow-no-upstream-local-only-commit",
    "severity": "error",
    "target": ".trellis/workflow.md",
    "whenOperations": ["workflow-phase-3-commit"],
    "assertion": {
      "type": "absent-literal",
      "values": ["Never push to remote in this step."]
    },
    "owner": "trellis-push",
    "reason": "Phase 3.4 普通模式由 trellis-push 执行 exact commit + push"
  }]
}
```

首版 assertion 类型保持最小集合：

- `absent-literal`：已知冲突签名不得存在。
- `required-literal`：产品关键一跳或权威指向必须存在。
- `max-occurrences`：同一完整职责签名不得重复超过声明次数。

规则只在 `whenOperations` 命中的精细安装中执行；未选择对应 Bundle 时不把未修改上游文件误判为冲突。声明不支持正则或可执行代码。

## 4. 冲突评估模块

### 4.1 JS API

新增 `src/lib/patch-conflicts.js`：

```js
loadPatchPolicy(overridesDir)
evaluatePatchCompatibility(version, policy)
evaluatePatchConflicts(plan, policy)
assertNoPatchConflictErrors(report)
```

结果契约：

```json
{
  "version": {
    "value": "0.6.5",
    "status": "tested | untested-compatible | unsupported | invalid"
  },
  "diagnostics": [{
    "id": "workflow-no-upstream-local-only-commit",
    "severity": "error | warning | info",
    "target": ".trellis/workflow.md",
    "owner": "trellis-push",
    "reason": "...",
    "evidence": ["..."]
  }],
  "summary": { "errors": 0, "warnings": 0, "info": 0 }
}
```

`evaluatePatchConflicts()` 读取 `plan.files[].next`，因此任何 `error` 都发生在 `applyPatchPlan()` 和资产复制之前。

### 4.2 Python Parity

`apply-trellis-patches.py` 读取相同 `compatibility.json` / `conflicts.json`，从目标 `.trellis/.version` 获取版本，在 `prepare_patches()` 成功后、`apply_prepared()` 前执行等价检查。

JS/Python 对相同 fixture 必须返回相同 version status、diagnostic ID/severity/target 和 error exit 行为；展示文案可按各自 CLI 风格不同。

## 5. 当前 Workflow 冲突清理

新增 `patches/workflow/phase-ownership/`，一个 `patch.json` 包含多个 section operation，每个 baseline/content 使用语义文件名：

```text
phase-ownership/
├── patch.json
├── active-task-routing-baseline.md
├── active-task-routing-content.md
├── phase-2-implement-baseline.md
├── phase-2-implement-content.md
├── phase-2-check-baseline.md
├── phase-2-check-content.md
├── phase-3-update-spec-baseline.md
├── phase-3-update-spec-content.md
├── phase-3-commit-baseline.md
└── phase-3-commit-content.md
```

所有 operation 都使用已有 `markdown-section` replace，不新增字符串模板引擎。

### 5.1 Active Task Routing

替换两组平台直达路径，保留三类意图：planning → brainstorm、in-progress implement/check → trellis-route、repeated debugging/spec update →对应 Skill。不得直接决定 inline/subagent。

### 5.2 Phase 2.1 Implement

保留“实现前必须已评审并 start”的上游边界；具体执行改为加载 `trellis-route(target=implement)`，再由 route 选择 inline/subagent。下层不复制 route prefs/runtime/fallback 细节。

### 5.3 Phase 2.2 Quality Check

统一进入 `trellis-route(target=check)` → `trellis-check-all`；删除上游 check agent 自动修复与 inline fix-until-green 文案。只保留 Check-All audit-only、修复后重检和最终 full 不降级的短指向，完整协议由 Skill 所有。

### 5.4 Phase 3.3 Update-Spec

改为加载 `trellis-update-spec` 并接受其 `no-op | written | needs-review` 自主结果；不重新询问是否更新，也不复制证据/写入矩阵。

### 5.5 Phase 3.4 Commit

完整替换上游 `Proposed commits`/local-only walkthrough，只保留“加载 trellis-push、普通默认 push、commit-only 需显式授权、确认一次”的阶段指向。详细计划、Git 安全和进度同步由 Skill 所有。

### 5.6 Hub 与 State 收敛

- Hub 删除 `overrides lower Active Task Routing`、`fully supersedes lower Phase 3.4` 等覆盖式文字。
- Hub 继续持有跨阶段顺序和不可丢失门禁，但不复制 Phase/Skill 完整正文。
- planning/in-progress State 逐句执行“一跳必要性”审计；保留会改变当前状态下一动作的句子，删除可从 Hub/Phase 自然获得的说明。

## 6. Pipeline Integration

### 6.1 Flower Runtime

```text
resolve variant/version
→ load/evaluate compatibility
→ invalid/unsupported: throw aggregated zero-write error with --no-enhance guidance
→ preparePatchPlan
→ validate conflict references + evaluate final output
→ compatible-line warnings/info: print structured summary
→ applyPatchPlan
→ assets/stale/manifest
```

Patch 汇总拆分为：`修改`、`已是最新`、`未安装入口`、`可选失败`。`missing-target` 只计入 info，不再与 `optional-skip` 合并为“跳过”。

### 6.2 Independent Skill-Garden

`install.sh` 仍只调用一次 Python runner。runner 自行读取目标版本和共享 policy，先输出冲突报告，再决定是否 apply；不得在 shell 中复制版本或冲突规则。

### 6.3 Maintainer And Release

- `scripts/check-patch-conflicts.mjs` 使用 pinned `@mindfoldhq/trellis` 模板创建全平台隔离 fixture，运行真实 Patch plan 与 conflict evaluator，并核对全部声明 Patch、target 和当前 8 种 target kind 都进入预检。
- `npm test` 调用该脚本；warning 退出 0，error/结构错误退出非 0。
- `check-snapshot.mjs` 在 sourceCommit/dirty 校验后调用同一模块，防止发布已知冲突快照。
- 脚本同时确认 vendor 与 `enhancements/0.6` 的整个 `overrides/` 文件树逐字节一致。

## 7. 回滚与兼容

- 新 Workflow section Patch 在 selector/baseline 漂移时全量预检失败，目标零写入。
- 已应用旧 Hub 的项目升级时，cleanup + section replace 生成单一最终协议；首次备份继续负责恢复。
- 回滚到旧 Flower 版本时恢复 `.trellis/.backup-flower/` 后重跑旧版，不能依赖旧引擎理解新 marker。
- `0.5/old` 不加载 compatibility/conflict policy，保持现有 legacy 行为。

## 8. 关键取舍

- 不把冲突规则塞入 Patch schema，避免让变换协议同时承担审计语言；policy 是只读断言层。
- 不新增公开 doctor，先让运行时、测试和发布共用规则，避免不成熟接口成为兼容负担。
- 不用正则或 LLM 判断语义；对已知互斥文本使用精确签名，对未知变化依靠 baseline 漂移和版本分级。
- 不把所有上游 Phase 整文件接管，只替换已经证明与产品协议互斥的 section。
