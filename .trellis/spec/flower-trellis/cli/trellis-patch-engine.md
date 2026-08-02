# Trellis Patch Engine

> Trellis 0.6 对 workflow、skill、command、hook 和平台配置执行统一 `insert / replace / remove` 的长期契约。

---

## Scope / Trigger

以下改动必须读取本规范：

- 新增或修改 `vendor/skill-garden/.trellis/0.6/overrides/patches/`、`overrides/bundles/`。
- 修改 `src/lib/patch-engine.js`、`platform-patch-adapters.js`、`apply-enhancements.js`。
- 修改 `src/lib/patch-fixture.js`、`scripts/run-skill-garden-compiled-targets.mjs`、`vendor/skill-garden/scripts/generate-compiled-targets.py` 或子仓 `compiled-targets/`。
- 修改 `vendor/skill-garden/scripts/apply-trellis-patches.py` 或 `install.sh` 的 0.6 流水线。
- 修改 Patch provenance、首次备份、精细安装别名或旧注入迁移规则。
- 上游 Trellis 升级后出现 selector/baseline 漂移或重复 marker。

0.6 的文件修改只能进入 Patch Engine。不得新增 workflow sentinel 注入器、skill additive override 注入器、hook 专用注入器或平台配置直改分支。0.5/old 保留 legacy 路径，不要求迁移到本协议。

## Source Layout

Skill-Garden 按修改目标组织，不按变换类型组织：

```text
vendor/skill-garden/.trellis/0.6/overrides/
├── compatibility.json
├── conflicts.json
├── patches/
│   ├── workflow/<feature>/
│   ├── skills/<skill>/<feature>/
│   └── hooks/<hook>/<feature>/
│       ├── patch.json
│       ├── selector.* | baseline-*.md
│       └── <role>-content.md | <state>-baseline.md
└── bundles/
    └── <install-alias>.json
```

Flower 自有的平台配置修改位于：

```text
src/patches/
├── conflicts.json
├── platforms/<platform>/<feature>/patch.json
└── bundles/*.json
```

硬约束：

- 每个 Patch 叶子目录只有一个 `patch.json`，selector、baseline、content 与它同目录。
- 内容片段统一使用 `<role>-content.<ext>`，例如 `common-content.md`、`subagent-content.md`、`inline-content.md`；基线使用 `<state>-baseline.<ext>`。禁止用 `common.md`、`dispatch.md` 这类无法直接看出文件职责或路由语义的名称。
- `bundles/` 只定义选择别名和 Patch 引用，不包含修改逻辑。
- `compatibility.json` 只登记受测 Trellis 版本与兼容线；`conflicts.json` 只声明最终产物断言。二者不得执行变换。
- Skill-Garden 是强化内容真实源；`npm run sync` 生成 `enhancements/0.6`，禁止只改快照。
- 新目录不得恢复 `overrides/transforms/`、`overrides/workflow-states/`、`overrides/skills/*.md` 或 `overrides/hooks/` 的并行协议。

