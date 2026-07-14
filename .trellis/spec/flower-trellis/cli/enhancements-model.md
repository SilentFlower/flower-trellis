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
- `enhancements/common/.common` 保存可选 common skill 快照。`MANIFEST.json.common`
  除当前 `codexSkills` / `claudeSkills` 外,还累计保存 `removedSkills` tombstone:
  同步脚本在清空旧快照前读取上一次 manifest,把“旧版存在、新版消失”的名称加入
  tombstone,并移除重新出现在当前快照中的名称。首次迁移保留已知历史移除项
  `sub2api-account-json-fix`,让旧仓库升级时能精确清理残留。
- **改 0.6 强化 skill / workflow 覆盖时,先改源再同步**:`vendor/skill-garden/.trellis/0.6/`
  是 `npm run sync` 的真实输入。不要只改 `enhancements/0.6/` 或当前项目 `.agents/` /
  `.claude/`;否则下一次 sync 会把改动覆盖回源里的旧版本。正确顺序是:
  1. 改 `vendor/skill-garden/.trellis/0.6/.agents` / `.claude` / `overrides` 对应源文件;
  2. 运行 `npm run sync`;
  3. 用 `diff -u vendor/... enhancements/...` 验证发布快照与源一致;
  4. 必要时再同步当前项目已安装副本(如 `.agents/skills/...`、`.claude/skills/...`)。
- `overrides/workflow.md` 与 `overrides/workflow-states/*.md` 是 AI-facing control protocol，
  必须保留既有源语言和稳定术语。当前英文协议正文只做语义级修改，不因项目中文文档规范
  整段翻译；用户实际输入的字面命令（如 `展开文件`）按产品约定保留原文。
- 0.6 `overrides/workflow.md` 是高优先级 hub,可以放轻量兜底提醒。例如
  `<flower-update>` 的阻塞确认、release notes 展示和 `<flower-update-result>` →
  `trellis-push` 确认联动应写在 hub 源文件,再同步到 `enhancements/0.6` 与当前 dogfood
  `.trellis/workflow.md`。
- 0.6 `overrides/hooks/shared/<file>` 是 shared hook override 源,用于覆盖目标项目已有的
  Trellis 平台 hook 文件。首批支持 `inject-workflow-state.py`,从源同步到
  `enhancements/0.6/overrides/hooks/shared/inject-workflow-state.py` 后,由全装叠加链路应用到
  已存在的 `.codex/hooks/inject-workflow-state.py` / `.claude/hooks/inject-workflow-state.py`。
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
   `trellis-auto-loop` 时也会带上 runner 脚本;`task_progress.py` 可由 `task-progress` /
   `progress` / `trellis-push` / `push` 及 legacy `push-snapshot` / `snapshot` 命中,确保精细安装
   `trellis-push` 时带上新 helper。旧 `push_snapshot.py` 从新快照移除后,全装升级只能按 flower
   manifest 记录的精确旧路径清理,不得删除用户自有文件。
5. **铺 flower 自有资产**(`flower-assets.js`):仅全装时把 flower-trellis 自身能力复制到
   目标 `.trellis/scripts/`,例如 `src/assets/flower_update_hook.py` → `.trellis/scripts/flower_update_hook.py`。
   这类资产不属于 skill-garden 快照,不要放进 `enhancements/<variant>/scripts/`。
6. **同步已启用 common skill**(**仅全装、无 `--skills` 时**):当前快照只覆盖目标
   `.codex/skills/<name>` / `.claude/skills/<name>` / 历史 `.agents/skills/<name>` 中
   已经存在的精确同名目录,不创建未启用项;历史 `removedSkills` 只删除这些固定根目录下
   的精确 tombstone 名称。legacy `.agents` 使用 Codex 快照原地刷新,不迁移到 canonical
   路径。若旧 manifest 仍把后来迁入 common 的路径记在 `paths`,本轮已刷新的路径必须
   临时加入 stale-path 保留集合,避免刷新后又被删除;写入新 manifest 时 common 路径仍不
   进入 `.flower-manifest.json.paths`。
7. **升级清理 + manifest**(**仅全装、无 `--skills` 时**):对比上次 manifest 的 `paths`,
   删除本次变体不含的过期项,再写新 manifest。带 `--skills` 是精细操作,不动 manifest、不清理。
