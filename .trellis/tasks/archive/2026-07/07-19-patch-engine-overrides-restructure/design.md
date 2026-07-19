# 统一 Patch 注入引擎与 Overrides 目录重构 - 技术设计

## 1. 设计目标

把 skill-garden 0.6 和 flower-trellis 当前对既有 Trellis 文件的修改统一为一个 Patch 计划：声明层只描述目标、选择器与 `insert/replace/remove`，执行层统一负责预检、旧状态识别、幂等、备份、写入和结果证据。

资产复制仍由现有安装器所有。Patch 不负责安装新的 Skill、Script 或 Flower 自有脚本，只负责修改目标项目已有文件，或在声明显式允许时创建已有平台目录中的配置文件。

## 2. 当前问题与边界

### 2.1 当前执行路径

0.6 的 `applyEnhancements()` 当前依次使用：

1. `enhancement-transform.js`：字面 selector 的 `insert/replace/remove`。
2. `workflow-inject.js`：Hub 插入、旧块清理、state guard 前置。
3. `skill-override-inject.js`：frontmatter/H1 后 additive override。
4. `hook-override-inject.js`：shared Hook 整文件覆盖。
5. `codex-tweaks.js` / `claude-tweaks.js`：TOML、YAML、JSON 的命令式修改。

独立 `install.sh` 又维护一份 transform runner、Workflow 内嵌 Python 和 Skill override 内嵌 Python。新设计删除 0.6 的多重所有权，但保留 0.5/old legacy 路径。

### 2.2 不纳入 Patch 的操作

- `copySkills()`、`copyScriptAssets()`、`copyFlowerAssets()`。
- common skill 刷新和 tombstone 清理。
- `.flower-manifest.json.paths` 驱动的 stale asset 删除。
- Trellis 版本选择、更新检查和发布快照复制。

这些操作改变的是 Flower 管理资产，不是对上游目标的局部修改。

## 3. 源目录

### 3.1 Skill-Garden Catalog

```text
vendor/skill-garden/.trellis/0.6/overrides/
├── patches/
│   ├── workflow/
│   │   ├── hub/
│   │   │   ├── patch.json
│   │   │   └── content.md
│   │   ├── state-no-task/
│   │   │   ├── patch.json
│   │   │   └── content.md
│   │   ├── states-planning/
│   │   │   ├── patch.json
│   │   │   ├── common-content.md
│   │   │   ├── subagent-content.md
│   │   │   └── inline-content.md
│   │   ├── states-in-progress/
│   │   │   ├── patch.json
│   │   │   ├── common-content.md
│   │   │   ├── subagent-content.md
│   │   │   └── inline-content.md
│   │   └── intent-routing/
│   │       └── <具体段落 Patch>/
│   ├── skills/
│   │   ├── trellis-start/no-task-routing/
│   │   ├── trellis-brainstorm/planning-authorization/
│   │   ├── trellis-brainstorm/auto-task-create/
│   │   ├── trellis-update-spec/autonomous-evaluation/
│   │   └── trellis-finish-work/exact-bookkeeping/
│   └── hooks/
│       ├── codex-session-start/no-task-routing/
│       ├── claude-session-start/no-task-routing/
│       └── inject-workflow-state/shared-runtime/
└── bundles/
    ├── intent-routing.json
    ├── update-spec-flow.json
    ├── finish-work.json
    └── shared-hook-runtime.json
```

叶子目录自包含 `patch.json`、可选 selector 文件和 content。禁止恢复共享 `matches/` / `content/` 大目录。

### 3.2 Flower Catalog

```text
src/patches/
├── platforms/
│   ├── codex/session-start-hooks/
│   ├── codex/remove-multi-agent-v2/
│   ├── codex/dispatch-mode/
│   └── claude/startup-update-hook/
└── bundles/
    └── flower-platform-integration.json
```

Flower catalog 可以引用 `FLOWER_UPDATE_HOOK_REL` 等 Flower 自有 resolver；独立 skill-garden consumer 不加载该 catalog。

## 4. 声明契约

### 4.1 Patch 声明

