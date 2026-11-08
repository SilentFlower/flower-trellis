# 本任务相关规范原文摘录

本文件用于有界注入相关章节，原始规范仍是权威来源；涉及的源章节变化或实施范围变化时应重新核对。摘录保留原文，不构成新增规则。

## Source — .trellis/spec/flower-trellis/cli/trellis-patch-engine.md:744

摘录范围：原文件第 744–865 行。

### 2. Signatures

部署入口示例（在项目根目录执行；Python 命令沿用本规范的目标物化规则）：

```bash
python3 -X utf8 .trellis/scripts/flower_session_start.py --hook .codex/hooks/session-start.py --part state
python3 .trellis/scripts/flower_session_start.py --hook .claude/hooks/session-start.py --part rules
```

- `--hook` 只接受上述两个原生路径；`--part` 只接受 `state | rules | stages`。
- `render_part(root: Path, hook: str, part: str, hook_input: dict) -> dict | None`。
- `_run_native_hook(root: Path, hook: str, hook_input: dict) -> dict | None`：在当前
  `sys.executable` 的独立解释器中执行白名单原生 Hook；空 stdout 表示原生跳过。
- `_model_workflow_hint(root: Path, config_key: str, hint: str, label: str) -> str`：按模型读取项目开关、校验完整提示；`_astra_workflow_hint(root)`、`_sol_workflow_hint(root)` 与 `_sol_6_1_workflow_hint(root)` 分别返回对应英文提示或空串，非法配置与超限由 state 的可选增强分支处理。
- `split_workflow(summary: str) -> dict[str, str]` 返回 `rules` / `stages`，拼接后等于原始摘要。
- `json-hook-command` 的 `content.value.sessionParts` 只允许固定数组 `["state", "rules", "stages"]`，
  且仅用于 `event=SessionStart`、`commandResolver=codex-session-start|claude-session-start`。

```python
subprocess.run(
    [sys.executable, "-X", "utf8", str(root / hook)],
    cwd=root,
    env={**os.environ, "PYTHONIOENCODING": "utf-8"},
    input=json.dumps(hook_input, ensure_ascii=False).encode("utf-8"),
    capture_output=True,
    check=False,
)
```

### 3. Contracts

- 源脚本属于 `src/assets/flower_session_start.py`；builtin Skill-Garden 0.6 全装通过内容投影安装到
  `.trellis/scripts/flower_session_start.py`，由 Plugin state 记录普通资产 ownership。对应平台 Patch
  属于 Flower `flower-platform-integration` full-only Bundle；不得只直改已部署脚本或 JSON 配置。
- 共享代码设计原则由 wrapper 的 `CODE_DESIGN_HINT` 所有；两个平台只在 state 的
  `startup|clear|compact` 追加一份 `<trellis-code-design>`，不受模型及模型开关影响，其他来源和
  rules/stages 不追加。正文以 KISS/YAGNI 为默认取向，按实际收益应用 SOLID/DRY，优先清晰并复用
  项目模式；避免过早抽象、额外分层、过度拆分及假设未来需求的配置或依赖，同时保留行为、兼容性、
  必需验证、工作流、评审门禁和模板。它仅指导代码设计，不替代已有工作流或模型提示。
- Codex 的通用同步交互规则同样由该 wrapper 所有；只在 state 的 `startup|clear|compact` 追加一份，
  与模型 hint 及其开关独立；具体配置和行为边界见下方同步交互场景。
- 两个平台均只注册 `startup|clear|compact`；迁移删除旧单 handler / 旧分段及因此移空的分组，
  保留无关 handler。Flower 更新检查独立匹配 `startup`。old/0.5 沿用原注册路径。
- `selector.commandNeedle` 为该平台原生 SessionStart 相对路径。新命令保留该路径为 `--hook` 参数，
  供既有 bootstrap 检测与后续迁移识别；不能把原生路径一并删除。
- stdin 为宿主 JSON 对象；原生入口继续消费 session 字段。wrapper 按自身部署位置确定项目根并设置
  输入 `cwd`；宿主的项目目录环境变量应与目标项目一致。CLI 注册仍沿用项目根目录的相对命令约定。