8. **注入 workflow**(`workflow-inject.js`):全装,或显式指定 workflow 相关 skill 时执行。
9. **skill override 注入**(`skill-override-inject.js`):全装,或显式指定 finish-work 相关
   skill 时执行。注入位置为 frontmatter 后;无 frontmatter 的 command 文件优先插到首个
   H1 标题后,避免 override 标题污染平台提取的命令描述。
10. **hook override 注入**(`hook-override-inject.js`):仅全装时执行。读取
   `overrides/hooks/shared/<file>`,只覆盖目标项目已有的平台 hook 文件,不创建未启用的平台目录。
   hook override 是对 Trellis 原生 hook 的覆盖,不是 flower 自有资产,不得写入 manifest
   `paths`,避免升级清理误删上游 hook。
11. **平台后处理**:
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
- `syncInstalledCommonSkills`:只由全装执行。当前快照名称必须先检查目标精确目录是否存在,
  存在才调用 `copyPath` 覆盖;新名称不得自动安装。`removedSkills` 读取失败按空列表降级,
  删除前必须校验名称是单一路径段,并只在固定 common 根目录下拼接精确路径。重新进入
  当前快照的名称即使仍残留在旧 tombstone 中也不得删除。
- `hook-override-inject`:只由全装执行。目标 hook 文件不存在时跳过,不得创建平台目录或 hook
  文件;内容一致时不写盘;内容变化时先通过 `preserveFirstBackup()` 保存首次备份到
  `.trellis/.backup-flower/<原相对路径>`。shared hook override 覆盖 `.codex` / `.claude`
  等已有平台 hook,但不把这些原生 hook 路径写入 manifest `paths`。
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

## Scenario: Audit-Only Check-All

### 1. Scope / Trigger

- Trigger: 0.6 强化包需要让提交前或 PR 前的全面检查先完成所有可继续的只读验证,
  再用统一清单一次性确认修复范围,避免发现一个问题就停下询问和修改。
- Scope: `trellis-check-all/SKILL.md` 定义检查、报告、修复和重检协议;
  `trellis-route/SKILL.md` 定义 inline/subagent 执行模式及 audit-only dispatch 边界。
  `trellis-check` 只提供检查清单和验证方法,不能把自身的自动修复语义带入 Check-All。

### 2. Signatures

普通 check 路由只允许以下两个全面检查 mode:

```text
route_decision.target = check
route_decision.mode = check-all-inline | check-all-subagent
```

统一问题记录必须包含固定字段:

```text
ID: CHK-001, CHK-002, ...
严重度: P0 | P1 | P2
标题 / 来源 / 证据 / 影响 / 建议 / 位置 / 验证
```

普通模式的修复选择只允许在完整报告末尾出现一次:

```text
修复全部
修复 CHK-001,CHK-003
仅保留报告
```

### 3. Contracts

- 检查阶段必须只读。允许读取文件、搜索和运行无业务写入副作用的 lint、typecheck、
  测试;禁止编辑代码、配置、测试或任务规格。
- 执行顺序固定为三件套实现 -> 实现假设 -> 完整性与规范。普通实现偏差、lint/typecheck/
  测试失败和假设错误都进入统一问题集合,继续其它独立且可安全执行的检查。
- 只有业务/规划冲突导致无法判断、已知问题使后续前提失效、或验证可能产生破坏性/
  外部副作用时,才允许提前阻塞。阻塞结果仍须报告已完成范围和统一问题 ID。
- 局部文案、普通配置值、局部样式或单点条件修改可以走快速路径;未命中 API、组件上下文、
  历史数据、跨层数据流等 Trigger 的维度必须标记 `N/A`,不得展开无关检查。
- 问题 ID 首次分配后在同一修复/重检循环保持稳定;同根因的多个位置合并为一个问题,
  新根因使用下一个 ID。报告按严重度排序,但不重排 ID。
- 报告顺序固定为总体摘要、维度结果、问题清单、未覆盖与风险、修复批次。无问题时省略
  问题清单和修复操作;有问题时只在末尾询问一次修复范围,不得附带 commit/push 计划。
- 用户确认修复后,批量修复所选问题并复用当前任务合法 implement route;不存在时重新进入
  `trellis-route(target=implement)`。定向验证后复用当前 check route 执行 Check-All 重检。