## Patch Declaration

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
      },
      "legacyMarkers": [
        { "namespace": "workflow-state", "id": "in_progress" }
      ]
    }
  ]
}
```

声明约束：

- Patch `schemaVersion` 固定为 `2`；Bundle `schemaVersion` 固定为 `1`。
- catalog、Patch、Bundle、operation ID 使用小写连字符；Patch、Bundle、operation ID 只要求在所属 catalog 内唯一。
- 全局身份固定为 `<catalog-id>/<local-id>`。Bundle 内的 Patch ref 仍只解析本 catalog；operation 关系中的裸 ID 解析到当前 catalog，qualified ID 可引用其它 catalog。
- `purpose` 必须说明修改目的；不得用于控制执行分支。
- operation 只允许 `insert`、`replace`、`remove`。
- `required` 默认继承 Patch，最终默认 `true`。
- `targetPolicy` 只允许 `each-existing`、`at-least-one`、`required-all`。
- `targets` 必须显式列出目标，不支持 glob、任意脚本或模板代码。
- `after` 与 `dependsOn` 是可选 operation 字符串数组：`after` 只约束双方都入选时的顺序，`dependsOn` 还要求依赖 operation 必须入选。同一引用不得重复或同时出现在两个字段。

## Operation Ordering

- planner 在 target preflight 前对完整 catalog 图校验未知引用、自引用和循环，再对已选 operation 执行稳定 Kahn 拓扑排序。
- `dependsOn` 建立 selection closure；依赖未进入精细计划时阻断。`after` 引用存在但未选中时不建边。
- 无依赖关系的 operation 严格保留 catalog/Bundle/Patch 声明顺序；禁止用数值 priority、对象键或偶然 Set 顺序控制执行。
- `operationOrder[]` 必须记录 qualified identity、声明/解析索引、`after`、`dependsOn` 和 `incomingEdges`，作为顺序审计依据。
- 不因两个 operation 修改同一 target 自动建边；不重叠修改继续依赖稳定声明顺序。

## Target Contract

target 字段：

- `kind`：`workflow | skill | command | hook | markdown | file | json | yaml | toml`。
- `path`：项目根内 POSIX 相对路径；拒绝绝对路径、反斜杠、空片段、`.`、`..` 和软链逃逸。
- `missing`：`skip | create | error`，默认 `skip`。
- `requires`：平台前置目录或文件。例如 `.codex/hooks.json` 可声明 `requires: [".codex"]`，避免给未启用平台创建目录。
- `markerStyle`：`html | hash | slash | none`。hook 默认 `hash`，普通文件默认 `none`，其余默认 `html`。

`missing=create` 只允许 `json`、`yaml`、`toml` target，且目标父目录必须已经存在、解析后的真实路径仍位于项目根内；平台根目录缺失时仍跳过。损坏的 JSON/YAML/TOML 必须失败，禁止用空对象覆盖用户配置。

## Content Contract

`insert` 与 `replace` 必须声明且只能声明一种 content 来源：

- `content.source`：单文件内容。
- `content.sources`：按数组顺序去尾空白后以单个换行拼接，适合 `common-content.md + subagent-content.md`。
- `content.value`：JSON 等结构化 adapter 的声明值。

`remove` 禁止 content。`insert` 必须声明 `position: before | after`。

baseline 是允许被升级的完整旧内容指纹，不是模糊 fallback。结构 selector 应优先用 baseline；字面 selector 使用 `selector.source` 和 `expectedMatches`。selector 漂移时不得自动改成顶部追加。

`markerStyle=none` 的 literal replace 只有在目标内容出现次数等于 `expectedMatches` 且 selector
出现次数为 `0` 时，才允许返回 `desired-content` 并判定幂等。若 selector 与目标内容同时存在，
必须继续执行 selector 替换；不得因为文件其它位置已有相同目标内容而静默跳过真实目标。

## Selector Contract

Core selector：

| type | 合法操作 | 关键约束 |
|---|---|---|
| `literal` | insert/replace/remove | 精确 UTF-8 原文和 `expectedMatches` |
| `workflow-state` | replace | `scope=body`，保留 state 开闭标签 |
| `workflow-hub` | insert | 精确二级标题锚点，内容放入 managed Patch block |
| `markdown-section` | insert/replace/remove | 精确 heading，可用完整 section baseline |
| `markdown-document` | replace | `scope=body`，按目标保留 frontmatter |
| `whole-file` | replace | 完整 baseline 或已经等于目标内容 |

Flower 扩展 adapter 仅用于结构化平台配置，目前允许：

- `json-hook-command`
- `yaml-key`：`content.value` 可继续是 legacy scalar；需要同步受管注释时使用 JSON 文本
  `{"value":"auto","commentSection":{"heading":"...","lines":[...],"missing":"skip|error"}}`。
  comment section 只匹配唯一精确标题和“分隔线 + 标题 + 分隔线 + 正文 + 分隔线”结构，替换时
  必须保留下一个 section 的起始分隔线。缺失、重复或结构损坏按 `missing`/error 处理，不能在文件
  顶部盲加注释。两级 key 更新仍须保留同 block 其它 key、其它顶层内容和原行尾语义。
- `toml-section`

adapter 必须通过 `flowerPatchAdapters()` 显式注册，并遵守相同的 preflight、required、目标路径、零写入和 changed-only 契约。不得把通用 Patch 逻辑复制进 adapter。

## Bundle Contract

```json
{
  "schemaVersion": 1,
  "id": "intent-routing",
  "aliases": ["workflow-enhancement", "task-intent"],
  "installMode": "full-or-selected",
  "patches": ["workflow/hub", "workflow/states-in-progress"]
}
```

- `installMode=full-or-selected`：全装或 ID/alias 精细安装时选择。
- `installMode=full-only`：仅全装选择，适合 Flower 平台配置。
- 每个 Patch 必须至少被一个 Bundle 引用；未知引用和孤立 Patch 均失败。
- 同一 Patch 可被多个 Bundle 合法引用；planner 只执行一次，并在 `selectedPatches[].bundles`、target `operationEntries` 和 provenance 中保留全部 qualified Bundle 归属。兼容字段 `bundle` 固定取第一归属。
- Bundle 不得隐式扩大精细安装范围。新增 alias 时必须测试它实际选择的完整 Patch 集合。
- Workflow phase ownership 属于 `intent-routing`/全量安装；`update-spec` 等单 Skill alias 不得顺带接管整个 Workflow。

## Compatibility And Conflict Policy

0.6 catalog 可通过 descriptor 声明只读 `compatibilityFile` / `conflictsFile`；文件必须位于 catalog 根内并参与 catalog hash。Skill-Garden 必须随源和快照携带同一份 policy：

- `testedVersions` 的精确版本正常继续；当前登记 `0.6.12`。
- 未登记但仍在 `compatibleLine=0.6` 的版本返回 `warning: untested-upstream`，只有完整 Patch preflight 与冲突断言通过后才允许写入。
- `0.7+`、`1.x` 或不可解析版本返回 `error`，Patch、资产、stale 清理和 manifest 全部零写入；用户只能改用匹配 Flower 版本或 `--no-enhance`。
- `conflicts.json` 首版只允许 `absent-literal`、`required-literal`、`max-occurrences`；规则只审计 `whenOperations` 全部实际选中的计划。
- 多 catalog policy 共同聚合 compatibility/conflict；任一 error 阻断。`whenOperations` 裸 ID 按 policy owner catalog 解析，qualified ID 可引用其它 catalog；rule diagnostic 身份固定为 `<catalog-id>/<rule-id>`。
- Flower 平台 operation 的最终产物断言由 `src/patches/conflicts.json` 所有，并通过 Flower catalog descriptor 加载。独立 Skill-Garden policy 不得引用 Flower operation，否则 canonical compiled-target 单 catalog consumer 会因未知 operation fail closed。
- evaluator 读取 `plan.files[].next`，不定位或修改文本。变换仍只由 Patch Engine 所有。
- `preparePatchPlan()` / `prepare_patches()` 必须返回未受精细安装过滤的 `catalogOperations[{id,targets}]`。evaluator 在执行规则前验证每个 `whenOperations` 存在，且规则 target 确由对应 operation 修改；拼写错误不得静默跳过。
- diagnostic 固定为 `error | warning | info`：互斥协议/未支持版本阻断，评审型重复与同线未测版本告警，正常 `missing-target` 只计 info。
- warning 必须在 `applyPatchPlan()` / `apply_prepared()` 前输出 rule ID、target、reason 和 evidence；Skill-only 精细安装也不能因未选择 Bundle 而吞掉版本 warning。维护者与发布脚本复用同一 JS formatter。

Workflow 内容所有权遵循“上游优先、Patch 只保留必要差异”：已确认冲突的 Active Task Routing、Phase 2.1、2.2、3.3、3.4 使用以 Trellis `0.6.12` 对应 section 为 baseline 的 `markdown-section replace`；Hub 不得再写“高优先级覆盖下层/下层 inactive”。State 只保留当前状态会改变下一动作的一跳门禁，完整 route/check/update-spec/push 协议由对应 Skill 所有。
Phase 正向断言必须包含 managed marker、heading 和 section 首句形成的唯一签名，不能只搜索整个 Workflow 中会被 Hub/State 重复满足的裸 Skill 名。已删除的 State Hub 职责句 `max-occurrences` 固定为 `0`，任一回流都返回 warning。

## Managed Marker And Migration

新 marker 统一使用：

```text
<!-- BEGIN skill-garden patch <operation-id> v0.6 -->
# BEGIN skill-garden patch <operation-id> v0.6
// BEGIN skill-garden patch <operation-id> v0.6
```

每种形式都有对应 END。marker 用于内容升级和 `remove` tombstone。BEGIN/END 不配对、数量不等于 `expectedMatches`、同一 operation 同时存在多种新旧 marker 时必须失败。

内置 `skill-garden`、`flower` catalog 保留 local operation marker，保证现有安装字节兼容；其它 catalog 使用 qualified operation ID 作为 marker，避免插件之间本地 ID 冲突。

0.6 一次性迁移要求：

- `legacyMarkers` 可识别旧 transform marker、旧 marker style 和 workflow-state sentinel。
- `cleanup` 只允许受控的 `skill-override`、`workflow-hub` 清理，用于移除旧 additive 块后再结构化应用。
- Update-Spec 替换原 `## Interactive Mode` section；Finish-Work 替换 document body；workflow state 替换完整 body。
- 迁移成功后最终文件只保留 Patch marker，不再保留旧 additive override 或 transform marker。

