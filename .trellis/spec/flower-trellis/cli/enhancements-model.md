# Enhancements Model

> 强化包(skill-garden)的快照、变体与叠加流水线 —— flower-trellis 的核心机制。

---

## Overview

flower-trellis 在 Trellis 之上**叠加** skill-garden 强化包:把强化文件随包发布为离线
快照,安装/升级时按目标的 Trellis 版本选择变体,跟随用户实际平台铺设到对应目录,
并以 manifest 驱动精确的升级清理。整条链路**处处幂等**,可重复执行而结果一致。

---

## Snapshot (`enhancements/` + `scripts/sync-enhancements.mjs`)

- `enhancements/<variant>/` 是 skill-garden `.trellis` 的**离线快照**,使最终用户安装时
  零网络即可叠加。
- 由开发期脚本 `scripts/sync-enhancements.mjs` 生成(`npm run sync`,并挂在
  `prepublishOnly`),**最终用户不会运行它**。脚本会先整体清旧快照再全量递归拷贝
  `.agents` / `.claude` / `overrides`,并写 `MANIFEST.json` 记录 `syncedAt` /
  `sourceCommit` 供溯源。
- **改 0.6 强化 skill / workflow 覆盖时,先改源再同步**:`vendor/skill-garden/.trellis/0.6/`
  是 `npm run sync` 的真实输入。不要只改 `enhancements/0.6/` 或当前项目 `.agents/` /
  `.claude/`;否则下一次 sync 会把改动覆盖回源里的旧版本。正确顺序是:
  1. 改 `vendor/skill-garden/.trellis/0.6/.agents` / `.claude` / `overrides` 对应源文件;
  2. 运行 `npm run sync`;
  3. 用 `diff -u vendor/... enhancements/...` 验证发布快照与源一致;
  4. 必要时再同步当前项目已安装副本(如 `.agents/skills/...`、`.claude/skills/...`)。
- 随包发布靠 `package.json` 的 `files: ["bin","src","enhancements","README.md"]`。
- **同步源 = git submodule `vendor/skill-garden`**(不在 `files` 白名单,不进 npm tarball)。
  `sync-enhancements.mjs` 三级路径解析:`SKILL_GARDEN_DIR` 环境变量 → `PKG_ROOT/vendor/skill-garden`
  → 都缺则 `exit(1)` 提示 `git submodule update --init --recursive`。
- **CI 幂等**:源 `.trellis` 缺失但 `enhancements/MANIFEST.json` 已存在(如 CI 未拉 submodule)→
  警告 `exit(0)` 沿用已提交快照;源与快照都无才 `exit(1)`。使 `prepublishOnly` 在"快照已提交、
  发布不拉 submodule"的 CI 场景不致失败。`syncedFrom` 记相对仓库根路径(避免绝对路径写进随包快照)。
- 发布前快照与 submodule pin 的一致性断言见 [Release & Publishing](./release-and-publishing.md)。

---

## Variants

- 三个变体:`old` / `0.5` / `0.6`(`src/constants.js` 的 `VARIANTS`)。
- 选择依据:目标项目 `.trellis/.version`(见 `variant.js` 的规则),或 `--variant` 强制覆盖。
- 差异:`0.6` 走 `overrides/workflow.md`(hub)+ `overrides/workflow-states/*.md`;
  `0.5` 走 `overrides/trellis-route.md`;`old` 无 overrides,workflow-state 文本来自
  `legacy-blocks.js` 常量。

---

## Apply Pipeline (`src/lib/apply-enhancements.js`)

`applyEnhancements(target, opts)` 是 init / update 共享的总编排,顺序固定:

1. **校验**:目标存在 `.trellis/`,否则抛错(不是 Trellis 项目)。
2. **选变体**:`--variant` 优先并校验合法性,否则 `selectVariant` 读 `.version`。
3. **铺 skill**(`copy-skills.js`):**跟随平台** —— 检测目标已有的 `.claude/` /
   `.agents/` 目录决定铺到哪;claude → `.claude/skills`(+ `.claude/commands/trellis`),
   codex/gemini 等共享层 → `.agents/skills`;两者皆无则兜底铺 claude。
4. **铺脚本资产**(`copy-scripts.js`):只复制变体 `scripts/` 下的直接文件到目标
   `.trellis/scripts/`。脚本资产跟随 `--skills` 过滤;例如 `auto_loop.py` 可由
   `auto_loop` / `auto-loop` / `auto-loop-runner` / `trellis-auto-loop` 命中,确保只安装
   `trellis-auto-loop` 时也会带上 runner 脚本。
5. **升级清理 + manifest**(**仅全装、无 `--skills` 时**):对比上次 manifest 的 `paths`,
   删除本次变体不含的过期项,再写新 manifest。带 `--skills` 是精细操作,不动 manifest、不清理。