- `check-all-subagent` 必须使用角色说明明确 audit-only 的专用 agent,或用完整 dispatch 契约
  约束通用 subagent。禁止 fallback 到会直接修改工作区的 `trellis-check` agent;没有兼容
  subagent 时必须阻塞并让用户重选 inline,不得静默换路由。
- auto-loop 复用同一问题模型,但不展示普通修复选择。有问题向 runner 记录 `failed`,
  需要产品决策或越权时记录 `blocked`,无问题记录 `ok`;runner 原有 fix/recheck 预算不变。

### 4. Validation & Error Matrix

| 条件 | 行为 |
|------|------|
| 工作区范围内无变更 | 提示无可检查变更并终止,不生成空问题清单 |
| 无 `prd.md` | 三件套实现标记 `N/A`,继续其它适用维度 |
| 文案/普通配置等局部低风险改动 | 只追踪受影响规划条目、直接引用点和必要回归路径 |
| 某个 lint/typecheck/test 失败 | 记录命令、退出状态和关键错误,继续其它独立验证 |
| 缺少历史数据或运行环境证据 | 标记 `部分验证` 或 `阻塞`,不得标记通过 |
| 规划冲突导致无法判断正确行为 | 输出统一阻塞报告,只询问解除阻塞所需的业务决策 |
| 验证可能修改生产数据或调用有副作用外部系统 | 不执行,标记阻塞或未覆盖风险 |
| 用户选择部分 `CHK-*` | 只批量修复选中 ID,未选问题保留在重检结果 |
| subagent 只有自修复型 `trellis-check` agent | 禁止 dispatch,让用户改选 `check-all-inline` |
| Check-All 无问题 | 报告通过和剩余风险,指向 Phase 3.3/3.4,不生成提交计划 |

### 5. Good/Base/Bad Cases

- Good: 两个验证命令和一个规划对照分别发现问题;Check-All 完成其余安全检查后输出
  `CHK-001` 至 `CHK-003`,用户回复“修复全部”,实现阶段一次修复并统一重检。
- Base: 只改一处 UI 文案;三件套实现对照最终有效文案来源,API/历史数据/跨层维度标记
  `N/A`,只运行必要回归验证后快速通过。
- Base: subagent 返回标准只读报告;主会话负责展示清单并询问一次修复范围,subagent 不修改文件。
- Bad: 第一个测试失败后立即问“要不要修”,导致后续 lint、规划和跨层问题未被发现。
- Bad: `trellis-route` 找不到专用 check-all agent 时改用带自修复语义的 `trellis-check` agent。
- Bad: 报告问题后直接生成 commit message、暂存范围或 push 确认。

### 6. Tests Required

- 静态检查 `trellis-check-all` 的 `.agents` / `.claude` 源副本一致,并确认包含
  `audit-only collect-all`、稳定 `CHK-*` 字段、统一结果/修复结果模板和 Post-Check 停止边界。
- 静态检查 `trellis-route` 不再把 `check-all-subagent` fallback 到
  `Agent({subagent_type: "trellis-check"})`,且 dispatch prompt 第一行包含当前任务路径。
- `npm run sync` 后用 `cmp -s` 确认 vendor 源、`enhancements/0.6` 快照和当前 dogfood
  `.agents` / `.claude` 副本一致;确认 `old` / `0.5` 无漂移。
- 快速路径场景断言未命中 Trigger 的维度为 `N/A`,不会展开无关检查。
- collect-all 场景断言多个独立失败被完整收集,报告只出现一次修复范围选择,检查阶段文件无变化。
- 修复/重检场景断言原问题 ID 保持稳定,修复复用 implement route,重检复用 check route。
- subagent 场景至少做静态契约检查;平台有兼容 audit-only subagent 时再执行真实 dispatch 冒烟。

### 7. Wrong vs Correct

#### Wrong

```markdown
Run trellis-check. When any check fails, fix it immediately, ask whether to
continue, and use the trellis-check agent as the check-all subagent fallback.
```

问题:检查范围在第一个失败处被打断,工作区在用户确认前被修改,subagent 路径也可能绕过
Check-All 的统一问题模型和只读边界。

#### Correct

```markdown
Run every safe read-only Check-All dimension, collect stable CHK-* issues,
show one standardized report, ask once for the repair scope, then repair via
the implement route and re-check via the existing check route.
```