## Preflight And Apply

`preparePatchPlan(target, catalogs, options)`：

1. 加载并校验全部 catalog、Bundle/Patch、qualified operation 关系和 policy 路径。
2. 解析 Bundle 多归属与稳定拓扑顺序，再在内存计算每个目标的最终文本。
3. 汇总 missing target、optional skip 与 required error；`missing-target` 和 `optional-skip` 必须分开统计。
4. 任一 required error 时抛出，目标、资产和 manifest 均零写入。
5. 返回稳定 `catalogHash`、`selectedBundles`、`selectedPatches`、`operationOrder`、qualified `catalogOperations`、文件 before/after hash 和结构化结果。

`applyPatchPlan(target, plan)`：

1. 写入前复核全部目标的存在性和内容，防止 preflight 后并发漂移。
2. 新建目标再次复核父目录存在且真实路径未通过软链逃逸。
3. changed 的已有文件调用 `preserveFirstBackup()`，备份到 `.trellis/.backup-flower/<target>`；备份源、最近存在父目录和最终父目录都必须位于项目根内。
4. 只写 changed 文件；重复运行必须零变更。
5. 返回 changed/unchanged/missingTargets/optionalSkipped、兼容 `skipped`、target、backup note、result 与 provenance。

普通文件系统 I/O 不承诺跨文件事务。中途异常时不得写成功 manifest；使用首次备份恢复后重跑。

