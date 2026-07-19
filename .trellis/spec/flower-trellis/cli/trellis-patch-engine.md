# Trellis Patch Engine

> Trellis 0.6 对 workflow、skill、command、hook 和平台配置执行统一 `insert / replace / remove` 的长期契约。

---

## Scope / Trigger

以下改动必须读取本规范：

- 新增或修改 `vendor/skill-garden/.trellis/0.6/overrides/patches/`、`overrides/bundles/`。
- 修改 `src/lib/patch-engine.js`、`platform-patch-adapters.js`、`apply-enhancements.js`。
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
- Patch、Bundle、operation ID 使用小写连字符；Patch ID 和 operation ID 在本次加载的全部 catalog 中唯一。
- `purpose` 必须说明修改目的；不得用于控制执行分支。
- operation 只允许 `insert`、`replace`、`remove`。
- `required` 默认继承 Patch，最终默认 `true`。
- `targetPolicy` 只允许 `each-existing`、`at-least-one`、`required-all`。
- `targets` 必须显式列出目标，不支持 glob、任意脚本或模板代码。

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
- `yaml-key`
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
- Bundle 不得隐式扩大精细安装范围。新增 alias 时必须测试它实际选择的完整 Patch 集合。
- Workflow phase ownership 属于 `intent-routing`/全量安装；`update-spec` 等单 Skill alias 不得顺带接管整个 Workflow。

## Compatibility And Conflict Policy

0.6 catalog 必须随源和快照携带同一份 `compatibility.json` / `conflicts.json`：

- `testedVersions` 的精确版本正常继续；当前登记 `0.6.5`。
- 未登记但仍在 `compatibleLine=0.6` 的版本返回 `warning: untested-upstream`，只有完整 Patch preflight 与冲突断言通过后才允许写入。
- `0.7+`、`1.x` 或不可解析版本返回 `error`，Patch、资产、stale 清理和 manifest 全部零写入；用户只能改用匹配 Flower 版本或 `--no-enhance`。
- `conflicts.json` 首版只允许 `absent-literal`、`required-literal`、`max-occurrences`；规则只审计 `whenOperations` 全部实际选中的计划。
- evaluator 读取 `plan.files[].next`，不定位或修改文本。变换仍只由 Patch Engine 所有。
- `preparePatchPlan()` / `prepare_patches()` 必须返回未受精细安装过滤的 `catalogOperations[{id,targets}]`。evaluator 在执行规则前验证每个 `whenOperations` 存在，且规则 target 确由对应 operation 修改；拼写错误不得静默跳过。
- diagnostic 固定为 `error | warning | info`：互斥协议/未支持版本阻断，评审型重复与同线未测版本告警，正常 `missing-target` 只计 info。
- warning 必须在 `applyPatchPlan()` / `apply_prepared()` 前输出 rule ID、target、reason 和 evidence；Skill-only 精细安装也不能因未选择 Bundle 而吞掉版本 warning。维护者与发布脚本复用同一 JS formatter。

Workflow 内容所有权遵循“上游优先、Patch 只保留必要差异”：已确认冲突的 Active Task Routing、Phase 2.1、2.2、3.3、3.4 使用带 0.6.5 全文 baseline 的 `markdown-section replace`；Hub 不得再写“高优先级覆盖下层/下层 inactive”。State 只保留当前状态会改变下一动作的一跳门禁，完整 route/check/update-spec/push 协议由对应 Skill 所有。
Phase 正向断言必须包含 managed marker、heading 和 section 首句形成的唯一签名，不能只搜索整个 Workflow 中会被 Hub/State 重复满足的裸 Skill 名。已删除的 State Hub 职责句 `max-occurrences` 固定为 `0`，任一回流都返回 warning。

## Managed Marker And Migration

新 marker 统一使用：

```text
<!-- BEGIN skill-garden patch <operation-id> v0.6 -->
# BEGIN skill-garden patch <operation-id> v0.6
// BEGIN skill-garden patch <operation-id> v0.6
```

每种形式都有对应 END。marker 用于内容升级和 `remove` tombstone。BEGIN/END 不配对、数量不等于 `expectedMatches`、同一 operation 同时存在多种新旧 marker 时必须失败。

0.6 一次性迁移要求：

