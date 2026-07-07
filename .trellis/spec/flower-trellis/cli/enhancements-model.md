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
- 0.6 `overrides/workflow.md` 是高优先级 hub,可以放轻量兜底提醒。例如
  `<flower-update>` 的阻塞确认、release notes 展示和 `<flower-update-result>` →
  `trellis-push` 确认联动应写在 hub 源文件,再同步到 `enhancements/0.6` 与当前 dogfood
  `.trellis/workflow.md`。
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
5. **铺 flower 自有资产**(`flower-assets.js`):仅全装时把 flower-trellis 自身能力复制到
   目标 `.trellis/scripts/`,例如 `src/assets/flower_update_hook.py` → `.trellis/scripts/flower_update_hook.py`。
   这类资产不属于 skill-garden 快照,不要放进 `enhancements/<variant>/scripts/`。
6. **升级清理 + manifest**(**仅全装、无 `--skills` 时**):对比上次 manifest 的 `paths`,
   删除本次变体不含的过期项,再写新 manifest。带 `--skills` 是精细操作,不动 manifest、不清理。
7. **注入 workflow**(`workflow-inject.js`):全装,或显式指定 workflow 相关 skill 时执行。
8. **skill override 注入**(`skill-override-inject.js`):全装,或显式指定 finish-work 相关
   skill 时执行。注入位置为 frontmatter 后;无 frontmatter 的 command 文件优先插到首个
   H1 标题后,避免 override 标题污染平台提取的命令描述。
9. **平台后处理**:
   - `codex-tweaks.js`:仅当目标存在 `.codex/` 时,兼容清理旧 `config.toml` 的
     `multi_agent_v2` 段,保留上游 hooks 并合并 Trellis / flower 的 `SessionStart`,同时强制
     `.trellis/config.yaml` 的 `codex.dispatch_mode: sub-agent`。Codex Trellis 主上下文 hook
     必须归位到 `matcher: "startup|resume|clear|compact"`、`timeout: 30`;flower 更新检查
     hook 必须归位到 `matcher: "startup"`、`timeout: 30`。
   - `claude-tweaks.js`:仅当目标存在 `.claude/` 时,只向 `.claude/settings.json` 的
     `SessionStart` `startup` matcher 合并 flower update hook,timeout 为 30,并清除
     `clear` / `compact` matcher 中的 flower update hook。

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
  内容一致则不写,避免覆盖 Trellis 上游 hook 参数。SessionStart 合并必须先从所有
  group 移除目标命令旧位置,再归位到目标 matcher group,避免旧版无 matcher group 与新版
  matcher group 同时触发;其它用户自定义 hooks 必须保留。
- `flower-assets`:只由全装复制,并把 `.trellis/scripts/flower_update_hook.py` 写入 manifest
  `paths`,让升级清理和 uninstall 只按 manifest 精确管理自己铺过的脚本。
- `claude-tweaks`:只追加缺失的 startup flower hook,重复运行不得重复;若历史版本把 flower
  hook 放到了 `clear` / `compact`,更新时必须移除这些非 startup 位置;若旧 hook 仍是
  8 秒 timeout,更新时必须迁移到 30 秒。

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
  - workflow hub 可用一句轻量提醒声明 compact summary、ordinary summary、SessionStart、
    replacement history、历史用户裸数字都不是 route evidence，并指向 `trellis-route`
    负责 numbered fallback 有效性；workflow-state 只保留面包屑级门禁，不重复裸数字细节。
  - 不内嵌 prefs 解析、runtime schema、fallback 选项、Python / awk 代码片段。
- `trellis-route/SKILL.md`:
  - 保留用户选项、mode 映射、轻量 check 逃生口、dispatch 指令和 helper 调用方式。
  - 明确 `1` / `2` / `3` / `4` 这类裸数字只可解释为当前可见上一条 assistant
    route 选项消息的紧邻回复；压缩摘要、历史消息、旧 target 的裸数字不得触发
    `write --source numbered-fallback`。
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
| compact 后只剩历史裸数字 `1` 和新的 check 选项摘要 | 不得写入 check route；必须重新展示当前 target 选项并等待紧邻回复 |