## Unified Apply Pipeline

Trellis 0.6 的 builtin skill-garden Runtime 顺序固定：

1. 解析 variant 和精细安装选择。
2. 读取共享 policy 并先执行版本兼容检查；invalid 或未支持的新 minor/major 直接返回包含 `--no-enhance` 的 error，不能被旧 catalog 的 selector/baseline 漂移掩盖。
3. 同时加载 Skill-Garden catalog 与 Flower platform catalog，对所有 required Patch 全量 preflight，在内存得到最终文件。
4. 校验 conflict rule 的 operation/target 引用并执行最终产物断言；同一兼容线未登记版本到此时才输出 warning，任一 error 时零写入。
5. 把 PatchMutation 与内容 mutation 合并为一个 InstallPlan；同 owner 重叠必须最终 hash 相同。
6. Transaction Writer 一次写目标、声明、lock 和 state；Patch provenance 写 state `patches[]`。
7. 旧 manifest 只读迁移并保留，不进入成功写链。

0.6 禁止再调用 `injectWorkflow()`、skill/hook override injector 或 Codex/Claude tweak。`injectWorkflow()` 与旧 tweak 只服务 0.5/old。

Skill-Garden 独立安装器顺序同样固定：版本/目标解析 → 共享 compatibility 早期阻断 → Python prepare → conflict 检查与同线 warning → apply → 复制 helper/common/Trellis 资产。不得在 `install.sh` 内维护第二份版本或冲突规则。

## Consumer Parity

正式 consumer：

- JS：`src/lib/patch-engine.js`。
- Python：`vendor/skill-garden/scripts/apply-trellis-patches.py`。

两者必须保持 schema、Bundle 选择与多归属、稳定顺序、路径安全、selector、baseline、marker 迁移、required/optional、preflight、首次备份、changed-only、catalog hash、版本状态和 diagnostic ID/severity/target 语义一致。Python 独立 consumer 固定为 `skill-garden` 单 catalog，跨 catalog 引用作为未知引用失败；多 catalog 隔离由 JS 测试覆盖。协议变更必须同时增加 JS/Python 测试。

## Provenance

全装成功 state 的 `flower/skill-garden.patches[]` 必须写 qualified operation、target 与 resultHash；
旧 manifest 的下列 provenance 结构只用于迁移兼容，不再新写：

```json
{
  "patches": {
    "schemaVersion": 2,
    "catalogHash": "sha256:...",
    "applied": [
      {
        "id": "workflow-state-in-progress",
        "catalog": "skill-garden",
        "qualifiedId": "skill-garden/workflow-state-in-progress",
        "patch": "workflow-states-in-progress",
        "qualifiedPatch": "skill-garden/workflow-states-in-progress",
        "bundle": "intent-routing",
        "bundles": ["skill-garden/intent-routing"],
        "target": ".trellis/workflow.md",
        "status": "applied",
        "resultHash": "sha256:..."
      }
    ]
  }
}
```

provenance 必须在首次应用与重复应用之间稳定；不得把本轮 `changed/unchanged` 写成持久状态。精细安装不维护 manifest，沿用现有 `--skills` 契约。

## Compiled Targets

`vendor/skill-garden/compiled-targets/<trellis-version>/full/` 是维护者可审阅的 Skill-Garden canonical full plan 最终产物，不是用户安装时的运行输入：