- `legacyMarkers` 可识别旧 transform marker、旧 marker style 和 workflow-state sentinel。
- `cleanup` 只允许受控的 `skill-override`、`workflow-hub` 清理，用于移除旧 additive 块后再结构化应用。
- Update-Spec 替换原 `## Interactive Mode` section；Finish-Work 替换 document body；workflow state 替换完整 body。
- 迁移成功后最终文件只保留 Patch marker，不再保留旧 additive override 或 transform marker。

## Preflight And Apply

`preparePatchPlan(target, catalogs, options)`：

1. 加载并校验全部选中 Bundle/Patch。
2. 按声明顺序在内存计算每个目标的最终文本。
3. 汇总 missing target、optional skip 与 required error；`missing-target` 和 `optional-skip` 必须分开统计。
4. 任一 required error 时抛出，目标、资产和 manifest 均零写入。
5. 返回稳定 `catalogHash`、文件 before/after hash 和结构化结果。

`applyPatchPlan(target, plan)`：

1. 写入前复核全部目标的存在性和内容，防止 preflight 后并发漂移。
2. 新建目标再次复核父目录存在且真实路径未通过软链逃逸。
3. changed 的已有文件调用 `preserveFirstBackup()`，备份到 `.trellis/.backup-flower/<target>`；备份源、最近存在父目录和最终父目录都必须位于项目根内。
4. 只写 changed 文件；重复运行必须零变更。
5. 返回 changed/unchanged/missingTargets/optionalSkipped、兼容 `skipped`、target、backup note、result 与 provenance。

普通文件系统 I/O 不承诺跨文件事务。中途异常时不得写成功 manifest；使用首次备份恢复后重跑。

## Unified Apply Pipeline

Trellis 0.6 的 `applyEnhancements()` 顺序固定：

1. 解析 variant 和精细安装选择。
2. 读取共享 policy 并先执行版本兼容检查；invalid 或未支持的新 minor/major 直接返回包含 `--no-enhance` 的 error，不能被旧 catalog 的 selector/baseline 漂移掩盖。
3. 同时加载 Skill-Garden catalog 与 Flower platform catalog，对所有 required Patch 全量 preflight，在内存得到最终文件。
4. 校验 conflict rule 的 operation/target 引用并执行最终产物断言；同一兼容线未登记版本到此时才输出 warning，任一 error 时零写入。
5. 统一 apply，再复制 skill、script、Flower asset 和已启用 common skill。
6. 全装时按旧 manifest 精确清理 stale path。
7. 所有步骤成功后写包含 Patch provenance 的 manifest。

0.6 禁止再调用 `injectWorkflow()`、skill/hook override injector 或 Codex/Claude tweak。`injectWorkflow()` 与旧 tweak 只服务 0.5/old。

Skill-Garden 独立安装器顺序同样固定：版本/目标解析 → 共享 compatibility 早期阻断 → Python prepare → conflict 检查与同线 warning → apply → 复制 helper/common/Trellis 资产。不得在 `install.sh` 内维护第二份版本或冲突规则。

## Consumer Parity

正式 consumer：

- JS：`src/lib/patch-engine.js`。
- Python：`vendor/skill-garden/scripts/apply-trellis-patches.py`。

两者必须保持 schema、Bundle 选择、路径安全、selector、baseline、marker 迁移、required/optional、preflight、首次备份、changed-only、catalog hash、版本状态和 diagnostic ID/severity/target 语义一致。协议变更必须同时增加 JS/Python 测试；共享 fixture 必须比较完整结构化报告。

## Provenance

全装成功 manifest 必须写：

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

provenance 必须在首次应用与重复应用之间稳定；不得把本轮 `changed/unchanged` 写成持久状态。精细安装不维护 manifest，沿用现有 `--skills` 契约。

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
python3 -m unittest discover -s test/python -p 'test_skill_garden_patches.py'
node scripts/check-patch-conflicts.mjs
npm run sync
npm test
```

至少覆盖三种 operation、`content.sources`、Core selector、平台 adapter、legacy migration、required/optional、target policy、版本四态、最终产物正反断言、正常 missing target、JS/Python report parity、普通文件 create 拒绝、新建父目录与备份软链逃逸、首次备份、非目标内容保留、全量 preflight 零写入、manifest 最后写、全部声明 Patch/target/target kind 覆盖和二次 dogfood 幂等。
