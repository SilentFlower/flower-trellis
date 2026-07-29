# 修复 Windows Python 命令导致的 Patch 漂移

## Goal

让 `flower-trellis init` / `--enhance-only` 在 Trellis 0.6.5 根据目标环境生成
`python3`、`python` 或 `py -3` 时，都能保持严格 Patch 预检、事务零写入和最终内容一致，
避免 Windows 新安装因 Python 命令差异被误判为 selector / baseline 漂移。

## Background

- npm 稳定版 `flower-trellis@0.5.1` 固定使用 `@mindfoldhq/trellis@0.6.5`。
- Trellis 0.6.5 会探测目标机器可用的 Python 命令，并把模板中的 canonical `python3`
  渲染为 `python`、`python3` 或 `py -3`。
- Flower 当前 Patch 资产仍以 `python3` 保存；例如
  `enhancements/0.6/overrides/patches/workflow/intent-routing/create-task-command/selector.md:2`
  和 Finish-Work baseline 中的命令均为 `python3`。
- JS Patch Engine 在 `src/lib/patch-engine.js:624-646` 直接加载 selector、content 和
  baselines，并在 `src/lib/patch-engine.js:1034-1099` 对目标原文执行严格匹配，没有平台命令物化。
- 使用 `TRELLIS_PYTHON_CMD=python` 在全新 Linux 临时目录运行已发布的
  `flower-trellis@0.5.1`，可逐字复现用户报告的 9 项 Patch 预检失败；默认
  `python3` 则完整安装成功。
- Plugin Runtime 要求同 owner 的内容投影与 Patch 最终 hash 完全一致；因此仅修 Patch
  selector/baseline 不足，还必须同步物化 0.6 Skill/Command 文本投影。

## Requirements

### R1. 识别目标项目的 Trellis Python 命令

- 提供单一、可测试的目标项目命令解析器。
- 优先从 Trellis 已生成的目标文件中读取实际命令，至少覆盖 `.trellis/workflow.md`，并可利用
  Codex / Claude Hook 配置作为更强证据。
- 支持上游默认候选 `python3`、`python`、`py -3`。
- 当当前进程显式提供 `TRELLIS_PYTHON_CMD` 时允许使用该值；从项目文本自动识别时只接受
  明确白名单，不能把任意目标文本变成可执行配置。
- 无证据时按平台回退：Windows 使用 `python`，其它平台使用 `python3`。

### R2. 受控物化 builtin Patch catalog

- Patch 资产继续以 Trellis canonical `python3` 原文保存；不得为 Windows 复制一套 selector、
  baseline 或 content。
- 在 catalog 加载后、严格 selector / fingerprint 预检前，对该 catalog 的 selectorText、
  string content 和 baselines 使用同一个 Python 命令物化规则。
- 物化规则与 Trellis 保持一致：逐行替换非 shebang 行中的 literal `python3`；不放宽 heading、
  marker、expectedMatches、baseline 或 required Patch 契约。
- 物化能力只能由可信 builtin system catalog descriptor 启用。外部 Plugin catalog 不得通过
  manifest 或 Patch 声明取得该能力。
- canonical catalog hash 仍绑定未物化的发布资产；最终文件 before/after hash 绑定实际目标字节。

### R3. 保持 Skill/Command 内容投影一致

- `projectSkillGardenContent()` 投影 0.6 Skill 和 Claude command 文本时使用与 Patch catalog 相同
  的已解析 Python 命令。
- 只物化明确的文本载荷；不得把任意二进制文件按 UTF-8 改写。
- 被内容投影和 Patch 同时拥有的目标必须保持相同最终 hash，不能绕过既有
  `allowContentPatchOverlap` 一致性门禁。
- common skill 不属于 Trellis 0.6 canonical 载荷，不因本修复被全局改写。

### R4. 保持 JS / Python Patch 语义一致

- `vendor/skill-garden/scripts/apply-trellis-patches.py` 对 selector、content、baselines 使用等价的
  Python 命令解析与物化规则。
- 共享 fixture 的 JS / Python plan、最终文件和 provenance 继续一致。
- 独立安装器仍保持 required 漂移时整批零写入。

### R5. 源与发布快照同步

- Skill-Garden 资产如需调整，先修改 `vendor/skill-garden/.trellis/0.6/`，再运行 `npm run sync`。
- 不通过手工维护 Windows 专用 selector/baseline 解决问题。
- 当前项目 dogfood 副本只在最终协议确认后按既有同步方式刷新。

### R6. 修复完整检查暴露的 Session Context 回归

- `.trellis/scripts/common/session_context.py` 不得恢复旧 Trellis 版本探测、会话 marker 或独立更新提示；
  启动更新检查继续由 Flower SessionStart Hook 统一负责。
- 修复必须进入 0.6 Skill-Garden Patch 源并由 full-only Bundle 安装，不能只修改当前仓库的
  dogfood 副本，否则后续 `trellis update` 会再次覆盖回来。
- Patch 最终产物必须通过 absent-literal policy、compiled targets、真实完整 init 和既有
  `test_session_context_update_markers.py` 回归。

## Acceptance Criteria

- [x] 使用未经强化的 Trellis 0.6.5 canonical target，`python3` 场景仍可完整安装且二次运行幂等。
- [x] 把同一 target 按 Trellis 规则渲染为 `python` 后，`applyEnhancements()` 不再出现用户报告的
      9 项 Patch 预检错误，且最终相关 Skill、Command、Workflow 与 Hook 文本使用 `python`。
- [x] `py -3` target 通过相同预检，最终 Markdown / Hook 命令使用 `py -3`。
- [x] 未知 selector 或 baseline 内容仍失败关闭，并证明 Patch、内容资产、state 和 lock 均零写入。
- [x] 同 owner 内容投影与 Patch 最终 hash 在 Windows 命令场景保持一致；不得关闭或跳过冲突检查。
- [x] 外部 Plugin catalog 即使声明相似字段，也不能启用 builtin Python 命令物化。
- [x] JS 与 Python Patch runner 的命令物化 fixture 结果一致。
- [x] `npm run sync` 后 `vendor/skill-garden/.trellis/0.6/overrides` 与
      `enhancements/0.6/overrides` 保持逐字节一致。
- [x] 至少通过 Patch Engine、Plugin Skill-Garden、apply-enhancements、Python parity、compiled
      targets 和完整 `npm test` 检查。
- [x] 完整 init 后 `session_context.py` 不再包含旧更新 helper，不调用 `trellis --version`，且默认
      上下文不会创建 `update-check-*.marker`。

## Out Of Scope

- 升级捆绑 Trellis 版本或改变 `old` / `0.5` 变体行为。
- 放宽 Patch fingerprint、selector expectedMatches、required/optional 或事务零写入规则。
- 为 Patch schema 增加可由普通声明使用的变量、表达式或任意模板代码。
- 全面审计所有第三方 common skill 内部使用的 Python 启动方式。
- 修复与本次安装失败无直接证据关联的 CRLF 或其它平台文本差异。