### 5. Good/Base/Bad Cases

- Good: 压缩后当前上下文没有 `route_decision`;`resolve --target implement` 命中 runtime,
  输出合法 `task` / `mode` / `source`,agent 直接复用,不重复问用户;需要诊断再加 `--verbose`。
- Base: runtime miss 但 `.route-prefs.tmp` 有 `implement=inline`;`resolve` 返回
  `origin=route-prefs`,`source=route-prefs` 并写回 runtime,后续同 session 直接 runtime hit。
- Base: runtime 和 prefs 都 miss,但当前 session 的 `current_auto_run` 指向 running auto-loop state,且 `route_authorization.implement=subagent`;`resolve` 返回 `origin=auto-loop`,`source=auto-loop` 并写回 runtime。
- Bad: compact summary 里只有“用户选过 inline”;workflow 不得把它当 route 证据,
  必须读取 `trellis-route` 并由 helper 校验 runtime / prefs。
- Bad: implement 阶段用户曾紧邻回复 `1`;后续 check route miss 并发生 compact,
  恢复上下文里出现旧 `1` 和 check 选项摘要时,不得把旧 `1` 当作 check 的
  `numbered-fallback`,也不得写入 `check-all-inline`。
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
  - prompt/workflow 回归:compact summary、ordinary summary、replacement history 或历史裸数字
    不能作为当前 target 的 numbered fallback；只有紧邻当前 route 选项消息的用户回复才有效。
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

## Scenario: Project Knowledge Discovery Helper

### 1. Scope / Trigger

- Trigger: 0.6 强化包需要让 AI 在“项目局部知识可能影响做法”的决策边界主动
  发现项目 SOP / 经验 / 标准流程,但不能为每个 SOP 新增一个 Skill,也不能把
  纯问答、只读查看、打开本地工具或轻量编辑都变成检索流程。
- Scope: `spec_router.py` 是随 0.6 `scripts/` 分发的通用发现器;workflow hub/state
  只提示何时调用;目标项目自己的 `.trellis/spec/**/*.md`(含 `spec/guides/**/*.md`)
  保存具体 SOP / spec / thinking guide。

### 2. Signatures

```bash
python3 ./.trellis/scripts/spec_router.py "<short query describing the intended action>"
python3 ./.trellis/scripts/spec_router.py --limit 3 "<short query describing the intended action>"
python3 ./.trellis/scripts/spec_router.py --json "<short query describing the intended action>"
```

`copy-scripts.js` 必须让 `spec_router.py` 在全装时铺到目标 `.trellis/scripts/`,并让
`--skills workflow-enhancement` / `spec-router` / `project-knowledge` /
`knowledge-router` 精细安装也带上该脚本,避免 workflow 提示存在但脚本缺失。

### 3. Contracts

- 查询参数是“意图动作短查询”,不是机械复制用户原文。AI 应结合当前请求、即将执行的
  命令、涉及文件/系统、package/layer 和领域词构造查询。
- 扫描范围固定为目标项目 `.trellis/spec/**/*.md`,其中 `.trellis/spec/guides/**/*.md`
  是共享 thinking guide 层,必须保留真实路径参与匹配。
- Markdown 可选声明简单 frontmatter:`kind` / `triggers` / `load` / `priority`。
  只支持 `key: value` 与 `key:` 后接 `- item`;不要引入 YAML 依赖。该能力只作
  向后兼容,不要推广为主路由机制,也不要要求项目为每份 spec 维护 `triggers`。
- 主路由机制是非侵入式文档结构:路径/文件名、H1-H3 标题、`.trellis/spec/**/index.md`
  中指向具体文档的链接文本与同一行描述、正文前缀样本。没有 frontmatter 的文件
  必须仍可参与检索。
- 路径匹配只使用 `.trellis/spec/` 内的相对路径,不要让公共前缀
  `.trellis/spec` 参与打分;否则查询里的 `spec` 会命中所有文档。