原因:用户先看到完整风险面再一次决策;inline/subagent 语义一致,修复和重检仍服从 Trellis
既有路由与阶段边界。

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
- Scope: `.trellis/scripts/auto_loop.py` 负责确定性状态机;`trellis-auto-loop` skill 负责 agent 入口、触发词、恢复协议、action 映射、commit-only 预授权校验和 record 回写;`trellis-route` 只负责 implement/check 路由授权;`trellis-push` 只负责 exact commit-only 执行。

### 2. Contracts

- `trellis-auto-loop/SKILL.md` 是 AI 侧入口。没有这个 skill 时,脚本虽然可运行,但 agent 不知道何时启动、压缩后如何恢复、每个 action 如何映射回 Trellis workflow、以及何时调用 `record`。
- `.trellis/scripts/auto_loop.py` 是状态权威,状态路径固定为 `.trellis/.runtime/auto-loop/<run-id>.json`;`resume_capsule` 只作人类摘要,由 `--verbose` 诊断输出动态生成,不要每次写回 runtime JSON。
- `start` 支持显式多任务队列,按用户顺序执行;同一 worktree 不并发。
- 默认 profile 为 `commit-only`;启动前由 `trellis-auto-loop` skill 通过 `trellis-route` 准备真实 route 决策或复用个人 `.trellis/.route-prefs.tmp`,runner 不默认写临时 route 授权。
- planning start gate 按已解析的有效 route 判断 JSONL 是否必需:inline / check-all-inline 可不因 seed-only JSONL 停住,subagent 路径仍要求 curated context。
- runner action 必须通过既有 Trellis 语义执行:`trellis-task-brief`、`task.py start`、`trellis-route`、implement/check、`trellis-update-spec`、`trellis-push commit-only`。
- `next` 发出的 action 必须写入 runtime 的待回写状态;`record` 必须显式传入匹配 action,缺失或不匹配时返回 error,不得静默推进。
- 默认 stdout 必须保持精简:只输出 run 状态、当前/待回写 action、队列计数、简短 blocked/pending/completed 列表和最近少量无 `data` 决策摘要。完整 blocked detail、完整 `decision_log.data`、`resume_capsule`、完整 `record` item 只在 `--verbose` 输出。
- auto-loop 的 `commit-only` 是本次 run 内任务相关本地提交的预授权;普通 `trellis-push` 仍必须展示计划并等待确认。`trellis-auto-loop` 根据 `status` 的 profile/action/task、空 staged 区和文件语义归属完成判定,再把 exact files/message 交给 `trellis-push` 内部执行器;成功后由 auto-loop 调用 `record`。
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
  route 准备度、action 调度、commit-only 安全校验和 runner 回写;`route_state.py` 校验
  route runtime/prefs;`trellis-push` 只负责接收 exact files/message 并执行本地提交。

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
- `commit_only` action 由 `trellis-auto-loop` 根据当前任务 artifacts、
  `git status`、`git diff` 和必要文件内容生成 planned files / retained files / commit
  message / 归属理由,不得用脚本基于 dirty baseline 或时间差猜测文件归属。
- `trellis-auto-loop` 必须复核当前 action/profile/task 匹配、staged 区为空、无冲突、
  planned files 当前 dirty,且不含 `.trellis/.runtime/`、`.trellis/.route-prefs.tmp`、其他任务目录
  或未解释文件;通过后调用 `trellis-push` 内部 commit-only。该内部执行器不读取 runtime、
  不调用 `status`/`record`、不 push、不写远端任务进度。提交成功后由 auto-loop 回写 runner。
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
| commit_only 时 staged 区已有文件 | auto-loop 记录当前 item blocked,不提交,queue 可继续 |
| commit_only 无法解释某个 dirty 文件归属 | 保留未提交或 blocked,不得猜测纳入 planned files |
| commit_only 发现非当前任务 `.trellis/tasks/**` | 保留未提交并记录 retained files |
| commit_only 成功 | trellis-push 本地 exact commit;auto-loop 回写 runner commit hash、files/message 和 decision_log |
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

## Scenario: Minimal Trellis Push And Task Progress

### 1. Scope / Trigger

- Trigger:普通 `trellis-check` / `trellis-check-all` 完成后,主 agent 可能绕过 Phase 3.4
  `trellis-push`,自行草拟 `Proposed commits`、commit message 和 commit-only 确认;大型或多仓
  计划也可能把普通文件全部铺开,造成高噪声输出。
