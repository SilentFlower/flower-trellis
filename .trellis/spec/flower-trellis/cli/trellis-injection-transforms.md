# Trellis Injection Transforms

> skill-garden 0.6 对 Trellis 原生 workflow、skill、command、hook 执行声明式 `insert / replace / remove` 的长期契约。

---

## Scope / Trigger

以下改动必须读取本规范：

- 新增或修改 `vendor/skill-garden/.trellis/0.6/overrides/transforms/`。
- 修改 `src/lib/enhancement-transform.js`、`apply-enhancements.js`、`workflow-inject.js`。
- 修改 `vendor/skill-garden/scripts/install.sh` 或 `apply-trellis-transforms.py`。
- 需要删除或替换 Trellis 原文，而不是继续追加高优先级 override。
- 上游 Trellis 升级后 transform selector 漂移、重复 marker 或 manifest 状态异常。

0.5/old 不使用本协议。首版只处理目标项目已经存在的 Trellis 文件，不创建未启用平台入口。

## Source Layout

```text
vendor/skill-garden/.trellis/0.6/overrides/transforms/
├── <feature>.json
├── matches/       # Trellis 上游精确原文
└── content/       # insert/replace 的目标正文

vendor/skill-garden/scripts/apply-trellis-transforms.py
# 独立 install.sh 使用的标准库 Python consumer
```

真实源始终在 `vendor/skill-garden`；`npm run sync` 生成 `enhancements/0.6`。禁止只改快照或当前 dogfood。

## Declaration Contract

```json
{
  "schemaVersion": 1,
  "id": "intent-routing",
  "aliases": ["workflow-enhancement"],
  "operations": [
    {
      "id": "workflow-request-triage",
      "operation": "replace",
      "required": true,
      "targets": [
        {
          "kind": "hook",
          "path": ".codex/hooks/session-start.py",
          "markerStyle": "hash"
        }
      ],
      "selector": {
        "source": "matches/workflow-request-triage.md",
        "expectedMatches": 1
      },
      "content": {
        "source": "content/workflow-request-triage.md"
      }
    }
  ]
}
```

硬约束：

- `schemaVersion=1`；未知版本失败。
- declaration/operation ID 使用小写连字符，operation ID 全局唯一。
- operation 只允许 `insert`、`replace`、`remove`。
- target `kind` 只允许 `workflow`、`skill`、`command`、`hook`，path 必须显式列举。
- target `markerStyle` 只允许 `html`、`hash`、`slash`；非 hook 默认 `html`，hook 必须显式声明，且标记必须在目标语言中是合法注释。
- target/source 都必须是根目录内 POSIX 相对路径；拒绝绝对路径、`..`、反斜杠与软链逃逸。
- selector 是 UTF-8 字面文本，不接受正则、捕获组或模板代码。
- `expectedMatches` 是正整数；首次应用和后续 managed marker 数都必须精确匹配。
- `insert` 必须声明 `position=before|after`；`insert/replace` 必须有 content；`remove` 禁止 content。
- `required` 默认 true。只有显式 false 才允许 selector mismatch 后跳过。
- `aliases` 复用 `shouldInstallName()` 的 `--skills` 过滤语义。

首版不是通用 patch 语言。禁止 target glob、任意脚本、动态模板变量和整文件覆盖。

## Managed Marker

```text
html:  <!-- BEGIN skill-garden transform <operation-id> v0.6 -->
hash:  # BEGIN skill-garden transform <operation-id> v0.6
slash: // BEGIN skill-garden transform <operation-id> v0.6
```

三种 style 都有对应 END。marker 用于区分已应用与上游漂移、原位升级 replacement，以及为 remove 留下幂等 tombstone。BEGIN/END 不配对、marker 数不等于 `expectedMatches`、同一 ID 同时出现多种 style 或 operation ID 重复时失败。非 HTML 目标升级时允许识别并原位迁移早期 HTML marker；迁移后只能保留声明 style。`workflow-inject.stripBlocks()` 不得删除 transform marker。

## Signatures / Apply Contract

```js
prepareEnhancementTransforms(target, variantDir, skills)
applyPreparedTransforms(target, plan)
```

`prepareEnhancementTransforms()`：

1. 读取并校验全部命中声明。
2. 对已存在目标按 operation 顺序在内存计算 next text。
3. 缺失平台入口记录 `missing-target`；不创建文件。
4. optional mismatch 记录 `optional-skip`。
5. required 错误汇总抛出，整个 preflight 零写入。

`applyPreparedTransforms()`：

1. 写入前复核全部目标仍等于 preflight 原文；并发漂移整体停止。
2. changed 文件调用 `preserveFirstBackup()`；首次备份位于 `.trellis/.backup-flower/<target>`。
3. 只写 changed 文件，非目标区域保持原文，结尾换行稳定。
4. 返回 changed/unchanged/skipped/targets/backupNotes/results 结构化结果。

独立 consumer 签名：

```bash
python3 scripts/apply-trellis-transforms.py \
  <transforms-dir> <target-project> [skill-name...]
```

成功输出 changed/unchanged/skipped 汇总；optional skip 额外输出 operation、target 与原因。schema、required selector、路径、marker 或并发漂移错误必须非零退出并写 stderr。