- 查询、路径、标题、index 描述、正文样本都必须 token 化后用 token set 匹配;
  禁止把 `token in text` 这类任意子串命中作为有效匹配依据。英文路径里的
  `/`、`-`、`_`、`.` 等分隔符应产生独立 token;中文连续文本用有限 n-gram
  保留 `发版` 命中 `发版流程` 这类能力。
- 默认候选要偏保守:最多返回 3 条。候选必须具备强锚点或足够强的组合证据:
  路径/标题/index 描述命中非弱词 token,或正文样本命中足够多非弱词 token。
  仅少量正文命中不能成为高置信候选。
- 弱匹配计数要过滤项目知识路由自身和轻量操作的高频泛词,例如 `project`、
  `context`、`read`、`matched`、`spec`、`workflow`、`to`、`flow`、`commit`、
  `changes`、`documentation`、`readme`、`typo`;它们可以出现在 reason 中,
  但不能凑成强匹配。
- 标题匹配应扫描完整 Markdown 标题;正文匹配仍只扫描前缀样本,避免大文档全文检索拖慢或放大误报。
- 默认输出只给候选路径、kind、score、confidence、reason 和 action;不输出完整
  spec 内容,避免上下文膨胀。`confidence: high` 使用
  `action: read before acting`;`confidence: medium` 使用
  `action: read if clearly relevant`。
- workflow 读取策略默认读取 high-confidence 匹配;medium-confidence 只有在 path /
  heading / index description / reason 明确相关时才读取,避免 helper 候选列表放大上下文。
- 无 `.trellis/`、无 `.trellis/spec/`、读取失败或无匹配都不阻断流程;输出
  “No relevant project SOP/spec matched. Continue with the normal workflow.”
- workflow hub/state 触发文案必须使用“项目局部知识可能影响做法的决策边界”语义,
  不要退回宽泛的 `procedural or high-impact actions`。状态块只保留短提示,长规则
  放在 workflow hub。

### 4. Validation & Error Matrix

| 条件 | 行为 |
|------|------|
| 查询命中 frontmatter `triggers` | 作为向后兼容信号参与加权并列出 matched triggers,但不要求新文档维护 triggers |
| 查询命中文件路径 / 标题 / index 描述 / 正文 | 按确定性分数和 confidence 排序,默认最多返回 3 条 |
| 仅命中正文普通词或弱词且未达到强匹配阈值 | 视为无匹配,避免无关查询误报 |
| 查询只命中 `.trellis/spec` 公共路径前缀 | 不算路径命中 |
| 查询命中 `to` / `flow` / `commit` / `changes` 等泛词 | 不得仅凭这些词返回候选 |
| 查询 guides 相关意图 | 返回 `.trellis/spec/guides/**/*.md` 真实路径 |
| index.md 链接描述命中具体文档 | 给被链接的具体文档加权;index 本身不应挤掉更具体候选 |
| Markdown 无 frontmatter | 退化到路径 / 标题 / 正文轻量匹配 |
| frontmatter 不完整或不是简单 YAML | 忽略复杂部分,继续扫描正文 |
| 无 `.trellis/` 或 `.trellis/spec/` | 返回无匹配提示,退出码 0 |

### 5. Good/Base/Bad Cases

- Good: 用户准备发版,AI 查询 `beta release publish tag changelog`,返回
  `.trellis/spec/.../release-and-publishing.md`,且 `confidence: high` /
  `action: read before acting`,然后先读 SOP 再执行命令。
- Good: 用户提到跨层/复用经验,AI 查询 `cross layer reuse thinking guide`,返回
  `.trellis/spec/guides/cross-layer-thinking-guide.md` 和 code reuse guide。
- Base: 项目没有 frontmatter,仍可通过文件名、标题、index 描述和正文关键词命中。
- Bad: 普通绘图请求 `draw architecture diagram visualize flow` 只因 `flow` 返回 CLI
  spec;应过滤为无匹配。
- Bad: `commit push changes to beta branch` 只因 `to` / `changes` 返回 thinking guide
  或 directory structure;应过滤为无匹配。
- Bad: `edit README documentation typo small change` 只因 `documentation` 返回模块规范;
  应过滤为无匹配。
- Bad: 把具体公司 SOP 复制进 skill-garden;项目私有知识只能留在目标项目 `.trellis/spec/`。