- `state` 通过 `_run_native_hook()` 在独立 Python 子进程调用原生 `main()`，父进程不得先导入原生模块，
  避免 Windows 原生 Hook 重配或 `detach` 标准流时破坏 wrapper 的内存捕获。state 从标准
  additionalContext 移除唯一完整 `trellis-workflow` 块，独占会话绑定等副作用；`rules` / `stages`
  仍在 wrapper 进程只调用 Codex `_build_workflow_toc` 或 Claude
  `_build_workflow_overview`，读取同一 `.trellis/workflow.md`，在 `### Planning Artifacts` 前无损分割。
  handler 可并行，不能依赖执行顺序、其他分段的缓存或绑定结果。
- state 刷新 workflow-state 后，仅从本次注入文本省略独占整行的
  `<!-- BEGIN/END skill-garden patch ... -->` 归属注释，兼容 LF、CRLF 和末行无换行。
  规则正文、原生上下文、普通注释及行内示例逐字保留；标记后还有文字或其他注释时不得删除。
  源文件标记和 helper 已写入的状态指纹保持原样，不通过概括提示措辞节省字符。
- state 子进程固定 `cwd=root`，继承当前环境并设置 `PYTHONIOENCODING=utf-8`；命令必须使用参数数组、
  `sys.executable -X utf8` 和 `shell=False` 语义。stdin 发送 UTF-8 JSON bytes，stdout 按严格
  `utf-8-sig` 解码并要求 JSON 对象，stderr 按 UTF-8 replacement 解码后原样转发。空 stdout 返回
  `None`；非零退出、解码/JSON/结构错误交给 wrapper 的可见 `trellis-injection-error` 降级。
- wrapper 不增加内部超时；平台注册的 30 秒超时是唯一 state 外层计时边界，避免双计时器产生不同错误语义。
- 每份输出为 `hookSpecificOutput: {hookEventName: "SessionStart", additionalContext: "..."}`，
  正文由独立闭合的 `<trellis-session-part name="state|rules|stages">` 包裹。state 去掉原生
  `additional_context` 兼容副本与旧全文字符计数消息，保留其他原生诊断。
- 重建前收集 `additionalContextLimit`，要求为非负安全整数。已有分段的显式值优先，其次继承旧单
  handler 的值；`0` 必须原样保留，不能用 truthy 判断丢弃。无显式值时不写该字段；不主动向 Claude
  加入 Codex 专属额度。同一分段或旧单 handler 存在矛盾的显式额度时，preflight 报错而不任选其一。
- `TRELLIS_HOOKS=0`、`TRELLIS_DISABLE_HOOKS=1` 时无输出；Codex 还尊重 `CODEX_NON_INTERACTIVE=1`。
  `source=resume` 无输出；state 的其余原生跳过条件在子进程 `main()` 内执行，rules/stages 继续在加载后
  调用 `should_skip_injection()`。
- Astra、Sol 与 Sol 6.1 共用源脚本的 `MODEL_WORKFLOW_HINT_BODY` 英文正文，分别生成最终
  `ASTRA_WORKFLOW_HINT`、`SOL_WORKFLOW_HINT`、`SOL_6_1_WORKFLOW_HINT`；闭合标签分别为
  `<trellis-astra-workflow-hint model="gpt-6-astra" version="1">`、
  `<trellis-sol-workflow-hint model="gpt-6-sol" version="1">` 和
  `<trellis-sol-6-1-workflow-hint model="gpt-6.1-sol" version="1">`。Astra 最终原文保持不变，每个完整块分别不超过 2048 UTF-8 字节。
  仅当 `hook` 为 Codex 原生路径、`part=state`、输入 `model` 精确等于 `gpt-6-astra`、`gpt-6-sol` 或 `gpt-6.1-sol`，且
  `source` 为 `startup | clear | compact` 时，在成功提取的原生状态后用一个换行追加对应模型的一块；rules/stages 零追加。
  不 trim、不猜别名、不读取配置默认模型，不使用 matcher 筛选模型；其他模型（包括 gpt-5.5）、缺失或非法模型零追加。