6. **注入 workflow**(`workflow-inject.js`):全装,或显式指定 workflow 相关 skill 时执行。
7. **codex 后处理**(`codex-tweaks.js`):仅当目标存在 `.codex/` 时,兼容清理旧
   `config.toml` 的 `multi_agent_v2` 段,并在保留上游 hooks 的基础上合并 SessionStart。

---

## Idempotency (必守)

叠加链路的每一步都要可重复执行:

- `fs-utils.copyPath`:先删软链/旧目标再拷贝,无条件覆盖,不残留上游已删文件。
- 升级清理只在**全装**时维护 manifest 与删除过期项,避免 `--skills` 精细操作误删。
- `workflow-inject` / `skill-override-inject`:先把首次回滚内容备份到
  `.trellis/.backup-flower/<原相对路径>`(目录名命中 Trellis `.backup-*` 忽略规则),已存在则保留,
  保证备份永远是首次注入前的原文。旧版本散落的 `.bak` /
  `.flower-skill-garden.bak` 要迁入该目录并删除旧文件,避免污染目标项目 git。随后
  `workflow-inject` 先 `stripBlocks` 清掉所有旧 skill-garden 段(SECTION + sentinel)再重新注入;
  处理后内容与原文件相同则**不写盘**。
- `codex-tweaks`:`config.toml` 段头已注释/不存在则不再处理;`hooks.json` 合并后的
  内容一致则不写,避免覆盖 Trellis 上游 hook 参数。

---

## Scenario: AI-Facing Enhancement State Helpers

### 1. Scope / Trigger

- Trigger: 0.6 强化包需要在压缩后恢复 `trellis-route` 本轮选择,同时减少
  `workflow.md` / `workflow-state` 每轮注入的长规则。
- Scope: 任何需要 AI 高频读取的 workflow/state/skill 文案,如果包含本地状态读写、
  JSON / key-value 解析、严格优先级或可测试错误分支,都应拆成三层:
  高频 prompt 只写门禁和边界;skill 写流程和语义;随 skill 分发的脚本写确定性状态操作。

### 2. Signatures

随 skill 分发的 helper 必须提供窄命令接口,让正常路径只调用一次即可得到结构化结果:

```bash
python3 .agents/skills/trellis-route/scripts/route_state.py resolve --target <implement|check>
python3 .agents/skills/trellis-route/scripts/route_state.py resolve --target <implement|check> --verbose
python3 .agents/skills/trellis-route/scripts/route_state.py write --target <implement|check> --mode <mode> --source <trellis-route|numbered-fallback> [--save-pref]
python3 .agents/skills/trellis-route/scripts/route_state.py clear-pref --target <implement|check>
```

Claude 平台只安装 `.claude` 副本时,路径改为
`.claude/skills/trellis-route/scripts/route_state.py`。`.agents`、`.claude`、`enhancements/0.6`
和 `vendor/skill-garden/.trellis/0.6` 中的同名脚本必须保持一致。

### 3. Contracts

- 高频 `workflow.md` / `workflow-state`:
  - 只声明何时需要 route、什么不能算证据、必须加载 `trellis-route`、用户覆盖优先。
  - 不内嵌 prefs 解析、runtime schema、fallback 选项、Python / awk 代码片段。
- `trellis-route/SKILL.md`:
  - 保留用户选项、mode 映射、轻量 check 逃生口、dispatch 指令和 helper 调用方式。
  - 不把机械 JSON 读写逻辑改写成 prompt 里的长代码块。
- `route_state.py`:
  - `resolve` 顺序固定为 session runtime `route_decisions.<target>` -> `.trellis/.route-prefs.tmp` -> `.trellis/.runtime/auto-loop/<run-id>.json` 临时授权。
  - prefs 或 auto-loop 授权命中时写回 `.trellis/.runtime/sessions/<context-key>.json`。
  - runtime 只保存原始合法来源:`trellis-route`、`numbered-fallback`、`route-prefs`、`auto-loop`。
  - `.runtime` 自身不是 `route_decision.source`;raw runtime JSON 必须经 helper / skill 校验后才可复用。
  - `--save-pref` 才写个人默认;不带该 flag 只写当前 session runtime。
  - 写入当前任务任一 target 的 runtime 决策前,必须清理同一 session 中属于其他任务的 `route_decisions`,避免任务切换后 check 阶段误复用上个任务的选择。
  - auto-loop 授权只在当前 session runtime 绑定 `current_auto_run`，或全局 auto-loop current 指针能指向唯一 running run 时生效。
  - 默认 stdout 必须保持精简:命中时返回 `status`、当前 `task`、`mode`、决策 `source`,以及可选 `origin`(`runtime` / `route-prefs` / `auto-loop`);未命中返回 `status` + `reason`。完整 `decision`、`path`、`context_key`、`pref_path`、`auto_path`、写回标记等诊断字段只在 `--verbose` 输出。