### 6. Tests Required

- `python3 -m py_compile vendor/skill-garden/.trellis/0.6/scripts/spec_router.py`
- `python3 -m py_compile enhancements/0.6/scripts/spec_router.py`
- `python3 -m py_compile .trellis/scripts/spec_router.py`
- 查询发版意图,断言返回 release SOP。
- 查询 guides 意图,断言返回 `.trellis/spec/guides/` 下文档。
- 查询无关意图,断言返回无匹配提示,至少覆盖:
  - `open IntelliJ IDEA for current project local tool launch`
  - `edit README documentation typo small change`
  - `draw architecture diagram visualize flow`
  - `commit push changes to beta branch`
- 查询输出必须包含 `confidence`;high-confidence 为 `read before acting`,
  medium-confidence 为 `read if clearly relevant`。
- `npm run sync` 后用 `cmp -s` 确认源、`enhancements/0.6`、dogfood 副本一致。
- 用临时目标跑 `--skills workflow-enhancement`,确认同时铺设 workflow 覆写和
  `.trellis/scripts/spec_router.py`。

### 7. Wrong vs Correct

#### Wrong

```markdown
Create one new skill for each SOP, ask every spec file to maintain
frontmatter triggers, or ask the model to remember to search all spec files by
itself.
```

问题:Skill 数量膨胀,frontmatter triggers 会漂移成第二套机器索引,且依赖模型记忆时
下次仍可能忘记 SOP 存在。

#### Correct

```markdown
Workflow only says when to run discovery; `.trellis/scripts/spec_router.py`
returns candidate SOP/spec paths from natural document structure
(path/title/index/body) with confidence; project-specific SOP content stays in
`.trellis/spec/`.
```

原因:高频提示保持短小,发现逻辑可测试,项目私有内容不进入 skill-garden,且 spec
文档不需要额外维护一套 triggers。

## Scenario: Auto Loop Runner

### 1. Scope / Trigger

- Trigger: 0.6 强化包需要提供接近 `/goal` 的自动任务循环,让用户显式启动后按单任务或显式多任务队列推进到本地 `commit-only`。
- Scope: `.trellis/scripts/auto_loop.py` 负责确定性状态机;`trellis-auto-loop` skill 负责 agent 入口、触发词、恢复协议、action 映射和 record 回写;`trellis-route` 只负责 implement/check 路由授权;`trellis-push` 只负责 commit-only 提交边界。

### 2. Contracts

- `trellis-auto-loop/SKILL.md` 是 AI 侧入口。没有这个 skill 时,脚本虽然可运行,但 agent 不知道何时启动、压缩后如何恢复、每个 action 如何映射回 Trellis workflow、以及何时调用 `record`。
- `.trellis/scripts/auto_loop.py` 是状态权威,状态路径固定为 `.trellis/.runtime/auto-loop/<run-id>.json`;`resume_capsule` 只作人类摘要,由 `--verbose` 诊断输出动态生成,不要每次写回 runtime JSON。
- `start` 支持显式多任务队列,按用户顺序执行;同一 worktree 不并发。
- 默认 profile 为 `commit-only`;启动前由 `trellis-auto-loop` skill 通过 `trellis-route` 准备真实 route 决策或复用个人 `.trellis/.route-prefs.tmp`,runner 不默认写临时 route 授权。
- planning start gate 按已解析的有效 route 判断 JSONL 是否必需:inline / check-all-inline 可不因 seed-only JSONL 停住,subagent 路径仍要求 curated context。
- runner action 必须通过既有 Trellis 语义执行:`trellis-task-brief`、`task.py start`、`trellis-route`、implement/check、`trellis-update-spec`、`trellis-push commit-only`。
- `next` 发出的 action 必须写入 runtime 的待回写状态;`record` 必须显式传入匹配 action,缺失或不匹配时返回 error,不得静默推进。
- 默认 stdout 必须保持精简:只输出 run 状态、当前/待回写 action、队列计数、简短 blocked/pending/completed 列表和最近少量无 `data` 决策摘要。完整 blocked detail、完整 `decision_log.data`、`resume_capsule`、完整 `record` item 只在 `--verbose` 输出。
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