```json
{
  "schemaVersion": 2,
  "id": "workflow-states-in-progress",
  "purpose": "workflow_state",
  "operations": [
    {
      "id": "workflow-state-in-progress",
      "operation": "replace",
      "scope": "body",
      "targets": [
        {
          "kind": "workflow",
          "path": ".trellis/workflow.md",
          "missing": "error"
        }
      ],
      "selector": {
        "type": "workflow-state",
        "name": "in_progress"
      },
      "baselines": ["in-progress-baseline.md"],
      "content": {
        "sources": ["common-content.md", "subagent-content.md"]
      }
    }
  ]
}
```

约束：

- `schemaVersion=2`；ID 全局唯一并使用小写连字符。
- operation 只能是 `insert`、`replace`、`remove`。
- `purpose` 只用于审计、预算和诊断，不选择执行器。
- operation 必须声明唯一 ID、targets 和 selector；target 声明 `kind`、POSIX 相对 `path` 与 `missing=skip|create|error`。
- 多平台目标可以声明 `targetPolicy=each-existing|at-least-one|required-all`；默认 `each-existing`。
- `create` 只允许结构化配置 Target，且父平台目录必须存在。
- content 可以声明单个 `source`，或声明有序 `sources` 数组做纯文本拼接；禁止条件表达式、变量插值和可执行模板。
- content/selector 路径相对当前叶子目录解析，拒绝绝对路径、`..`、反斜杠和软链逃逸。
- 声明不允许脚本、动态模板代码、正则 selector 或任意表达式。

### 4.2 Bundle 声明

```json
{
  "schemaVersion": 1,
  "id": "intent-routing",
  "aliases": ["workflow-enhancement", "task-intent", "intent-routing"],
  "installMode": "full-or-selected",
  "patches": [
    "workflow/state-no-task",
    "skills/trellis-start/no-task-routing",
    "skills/trellis-brainstorm/planning-authorization",
    "hooks/codex-session-start/no-task-routing"
  ]
}
```

Bundle 只负责选择，不保存正文。全装选择全部适用 Bundle；精细安装复用 `shouldInstallName()` 对 bundle ID/aliases 过滤。`installMode=full-only` 用于 shared Hook 或平台集成。

## 5. Target Adapter

统一 operation 不等于统一为字符串替换。Patch Engine 根据 target/selector 类型选择受控适配器：

| Adapter | Selector / Scope | 用途 |
|---|---|---|
| literal text | `literal-file` | 迁移现有 intent-routing 字面段落 |
| Markdown workflow-state | `workflow-state` + `body` | 替换状态块最终正文 |
| Markdown section | `heading` + `section` | 替换/删除 Skill 的指定章节 |
| Markdown prologue/body | `frontmatter-end`、`document-body` | additive Skill 与完整 Skill body 接管 |
| file | `whole-file` | shared Python Hook 整文件替换 |
| JSON hook config | event、matcher、command identity | Hook 归位、去重、timeout 迁移 |
| YAML key | dotted key path | `codex.dispatch_mode` 插入/替换 |
| TOML section | section name | 删除旧 `features.multi_agent_v2` 段 |

结构化 Adapter 只能实现固定、可测试的领域动作。动态命令只能通过白名单 resolver 获取，例如从现有 `UserPromptSubmit` Hook 推导 Python 前缀；声明不能嵌入可执行代码。

## 6. 三种 Operation 的统一语义

### 6.1 Insert

- 必须声明结构化位置或稳定字面锚点。
- 必须有幂等身份；Markdown 使用 managed marker，JSON Hook 使用 event + matcher + command needle。
- 已存在同身份内容时原位归一化，不重复追加。

### 6.2 Replace

- 可以替换 literal、Markdown section/body、整文件、JSON item/value、YAML key 或 TOML section。
- required selector/fingerprint 漂移失败；不得 fallback 到文件顶部追加。
- 文件级 replace 对未知用户修改默认失败，只有当前内容等于已知上游 fingerprint、旧版结果或目标 content 时通过。

### 6.3 Remove

- 文本/Markdown 使用 marker tombstone 保持精确匹配与幂等。
- JSON/YAML/TOML 使用结构化 absence 作为幂等结果，并在 Patch 结果中记录。
- 删除只影响 selector 拥有的目标，不删除无关用户配置。