- Scope:`overrides/workflow.md` 与 in-progress state 负责 post-check / Phase 3.4 硬门禁;
  `trellis-check-all` 负责纯检查汇总;`trellis-push` 只负责 exact plan、一次确认、业务 Git
  动作和普通 push 后的 task progress trigger;`task_progress.py` 只负责窄 schema 读写;
  `trellis-auto-loop` 仍只使用本地 commit-only 预授权。

### 2. Signatures

普通流程状态序列:

```text
trellis-check-all
  -> post-check report + stop
  -> existing Phase 3.3 trellis-update-spec flow
  -> Phase 3.4 trellis-push plan
  -> user confirmation
  -> exact git add / git commit --only / push
  -> exact task progress commit / push
```

auto-loop 状态序列保持不变:

```text
run_check_all -> run_spec_update -> commit_only
  -> trellis-auto-loop validates
  -> trellis-push internal commit-only
  -> trellis-auto-loop record / next
```

展示阈值:

```text
planned_files <= 8  ->逐项展示
planned_files > 8   ->按目录归组,文件摘要最多 12 行,支持“展开文件”
retained_dirty      ->逐项标注 untracked/unstaged/staged,不折叠
risk_items          ->始终逐项展示,不折叠
```

### 3. Contracts

- 普通 post-check 报告只含检查维度/问题数、实际验证、剩余风险、结论和下一步;输出后等待
  用户继续。不得包含 commit message、planned/staged files、`Proposed commits`、commit-only
  决策或提交确认提示。
- Phase 3.3 的既有触发和 required-once 语义不变。本场景不在 check 通过后新增自动 spec update。
- Phase 3.4 必须加载 `trellis-push`;在该 skill 外草拟提交计划不能作为等价替代。
- workflow hub 只声明 Phase 3.4 门禁和格式所有权:详细计划/结果格式完全由 `trellis-push`
  管理。hub 不复制模板、字段顺序、仓库显示名、retained 用户标签或 8/12 文件阈值。
- skill-garden hub/state guard 必须明确整段覆盖上游 workflow 下层 Phase 3.4 的
  `Proposed commits`、本地直接 commit 和 `Never push` walkthrough;目标项目保留上游正文,
  但 AI 在强化模式下必须把该下层 walkthrough 视为 inactive,不得混用其中任一步骤。
- 普通 `trellis-push` 默认 commit + push 当前分支;commit-only 只来自用户明确意图或已经由
  auto-loop 校验的内部调用。分支合并、release、finish-work 和 runner 状态不属于该 skill。
- `trellis-push` 内部始终保存 exact planned files 与 exact retained/unrecognized dirty paths;
  紧凑展示只影响对话,执行仍只能 `git add -- <exact files>` 和
  `git commit --only -- <exact files>`。
- 普通确认模式下,计划外 untracked、unstaged、staged 文件全部保留并展示,不阻塞当前任务
  提交;提交前后必须验证计划外 staged 列表保持不变。auto-loop commit-only 继续要求 staged
  区为空,不扩大预授权。
- `retained` 只作为内部集合名,含义固定为“本次排除并保持原状的 dirty paths”。用户界面统一
  显示“保留未提交的变更（dirty）”,并标注 Git 状态;clean files 不进入该集合。unknown ahead、
  branch/upstream 异常和归属不确定等真正风险单独进入“风险”区。
- 分仓标题优先使用 config package 名,否则使用 Git top-level 目录名。内部输入别名 `root`、
  `parent`、`main repo` 不得直接出现在用户输出中。
- 每仓 planned files 不超过 8 个时完整展示;超过 8 个时按目录归组,普通文件摘要最多
  12 行,并允许用户展开同一 exact set。展开不是执行确认,也不能重新推断范围。
- 保留 dirty 和风险条目始终逐项展示,不受阈值限制。
- 多仓库逐仓独立生成 commit message、branch/upstream、文件范围和 push 结果;普通模式对完整
  计划只确认一次。计划/结果复用原有总览 → 分仓 → 任务进度 → 保留 dirty 的视觉顺序,
  但只显示精简后的 commit/push/progress;不重复展示 Spec review、check、release 或 finish-work 信息。
- 无活动任务时仍可处理当前会话可明确归属的文件,但跳过 task progress。无法证明来源的
  dirty 文件全部作为 unrecognized 排除,直到用户明确指定后重新生成计划。
- commit message 只能由 `trellis-push` 最终草拟/采用;优先级为用户明确提供 > 任务材料与
  实际 diff > 最近提交风格。