任务隔离属于 helper 的确定性逻辑,不要把 `task == current_task` 判断扩散到高频 workflow/state 文案里。workflow 维持轻量的 target-matched route 证据规则;`trellis-route` / `route_state.py` 负责 runtime 命中校验、写入清理和默认输出里的 `task` 诊断字段。

### 4. Validation & Error Matrix

| 条件 | 行为 |
|------|------|
| 无 `.trellis/` | 返回 `status=miss/skipped`,不阻断外层流程 |
| 无 current task 或无 session context key | 返回 `no-current-task` / `no-session-context`,继续展示 route 选项 |
| runtime 文件缺失或 JSON 损坏 | 忽略 runtime,继续读 prefs 或展示选项;不要删除文件 |
| runtime 的 task / target / source / mode / scope 不匹配 | 返回 miss,不得复用 |
| 同一 session 切换到新任务并写入 implement/check 决策 | 写入前清理其他任务的 runtime route 决策;个人 prefs 不受影响 |
| prefs 缺失或值不合法 | 返回 miss,展示选项 |
| prefs 命中 | 返回 hit,写回 runtime,`origin=route-prefs`,`source=route-prefs` |
| auto-loop running run 存在合法 route_authorization | 返回 hit,写回 runtime,`origin=auto-loop`,`source=auto-loop` |
| auto-loop 无绑定 run / 非唯一 running run / mode 不合法 | 返回 miss,展示选项 |
| 用户明确重选 / 临时改 / 清除默认 | 忽略 runtime 和 prefs,重新进入 route 选项 |

### 5. Good/Base/Bad Cases

- Good: 压缩后当前上下文没有 `route_decision`;`resolve --target implement` 命中 runtime,
  输出合法 `task` / `mode` / `source`,agent 直接复用,不重复问用户;需要诊断再加 `--verbose`。
- Base: runtime miss 但 `.route-prefs.tmp` 有 `implement=inline`;`resolve` 返回
  `origin=route-prefs`,`source=route-prefs` 并写回 runtime,后续同 session 直接 runtime hit。
- Base: runtime 和 prefs 都 miss,但当前 session 的 `current_auto_run` 指向 running auto-loop state,且 `route_authorization.implement=subagent`;`resolve` 返回 `origin=auto-loop`,`source=auto-loop` 并写回 runtime。
- Bad: compact summary 里只有“用户选过 inline”;workflow 不得把它当 route 证据,
  必须读取 `trellis-route` 并由 helper 校验 runtime / prefs。
- Bad: 同一 session 里任务 A 的 `route_decisions.check` 还在 runtime 中;切到任务 B 后不得把它当任务 B 的 check 证据。写入任务 B 任一路由时应清理任务 A 的 runtime route 决策。

### 6. Tests Required

- 静态检查:
  - `git diff --check`
  - helper 脚本 `python3 -m py_compile <script>`
  - 多份 skill/script 副本用 `cmp -s` 或等价方式确认一致。
- 行为检查:
  - 清空 `route_decisions` 但保留 session 文件其他字段,验证 prefs hit 会写回 runtime。
  - 第二次 `resolve` 验证 runtime 优先。
  - `write` 不带 `--save-pref` 时验证 `.route-prefs.tmp` 不变。
  - 同一 session 从任务 A 切到任务 B 后,写入任务 B 的 implement 决策会清理任务 A 的 check 决策;随后 `resolve --target check` 对任务 B 返回 miss,除非存在个人 check 默认。
  - `write --save-pref` 验证只更新当前 target 并保留另一个 target。
  - `clear-pref --target check` 验证只清 check 默认。
  - prefs miss 时,当前 session 绑定 `current_auto_run` 且 auto-loop state 有合法授权,验证 `resolve` 命中 auto-loop 并写回 runtime。
  - `.route-prefs.tmp` 存在时,验证个人偏好优先于 auto-loop 授权。
  - auto-loop running run 不唯一或 mode 不合法时,验证返回 miss 且不写 runtime。
- 同步检查:
  - 先改 `vendor/skill-garden/.trellis/0.6`,再 `npm run sync`。
  - 确认 `enhancements/0.6` 和当前 dogfood `.agents` / `.claude` 副本未漂移。

### 7. Wrong vs Correct

#### Wrong

```markdown
At every route boundary, parse .trellis/.route-prefs.tmp with awk, inspect
.trellis/.runtime/sessions/*.json manually, and if the compact summary says
"inline" then reuse it.
```

问题:高频注入塞入机械解析细节,模型可能绕过 task/target/source/mode 校验,也会把普通压缩摘要误当证据。

#### Correct