## 7. 计划与应用

### 7.1 JS API

```js
preparePatchPlan(target, catalogs, options)
applyPatchPlan(target, plan)
```

`preparePatchPlan()`：

1. 递归读取 Patch 与 Bundle，校验 schema、ID、引用和 alias。
2. 按 consumer、variant、全装/精细安装选择 Bundle。
3. 对全部 required Patch 解析目标和旧状态，在内存中按顺序计算每个文件的最终内容。
4. 同一文件的多个 Patch 串行作用于内存结果，并检测重叠所有权和重复 target。
5. 汇总 missing、optional-skip、legacy-migration、ready、unchanged、error。
6. 任一 required 错误时抛出汇总错误，目标、资产、stale path 和 manifest 均未写入。

`applyPatchPlan()`：

1. 写入前逐文件复核原文或“不存在”状态仍与 preflight 一致。
2. changed 的已有文件调用 `preserveFirstBackup()`；新建配置文件记录 created 状态但不伪造备份。
3. changed-only 写入，保持原换行策略和结构化文件格式。
4. 返回 bundles、patches、targets、before/after hash、status、backupNotes 和 warnings。

### 7.2 Apply Pipeline

0.6：

```text
resolve variant/catalogs
→ prepare all Skill-Garden + Flower Patch
→ apply Patch plan
→ copy skills/scripts/Flower assets
→ sync common skills
→ stale asset cleanup
→ write success manifest with Patch provenance
```

0.5/old 继续走 legacy Workflow 注入。0.6 不再调用 Skill/Hook override 或平台 tweak 独立执行器。

普通文件系统不承诺跨 Patch 与资产复制的事务回滚。Patch preflight 或 apply 失败发生在资产写入前；Patch 成功后若后续资产步骤失败，manifest 不更新，用户可从首次备份恢复后重跑。

## 8. 旧状态迁移

Patch Engine 显式识别以下旧来源：

- `skill-garden transform <id> v0.6` marker。
- `skill-garden overrides` Hub section。
- `skill-garden workflow-state <state>` sentinel。
- `skill-garden skill override <name>` block。
- shared Hook 已覆盖内容 fingerprint。
- JSON Hook 的旧 matcher、旧 timeout 和重复命令位置。

迁移在内存中完成，最终只保留新 Patch 结果。Workflow-state 直接替换完整 body，因此会同时清掉旧 sentinel 和被其压制的上游旧正文。

新 marker 使用 `skill-garden patch <operation-id> v0.6`。升级兼容允许识别旧 HTML/hash/slash marker，但目标中不得同时保留新旧 namespace。

不支持无损自动降级到旧执行器。旧 flower 版本面对新 marker 应因 required selector 不匹配而失败保护；恢复旧版时使用 `.trellis/.backup-flower/` 原始文件后重新应用旧版本。

## 9. Skill 与 Workflow 迁移策略

### 9.1 Workflow

- Hub：识别旧 section 并 `replace`；fresh 上游通过 `## Phase Index` 结构锚点 `insert`。
- 五个 workflow-state：按 state 名 `replace body`，每个最终 body 只有一个 Patch marker。
- planning 与 planning-inline、in-progress 与 in-progress-inline 各自共用一个叶子目录；Patch 通过有序 `content.sources` 拼接 `common-content + subagent/inline-content`，不引入构建脚本或模板代码。

### 9.2 Update-Spec

- 保留上游仍有效的 code-spec 规则、模板和七段式要求。
- 用 Markdown section `replace/remove` 删除 `Interactive Mode` 冲突。
- 在稳定章节位置 `insert` 自主三态、证据、最小写入和续行契约。
- 不再保留顶部“覆盖下方 Interactive Mode”的长高优先级声明。
- Patch 正文保持上游 Skill 的英文协议语言；只有“下一步”“继续”等需要按字面识别的用户输入可作为示例保留中文。

### 9.3 Finish-Work