- auto-loop 继续保持唯一 `profile=commit-only`、`commit_only` action 和 runtime schema;
  普通默认 push 不扩大 auto-loop 的远端授权。auto-loop 自己校验 action/profile/task、空 staged
  区和文件归属,再把 exact files/message 交给内部执行器;`trellis-push` 不读写 runner runtime。
- 当前任务进度 schema 固定为 `updatedAt`、`completedSteps`、`partialStep`、`nextStep`、`notes`;
  不保存 push mode、业务 commit hash、分支或完整计划。`task_progress.py write` 必须拒绝额外字段,
  只更新 `task.json.progress`,并在成功写入时移除 legacy `last_push_snapshot`。
- 普通业务 push 全部成功时写完整 progress;已有成功仓库而后续失败时写 partial/next/failure notes。
  尚无成功 Git 动作时不得伪造 completed steps。progress 使用固定 message 对 exact 当前任务
  `task.json` 生成独立 commit 并立即 push,不增加第二次确认。
- progress 写入/commit/push 失败不回滚业务结果,最终报告必须分开显示 business 与 progress sync。

### 4. Validation & Error Matrix

| 条件 | 行为 |
|------|------|
| 普通 check 汇总准备输出 commit message / planned files | 停止;只输出检查报告与下一步 |
| Phase 3.4 未加载 `trellis-push` 却准备 commit | 阻断;进入本 skill 重新生成计划 |
| 下层 Phase 3.4 `Proposed commits` / `Never push` 与 hub 同时存在 | hub/state guard 整段覆盖,下层 walkthrough inactive |
| 普通 `trellis-push` 未收到 commit-only 意图 | mode 必须是 commit + push |
| auto-loop outstanding action/profile/task 不匹配 | auto-loop 不得调用内部 commit-only,写回 failed/blocked |
| 单仓 planned files = 8 | 逐项完整展示 |
| 单仓 planned files > 8 | 按目录归组,文件摘要最多 12 行,提供“展开文件” |
| 存在 retained dirty | 在“保留未提交的变更（dirty）”中逐项标注 Git 状态,不作为默认阻塞 |
| 存在 risk items | 在独立“风险”区逐项完整展示,即使超过 12 行也不得折叠 |
| 用户请求“展开文件” | 展示当前 exact planned files,不改变计划、不执行 |
| 执行前 planned set / branch / upstream / conflict / push 目标变化 | 原确认失效,重新生成并确认计划 |
| 只有 retained dirty 变化 | 更新保留摘要并继续,不得让当前任务计划失效 |
| 普通模式存在计划外 staged 文件 | `git commit --only` 提交 exact planned files,保留原 staged 列表 |
| 无活动任务且 dirty 来源不明 | 全部放入 unrecognized,默认不提交 |
| 多仓第二仓执行失败且第一仓已 push | 保留第一仓结果,写 partial progress 与下一恢复动作 |
| 业务动作成功但 progress push 失败 | 不回滚业务提交;单独报告 progress sync failed |
| progress JSON 带额外字段 | helper 拒绝写入,防止旧 Git 编排状态混入 |
| 只有 legacy `last_push_snapshot` | status 映射为新 summary;下一次成功 write 迁移为 `progress` |

### 5. Good/Base/Bad Cases

- Good:check-all 通过后只报告三维检查、验证命令、Redis 未实机验证风险和下一步,等待用户;
  用户继续后按现有 Phase 3.3 进入 `trellis-push`。
- Good:单仓 20 个普通 planned files 按目录压成 6 行,2 个未识别 dirty 文件仍逐项展示;
  用户回复“展开文件”后看到原 20 个 exact paths。
- Good:两个业务仓库各自拥有 commit message 和 branch/upstream,顶部显示执行顺序和一行任务
  progress,用户只确认一次;业务 push 后自动生成独立 progress commit/push。
- Good:当前任务 2 个 planned files,另一个规划任务有 untracked 文件且 index 中有 1 个无关
  staged 文件;输出在“保留未提交的变更（dirty）”中标注两者状态,`git commit --only` 只提交
  2 个 planned files,其他状态保持不变,随后正常 push。
- Base:无活动任务但当前会话明确修改 2 个文件,它们进入 planned;仓库中另外 3 个旧 dirty
  文件进入 unrecognized 并排除。
