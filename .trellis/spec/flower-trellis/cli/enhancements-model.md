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
4. **升级清理 + manifest**(**仅全装、无 `--skills` 时**):对比上次 manifest 的 `paths`,
   删除本次变体不含的过期项,再写新 manifest。带 `--skills` 是精细操作,不动 manifest、不清理。
5. **注入 workflow**(`workflow-inject.js`):全装,或显式指定 workflow 相关 skill 时执行。
6. **codex 后处理**(`codex-tweaks.js`):仅当目标存在 `.codex/` 时,兼容清理旧
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
  - `resolve` 顺序固定为 session runtime `route_decisions.<target>` -> `.trellis/.route-prefs.tmp`。
  - prefs 命中时写回 `.trellis/.runtime/sessions/<context-key>.json`。
  - runtime 只保存原始合法来源:`trellis-route`、`numbered-fallback`、`route-prefs`。
  - `.runtime` 自身不是 `route_decision.source`;raw runtime JSON 必须经 helper / skill 校验后才可复用。
  - `--save-pref` 才写个人默认;不带该 flag 只写当前 session runtime。

### 4. Validation & Error Matrix

| 条件 | 行为 |
|------|------|
| 无 `.trellis/` | 返回 `status=miss/skipped`,不阻断外层流程 |
| 无 current task 或无 session context key | 返回 `no-current-task` / `no-session-context`,继续展示 route 选项 |
| runtime 文件缺失或 JSON 损坏 | 忽略 runtime,继续读 prefs 或展示选项;不要删除文件 |
| runtime 的 task / target / source / mode / scope 不匹配 | 返回 miss,不得复用 |
| prefs 缺失或值不合法 | 返回 miss,展示选项 |
| prefs 命中 | 返回 hit,写回 runtime,`source=route-prefs` |
| 用户明确重选 / 临时改 / 清除默认 | 忽略 runtime 和 prefs,重新进入 route 选项 |

### 5. Good/Base/Bad Cases

- Good: 压缩后当前上下文没有 `route_decision`;`resolve --target implement` 命中 runtime,
  输出合法 `decision`,agent 直接复用,不重复问用户。
- Base: runtime miss 但 `.route-prefs.tmp` 有 `implement=inline`;`resolve` 返回
  `source=route-prefs` 并写回 runtime,后续同 session 直接 runtime hit。
- Bad: compact summary 里只有“用户选过 inline”;workflow 不得把它当 route 证据,
  必须读取 `trellis-route` 并由 helper 校验 runtime / prefs。

### 6. Tests Required

- 静态检查:
  - `git diff --check`
  - helper 脚本 `python3 -m py_compile <script>`
  - 多份 skill/script 副本用 `cmp -s` 或等价方式确认一致。
- 行为检查:
  - 清空 `route_decisions` 但保留 session 文件其他字段,验证 prefs hit 会写回 runtime。
  - 第二次 `resolve` 验证 runtime 优先。
  - `write` 不带 `--save-pref` 时验证 `.route-prefs.tmp` 不变。
  - `write --save-pref` 验证只更新当前 target 并保留另一个 target。
  - `clear-pref --target check` 验证只清 check 默认。
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

原因:prompt 保留边界,skill 保留语义,脚本负责可测试状态操作;压缩恢复稳定,每轮 token 也更低。

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
