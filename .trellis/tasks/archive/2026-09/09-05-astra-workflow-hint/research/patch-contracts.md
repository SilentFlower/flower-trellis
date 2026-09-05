# 本任务适用的 Patch 规范原文摘录

来源：`.trellis/spec/flower-trellis/cli/trellis-patch-engine.md`，SHA-256：`d166af7e14118829dc30724445e2abcba4ee9129197d85e5109ecd66d8bdb27f`。

为避免源文超过单文件注入额度导致尾部 SessionStart 契约被截断，本研究文件逐字摘录基础契约、全局 Tests Required 与完整 SessionStart 场景；不替代规范源。实施/检查前核对源摘要，若有变化重新读取对应完整章节。涉及此处未收录的 Python 命令物化、生成目标提交或 Bundle 依赖变更时，再按 spec router 补读原文相应章节。

以下为原文，内部相对链接按源规范目录解析。

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

- `testedVersions` 的精确版本正常继续；当前登记 `0.6.14`。
- 未登记但仍在 `compatibleLine=0.6` 的版本返回 `warning: untested-upstream`，只有完整 Patch preflight 与冲突断言通过后才允许写入。
- `0.7+`、`1.x` 或不可解析版本返回 `error`，Patch、资产、stale 清理和 manifest 全部零写入；用户只能改用匹配 Flower 版本或 `--no-enhance`。
- `conflicts.json` 首版只允许 `absent-literal`、`required-literal`、`max-occurrences`；规则只审计 `whenOperations` 全部实际选中的计划。
- 多 catalog policy 共同聚合 compatibility/conflict；任一 error 阻断。`whenOperations` 裸 ID 按 policy owner catalog 解析，qualified ID 可引用其它 catalog；rule diagnostic 身份固定为 `<catalog-id>/<rule-id>`。
- Flower 平台 operation 的最终产物断言由 `src/patches/conflicts.json` 所有，并通过 Flower catalog descriptor 加载。独立 Skill-Garden policy 不得引用 Flower operation，否则 canonical compiled-target 单 catalog consumer 会因未知 operation fail closed。
- evaluator 读取 `plan.files[].next`，不定位或修改文本。变换仍只由 Patch Engine 所有。
- `preparePatchPlan()` / `prepare_patches()` 必须返回未受精细安装过滤的 `catalogOperations[{id,targets}]`。evaluator 在执行规则前验证每个 `whenOperations` 存在，且规则 target 确由对应 operation 修改；拼写错误不得静默跳过。
- diagnostic 固定为 `error | warning | info`：互斥协议/未支持版本阻断，评审型重复与同线未测版本告警，正常 `missing-target` 只计 info。
- warning 必须在 `applyPatchPlan()` / `apply_prepared()` 前输出 rule ID、target、reason 和 evidence；Skill-only 精细安装也不能因未选择 Bundle 而吞掉版本 warning。维护者与发布脚本复用同一 JS formatter。

Workflow 内容所有权遵循“上游优先、Patch 只保留必要差异”：已确认冲突的 Active Task Routing、Phase 2.1、2.2、3.3、3.4 使用以 Trellis `0.6.14` 对应 section 为 baseline 的 `markdown-section replace`；Hub 不得再写“高优先级覆盖下层/下层 inactive”。State 只保留当前状态会改变下一动作的一跳门禁，完整 route/check/update-spec/push 协议由对应 Skill 所有。
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

## Scenario: SessionStart Parts And Context Limit Preservation

### 1. Scope / Trigger

修改 Codex / Claude 的 SessionStart 注册、`json-hook-command` 重建逻辑或 Flower 启动资产时读取本节。
旧 adapter 删除 handler 后只重建 type / command / timeout，会丢失用户设置的 `additionalContextLimit`；
单份工作流摘要过长也可能被宿主替换成落盘预览。分段和额度迁移必须同时经过真实安装链验证。

### 2. Signatures

部署入口示例（在项目根目录执行；Python 命令沿用本规范的目标物化规则）：

```bash
python3 -X utf8 .trellis/scripts/flower_session_start.py --hook .codex/hooks/session-start.py --part state
python3 .trellis/scripts/flower_session_start.py --hook .claude/hooks/session-start.py --part rules
```

- `--hook` 只接受上述两个原生路径；`--part` 只接受 `state | rules | stages`。
- `render_part(root: Path, hook: str, part: str, hook_input: dict) -> dict | None`。
- `split_workflow(summary: str) -> dict[str, str]` 返回 `rules` / `stages`，拼接后等于原始摘要。
- `json-hook-command` 的 `content.value.sessionParts` 只允许固定数组 `["state", "rules", "stages"]`，
  且仅用于 `event=SessionStart`、`commandResolver=codex-session-start|claude-session-start`。

### 3. Contracts

- 源脚本属于 `src/assets/flower_session_start.py`；builtin Skill-Garden 0.6 全装通过内容投影安装到
  `.trellis/scripts/flower_session_start.py`，由 Plugin state 记录普通资产 ownership。对应平台 Patch
  属于 Flower `flower-platform-integration` full-only Bundle；不得只直改已部署脚本或 JSON 配置。