- `.trellis/config.yaml` 的 `codex.astra_workflow_hint`、`codex.sol_workflow_hint` 与 `codex.sol_6_1_workflow_hint` 各自缺省开启，`false` 只关闭对应模型后续新增提示。
  沿用 `common.trellis_config.read_trellis_config`：其 YAML 标量返回字符串，因此只接受布尔值或
  不区分大小写的 `"true" / "false"` 字符串；不能用 truthy 判断。`codex` 非映射或非法显式值须诊断。
  配置合并到已有 codex 映射，正常更新必须保留三个用户字段。
- 每次匹配的 SessionStart 重新判断当前模型；普通 UserPromptSubmit 不新增提示，也不新增事件注册、
  跨轮状态或 shared-runtime Patch。会话中切换模型不会立即刷新，关闭或切换不能删除历史提示。
  `no-trellis` 保留仅跳过本轮 UserPromptSubmit 的原语义，不用于关闭 SessionStart 模型提示。
- 提示生成失败只停用可选增强，保留原生 state 和原有诊断，追加 `systemMessage` 并写 stderr；
  后续字符超预算诊断也必须追加，不能覆盖已有诊断。不得把该失败伪装成整个原生启动上下文丢失。
- 提示覆盖必需步骤/引用、阶段边界、模板结构、指令层级、用户当前授权及证据陈述；检查默认内部完成，
  阶段转换与评审条件交给所属 workflow；自主性用于流程内推进，不因任务简单、检查看似冗余或减少打断而省略必需步骤。
  不把开始规划的许可推定为最终方案批准；流程要求展示计划后评审时，泛化的“提交推送”请求不自动确认随后生成的计划。
  同一计划已获确认或存在范围明确的免确认授权（含有效 auto-loop 预授权）时沿用；否则展示后等待实际用户确认，
  不能以展示计划或自行宣称“按授权执行”替代用户回复证据。
  普通问答保持简短。宿主规则冲突应按真实来源、适用范围和可编辑性记录，不能承诺 Hook 覆盖所有规则，
  也不能把“已读取但执行偏离”解释成无依据的“没读”。工程注入成功与行为效果必须分别验证。
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
| Windows 原生入口重配真实标准流或调用 `sys.stdout.detach()` | state 在独立解释器成功，父 wrapper 标准流不受影响 |
| 原生 stdout 为空 | state 返回 `None`，wrapper 退出 0 且无 stdout |
| workflow-state 含整行 Patch 归属注释 | 仅省略归属注释，规则原文不变；普通注释、行内示例及带后续正文的标记保留 |
| 原生 stderr 非空且退出码非 0 | stderr 原样转发；stdout 输出含退出码的 systemMessage 与 trellis-injection-error，wrapper 退出 0 |
| Astra、Sol 或 Sol 6.1 + startup/clear/compact + state + 对应开关开启 | 原状态后追加对应模型的一个英文块，三段合计一次 |
| 其他模型、缺失/非法 model、别名、非目标 source、Claude 或 rules/stages | 不新增提示，保留原路径输出 |
| astra_workflow_hint=false、sol_workflow_hint=false 或 sol_6_1_workflow_hint=false | 原工作流和其他模型的开关不受影响；对应模型后续不新增，历史提示不撤回 |
| codex 非映射、开关为 yes/1/空值、读取器异常或完整提示超过 2048 字节 | 保留原生 state，追加可见诊断，不新增提示 |
| 原生文件损坏、输出非 JSON、缺少工作流块或章节边界 | stdout 输出 systemMessage 与 trellis-injection-error 上下文，stderr 诊断，退出 0；提示补读 workflow 和 get_context |
| 分段超过脚本字符预算 | 保留完整正文及尾部规则，输出 systemMessage；不静默截断 |
| 预算 fixture 返回注入失败诊断 | 结构性测量错误，不当作短小的成功上下文 |

### 5. Good/Base/Bad Cases


## Source — .trellis/spec/flower-trellis/cli/enhancements-model.md:7

摘录范围：原文件第 7–98 行。

## Overview