- Bad:check-all 汇总后直接输出 `Proposed commits` 并说“不会推送”;这同时绕过 post-check、
  Phase 3.3 和 `trellis-push` 默认 push 语义。
- Bad:为了缩短输出把 staged/conflict 文件折叠成“其他 12 个文件”;风险范围不可审计。
- Bad:普通计划沿用 auto-loop 的 commit-only 文案;auto-loop 预授权不能泄漏到普通流程。
- Bad:progress 记录 business commit hash 或 push mode,再让 finish-work 根据它决定是否 push。

### 6. Tests Required

- `git diff --check`
- `npm run sync` 后确认 vendor、`enhancements/0.6`、当前 `.agents` / `.claude` 对应 skill
  和 workflow override 语义一致。
- 静态扫描 post-check 文案,确认只允许检查结果/验证/风险/结论/下一步,且禁止
  `Proposed commits`、commit message、planned files 和提交确认。
- 静态扫描 Phase 3.4 文案,确认必须加载 `trellis-push`,普通默认 push,commit-only 仅来自
  明确用户意图或合法 auto-loop 预授权。
- 静态扫描 hub 与 in-progress states,确认明确整段覆盖下层 `Proposed commits`、local-only、
  no-push walkthrough,而不是只依赖隐含优先级。
- 静态扫描 hub,确认只引用 `trellis-push` 的格式所有权和必要 Git 门禁,不重复 skill 的展示细节。
- 用 8 个、9 个和超过 12 个目录分组行的模拟计划验证展示阈值;风险文件始终逐项显示。
- 模拟单仓、多仓、无活动任务、用户展开文件、计划漂移、部分仓库失败六类输出。
- 静态验证计划和结果模板保留原有总览/分仓结构,用户可见文本不单独使用裸 `retained`,
  retained dirty 与真正 risk 分区展示。
- 在临时 Git 仓库验证 `git commit --only -- <planned files>` 不消费计划外 staged 文件,
  并验证 retained-only 变化不会触发计划重确认。
- `python3 -m py_compile` 验证 `task_progress.py`;临时任务覆盖新 progress 读写、额外字段拒绝、
  legacy 读取与下一次 write 迁移。
- 临时多仓/裸远端覆盖普通成功、部分失败、progress sync 失败和显式 commit-only;验证 progress
  commit 只包含当前任务 `task.json`,commit-only 不 push 也不生成远端 progress。
- 回归 `auto_loop.py start` 仍只接受/default `profile=commit-only`,并保持
  `run_check_all -> run_spec_update -> commit_only`;静态确认 runner `status/record` 只在
  `trellis-auto-loop` skill,不在 `trellis-push`。

### 7. Wrong vs Correct

#### Wrong

```markdown
Check-all 已通过。
Proposed commits:
1. fix(api): 修复会话一致性
回复 ok 执行提交,不会推送。
```

问题:check 阶段越权生成 Phase 3.4 内容,且普通流程擅自选择 commit-only。

#### Correct

```markdown
Check-all 已通过。
验证:5/5 通过。
剩余风险:Redis 未实机执行。
下一步:按现有 Phase 3.3 处理后进入 Phase 3.4 trellis-push。
```

```markdown
## Trellis Push 计划

[PUSH] 1 个仓库 · 1 个 commit · 2 个文件 · 保留未提交 1 · 风险 0
顺序：flower-trellis -> task progress

### 1. flower-trellis
`fix(api): 修复会话一致性`
分支：`beta` -> `origin/beta`
变更：2 个文件
计划提交：src/api.js、test/api.test.js
Push：执行

### 保留未提交的变更（dirty）
- [untracked] notes/local.md

任务进度：completed=实现与检查 | partial=无 | next=finish-work
确认执行请回复 `确认`。
```

原因:check 报告与 Git 计划职责分离,Phase 3.3 时机不变,Phase 3.4 的默认 push、文件范围
和确认都由唯一入口负责。

---

## Scenario: Finish-work Release Audit And Exact Bookkeeping

### 1. Scope / Trigger

- Trigger:Phase 3.4 已完成后显式运行 finish-work,工作区仍保留其他规划任务、旧 archive、
  其他窗口的 untracked/unstaged/staged 文件。
- Scope:`trellis-release audit-current` 负责当前任务单任务上线核对;finish-work 只负责调用该
  模式、当前任务 archive 与本次 journal bookkeeping;不重复提交业务代码,不把工作区整体
  clean 或任务进度当作提交/自动 push 条件。