- 两个平台均只注册 `startup|clear|compact`；迁移删除旧单 handler / 旧分段及因此移空的分组，
  保留无关 handler。Flower 更新检查独立匹配 `startup`。old/0.5 沿用原注册路径。
- `selector.commandNeedle` 为该平台原生 SessionStart 相对路径。新命令保留该路径为 `--hook` 参数，
  供既有 bootstrap 检测与后续迁移识别；不能把原生路径一并删除。
- stdin 为宿主 JSON 对象；原生入口继续消费 session 字段。wrapper 按自身部署位置确定项目根并设置
  输入 `cwd`；宿主的项目目录环境变量应与目标项目一致。CLI 注册仍沿用项目根目录的相对命令约定。
- `state` 调用原生 `main()`，从标准 additionalContext 移除唯一完整 `trellis-workflow` 块，
  独占会话绑定等副作用；`rules` / `stages` 只调用 Codex `_build_workflow_toc` 或 Claude
  `_build_workflow_overview`，读取同一 `.trellis/workflow.md`，在 `### Planning Artifacts` 前无损分割。
  handler 可并行，不能依赖执行顺序、其他分段的缓存或绑定结果。
- 每份输出为 `hookSpecificOutput: {hookEventName: "SessionStart", additionalContext: "..."}`，
  正文由独立闭合的 `<trellis-session-part name="state|rules|stages">` 包裹。state 去掉原生
  `additional_context` 兼容副本与旧全文字符计数消息，保留其他原生诊断。
- 重建前收集 `additionalContextLimit`，要求为非负安全整数。已有分段的显式值优先，其次继承旧单
  handler 的值；`0` 必须原样保留，不能用 truthy 判断丢弃。无显式值时不写该字段；不主动向 Claude
  加入 Codex 专属额度。同一分段或旧单 handler 存在矛盾的显式额度时，preflight 报错而不任选其一。
- `TRELLIS_HOOKS=0`、`TRELLIS_DISABLE_HOOKS=1` 时无输出；Codex 还尊重 `CODEX_NON_INTERACTIVE=1`。
  `source=resume` 无输出；其余原生跳过条件继续交给 `should_skip_injection()`。
- 大小目标、字符与 UTF-8 bytes 的区别、默认 / strict 告警规则统一见 [AI Context Budget](./ai-context-budget.md)。
  分段字符数和本地 tokenizer 测量不能替代宿主实际接收验证，也不能证明模型会遵循工作流。

### 4. Validation & Error Matrix

| 条件 | 结果 |
| --- | --- |
| 原单 handler 的额度为 5000，尚无分段覆盖 | 三段分别继承 5000，后续更新不丢失 |
| 三段分别设置 5000 / 6000 / 0 | 再次应用原样保留，目标零差异 |
| 缺省额度 | 保持字段缺省，使用宿主行为 |
| 已有额度非法或同一分段额度冲突 | Patch preflight 失败，目标配置不写入 |
| sessionParts 非固定数组，或 event / resolver 不支持 | Patch preflight 失败 |
| resume 或显式禁用 | wrapper 退出 0，无注入输出 |
| 原生文件损坏、输出非 JSON、缺少工作流块或章节边界 | stdout 输出 systemMessage 与 trellis-injection-error 上下文，stderr 诊断，退出 0；提示补读 workflow 和 get_context |
| 分段超过脚本字符预算 | 保留完整正文及尾部规则，输出 systemMessage；不静默截断 |
| 预算 fixture 返回注入失败诊断 | 结构性测量错误，不当作短小的成功上下文 |

### 5. Good/Base/Bad Cases

- Good：配置迁移保留用户 5000；三段并行输出，拼回正文与原始摘要等价；真实 update 再运行零差异。
- Base：全新安装使用宿主缺省额度，只有 state 绑定会话，规则直接复用当前原生生成器。
- Bad：三个 handler 分别运行完整原生 main 后截字数，造成重复绑定、规则遗漏或依赖 handler 顺序。
- Bad：只改 `.codex/hooks.json` 中的额度，后续安装仍用删除重建的 adapter 抹掉该值。

### 6. Tests Required

```bash
node --test test/js/platform-patches.test.js test/js/apply-enhancements.test.js test/js/ai-context-budget.test.js
python3 -m unittest discover -s test/python -p 'test_flower_session_start.py'
```

断言：原文拼回等价、关键路由完整、并行无状态副作用、禁用与 resume 无输出；原额度 / 分段独立额度 /
0 / 缺省 / 冲突 / 非法值迁移；缺少或损坏源的可见诊断与超限尾部保留；真实内容投影、目标 ownership
和二次安装文件树不变。预算须运行两平台六份最终输出，并验证最大平台合计及字符单位。
完整回归继续执行本规范的全局检查。真实宿主日志未验证时，必须明确记录接收证据缺口。

### 7. Wrong vs Correct

Wrong：`if (limit) handler.additionalContextLimit = limit`，且三个分段都先执行完整 SessionStart。

Correct：`limit !== undefined` 时写回；按分段保留已有值，再继承旧单 handler 的额度；只有 state
调用原生 main，规则分段只读生成器。配置和脚本一起经过 Plugin 事务安装，最后验证真实 handler 输出。