flower-trellis 在 Trellis 之上通过内置 `flower/skill-garden` system Plugin 叠加强化包：
强化文件仍随包发布为离线快照，安装/升级时按目标 Trellis 版本选择变体，最终由
Plugin Runtime 的统一计划、事务、lock 和 state 管理。整条链路**处处幂等**。

---

## Snapshot (`enhancements/` + `scripts/sync-enhancements.mjs`)

- `enhancements/<variant>/` 是 skill-garden `.trellis` 的**离线快照**,使最终用户安装时
  零网络即可叠加。
- 由开发期脚本 `scripts/sync-enhancements.mjs` 生成(`npm run sync`,并挂在
  `prepublishOnly`),**最终用户不会运行它**。脚本会先整体清旧快照再全量递归拷贝
  `.agents` / `.claude` / `overrides`,并写 `MANIFEST.json` 记录 `syncedAt` /
  `sourceCommit` 供溯源；0.6 `variants[].policyFiles` 必须登记 `compatibility.json` 和 `conflicts.json`。
- `enhancements/common/.common` 保存可选 common skill 快照。`MANIFEST.json.common`
  除当前 `codexSkills` / `claudeSkills` 外,还累计保存 `removedSkills` tombstone:
  同步脚本在清空旧快照前读取上一次 manifest,把“旧版存在、新版消失”的名称加入
  tombstone,并移除重新出现在当前快照中的名称。首次迁移保留已知历史移除项
  `sub2api-account-json-fix`,让旧仓库升级时能精确清理残留。
- **改 0.6 强化 skill / Patch 时,先改源再同步**:`vendor/skill-garden/.trellis/0.6/`
  是 `npm run sync` 的真实输入。不要只改 `enhancements/0.6/` 或当前项目 `.agents/` /
  `.claude/`;否则下一次 sync 会把改动覆盖回源里的旧版本。正确顺序是:
  1. 改 `vendor/skill-garden/.trellis/0.6/.agents` / `.claude` / `overrides` 对应源文件;
  2. 运行 `npm run sync`;
  3. 用 `diff -u vendor/... enhancements/...` 验证发布快照与源一致;
  4. 必要时再同步当前项目已安装副本(如 `.agents/skills/...`、`.claude/skills/...`)。
- `overrides/patches/` 是 0.6 AI-facing 修改源，按 workflow/skills/hooks 目标组织；
  `overrides/bundles/` 只提供安装别名与 Patch 组合。英文协议正文只做语义级修改，不因项目
  中文文档规范整段翻译；用户实际输入的字面命令按产品约定保留原文。
- Patch 载荷继承目标文件的语言与风格:`selector.*` / `baseline-*` 必须保留目标原文，
  `content.*` 注入英文目标时使用英文、注入中文目标时使用中文。这些文件是最终内容或匹配材料，
  不按项目自有源码的维护性注释语言规则翻译。
- `overrides/compatibility.json` 与 `conflicts.json` 是共享只读 policy；vendor 与 `enhancements/0.6` 的整个 `overrides/` 文件树必须由维护者门禁逐字节一致。
- workflow hub/state、Update-Spec、Finish-Work 和 shared hook 都必须通过 Patch leaf 表达。
  需要共享正文时使用有序 `content.sources`，不得恢复独立 additive override 目录。
- Flower 自有 Codex/Claude 配置 Patch 位于 `src/patches/`，不进入 Skill-Garden 源；两类 catalog
  由 builtin Provider 交给 Plugin Patch Planner，在同一个 preflight/事务中执行。
- 随包发布靠 `package.json` 的 `files: ["bin","src","enhancements","README.md"]`。
- `vendor/skill-garden/compiled-targets/` 是 Skill-Garden 子仓内的 `all-platforms` canonical 维护审阅产物，不属于 `.trellis/` 离线安装快照；`npm run sync` 只读取 variant 源，不读取或复制该目录。vendor 子仓不进入 npm tarball，维护期 `patch-fixture.js` 也继续显式排除。
- **同步源 = git submodule `vendor/skill-garden`**(不在 `files` 白名单,不进 npm tarball)。
  `sync-enhancements.mjs` 三级路径解析:`SKILL_GARDEN_DIR` 环境变量 → `PKG_ROOT/vendor/skill-garden`
  → 都缺则 `exit(1)` 提示 `git submodule update --init --recursive`。