- `full` 只表示选择全部 Skill-Garden Bundle/Patch；平台 profile 固定为 `all-platforms`，覆盖 pinned Trellis 当前支持的全部 21 个平台及其 `.trellis`、共享 `.agents` 和平台原生 root。profile 中的 `platforms[]`、`roots[]` 与最终 `targets[]` 顶层目录必须互相一致。
- `plan.json` 保存 profile、catalog hash、qualified selection/order、catalog operations、target before/after hash、operation provenance、missing/optional 结果和 conflict 汇总；catalog 固定只有 `skill-garden`。
- `targets/<target>` 保存所有实际进入 plan 且有最终内容的 target；changed target 在同一目录旁保存 `targets/<target>.diff`，未变化 target 不生成 sidecar。
- 生成器在写盘前必须验证最终文件与 sidecar 不存在同名或文件/目录前缀冲突；真实 target 以 `.diff` 结尾不能覆盖另一个 target 的审阅 sidecar。
- `vendor/skill-garden/scripts/generate-compiled-targets.py` 必须直接复用 Python consumer 的 prepare/apply/policy API；Flower 薄调用器只负责传入当前包锁定的 Trellis/Node executable。
- `npm run patch:targets` 只保留当前精确 Trellis semver，使用 staging 和严格版本目录边界替换子仓产物；`npm run patch:targets:check` 逐文件逐字节报告缺失、变更和多余项。
- 产物不得包含绝对路径、临时路径、时间戳或用户名。vendor 子仓不进入 `package.json.files`；`npm run sync` 不得复制 compiled targets。
- canonical compiled targets 只加载 `skill-garden` catalog，但持久化全平台最终目标，供跨平台 Patch 结果审阅。`src/lib/patch-fixture.js` 继续初始化同一平台集合并额外加载 Flower catalog，供双 catalog coverage、adapter、compatibility 与 conflict 临时门禁使用；该临时 fixture 不写入仓库。
- AI context budget 的静态 workflow/skill 指标读取 compiled full `targets/` 中的最终文件；不得把 `.diff` sidecar 纳入最终上下文。Phase summary 与 SessionStart 继续真实执行测量。

## Validation Matrix

| 条件 | 结果 |
|---|---|
| required selector/baseline 漂移 | preflight 失败，全部目标零写入 |
| optional selector 漂移 | `optional-skip` 并继续独立操作 |
| 平台 prerequisite 缺失 | `missing-target`，不创建平台目录 |
| 同一 0.6.x 未登记版本 | `untested-upstream` warning，完整检查通过后继续 |
| 0.7+/1.x 或损坏版本 | 在旧 baseline preflight 前返回带 `--no-enhance` 指引的 compatibility error，全部目标零写入 |
| 最终产物复现 direct dispatch/auto-fix/local-only 等已知签名 | conflict error，全部目标零写入 |
| 配置 target 使用 `missing=create` 且真实父目录位于项目内 | 创建目标文件 |
| 非配置 target 使用 `missing=create` | schema 失败，零写入 |
| marker 已存在且唯一 | 原位升级 managed content |
| `markerStyle=none` 且 selector 与目标内容同时存在 | 执行 selector 替换，不返回 `desired-content` |
| 只有声明的 legacy marker | 迁移为 Patch marker |
| marker 重复、不配对或新旧并存 | preflight 失败 |
| 已有目标、新建目标父目录或备份目录通过软链逃逸 | preflight/apply 失败，项目外零写入 |
| preflight 后目标变化 | apply 前整体停止 |
| 重复全装 | Patch 修改数为 0，目标文件树与 manifest 不变 |

## Scenario: Target Python Command Materialization

### 1. Scope / Trigger

- Trigger：Trellis 0.6 目标项目可能把 canonical `python3` 渲染成 `python` 或 `py -3`，并因此影响 Patch selector、baseline、content、conflict assertion、平台 Hook 与随包文本资产。
- Scope：只对 Flower 可信 builtin 的 0.6 Patch catalog、policy、结构化 Hook adapter 和明确标记的 Skill-Garden 文本投影生效；不得扩展 Patch/Bundle schema，不得改写外部 Plugin catalog，也不得把文本命令当作 Python subprocess 的单个 executable argv。

### 2. Signatures

```js
resolveTrellisPythonCommand(target, options = {}) -> { command, source }
materializeTrellisPythonText(value, command) -> string
preparePatchPlan(target, catalogs, options = {}) -> PatchPlan
projectSkillGardenContent(options) -> ContentProjection
flowerPatchAdapters(pythonCommand = "python3") -> AdapterRegistry
```

可信 builtin catalog 通过 Runtime descriptor 传递命令：

```js
textMaterialization: { trellisPythonCommand: command }
```

Python 独立 consumer 使用等价入口：

```python
_resolve_trellis_python_command(target_root: Path) -> str
_materialize_trellis_python_text(value: str, command: str) -> str
prepare_patches(overrides_dir, target_root, skills=None, python_command=None) -> dict
```

### 3. Contracts