## Scenario: Auto Loop Runner Boundaries

### 1. Scope / Trigger

- Trigger: 0.6 强化包提供 `trellis-auto-loop` 自动推进任务到本地提交,但 runner
  不能替代 `trellis-route` 的真实执行模式选择,也不能绕过 `trellis-push` 的提交边界。
- Scope: `.trellis/scripts/auto_loop.py` 是状态机;`trellis-auto-loop/SKILL.md` 负责启动前
  route 准备度和 action 调度;`route_state.py` 校验 route runtime/prefs;`trellis-push`
  负责 auto-loop commit-only 的计划、边界复核、提交和 runner 回写语义。

### 2. Signatures

```bash
python3 ./.trellis/scripts/auto_loop.py start --tasks <task> [<task> ...] --profile commit-only
python3 ./.trellis/scripts/auto_loop.py next [--run-id <run-id>] [--verbose]
python3 ./.trellis/scripts/auto_loop.py record --action <action> --result <ok|failed|blocked> [...] [--verbose]
python3 ./.trellis/scripts/auto_loop.py retry-blocked [--run-id <run-id>] [--task <task>] [--route-implement inline|subagent] [--route-check check-all-inline|check-all-subagent] [--all] [--verbose]
python3 ./.trellis/scripts/auto_loop.py status [--run-id <run-id>] [--verbose]
python3 ./.trellis/scripts/auto_loop.py stop --reason "<reason>"
```

`copy-scripts.js` 必须让 `auto_loop.py` 在全装时铺到目标 `.trellis/scripts/`,并让
`--skills trellis-auto-loop` 精细安装也带上 runner 脚本。auto-loop commit-only 不引入
额外提交 helper。

### 3. Contracts

- auto-loop 默认 start 不写 `route_authorization`;缺少当前任务 route runtime 决策且无
  `.route-prefs.tmp` 时,`trellis-auto-loop` skill 必须先走 `trellis-route` 询问/fallback。
- 如果 implement 与 check 两个 target 都缺 route,`trellis-auto-loop` skill 应优先展示
  auto-loop 专用合并选择:本次全 inline、本次全 subagent、保存默认全 inline、保存默认全
  subagent;避免把 `trellis-route` 两套完整 fallback 选项原样贴出。用户仍可用
  `implement 1, check 2` 这类高级格式分别选择。
- runner 是调度器,不自行默认 inline/subagent,也不把 auto 临时授权展示成真实 route 结果。
- `route_state.py resolve` 顺序仍是 runtime -> prefs -> running auto-loop 临时授权;但
  session `current_auto_run` 或全局 `current.json` 指向非 running run 时必须忽略 stale pointer,
  再 fallback 扫描唯一 running run。
- run completed/stopped 后,`auto_loop.py` 只在 current pointer 仍指向本 run 时删除
  `.trellis/.runtime/auto-loop/current.json`;显式 `--run-id` 仍可查看历史 run。
- 队列处理完但存在 blocked item 时,run `status` 必须是 `blocked`,不能伪装成
  `completed`;全 item 本地提交完成才是 `completed`。
- blocked 是同一个 run 的可恢复状态。补齐 route / context / PRD 后,AI 应调用
  `retry-blocked` 把可恢复 blocked item 重置为 `pending`,并继续 `next`;不要用
  `start --force` 新建 run 来纠正漏传参数。
- `retry-blocked` 只写现有 run JSON:合并本次显式 `--route-implement` /
  `--route-check` 到 `route_authorization`,清空 item 的 `blocked` / `last_action`,把 run
  置回 `running`,并刷新 `current.json` 指针。它不创建新的 `auto-*.json`,不改任务文件,
  不替用户默认选择 route。
- runtime JSON 不再落盘派生的 `resume_capsule`;旧状态中的该字段只为兼容读取,下一次写状态时应移除。
- `status` 在无唯一 running/current run 时仍返回 `status=ok`,并列出最近 run 的
  `run_id`、`run_status`、completed / blocked / remaining 计数,方便用户指定 `--run-id`。