```markdown
At each route boundary, reuse only an explicit target-matched route_decision in
current context; otherwise load trellis-route. trellis-route calls:

python3 .agents/skills/trellis-route/scripts/route_state.py resolve --target implement
```

原因:prompt 保留边界,skill 保留语义,脚本负责 task 校验和跨任务 runtime 清理;压缩恢复稳定,每轮 token 也更低。

## Scenario: Auto Loop Runner

### 1. Scope / Trigger

- Trigger: 0.6 强化包需要提供接近 `/goal` 的自动任务循环,让用户显式启动后按单任务或显式多任务队列推进到本地 `commit-only`。
- Scope: `.trellis/scripts/auto_loop.py` 负责确定性状态机;`trellis-auto-loop` skill 负责 agent 入口、触发词、恢复协议、action 映射和 record 回写;`trellis-route` 只负责 implement/check 路由授权;`trellis-push` 只负责 commit-only 提交边界。

### 2. Contracts

- `trellis-auto-loop/SKILL.md` 是 AI 侧入口。没有这个 skill 时,脚本虽然可运行,但 agent 不知道何时启动、压缩后如何恢复、每个 action 如何映射回 Trellis workflow、以及何时调用 `record`。
- `.trellis/scripts/auto_loop.py` 是状态权威,状态路径固定为 `.trellis/.runtime/auto-loop/<run-id>.json`;`resume_capsule` 只作人类摘要。
- `start` 支持显式多任务队列,按用户顺序执行;同一 worktree 不并发。
- 默认 profile 为 `commit-only`,可写入临时 route 授权;该授权低于个人 `.trellis/.route-prefs.tmp`。
- planning start gate 按有效 route 判断 JSONL 是否必需:个人默认优先于 auto 临时授权;inline / check-all-inline 可不因 seed-only JSONL 停住,subagent 路径仍要求 curated context。
- runner action 必须通过既有 Trellis 语义执行:`trellis-task-brief`、`task.py start`、`trellis-route`、implement/check、`trellis-update-spec`、`trellis-push commit-only`。
- `next` 发出的 action 必须写入 runtime 的待回写状态;`record` 必须显式传入匹配 action,缺失或不匹配时返回 error,不得静默推进。
- auto-loop 的 `commit-only` 是本次 run 内任务相关本地提交的预授权;普通 `trellis-push` 仍必须展示计划并等待确认。预授权判定以 `status` 输出里的 `outstanding_action.action=commit_only` 和当前任务匹配为准。
- `scripts/auto_loop.py` 必须随 0.6 快照发布,并可被 `--skills trellis-auto-loop` 精细安装带上。

### 3. Validation

- `python3 -m py_compile .trellis/scripts/auto_loop.py`
- `python3 -m py_compile enhancements/0.6/scripts/auto_loop.py`
- `cmp -s` 检查源、快照、当前 dogfood runner 一致。
- 用临时目标安装 `--skills trellis-auto-loop`,确认同时铺设 `trellis-auto-loop` skill 和 `.trellis/scripts/auto_loop.py`。
- 行为冒烟至少覆盖 start → next → record → check/fix/recheck → spec_update → commit_only → done。
- 行为冒烟必须覆盖 `record` 缺失 / 不匹配 action 会被拒绝,以及 inline route 下 seed-only JSONL 不阻塞 planning start、个人 subagent 默认仍会阻塞。

---

## Faithful Porting (溯源)

大量逻辑是从 skill-garden `install.sh` **逐字符移植**而来(`fs-utils` 的 `install_one`、
`variant.js` 263-274、`copy-skills` 的 `should_install`、`workflow-inject` 的 362-557
内嵌 Python)。约束:

- 改这些逻辑前先核对上游 install.sh 对应段落,保持语义一致。
- 移植代码要保留「移植自 install.sh xxx」的 Why 注释,标明出处与对齐点。
- `constants.js` 的平台/变体名单同理,与 Trellis `cli/index.ts`、skill-garden 对齐。

---

## Common Mistakes

- 改了叠加逻辑却不跑 `npm run sync` 重建快照,或反过来改了快照不对应上游版本。
- 只改 `enhancements/0.6/` 中的 skill / workflow 覆盖,没有改
  `vendor/skill-garden/.trellis/0.6/` 源 —— 下一次 `npm run sync` 会覆盖掉手工快照改动。
- 把本地状态读写、JSON/key-value 解析和长 fallback 规则塞进高频 workflow/state 文案,
  而不是下沉到随 skill 分发的 helper 脚本。
- 在 `--skills` 精细模式下触发 manifest 清理 —— 清理只允许全装。
- 注入/写盘类新逻辑没做「内容相同则不写」的幂等判断。
- 移植上游逻辑时「优化」掉了与 install.sh 的一致性,导致升级行为漂移。