- 命令证据优先级固定为 `.codex/hooks.json` → `.claude/settings.json` → `.trellis/workflow.md` → `TRELLIS_PYTHON_CMD` → 平台回退；目标文件证据只识别 `python3`、`python`、`py -3` 对 Trellis/Hook 脚本的真实调用。
- `TRELLIS_PYTHON_CMD` 允许调用方显式传入非空命令，但必须去除首尾空白并拒绝换行、回车和 NUL；无证据时 Windows 回退为 `python`，其它平台回退为 `python3`。
- 同一次 builtin 规划必须把同一个解析结果传给 Skill-Garden 与 Flower catalog descriptor、`flowerPatchAdapters()` 和 Skill-Garden 内容投影，禁止各 consumer 独立猜测平台命令。
- 文本物化按行处理，只替换非 shebang 行中的 canonical `python3`；命令为 `python3` 时必须保持原字节不变。
- Patch selector、content、全部 baseline 与 conflict policy assertion 必须在精确匹配和冲突检查前物化；结构化 Hook adapter 与发布文本资产必须使用同一命令。
- `catalogHash` 继续绑定 canonical 原始 catalog/policy 文件，不能因目标命令不同而变化；目标 `beforeHash` / `afterHash` 必须按目标项目的实际字节计算。
- `textMaterialization` 是 Flower 可信 system catalog 的 Runtime descriptor，不是外部 Plugin manifest/catalog 能力；外部 catalog 经过安全规范化后不得携带该字段或获得 system adapter。

### 4. Validation & Error Matrix

| 条件 | 错误 / 结果 |
|---|---|
| 目标证据为 `python3` | 物化 no-op，canonical 字节与 hash 保持稳定 |
| 目标证据为 `python` 或 `py -3` | selector、baseline、content、assertion、Hook 和文本投影统一物化 |
| 多个证据或环境变量并存 | 按固定证据文件顺序取首个命中，目标证据优先于环境变量 |
| `TRELLIS_PYTHON_CMD` 为空、含换行/回车或 NUL | 规划前失败，目标、内容、lock/state 零写入 |
| 目标文件含未知命令或无 Trellis 脚本调用 | 不作为证据，继续环境变量或平台回退 |
| 外部 Plugin 尝试自报 descriptor 或 adapter | 规范化/能力边界拒绝或丢弃，不能进入可信 Runtime 路径 |
| 只物化 Patch 载荷但目标仍有其它 canonical 文本 | hash/冲突/内容一致性检查失败，事务不得部分写入 |

### 5. Good / Base / Bad Cases

#### Good

- Windows 目标的 `.codex/hooks.json` 已使用 `py -3`；Provider 解析一次并让两个 builtin catalog、Hook adapter、Skill 内容投影和 Python consumer 都产出 `py -3`，完整 preflight 后原子提交。

#### Base

- Linux/macOS 目标没有覆盖且使用 canonical `python3`；物化函数返回原文，既有 catalog hash、selector 和 compiled target 保持稳定。

#### Bad

- 为 Windows 复制一套 selector/content/baseline 文件，或只放宽 selector 来绕过 fingerprint 漂移。
- 把 `py -3` 作为单个 subprocess executable 传入 argv，混淆“文本命令渲染”和“进程启动参数”两个边界。
- 允许外部 Plugin 通过 catalog JSON 自报 `textMaterialization`，从而改写 selector、policy 或 system Hook adapter。

### 6. Tests Required

- JS helper：覆盖三种命令、证据优先级、环境变量和平台回退、shebang 保留、非法命令拒绝。
- JS Patch Engine / conflict policy：覆盖 literal selector、content、whole-file baseline、conflict assertion 的 `python` / `py -3` 物化，以及 strict drift 和零写入。
- builtin Plugin Runtime：断言两个可信 catalog、system adapter 和内容投影共享同一命令；断言外部 catalog 不能注入 descriptor。
- 真实 CLI：至少分别用 `python`、`py -3` 跑 `init --enhance-only`，验证 workflow、Hook、Skill 文本、重复执行与事务状态。
- Python runner：覆盖同样的解析与物化矩阵，并与 JS consumer 对同一 fixture 的 plan/target 结果保持 parity。
- 发布门禁：继续运行 snapshot sync、compiled target check、Patch conflict check 与 `npm test`，确保 canonical `python3` 产物无漂移。

### 7. Wrong vs Correct

Wrong：直接修改 canonical Patch 资产为 Windows 命令，或仅替换目标正文而让 selector、baseline、conflict assertion、Hook adapter 继续使用 `python3`。

Correct：保留单份 canonical `python3` 资产，由可信 builtin Provider 从目标证据解析一次命令，通过 Runtime descriptor 和共享参数在 preflight 前一致物化所有声明式匹配材料、结构化 adapter 与明确文本投影，同时保持原始 catalog hash 和 JS/Python consumer parity。

## Scenario: Compiled Target Output Commit Boundary

### 1. Scope / Trigger

- Trigger：修改 `generate-compiled-targets.py` 的目录替换、旧产物清理或 unified diff 生成行为。
- Scope：保证命令退出状态与实际输出树一致，并让任意文本行尾状态都产生可审阅、可校验的 diff sidecar。

### 2. Signatures

```python
_unified_diff(target: str, original: str | None, next_value: str) -> str
_replace_output(staging: Path, output_root: Path) -> list[str]
generate_compiled_targets(...) -> {
    "version": str,
    "files": int,
    "changedTargets": int,
    "warnings"?: list[str],
}
```

### 3. Contracts