普通文件系统 I/O 不承诺跨文件事务；发生异常时 manifest 不更新，使用首次备份恢复后重跑。

## Consumer Parity

同一份声明有两个正式 consumer：

- flower-trellis 离线快照：`src/lib/enhancement-transform.js`。
- skill-garden 独立安装：`scripts/apply-trellis-transforms.py`，由 `install.sh` 调用。

两者必须保持相同的 schema 类型校验、alias 过滤、路径/软链约束、字面 selector、marker style/迁移、
required/optional、preflight、首次备份和 changed-only 语义。禁止在 `install.sh` 内再维护一套
只支持追加的特殊分支。协议变更必须同时增加 JS 与 Python 行为测试。

## Apply Pipeline

`applyEnhancements()` 顺序固定：

1. 解析 variant。
2. required transform 全量 preflight。
3. 应用 prepared transform。
4. 复制 skill/script/flower/common 资产。
5. 按旧 manifest 精确清 stale paths。
6. 执行 additive workflow/skill override、hook override 与平台 tweaks。
7. 全部 required 步骤成功后写新 manifest。

required transform 失败必须发生在任何复制、清理和 manifest 写入之前。`--skills` 精细安装继续不维护 manifest、不清 stale，只执行 aliases 命中的 transform。

skill-garden 独立安装器的 0.6 顺序同样固定：解析 Trellis 版本与目标 → transform preflight/apply → 复制 intent helper
与 common/Trellis 强化资产 → additive hub/state。`--scope all` 的 required 失败也必须发生在任何 common/helper/skill 复制前；独立安装无
flower manifest，但仍使用 `.trellis/.backup-flower/<target>` 保存首次备份。

## Workflow Migration

- 0.6 hub 继续由 `workflow-inject.js` 注入 `## Phase Index` 后。
- `no_task` 原 body 由 transform 替换；旧 `workflow-states/no_task.md` 已删除，不得恢复 additive sentinel。
- planning/in_progress state 暂时保留 additive sentinel；0.5/old legacy 行为不变。
- start/brainstorm 各平台路径和 Codex/Claude SessionStart hook 必须显式列在声明中；新平台加入时先用实际 init 输出确定路径与合法 marker style。
- 自动路由创建必须实际调用 `task_intent.py create`；用户从自动 planning 切到不要 task 时，hub/planning state 必须实际调用 `task_intent.py discard`，不能只描述理想行为。手工或历史 task 不调用 auto-discard，保持原状态并只把当前请求路由为 untracked。
- 相同规则跨 hub、state、workflow body、skill 出现时，高频层只保留边界与指向。

## Validation Matrix

| 条件 | 结果 |
|---|---|
| required selector 0 次或多于预期 | preflight 失败，目标与 manifest 不变 |
| optional selector 漂移 | `optional-skip`，输出原因，继续其它操作 |
| 目标平台入口不存在 | `missing-target`，不创建平台目录 |
| marker 已存在且数量正确 | 原位更新 managed content |
| 非 HTML target 只有旧 HTML marker | 原位迁移为声明 style |
| 同一 operation 同时存在两种 marker style | preflight 失败 |
| hook 未显式声明 markerStyle | schema 校验失败 |
| marker 重复或不配对 | required 失败 |
| target/source 路径逃逸 | required 失败 |
| preflight 后目标被并发修改 | apply 前整体停止 |
| 重复全装 | 目标文件树无新增 diff |

## Good / Base / Bad Cases

- Good：目标存在、selector 精确命中一次，required hook 使用 `hash` marker；变换、备份和 helper 同步成功。
- Base：可选平台入口不存在或 optional selector 漂移；记录 `missing-target` / `optional-skip`，其它独立操作继续。
- Bad：required selector 漂移、hook 缺 markerStyle、同一 ID 混用 marker style、路径逃逸或 `--scope all` preflight 失败；任何 common/Trellis 资产都不得复制。

## Tests Required

```bash
node --test test/js/enhancement-transform.test.js
node --test test/js/apply-enhancements.test.js
python3 -m unittest discover -s test/python -p 'test_skill_garden_transforms.py'
npm run sync
node scripts/check-snapshot.mjs
```

测试至少覆盖三种 operation、marker 内容升级与 style 迁移、hook 语法合法性、required/optional、严格 schema 类型、路径安全、首次备份、非目标文本保留、preflight 零写入、manifest 最后写、`--scope all` 零复制、独立 `install.sh` 真实 clone/install 和二次 dogfood 幂等。

## Wrong vs Correct

**Wrong**：保留旧机械规则，再在 hub/state 顶部追加一段高优先级覆盖。

**Correct**：把旧原文保存为 `matches/` selector，通过 required replace 真正替换，并用 marker 管理后续升级。

**Wrong**：上游升级导致 selector 漂移时 fallback 到顶部 insert。

**Correct**：required preflight 失败，展示 operation/target/匹配次数，更新 selector 并重新 sync。

**Wrong**：把默认 HTML marker 写入 Python SessionStart hook，导致 hook 语法错误。

**Correct**：hook target 显式声明 `markerStyle: "hash"`，并测试旧 HTML marker 可迁移且 `py_compile` 通过。