- `record` 默认返回当前 item 的 `task`、`item_status`、`current_step`、`commit` 和紧凑 summary,不得返回完整 item;排障时由 `record --verbose` 返回完整 item。
- `commit_only` action 必须进入 `trellis-push` commit-only 语义;AI 根据当前任务 artifacts、
  `git status`、`git diff` 和必要文件内容生成 planned files / retained files / commit
  message / 归属理由,不得用脚本基于 dirty baseline 或时间差猜测文件归属。
- `trellis-push` 边界必须复核当前 action/profile/task 匹配、staged 区为空、无冲突、
  planned files 当前 dirty,且不含 `.trellis/.runtime/`、`.trellis/.route-prefs.tmp`、
  其他任务目录或未解释文件;通过后只暂存 planned files 并本地 commit,再回写 runner。
- 单个 item 的 commit-only 预检失败只把该 item blocked/skipped 并记录原因;多任务 run
  后续 pending item 必须继续。只有 merge/rebase 冲突、repo 状态不可读、脚本损坏或用户 stop
  这类全局问题才停止整个 run。
- runtime `decision_log` 只保留最近有限条结论、来源、文件列表、commit message、commit hash、blocked
  原因和未归档提示;不得记录完整模型思维链。默认输出只给最近少量 `at/type/task/summary`,完整 `data` 只走 `--verbose`。
- `completed` 在 auto-loop summary 中只表示 item 已本地提交。任务生命周期仍需用户显式
  `trellis-finish-work` / archive;runner done 只输出非阻塞提醒。

### 4. Validation & Error Matrix

| 条件 | 行为 |
|------|------|
| start 无 route prefs/runtime | skill 先走 `trellis-route`;runner 不默认选择 |
| 启动漏传临时 route 导致 `missing-implement-context` / `missing-check-context` | `retry-blocked --route-implement ... --route-check ...` 复用同一 run |
| 队列项 blocked 但 blocked reason 是非门禁类问题 | 默认不自动重试;指定 `--task` 或 `--all` 才重置 |
| 多个历史 run 且无 current/running | `status` 返回最近 run 列表,不报 `status-failed` |
| current.json 指向 completed/stopped run | route helper 忽略 stale pointer,扫描唯一 running run |
| run completed/stopped | 清理仍指向本 run 的 current pointer |
| commit_only 时 staged 区已有文件 | trellis-push 记录当前 item blocked,不提交,queue 可继续 |
| commit_only 无法解释某个 dirty 文件归属 | 保留未提交或 blocked,不得猜测纳入 planned files |
| commit_only 发现非当前任务 `.trellis/tasks/**` | 保留未提交并记录 retained files |
| commit_only 成功 | trellis-push 本地 commit,回写 runner commit hash 和 decision_log |
| 多任务第一个 item blocked | `next` 继续后续 pending item,最终 summary 汇总 blocked/unarchived |

### 5. Good/Base/Bad Cases

- Good: 用户启动 auto-loop 前已有 `.route-prefs.tmp implement=inline`;`trellis-route` resolve
  写回 runtime,runner 启动后记录真实 `route_resolved`。
- Good: 第一个任务 commit-only 因 staged 区不空 blocked;runner summary 记录 blocked,`next`
  继续第二个 pending 任务。
- Good: 第一次 start 漏传 inline route,三个 planning task 因 seed-only JSONL blocked;AI
  执行 `retry-blocked --route-implement inline --route-check check-all-inline`,同一个
  `run_id` 继续,目录中不新增第二个 `auto-*.json`。
- Base: run completed 后用户查 `auto_loop.py status --run-id auto-...` 仍可读历史结果;无
  `--run-id` 时不会让 stale current 影响新 run。
- Bad: `trellis-auto-loop` skill 默认传 `--route-implement subagent`;这绕过用户真实 route。
- Bad: run blocked 后直接 `start --force` 启动同一任务队列,产生多个 JSON,用户难以判断哪次
  是权威状态。
- Bad: 主 agent 看到 `commit_only` action 后手动 `git add . && git commit`;这绕过
  `trellis-push` 边界且可能混入无关文件。

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