- `plan.json#profile.id` 固定为 `all-platforms`；`platforms[]` 必须覆盖 pinned Trellis 当前支持的平台，`roots[]` 必须等于 `targets[].target` 的顶层目录集合。
- compiled plan 只包含 `skill-garden` catalog，不混入 Flower 平台 catalog；Flower catalog 继续由临时全平台 fixture 和冲突门禁验证。
- `_unified_diff()` 固定使用 `a/<target>`、`b/<target>` 逻辑标签；输入末行缺少换行时，该删除行或新增行后必须独立输出 `\ No newline at end of file`，不得把 `-old` 与 `+new` 粘成同一行。
- Skill-Garden 根 `.gitattributes` 必须对 `compiled-targets/**/targets/**/*.diff` 设置 `-whitespace`。sidecar 是补丁文本，`+ ` 等行表达目标文件真实空白，不能被仓库级 `git diff --check` 当作 sidecar 自身缺陷。
- `staging.rename(output_root)` 是目录替换的提交点。提交点之前失败返回 `CompiledTargetError`，已有输出可恢复时必须恢复；提交点之后新树已经是权威结果。
- 新树换入后删除旧 `compiled-targets.backup-<pid>` 失败属于可恢复清理问题：保持新树、返回 warning、CLI 退出成功并打印备份路径，不得再把已经提交的生成结果报告成替换失败。
- `--check` 只比较 staging 与现有输出，不执行替换，因此不返回清理 warning。

### 4. Validation & Error Matrix

| 条件 | 结果 |
|---|---|
| profile 缺平台、root 与 target 顶层目录不一致 | compiled target 测试失败，禁止提交产物 |
| plan 混入 Flower catalog | compiled target 测试失败；Flower catalog 只进入临时双 catalog 门禁 |
| 首次生成且 output root 不存在 | staging 直接换入，`warnings=[]` |
| 旧 root 移入 backup 或 staging 换入失败 | 返回 `CompiledTargetError`；可恢复时恢复旧 root |
| 新 root 已换入但 backup 删除失败 | 返回成功 summary + cleanup warning；新 root 保持有效 |
| 原文件末行无换行 | 删除行后输出标准 no-newline 标记 |
| 最终文件末行无换行 | 新增行后输出标准 no-newline 标记 |
| 原文件与最终文件末行均无换行 | 两侧各自输出标记，`git apply --check` 通过 |
| sidecar 包含补丁中的尾随空白行 | `git check-attr whitespace` 返回 `unset`，staged `git diff --check` 通过 |

### 5. Good/Base/Bad Cases

- Good：换入完成后 cleanup 失败，CLI 输出成功摘要和带 backup 路径的 warning，维护者可审查新树并单独清理旧备份。
- Base：正常替换后旧 backup 删除成功，返回空 warning 列表，重复生成保持零漂移。
- Bad：新树已经换入后因 `rmtree(backup)` 失败抛整体错误，使自动化认为输出未变化。
- Bad：直接拼接 `difflib.unified_diff()` 的无行尾数据，生成 `-old+new` 这类不可应用 sidecar。
- Bad：删除 sidecar 的 `-whitespace` 属性，导致合法补丁内容阻断仓库提交门禁。

### 6. Tests Required

- Python 单测故障注入 `shutil.rmtree(backup)` 失败，断言 `_replace_output()` 不抛错、新树存在、旧树只位于 backup、warning 包含 backup 路径。
- JS compiled target 测试断言 `profile.id=all-platforms`、平台数量、root 列表，以及 `roots[]` 与所有 target 顶层目录严格相等。
- Python 单测覆盖两侧都缺、仅原文件缺、仅最终文件缺三种行尾组合，断言标记数量和删除/新增行边界。
- 对上述 diff 运行 `git apply --check`，证明 sidecar 语法有效。
- 读取代表性 sidecar 的 Git attribute，断言 `whitespace: unset`，并运行 Skill-Garden staged `git diff --check`。
- 运行 `npm run patch:targets:check`，证明当前 canonical 文件未因生成器修复发生无关漂移。

### 7. Wrong vs Correct

#### Wrong

```python
staging.rename(output_root)
shutil.rmtree(backup)  # 失败后抛整体错误，但 output_root 已经是新树
```

#### Correct

```python
staging.rename(output_root)  # 提交点
try:
    shutil.rmtree(backup)
except OSError as error:
    warnings.append(f"旧备份清理失败:{backup}:{error}")
```

## Tests Required

```bash
node --test test/js/patch-engine.test.js
node --test test/js/platform-patches.test.js
node --test test/js/apply-enhancements.test.js
node --test test/js/patch-conflicts.test.js
node --test test/js/patch-targets.test.js
python3 -m unittest discover -s test/python -p 'test_skill_garden_patches.py'
node scripts/check-patch-conflicts.mjs
npm run sync
npm run patch:targets
npm run patch:targets:check
npm test
```