- **CI 幂等**:源 `.trellis` 缺失但 `enhancements/MANIFEST.json` 已存在(如 CI 未拉 submodule)→
  警告 `exit(0)` 沿用已提交快照;源与快照都无才 `exit(1)`。使 `prepublishOnly` 在"快照已提交、
  发布不拉 submodule"的 CI 场景不致失败。该早退路径只允许加载 Node 内置模块与零依赖
  helper，不得在判断源缺失前静态引入 `semver` 等外部包。`syncedFrom` 记相对仓库根路径
  (避免绝对路径写进随包快照)。
- 发布前快照与 submodule pin 的一致性断言见 [Release & Publishing](./release-and-publishing.md)。

---

## Variants

- 三个变体:`old` / `0.5` / `0.6`(`src/constants.js` 的 `VARIANTS`)。
- 选择依据:目标项目 `.trellis/.version`(见 `variant.js` 的规则),或 `--variant` 强制覆盖变体。即使强制变体，真实 `version` 仍必须读取并进入兼容检查，不能返回空串。
- 差异:`0.6` 走 `overrides/patches/` + `overrides/bundles/` 统一 Patch catalog；
  `0.5` 走 `overrides/trellis-route.md`;`old` 无 overrides,workflow-state 文本来自
  `legacy-blocks.js` 常量。

---

## Apply Pipeline (`flower/skill-garden`)

`applyEnhancements(target, opts)` 只保留兼容参数、日志和返回结构，实际顺序固定：

1. 校验 `.trellis/`，选择 `old|0.5|0.6` 并保留真实 Trellis 版本。
2. 构造目标绑定的 `SkillGardenBuiltinProvider`；digest 绑定 Flower 版本、variant、去除
   `syncedAt` 的快照 manifest，以及当前 variant、common、Flower assets/lib/patches 和 builtin
   Plugin 的 canonical 内容；忽略 `__pycache__` / `.pyc`。
3. 通过 `PluginApplicationService.add/update()` 声明或重放 `flower/skill-garden`。
4. builtin 内容 adapter 按 `ENHANCEMENT_SKILL_TARGETS` 投影 skill/command，按原 alias 过滤
   变体脚本，并在全装时投影 Flower update hook。
5. 0.6 同时加载 Skill-Garden 与 Flower catalog，先做兼容线门禁，再做一次统一 Patch
   preflight；同 owner 内容/Patch 重叠只有最终 hash 相同时才合并。
6. old/0.5 在临时镜像中调用 workflow/Codex/Claude legacy 函数，收集最终文件与首次备份，
   目标项目本身不发生预事务写入。
7. 全装只刷新目标中已经启用的 common skill，并将其记录为 `shared` ownership；不会安装
   用户未启用的新 common skill，卸载不删除 shared 路径。
8. Plugin Transaction Writer 一次性写目标 mutation、`plugins.json`、lock 和最后的 state。
   旧 manifest 的配置迁移与删除进入同一事务，失败恢复原字节；详见
   [Team Clone Bootstrap](./config-and-state.md#scenario-team-clone-bootstrap)。

`init` 默认显式声明 builtin Plugin；`--enhance-only` 使用同一 Runtime。普通 `update` 只允许
skill-garden 以当前 Flower 精确版本刷新直接声明并重新选 variant，其它 Plugin lock-first 重放；
`--no-enhance` 冻结 skill-garden 的完整 lock 约束、capability grant 和 state，但仍重放外部 Plugin。
普通跨版本 `update --dry-run` 在项目外沙箱真实升级到捆绑模板并执行 Plugin dry-run，来源项目
零写入；同版本 dry-run 与 `--enhance-only --dry-run` 仍直接执行严格 Patch preflight，外部 Plugin
replay 不受影响。真实 update 的 Trellis + Plugin 链失败时由项目外受管快照补偿恢复。
独立 `plugin add` 不隐式声明 skill-garden。