- 新协议已经完整接管旧 Step 1-4，使用 `document-body replace`，保留上游 frontmatter。
- 最终正文只保留 release audit、exact archive/journal bookkeeping、基线 push 和结果格式，不再并列两套步骤。

## 10. Catalog 所有权与双消费者

- `src/lib/patch-engine.js` 是 flower-trellis JS Core consumer，`platform-patch-adapters.js` 注册 Flower 扩展 Adapter。
- `vendor/skill-garden/scripts/apply-trellis-patches.py` 是标准库 Python consumer。
- 两者共享 Skill-Garden Core schema、fixture corpus、marker、literal/Markdown/file 目标解析和错误矩阵。
- flower JS consumer 在同一 Patch Engine 上额外注册 JSON Hook、YAML key、TOML section 和 Flower resolver，再加载 `src/patches`。
- Python consumer 不加载 Flower catalog；如果输入 catalog 声明其不支持的 adapter/resolver，必须失败而不是静默跳过。
- `install.sh` 只调用 Python Patch runner一次，删除 0.6 Workflow/Skill 内嵌 Python；0.5/old 分支保留 legacy 逻辑。

## 11. Provenance 与诊断数据

全装成功后的 `.flower-manifest.json` 增加：

```json
{
  "patches": {
    "schemaVersion": 1,
    "catalogHash": "sha256:...",
    "applied": [
      {
        "id": "workflow-state-in-progress",
        "patch": "workflow-states-in-progress",
        "bundle": "intent-routing",
        "target": ".trellis/workflow.md",
        "status": "applied",
        "resultHash": "sha256:..."
      }
    ]
  }
}
```

精细安装继续不写 manifest；幂等依靠 marker/结构化身份，CLI 结果仍输出完整 Patch evidence。该数据足够后续 Doctor 检测 catalog drift、target drift 和旧 marker，不在本任务实现完整 Doctor UI。

## 12. 上下文预算

预算 checker 不再依赖旧 `overrides/workflow.md` / `workflow-states/` 目录，而测量：

- 当前 dogfood `.trellis/workflow.md`。
- dogfood 中全部 workflow-state 的最终 body 和总量，包括五个受管 state 与项目自定义 state。
- `get_context.py --mode phase` 与真实 SessionStart fixture。
- Patch 后 `.agents` / `.claude` 中 `trellis-update-spec`、`trellis-finish-work` 的有效最终 Skill。

默认 `warn/high-warning` 不失败；`--strict` 只对 high-warning 失败。新增 Skill 指标的 target/review 以迁移前实际值和预期去重结果建立，不提高既有 Workflow 阈值。

## 13. 错误与兼容矩阵

| 条件 | 结果 |
|---|---|
| Bundle 引用未知 Patch | schema/preflight 失败，零写入 |
| required selector/fingerprint 漂移 | 汇总失败，零写入 |
| optional 或 existing-only 目标缺失 | 结构化 skip |
| `missing=create` 但父平台目录缺失 | skip 或 error，按声明；不创建平台目录 |
| 同一目标 Patch ownership 重叠 | preflight 失败，除非显式有序且前后 selector 可验证 |
| 旧 marker 唯一且合法 | 原位迁移到新 Patch |
| 新旧 marker 同时存在 | required 失败 |
| JSON Hook 已在错误 matcher/timeout | remove + insert/replace 归位 |
| 结构化文件损坏 | required 失败，不用空壳覆盖用户文件 |
| preflight 后文件变化 | apply 失败，资产尚未写入 |
| 重复运行 | changed=0，文件树 hash 不变 |

当前 `codex-tweaks` / `claude-tweaks` 对损坏 JSON 使用空壳重建。统一 Patch 后改为失败保护，避免用空配置覆盖未知用户内容；缺失文件仅在已有平台目录且声明 `missing=create` 时创建。

## 14. 回滚

- 代码回滚：恢复旧 catalog/执行器并从 `.trellis/.backup-flower/` 恢复目标原文后重跑。
- 单目标迁移失败：Patch 尚未写入；修复声明或 selector 后重跑。
- Patch 已写、后续资产失败：manifest 保留旧版；恢复备份或修复资产问题后完整重跑。
- 0.5/old 未迁移，回滚不影响其行为。