### 2. Contracts

- finish-work 在移动前记录 task source/name/children、branch、upstream、`HEAD` 与 upstream HEAD,
  以及 `@{u}..HEAD`;只有开始时 upstream 存在且两端 HEAD 完全相同才设置 `baseline_synced=true`。
- 归档前自动调用 `trellis-release audit-current`。该模式只读取当前任务 artifacts、现有
  `release.md` 和 Git 证据:高置信有上线事项时创建/更新 task `release.md`;高置信无事项时
  no-op;证据不确定时写 `Needs human review`。它不生成 `.trellis/releases/` 批次文件、不确认、
  不提交/推送，也不执行 SQL、配置、脚本或外部系统操作。
- 普通 `trellis-release` 批次模式仍按既有任务集合核对、生成批次草案并在写盘前等待用户确认;
  `audit-current` 的无确认语义不得泄漏到批次模式。
- archive 和 journal 写入统一使用原生命令的 `--no-commit`,再由 finish-work 使用 exact paths
  和 `git commit --only` 生成 bookkeeping commits。
- archive commit 只允许归档前源路径、`task.py archive` stdout 返回的
  `.trellis/tasks/archive/YYYY-MM/<task>` 目标路径,以及实际被修改的 child `task.json`。
  禁止暂存 `.trellis/tasks/archive`、`.trellis/tasks`、`.trellis/workspace` 或 `.trellis` 根目录。
- journal commit 只允许 `add_session.py` 本次实际修改的 journal/index 文件。计划外 staged
  文件在提交前后必须保持原状。
- `session_auto_commit=false` 时只落盘和报告精确 dirty paths,不生成 bookkeeping commit,
  不自动 push。
- `baseline_synced=true` 时,完成 exact bookkeeping commits 后确认 branch/upstream 未变化,且
  新增 ahead set 只包含本轮 archive/journal commits,然后自动 push。无关 dirty/staged 不阻断。
- finish-work 开始时已有 ahead、分支 behind/diverged、无 upstream,或执行期间出现并发 commit /
  branch/upstream 变化时,完成本地 bookkeeping commits 但不自动 push。不得读取 progress 或
  legacy task 字段决定 Git 行为。

### 3. Validation & Error Matrix

| 条件 | 行为 |
|------|------|
| 其他规划任务存在 untracked 文件 | 保留并报告;继续当前任务 archive/journal commit |
| 旧 archive 下存在未跟踪任务 | 不纳入 exact destination;继续 |
| index 中已有计划外 staged 文件 | `git commit --only` 隔离并验证 staged 列表保持不变 |
| 当前任务仍有未提交业务文件 | 返回 Phase 3.4 `trellis-push` |
| audit-current 高置信无上线事项 | status=no-op,不创建 release.md,继续 finish-work |
| audit-current 高置信有上线事项 | 写/更新当前任务 release.md,由 archive 自然纳入 |
| audit-current 证据不确定 | 写 Needs human review,继续并在最终结果保留风险 |
| 开始时 `HEAD == upstream HEAD` | push 本轮 bookkeeping commits,不要求工作区 clean |
| finish-work 前已有 ahead commits | 完成本地 bookkeeping commits,不自动 push |
| 无 upstream 或分支 behind/diverged | 完成本地 bookkeeping commits,不猜测远端目标 |
| `session_auto_commit=false` | 只落盘,不 commit/push |

### 4. Tests Required

- 临时仓库中同时创建当前任务、旧 archive、其他规划任务 untracked 文件和计划外 staged 文件;
  验证 archive/journal commits 的 `git show --name-only` 只包含 exact allowed paths。
- 验证两个 `git commit --only` 完成后,计划外 staged/untracked/unstaged 状态保持不变。
- 验证 `audit-current` 的 `no-op` / `written` / `needs-review` 三种结果,并回归普通批次模式仍需确认。
- 验证工作区 dirty 但开始 `HEAD == upstream HEAD` 时允许 push;验证开始已有 ahead、无 upstream、
  behind/diverged 时只生成本地 bookkeeping commits。
- 静态扫描 finish-work override,确认不再出现“`git status --porcelain` clean 才 push”或暂存
  archive/workspace 根目录的指令,也不包含 release 证据推断正文或 progress/legacy Git 联动。

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
