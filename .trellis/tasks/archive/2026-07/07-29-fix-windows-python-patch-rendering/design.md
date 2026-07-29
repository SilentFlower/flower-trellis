# 修复 Windows Python 命令导致的 Patch 漂移 - 技术设计

## 1. Problem Statement

Trellis 0.6.5 把模板中的 canonical `python3` 渲染为目标机器实际命令，Flower 却用未渲染的
Patch 资产做严格原文比较。根因不是 fingerprint 规则过严，而是两侧进入比较前不在同一平台语义。

修复必须同时满足：

1. selector / baseline 继续严格匹配已知上游内容；
2. content 写入目标项目时使用与 Trellis 相同的命令；
3. Skill/Command 内容投影与 Patch overlap 产生相同最终字节；
4. 外部 Plugin 不能取得新的动态渲染能力。

## 2. Architecture

### 2.1 Canonical source and target materialization

Patch 与 Skill-Garden 源继续保存 `python3` canonical 文本。运行时解析一次目标项目命令，形成：

```text
target project evidence
  -> resolveTrellisPythonCommand(target, env, platform)
  -> pythonCommand
     -> builtin catalog textMaterialization
     -> Skill/Command text projection
```

不在 Patch JSON 中增加 `{{PYTHON_CMD}}`，避免把 schema 变成模板语言。

### 2.2 Command resolution

新增共享 JS helper，例如 `src/lib/trellis-python-command.js`：

- `resolveTrellisPythonCommand(target, options)` 返回命令和 evidence source。
- 优先读取结构化 Hook 配置，其次读取 `.trellis/workflow.md` 中已生成的命令。
- 自动识别只接受 `python3`、`python`、`py -3`。
- `TRELLIS_PYTHON_CMD` 是显式调用方输入，可原样采用，但只作为文本物化值，不在 Patch Engine
  内执行。
- 无证据时按 `process.platform` 回退。

helper 还提供 `materializeTrellisPythonText(value, command)`：

- 输入输出都是字符串；
- 非 `python3` 目标逐行替换 literal `python3`；
- shebang 行保持不变；
- `python3` 目标为 no-op。

### 2.3 Catalog descriptor boundary

为 Patch Engine 的运行时 catalog descriptor 增加受控数据字段，例如：

```js
{
  id: "skill-garden",
  patchesDir,
  bundlesDir,
  textMaterialization: { trellisPythonCommand: "python" },
}
```

该字段不属于 `patch.json` / Bundle schema。`loadCatalog()` 校验字段结构后，在
`normalizeOperation()` 结果上物化：

- `selector.text` / `selectorText`
- string `content`
- `baselines[]`

catalog 的 canonical hash 仍从原始文件计算。最终 plan 的文件 hash 来自物化后的实际内容。

外部 Plugin 经过 `inspectExternalPatchCatalog()` 生成固定 descriptor，不复制任意额外字段；只有受信
system Provider 能传入该运行时字段。

### 2.4 Skill-Garden content projection

`SkillGardenBuiltinProvider` 对目标项目只解析一次命令，并把同一值传入：

- Skill-Garden / Flower builtin catalog descriptor；
- `pluginPackage.skillGarden` 内容投影上下文。

`projectSkillGardenContent()` 对 0.6 的 Skill Markdown、Claude Command Markdown 和其它明确文本载荷
做相同物化，再计算 mutation hash。二进制文件、common skill 和未声明为 Trellis canonical 文本的载荷
保持原字节。

这样 Finish-Work 等同目标 overlap 时，内容投影和 Patch plan 仍能通过最终 hash 一致性检查。

### 2.5 Python runner parity

`vendor/skill-garden/scripts/apply-trellis-patches.py` 增加等价 helper：

- 从目标项目 / 环境 / host platform 解析命令；
- catalog load 后物化 selector_text、content 和 baselines；
- canonical catalog hash 不受目标平台影响。

Python runner 是 Skill-Garden 自有可信入口，不开放第三方 catalog 注入，因此不需要复制 Plugin
capability 边界，但输出语义必须与 JS fixture 一致。

## 3. Data Flow

```text
flower init finishes Trellis write
  -> SkillGardenBuiltinProvider reads generated target
  -> resolve python command once
  -> project 0.6 textual assets with materialized command
  -> load builtin catalogs with per-catalog materialization
  -> strict Patch preflight on actual target bytes
  -> content/Patch overlap hash comparison
  -> one Plugin transaction write
```

任何 required selector / baseline 的非命令差异仍进入原失败路径，不能被 canonicalization 吞掉。

## 4. Compatibility And Migration

- Linux / macOS canonical `python3`：输出保持原字节，现有 manifest / state 行为不变。
- Windows `python`：首次安装可直接匹配 Trellis 生成物；旧失败现场可在修复版执行
  `ftl init --enhance-only`。
- Windows `py -3`：Markdown 与 Hook 文本按完整命令物化。
- 已有 managed marker：marker 身份不变，正文按当前解析命令原位刷新。
- 旧 Flower state：Plugin 更新仍按既有 ownership 与 drift 检查执行，不做无条件 takeover。

## 5. Risks And Controls

| 风险 | 控制 |
|---|---|
| 把正常英文或代码中的 `python3` 错改 | 仅对受信 catalog 和明确 0.6 文本投影启用，复用 Trellis 的逐行规则并保留 shebang |
| 外部 Plugin 借字段获得模板执行 | 字段只存在于 runtime descriptor；外部 catalog inspector 构造白名单 descriptor |
| Patch 与内容投影 hash 不一致 | 两条路径共享同一个解析结果和 materializer，并保留 overlap 门禁测试 |
| 命令探测与 Trellis init 不一致 | 优先读取目标已生成证据，不重新猜测或执行目标文本 |
| 平台差异污染 catalog digest | canonical hash 继续使用未物化源文件；仅最终文件 hash 平台相关 |
| py -3 在 Python subprocess argv 中语义不同 | 本任务只对 Patch 和明确文本载荷做命令物化，不把 Python 源文件中的 argv 字符串做盲替换 |

## 6. Rollback

- 删除 catalog runtime materialization 字段和共享 helper调用即可恢复原行为。
- Plugin Transaction 在 preflight 前不写目标；失败现场继续保留纯 Trellis 基础文件。
- 已成功安装项目可从 `.trellis/.backup-flower/` 恢复首次备份后用旧版重放，但正常降级不承诺自动完成。