至少覆盖三种 operation、`content.sources`、Core selector、平台 adapter、legacy migration、required/optional、target policy、版本四态、最终产物正反断言、正常 missing target、JS/Python report parity、普通文件 create 拒绝、新建父目录与备份软链逃逸、首次备份、非目标内容保留、全量 preflight 零写入、manifest 最后写、全部声明 Patch/target/target kind 覆盖和二次 dogfood 幂等。

## Scenario: Bundle Dependency Closure And Integrity Assertions

### 1. Scope / Trigger

- Trigger:新增/移动 Patch、调整 Bundle 归属、把通用控制面能力从精细安装 Bundle 拆到 `full-only`,或新增会改变 CLI 成败语义的 operation。
- Scope:保证每种可选安装计划都能独立生成可运行最终文件,并让关键 operation 在 `conflicts.json` 中有最终产物证据。

### 2. Signatures

```python
prepare_patches(overrides_dir, target_root, skills=[])
prepare_patches(overrides_dir, target_root, skills=["task-intent"])
```

```json
{
  "id": "control-plane-integrity",
  "installMode": "full-only",
  "patches": ["scripts/task-store-write-integrity", "scripts/runtime-state-integrity"]
}
```

### 3. Contracts

- `full-or-selected` Bundle 的最终文件不得依赖只存在于 `full-only` Bundle 的 helper、import、类型或 marker。精细 alias 的 Patch 计划必须自包含。
- 通用 runtime 原子写、损坏分类、resolution/fallback/set 属于 `full-only` 控制面 Patch;面向 `task-intent` 的 finish/clear 契约只保留自身需要的最小读取 helper,不得把整套 runtime Patch 塞回 alias。
- Patch 移动后 operation ID 保持稳定,让已有 managed marker、backup 和 provenance 原位升级;不得通过新 ID 叠加第二份实现。
- `conflicts.json` 的 `whenOperations` 必须覆盖所有新增的控制面成败语义 operation。不同 target 使用独立 rule;不得把 `.trellis/scripts/common/paths.py` 的断言藏在 task-store rule 中。
- conflict rule 必须断言最终文件中的 marker 和关键行为字面量,不能只证明 Patch 声明文件存在。

### 4. Validation & Error Matrix

| 条件 | 结果 |
|---|---|
| `task-intent` 精细计划包含 full-only runtime operation | 测试失败,视为 Bundle 范围扩大 |
| 精细计划缺少自身 clear helper | 最终脚本不可运行,测试失败 |
| full 计划缺少 runtime-state-integrity | preflight/测试失败 |
| 新控制面 operation 未出现在任何 `whenOperations` | 静态覆盖测试失败 |
| conflict rule target 不是 operation 实际 target | catalog policy 校验失败 |
| full 与精细计划均可重复应用 | 第二次 Patch 修改数为 0 |

### 5. Good/Base/Bad Cases

- Good:`runtime-state-integrity` 只在 full 安装出现;`task-intent` 仍包含 structured clear result 和其最小 JSON 分类 helper,最终 `active_task.py` 可运行。
- Base:operation 从旧 Patch 移到新 Patch 但 ID 不变;已有 marker 被新 owner 原位升级,provenance 显示新 Patch/Bundle。
- Bad:为复用 `_read_json_result` 把原子写、fallback、set 等所有 F7 operation 留在 `intent-routing`,导致安装单个 task-intent Skill 时隐式改变整个 runtime 控制面。
- Bad:新增 `task-set-scope-write` 但 conflict rule 只覆盖 create/archive,最终产物回退时发布检查无法发现。

### 6. Tests Required

- Python consumer 分别生成 full 与 `task-intent` 计划;断言 full 包含 `runtime-state-integrity`,精细计划不含 `active-task-runtime-json-io/resolution/fallback/set` 且包含 clear helper。
- JS apply 测试读取精细安装后的最终 `active_task.py`,断言 clear marker 存在、runtime marker 不存在,并验证第二次应用文件树不变。
- 静态测试读取 `conflicts.json`,断言每个新增控制面 operation 至少被一个匹配 target 的 rule 覆盖。
- 运行 `node scripts/check-patch-conflicts.mjs`、`npm test`、`npm run sync`,并比较 vendor 与 `enhancements/0.6/overrides` 逐字节一致。

### 7. Wrong vs Correct

#### Wrong

```text
intent-routing -> state-missing-task -> clear + atomic I/O + fallback + set
```

精细安装为了一个 finish 契约顺带改变整个 session runtime。

#### Correct

```text
intent-routing -> structured clear + minimal read classification
full-only control-plane-integrity -> atomic I/O + resolution + fallback + set
```

每种安装模式只获得其声明职责,同时由 full/selected 计划测试和 conflict policy 验证最终产物。
