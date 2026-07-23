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
  由 `applyEnhancements()` 在同一个 preflight/apply 计划中执行。
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
- 选择依据:目标项目 `.trellis/.version`(见 `variant.js` 的规则),或 `--variant` 强制覆盖变体。即使强制变体，真实 `version` 仍必须读取并进入兼容检查，不能返回空串。
- 差异:`0.6` 走 `overrides/patches/` + `overrides/bundles/` 统一 Patch catalog；
  `0.5` 走 `overrides/trellis-route.md`;`old` 无 overrides,workflow-state 文本来自
  `legacy-blocks.js` 常量。

---

## Apply Pipeline (`src/lib/apply-enhancements.js`)

`applyEnhancements(target, opts)` 是 init / update 共享的总编排,顺序固定:

1. **校验**:目标存在 `.trellis/`,否则抛错(不是 Trellis 项目)。
2. **选变体并保留真实版本**:`--variant` 只覆盖变体；`.trellis/.version` 始终读取。
3. **兼容线早期门禁**(`patch-conflicts.js`):读取共享 policy；invalid 或未支持的新 minor/major 在旧 catalog preflight 前返回包含 `--no-enhance` 的 error，避免 selector 漂移掩盖真实处理方式。
4. **统一 Patch preflight 与冲突检查**(`patch-engine.js` + `patch-conflicts.js`):同时加载 Skill-Garden 与 Flower platform catalog，在内存得到最终文件；校验 rule operation/target 引用后断言最终产物。同一兼容线未登记版本到此时才在写入前展示 rule/target/reason/evidence warning；任一 error 零写入，通过后才 apply Patch。
5. **铺 skill**(`copy-skills.js`):**跟随平台** —— 检测目标已有的 `.claude/` /
   `.agents/` 目录决定铺到哪;claude → `.claude/skills`(+ `.claude/commands/trellis`),
   codex/gemini 等共享层 → `.agents/skills`;两者皆无则兜底铺 claude。
6. **铺脚本资产**(`copy-scripts.js`):只复制变体 `scripts/` 下的直接文件到目标
   `.trellis/scripts/`。脚本资产跟随 `--skills` 过滤;例如 `auto_loop.py` 可由
   `auto_loop` / `auto-loop` / `auto-loop-runner` / `trellis-auto-loop` 命中,确保只安装
   `trellis-auto-loop` 时也会带上 runner 脚本;`task_progress.py` 可由 `task-progress` /
   `progress` / `trellis-push` / `push` 及 legacy `push-snapshot` / `snapshot` 命中,确保精细安装
   `trellis-push` 时带上新 helper。旧 `push_snapshot.py` 从新快照移除后,全装升级只能按 flower
   manifest 记录的精确旧路径清理,不得删除用户自有文件。
7. **铺 flower 自有资产**(`flower-assets.js`):仅全装时把 flower-trellis 自身能力复制到
   目标 `.trellis/scripts/`,例如 `src/assets/flower_update_hook.py` → `.trellis/scripts/flower_update_hook.py`。
   这类资产不属于 skill-garden 快照,不要放进 `enhancements/<variant>/scripts/`。
8. **同步已启用 common skill**(**仅全装、无 `--skills` 时**):当前快照只覆盖目标
   `.codex/skills/<name>` / `.claude/skills/<name>` / 历史 `.agents/skills/<name>` 中
   已经存在的精确同名目录,不创建未启用项;历史 `removedSkills` 只删除这些固定根目录下
   的精确 tombstone 名称。legacy `.agents` 使用 Codex 快照原地刷新,不迁移到 canonical
   路径。若旧 manifest 仍把后来迁入 common 的路径记在 `paths`,本轮已刷新的路径必须
   临时加入 stale-path 保留集合,避免刷新后又被删除;写入新 manifest 时 common 路径仍不
   进入 `.flower-manifest.json.paths`。
9. **升级清理**(**仅全装、无 `--skills` 时**):对比上次 manifest 的 `paths`,删除本次
   变体不含的过期项。带 `--skills` 是精细操作,不动 manifest、不清理。
10. **legacy 后处理**:**仅 0.5/old** 执行 `workflow-inject.js` 和平台 tweak：
   - `codex-tweaks.js`:仅当目标存在 `.codex/` 时,兼容清理旧 `config.toml` 的
     `multi_agent_v2` 段,保留上游 hooks 并合并 Trellis / flower 的 `SessionStart`,同时强制
     `.trellis/config.yaml` 的 `codex.dispatch_mode: sub-agent`。Codex Trellis 主上下文 hook
     必须归位到 `matcher: "startup|resume|clear|compact"`、`timeout: 30`;flower 更新检查
     hook 必须归位到 `matcher: "startup"`、`timeout: 30`。
   - `claude-tweaks.js`:仅当目标存在 `.claude/` 时,只向 `.claude/settings.json` 的
     `SessionStart` `startup` matcher 合并 flower update hook,timeout 为 30,并清除
     `clear` / `compact` matcher 中的 flower update hook。
   0.6 不调用这些旧入口；对应修改已经在第 3-4 步完成。
11. **成功 manifest**(**仅全装**):全部 required Patch、policy、资产复制、清理和 legacy 后处理完成后写
    `.trellis/.flower-manifest.json`，并记录稳定 Patch provenance。中途失败保留旧 manifest。

---

## Idempotency (必守)

叠加链路的每一步都要可重复执行:

- `fs-utils.copyPath`:先删软链/旧目标再拷贝,无条件覆盖,不残留上游已删文件。
- 升级清理只在**全装**时维护 manifest 与删除过期项,避免 `--skills` 精细操作误删。
- Patch 先 preflight 后 apply;required selector/marker 漂移时目标与 manifest 都不写,
  optional skip 必须进入结构化结果。完整规则见
  [Trellis Patch Engine](./trellis-patch-engine.md)。
- 0.6 changed 目标由 Patch Engine 调用 `preserveFirstBackup()`，备份到
  `.trellis/.backup-flower/<原相对路径>`；已存在则保留，保证备份永远是首次修改前原文。
  legacy marker/additive override 由 Patch 声明迁移，重复运行只产生 unchanged。
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
- shared hook Patch 只修改已存在平台目标，平台前置目录缺失时 `missing-target`；不得创建未启用
  平台。上游 hook 路径不进入 manifest `paths`，由 Patch provenance 单独记录。
- `claude-tweaks`:只追加缺失的 startup flower hook,重复运行不得重复;若历史版本把 flower
  hook 放到了 `clear` / `compact`,更新时必须移除这些非 startup 位置;若旧 hook 仍是
  8 秒 timeout,更新时必须迁移到 30 秒。

---

## Scenario: Complex Repair Intent Routing

### 1. Scope / Trigger

- Trigger:修改 0.6 Request Intent Routing、`workflow-state:no_task`，或修复“先检查 BUG、
  用户确认修复后被误判为无任务 `direct_edit`”的行为。
- Scope:这里只定义 AI-facing 意图契约及其 Patch/测试归属，不新增关键词分类器，也不让
  `task_intent.py` 推断自然语言意图。

### 2. Signatures

意图分类集合固定为:

```text
discuss | inspect | direct_edit | task_plan | workflow_action
```

权威 Patch 入口固定为:

```text
workflow/hub
workflow/intent-routing/request-triage
workflow/state-no-task
bundles/intent-routing.json
```

同步与验证入口固定为:

```bash
npm run sync
node --test test/js/apply-enhancements.test.js
python3 -m unittest discover -s test/python -p 'test_skill_garden_patches.py'
node scripts/check-ai-context-budget.mjs --strict
```

### 3. Contracts

- “允许修改”与“允许跳过任务规划”是两个独立判断。用户确认修复对象，只表示可以继续推进
  修复流程，不自动得到 `direct_edit` 结论。
- 仅要求查看、分析或定位问题时使用 `inspect`，获得修复授权前不得编辑业务文件。已经授权
  修复但范围未知时仍先 `inspect`，再根据实际 scope、risk 和 side effects 重新分类。
- `direct_edit` 只适用于范围已知、局部、低风险、可逆且验收简单的改动。权限/认证/数据范围/
  安全、共享契约、跨包或跨层、多入口一致性、数据库/迁移/配置/发布/外部系统、历史回归、
  系统性验证或范围仍未知，均是 `task_plan` 信号。
- `fix item 1`、`change that`、`修一下`、`改一下` 等修复选择不是 no-task switch。只有当前请求
  明确表达 `直接做`、`不要任务` 等工作流指令时，才可覆盖自动 `task_plan`；新且无关的请求
  恢复自动推断。
- 命中 `task_plan` 只授权创建 planning task 并进入 `trellis-brainstorm`，不得越过 brief、
  `task.py start` 或 `trellis-route` 门禁直接实现。
- workflow hub 保存完整权威语义；Request Triage 与 `workflow-state:no_task` 只保留一跳门禁和
  hub 指向，禁止复制复杂信号清单。`task_intent.py` 继续只执行已经判定后的 create/discard。
- 修改必须从 `vendor/skill-garden/.trellis/0.6` 源 Patch 开始，经 `npm run sync` 生成
  `enhancements/0.6`，再应用到当前 dogfood workflow；禁止只改快照或最终安装副本。

### 4. Validation & Error Matrix

| 条件 | 行为 |
|------|------|
| 用户只要求查明问题 | `inspect`，不编辑 |
| 用户授权修复但影响范围未知 | 先 `inspect`，得到证据后重新分类 |
| 已知局部、低风险、可逆且验证简单 | 可进入 `direct_edit` |
| 权限/数据范围、共享契约、跨层、多入口或系统性回归 | 进入 `task_plan` |
| inspect 结论后用户说“修第 1 个”或“改一下” | 视为修复选择，不视为 no-task switch |
| 当前请求明确说“直接做”或“不要任务” | 可覆盖自动 `task_plan`，但不覆盖独立安全确认 |
| 命中 `task_plan` 后尚未完成 planning gate | 只能创建/完善任务，不得实现 |
| vendor 与 snapshot 或 dogfood 漂移 | 验证失败，禁止发布 |
| Phase summary 或 SessionStart 超过 review ceiling | strict budget 失败，先去重而非提高阈值 |

### 5. Good/Base/Bad Cases

- Good:用户要求“查并修复权限 BUG”；Agent 先只读定位，确认涉及共享权限服务和多入口后创建
  planning task，完成 brief/start/route 再实施。
- Base:用户要求修复已定位的单文件文案错误；范围明确、低风险且验证简单，可使用
  `direct_edit`，不机械创建任务。
- Base:复杂修复已命中 `task_plan`，但用户在当前请求明确说“不要任务，直接做”；按显式流程
  覆盖继续，同时仍遵守生产、凭据、破坏性操作等独立安全边界。
- Bad:Agent 在 inspect 后看到用户回复“第 1 个改一下”，只按消息短或措辞简单判为
  `direct_edit`，随后修改共享服务、DAO、配置和回归测试。
- Bad:为防止误判，把所有包含“修复”的请求机械升级为 `task_plan`，导致已知局部小改也必须建任务。

### 6. Tests Required

- JS apply 测试必须对应用后的最终 workflow 断言两维授权、未知范围重分类、`direct_edit` 边界、
  复杂信号、普通修复选择和显式覆盖语义；不得只搜索 Patch 源文件。
- `task-intent` 与 `intent-routing` 两个精细安装 alias 都必须选择完整 Bundle，并在第二次应用后
  保持文件树不变。
- Python consumer 的真实 catalog preflight 必须从 `plan.files[].next` 断言相同最终 workflow
  语义，防止 JS/Python consumer 或快照漂移。
- `npm run sync` 后逐字节核对 vendor 与 `enhancements/0.6` 对应 Patch，并对当前 dogfood 重复
  应用两次；第二次 Patch 修改数必须为 0。
- 运行 `npm test`、Patch 冲突检查、默认及 strict AI context budget；新增文本不得通过调高
  target/review ceiling 掩盖重复内容。

### 7. Wrong vs Correct

#### Wrong

```text
用户说“改一下” -> direct_edit -> 立即编辑
```

问题:把修复授权当成跳过任务规划授权，没有使用已经查明的影响范围重新分类。

#### Correct

```text
用户授权修复 -> 范围未知则 inspect -> 按实际影响重新分类
                              -> 局部低风险: direct_edit
                              -> 复杂实现信号: task_plan
```

原因:保留小修复的效率，同时让权限、共享契约、跨层和系统性回归等复杂修复经过任务门禁。

---

## Scenario: Planning Brief Review Gate

### 1. Scope / Trigger

- Trigger:修改 Phase 1.4、`trellis-brainstorm` planning handoff、`trellis-task-brief`，或
  `.trellis/scripts/task.py start` 的 `planning -> in_progress` 行为。
- Scope:brief review 由 workflow/skill 负责用户交互，`task.py` 只校验可确定的文件状态；
  不新增无法证明真人确认的 review token、确认参数或独立任务状态。

### 2. Signatures

```bash
python3 ./.trellis/scripts/task.py start <task-dir>
```

```python
_validate_planning_brief(full_path, task_json_path) -> bool
```

权威 planning artifacts 固定为实际存在的：

```text
prd.md | design.md | implement.md
```

`brief.md` 是从上述文件生成的派生交接视图，不是新的需求或设计权威源。

### 3. Contracts

- Phase 1.4 必须加载 `trellis-task-brief`，从最终 planning artifacts 刷新 `brief.md`，在对话
  完整展示后结束当前回合。只有用户在后续消息确认已展示的 brief，才可运行 `task.py start`。
- `trellis-brainstorm` 的 Quality Bar 只表示 planning artifacts 可进入最终 brief handoff；
  用户在最终产物和完整 brief 展示前表达的实现意向不能复用为 planning review。
- `_validate_planning_brief()` 只对 `task.json.status == "planning"` 生效，并且必须在 active-task
  pointer、任务状态和 `after_start` hook 的任何写入或副作用之前执行。
- planning task 缺少 `brief.md`、读取任务状态失败、读取 artifact 元数据失败，或任一权威 artifact
  的 `st_mtime_ns` 严格大于 brief 时，校验返回 `False`，命令退出非零并给出刷新/review 指引。
- brief 与权威 artifact 时间相同视为未过期，避免文件系统时间粒度造成无意义阻断。
- 已经 `in_progress` 的历史任务允许在没有 brief 时通过 `task.py start` 重新绑定 session pointer；
  workflow-state 仍应提示读取三件套并建议回补，而不是从记忆生成未经 review 的 brief。
- 规则必须从 `vendor/skill-garden/.trellis/0.6` 的 Workflow/Skill/File Patch 修改，经
  `npm run sync` 生成发布快照，再应用到当前 dogfood；Hub、Phase、Skill 和 helper 只保留各自职责。

### 4. Validation & Error Matrix

| 条件 | 行为 |
|------|------|
| planning task 缺少 `brief.md` | start 退出非零，状态/pointer/hook 不变，提示运行 `trellis-task-brief` |
| `prd.md`、`design.md` 或 `implement.md` 晚于 brief | start 退出非零并列出过期来源 |
| task/artifact 文件访问或解析失败 | 默认失败关闭，输出可恢复错误，不抛 traceback |
| brief 存在且不早于所有实际存在的权威 artifact | 允许现有 start 流程进入 `in_progress` |
| 历史任务已经是 `in_progress` 且没有 brief | 允许重新绑定，不批量强制迁移 |
| 无 session identity | 仍先执行 brief guard；通过后才进入既有 degraded mode |
| auto-loop planning task 缺少 brief | 先返回 `refresh_brief`，成功后再执行 `start_task` |
| 重复同步和 enhance-only apply | 第二次 Patch 修改数为 0，marker/provenance 不重复 |

### 5. Good/Base/Bad Cases

- Good:复杂任务同一回合完成 create 和三件套后直接调用 start；因为 brief 缺失，脚本在任何
  状态或 hook 副作用前阻断，AI 返回最终 brief handoff。
- Good:用户 review brief 后又修改 `design.md`；start 列出 `design.md` 为更新来源，要求刷新并
  重新 review。
- Base:轻量任务只有 `prd.md` 和更新后的 brief；校验通过，不机械要求不存在的 design/implement。
- Base:旧 `in_progress` 任务没有 brief；重新绑定成功，后续 workflow 建议回补。
- Bad:只在 `workflow-state:planning` 增加提示。该状态可能要到下一次用户输入才注入，同一回合
  create -> plan -> start 仍可绕过。
- Bad:在 task.json 写 `reviewed=true` 或接受 `--confirmed` 参数。脚本无法证明确认来自真人，
  只会制造可伪造的安全状态和迁移成本。

### 6. Tests Required

- Python runtime 测试覆盖 create 后立即 start、brief 缺失、三种权威 artifact 任一过期、
  artifact `stat` 异常、fresh brief、历史 `in_progress` 重绑和无 session identity。
- 所有 guard 失败用例断言退出码非零、任务仍为 planning、`after_start` hook 未执行，并且不会
  覆盖 create 已建立的 planning pointer。
- JS/Python Patch consumer 都断言 Phase 1.4、Brainstorm readiness/handoff、task.py validator/guard
  的最终 marker 与语义；`.agents`、`.claude` 目标至少各覆盖一次。
- Patch conflict policy 同时要求 handoff/readiness 两个 operation，并检查最终 workflow、skill、
  script 的唯一签名；selector/baseline 漂移继续保持全量预检零写入。
- 运行 `npm run sync`、enhance-only 二次幂等、`npm test`、Patch conflict、默认及 strict context
  budget，并逐字节比较 vendor 与 `enhancements/0.6/overrides`。

### 7. Wrong vs Correct

#### Wrong

```text
task.py create -> 写 prd/design/implement -> task.py start -> 开始实现
```

问题:planning state 的下一回合 breadcrumb 尚未注入，提示词门禁和用户 review 都被跳过。

#### Correct

```text
task.py create -> 完善最终 planning artifacts
               -> trellis-task-brief -> 展示完整 brief -> 停止等待
用户后续确认 -> task.py start -> brief freshness guard -> in_progress
```

原因:workflow/skill 保留真实用户确认边界，脚本只验证缺失、过期和 I/O 失败这类确定事实；
三层职责互补且不会伪造确认状态。

---

## Scenario: Stale Task Pointer Intent Recovery

### 1. Scope / Trigger

- Trigger:shared per-turn workflow-state Hook 解析到 `ActiveTask.stale=true`,或 Codex / Claude
  SessionStart 发现 session runtime 指向不存在的任务目录。
- Scope:恢复流程只清理失效 pointer,不授权实现、编辑、任务创建或 `task.py start`。清理成功后,
  当前用户请求必须在同一轮重新进入既有 `no_task` Request Intent Routing。

### 2. Signatures

```text
workflow-state status = missing_task
shared hook stale result = (task_dir.name, "missing_task", active.source)
SessionStart stale status = MISSING TASK POINTER
cleanup command = python3 ./.trellis/scripts/task.py finish
```

Patch 与 Bundle 入口固定为:

```text
workflow/state-missing-task
hooks/inject-workflow-state/shared-runtime
hooks/codex-session-start/missing-task-routing
hooks/claude-session-start/missing-task-routing
bundles/intent-routing.json
```

### 3. Contracts

- shared Hook 必须把 `session`、`session-fallback` 等 stale 来源统一映射为固定状态
  `missing_task`;`source_type` 只保留为诊断来源,不得继续拼进 workflow-state 名称。
- `.trellis/workflow.md` 必须存在唯一 `[workflow-state:missing_task]` 权威正文,并明确:
  1. 先运行 `python3 ./.trellis/scripts/task.py finish`;
  2. 清理失败时报告并停止;
  3. 清理成功后同轮把当前请求视为 `no_task`;
  4. 完成分类前禁止编辑、创建/启动任务或归入已经失效的历史任务。
- `missing_task` state 只引用 `[workflow-state:no_task]` / Request Intent Routing,不得复制五类意图的
  完整判定规则。Hook 继续只读,不得自行修改 `.trellis/.runtime/sessions/`。
- `workflow/state-missing-task` Patch 必须同时修正 `clear_active_task()`:当显式 context key
  不可用、但 `resolve_active_task()` 已按“运行时目录中恰好一个 session 文件”返回
  `session-fallback` 时,使用该结果的真实 `context_key` 清理 pointer。存在多个 session 时继续
  拒绝猜测,不得批量删除或任选一个 session。
- `missing_task` 通过带 managed marker 的 `literal insert after` 加到唯一
  `[/workflow-state:no_task]` 后。Core `workflow-state` selector 只负责替换已有 body,不得为此
  新增平行注入器。
- shared whole-file Hook Patch 目标以 Trellis `SHARED_HOOKS_BY_PLATFORM` 的实际 per-turn
  能力为准:Claude、Codex、Gemini、Qoder、Copilot、CodeBuddy、Droid、Kiro、Trae。
  Cursor 当前没有 per-turn workflow-state Hook,不进入目标。所有目标 `missing=skip`,不得创建
  未启用平台目录。
- Codex / Claude 已有 SessionStart stale 分支必须与 per-turn state 保持一致;只替换已有入口,
  不为其它平台创建 SessionStart 文件。
- `intent-routing` Bundle 必须同时包含 `missing_task` workflow state、shared runtime 和 Codex/Claude
  SessionStart Patch,保证全装及 `task-intent` / `intent-routing` 精细安装都完整生效。
- whole-file desired content 升级时,baselines 必须同时包含 Trellis 0.6.5 上游原始 Hook和上一版
  Flower 强化 Hook。未知用户改动继续返回 fingerprint drift,不得用宽松覆盖换取升级成功。

### 4. Validation & Error Matrix

| 条件 | 行为 |
|------|------|
| stale 来源为 `session` 或 `session-fallback` | 都输出 `status=missing_task` |
| workflow 缺 `missing_task` | 输出泛化 fallback,测试必须失败并阻止发布 |
| `task.py finish` 失败 | 报告失败并停止,不执行后续编辑或任务动作 |
| 清理成功 | 当前请求同轮按 `no_task` 分类,不再次机械询问用户下一步 |
| 平台 per-turn Hook 不存在 | `missing-target`,不创建目录或文件 |
| 目标是上游原始 Hook或上一版 Flower Hook | whole-file baseline 收敛到当前 desired content |
| 目标含未知用户修改 | required fingerprint drift,全量 preflight 零写入 |

### 5. Good/Base/Bad Cases

- Good:session runtime 指向已删除任务目录,shared Hook 输出 `missing_task`;AI 先运行
  `task.py finish`,成功后同轮把当前用户请求按 `no_task` 意图重新分类。
- Base:目标项目没有某个平台的 per-turn Hook 文件,Patch 返回 `missing-target`,不创建平台目录,
  其它已存在平台仍正常升级。
- Base:目标 Hook 等于 Trellis 0.6.5 上游原始内容或上一版 Flower 强化内容,whole-file Patch
  都能通过 baseline 收敛到当前 desired content。
- Bad:把 stale 来源拼成 `stale_session-fallback` workflow-state,导致 workflow 找不到正文并退化为
  `Refer to workflow.md for current step.`。
- Bad:`task.py finish` 成功后询问“下一步做什么”,或直接编辑文件,等于丢失当前用户请求的任务意图。

### 6. Tests Required

- Python Hook 行为测试覆盖 stale `session`、`session-fallback` 归一和权威 breadcrumb 加载;
  普通 `no_task`、planning、in_progress 模板输出保持不变。
- Python CLI 行为测试必须实际执行 `task.py finish`:唯一 `session-fallback` 被清理,多个 session
  保持不变且返回无当前任务,避免只验证提示文本而遗漏恢复动作。
- JS apply 测试覆盖 fresh apply、上一版 Flower Hook 升级、九个平台已有目标、缺平台 skip、
  Codex/Claude SessionStart、两个 intent alias 和第二次运行幂等。
- Python consumer 的真实 catalog preflight 必须断言 `task-intent` 选中完整 stale recovery Patch 集合。
- `npm run sync` 后核对 vendor、`enhancements/0.6`、当前 dogfood workflow/Hook 与 provenance;
  同时运行默认及 strict AI context budget,避免 stale state 复制长 `no_task` 正文。

### 7. Wrong vs Correct

#### Wrong

```python
return task_dir.name, f"stale_{active.source_type}", active.source
```

问题:把诊断来源写进 workflow-state 名称,会生成未声明的动态状态,让 AI 只拿到泛化 fallback。

#### Correct

```python
return task_dir.name, "missing_task", active.source
```

原因:`missing_task` 是固定伪状态;`active.source` 只作为诊断信息保留。workflow 能加载同一个恢复正文,
AI 清理 pointer 后也能继续按 `no_task` 处理当前请求。

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
  - auto-loop 授权只在当前 session runtime 绑定 `current_auto_run`，或全局 auto-loop current 指针能指向唯一 running run 时生效；授权前还必须确认当前 task 位于该 run 的 pending/running 队列中。
  - 当前 session runtime 本身损坏，或 session 显式绑定的 run JSON 损坏/I/O 失败时必须返回结构化 miss 并失败关闭；不得继续读取 prefs、全局 pointer 或其它健康 run，也不得覆盖损坏文件。仅 missing/stale pointer 保留唯一 running run fallback。
  - 默认 stdout 必须保持精简:命中时返回 `status`、当前 `task`、`mode`、决策 `source`,以及可选 `origin`(`runtime` / `route-prefs` / `auto-loop`);未命中返回 `status` + `reason`。完整 `decision`、`path`、`context_key`、`pref_path`、`auto_path`、写回标记等诊断字段只在 `--verbose` 输出。

任务隔离属于 helper 的确定性逻辑,不要把 `task == current_task` 判断扩散到高频 workflow/state 文案里。workflow 维持轻量的 target-matched route 证据规则;`trellis-route` / `route_state.py` 负责 runtime 命中校验、写入清理和默认输出里的 `task` 诊断字段。

### 4. Validation & Error Matrix

| 条件 | 行为 |
|------|------|
| 无 `.trellis/` | 返回 `status=miss/skipped`,不阻断外层流程 |
| 无 current task 或无 session context key | 返回 `no-current-task` / `no-session-context`,继续展示 route 选项 |
| session runtime 文件缺失 | 继续读 prefs/auto-loop 或展示选项 |
| session runtime JSON 损坏或 I/O 失败 | 返回 `session-runtime-corrupt/io_error`,不读 prefs/auto-loop,不覆盖原文件 |
| runtime 的 task / target / source / mode / scope 不匹配 | 返回 miss,不得复用 |
| 同一 session 切换到新任务并写入 implement/check 决策 | 写入前清理其他任务的 runtime route 决策;个人 prefs 不受影响 |
| prefs 缺失或值不合法 | 返回 miss,展示选项 |
| prefs 命中 | 返回 hit,写回 runtime,`origin=route-prefs`,`source=route-prefs` |
| auto-loop running run 存在合法 route_authorization,且当前 task 属于未完成队列 | 返回 hit,写回 runtime,`origin=auto-loop`,`source=auto-loop` |
| session 显式绑定的 auto run JSON 损坏/I/O 失败 | 返回 `session-auto-run-corrupt/io_error`,不得 fallback 到其它 run |
| auto-loop 无绑定 run / 非唯一 running run / mode 不合法 | 返回 miss,展示选项 |
| 用户明确重选 / 临时改 / 清除默认 | 忽略 runtime 和 prefs,重新进入 route 选项 |
| compact 后只剩历史裸数字 `1` 和新的 check 选项摘要 | 不得写入 check route；必须重新展示当前 target 选项并等待紧邻回复 |

### 5. Good/Base/Bad Cases

- Good: 压缩后当前上下文没有 `route_decision`;`resolve --target implement` 命中 runtime,
  输出合法 `task` / `mode` / `source`,agent 直接复用,不重复问用户;需要诊断再加 `--verbose`。
- Base: runtime miss 但 `.route-prefs.tmp` 有 `implement=inline`;`resolve` 返回
  `origin=route-prefs`,`source=route-prefs` 并写回 runtime,后续同 session 直接 runtime hit。
- Base: runtime 和 prefs 都 miss,但当前 session 的 `current_auto_run` 指向 running auto-loop state,且 `route_authorization.implement=subagent`;`resolve` 返回 `origin=auto-loop`,`source=auto-loop` 并写回 runtime。
- Base: session 绑定 run 已 stopped 或缺失,项目中只有一个健康 running run 且包含当前 task;忽略 stale pointer 后允许 fallback。
- Bad: compact summary 里只有“用户选过 inline”;workflow 不得把它当 route 证据,
  必须读取 `trellis-route` 并由 helper 校验 runtime / prefs。
- Bad: implement 阶段用户曾紧邻回复 `1`;后续 check route miss 并发生 compact,
  恢复上下文里出现旧 `1` 和 check 选项摘要时,不得把旧 `1` 当作 check 的
  `numbered-fallback`,也不得写入 `check-all-inline`。
- Bad: 同一 session 里任务 A 的 `route_decisions.check` 还在 runtime 中;切到任务 B 后不得把它当任务 B 的 check 证据。写入任务 B 任一路由时应清理任务 A 的 runtime route 决策。
- Bad: session 绑定的 `auto-bad.json` 已截断,项目中另有 `auto-good.json`;不得把损坏绑定视为 missing 并套用 `auto-good` 授权。

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
  - session 绑定 run 损坏且存在其它健康 run 时,验证 `resolve` 返回 `session-auto-run-corrupt` 且不写 runtime。
  - auto-loop run 不包含当前 task 或队列项已 completed 时,验证授权 miss。
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

## Scenario: Pre-Check Feedback Hold

### 1. Scope / Trigger

- Trigger: Phase 2.1 首次实现必须自动进入 Check-All,但首次检查后的连续产品/UI/交互/
  业务调整需要暂缓下一次完整检查,且压缩或 resume 后不能遗忘最终检查。
- Scope:只调整进入 Phase 2.2 之前的交互决策。Interactive Post-Check Stop Gate、
  Check-All audit-only/collect-all、`CHK-*` 修复重检和 auto-loop runner action 均保持不变。

### 2. Signatures

随 0.6 `scripts/` 分发平台无关 helper:

```bash
python3 ./.trellis/scripts/pre_check_state.py status [--verbose]
python3 ./.trellis/scripts/pre_check_state.py hold --source <user-explicit|follow-up-edit> [--verbose]
python3 ./.trellis/scripts/pre_check_state.py clear [--verbose]
```

Runtime 只增加当前 session 文件中的可选字段:

```json
{
  "pre_check_preference": {
    "version": 1,
    "task": ".trellis/tasks/<task>",
    "mode": "hold",
    "source": "user-explicit | follow-up-edit",
    "updated_at": "<UTC ISO-8601>"
  }
}
```

### 3. Contracts

- 默认行为:
  - 任务首次完成实现和定向验证后,用户未明确暂缓时必须在同一流程进入
    `trellis-route(target=check)`;不得把 Check-All 表述为可选下一步并提前结束。
  - 用户当前消息明确“先不检查”时可覆盖默认,写入 `user-explicit` hold。
  - 首次 Check-All 执行后的第一条追加修改在编辑前写入 `follow-up-edit` hold,无论检查是
    干净通过还是报告了问题;
    不等待第二轮修改,不持久化修改次数。
- hold 是软偏好:
  - 只持久化 `hold`,字段缺失即默认检查;当前消息最新明确意图始终优先。
  - 暂缓期间完成修改和定向验证后停在 Phase 2.2 前,输出一条简短陈述式引导:
    用户可以继续修改;准备检查时说“下一步”或“可以检查了”。不得机械提问或使用
    “收口”等不自然表述。
  - “下一步”“可以检查了”“提交”“部署”或等价继续语义先 clear 再进入检查/后续流程。
  - Check-All 开始后清除 hold;Check-All 问题修复及重检不再进入 Pre-Check gate。
- session 隔离:
  - helper 必须同时校验 `resolve_context_key()` 的直接 context key、当前 active task 和
    preference task。不得用 unique-session fallback 让新 AI session 继承旧 hold。
  - 同一 session/window 的 compact 和 resume 继续命中;不同 context key、任务不匹配、
    完成/归档后 session 清理均忽略或清除旧状态。
  - JSON 写入保留 `current_task`、route、auto-loop 等其它字段,使用同目录临时文件、
    flush/fsync 和 `os.replace`;损坏或 I/O 错误不得覆盖原文件。
- 上下文预算:
  - workflow hub/state 只保存短边界和一跳动作;完整优先级放 Phase 2.1 walkthrough/helper。
  - Codex/Claude SessionStart 通过 helper 的只读 API 恢复。无匹配 hold 时零动态行;
    命中时只追加 `Pre-check: deferred for current task; latest user intent may override.`。
- auto-loop:
  - validated runner 的 `run_implement -> run_check_all`、`run_fix -> run_recheck` 不读取 hold。
  - `trellis-auto-loop` start/resume 前静默调用 `pre_check_state.py clear`;miss/task mismatch
    是 no-op,损坏状态只记录诊断,不得阻断 runner 或增加确认卡点。
  - auto-loop 运行中的显式暂缓使用 runner blocked/retry,不写交互 hold。
- 分发:
  - 真实源先改 `vendor/skill-garden/.trellis/0.6`,再 `npm run sync` 生成快照并应用 dogfood。
  - `copyScriptAssets` 的 `workflow-enhancement`、`task-intent`、`intent-routing`、
    `auto-loop`、`auto-loop-runner`、`trellis-auto-loop` 选择性安装必须携带 helper。

### 4. Validation & Error Matrix

| 条件 | 行为 |
|------|------|
| 首次实现,无显式暂缓/hold | 自动进入 Check-All |
| 当前消息明确暂缓 | 写入 `user-explicit`,停在 Phase 2.2 前并引导 |
| 首次检查后的第一条追加修改 | 编辑前写入 `follow-up-edit`;本轮只做定向验证 |
| 当前消息明确继续/提交/部署 | clear 后立即进入检查或后续流程 |
| 同 context key compact/resume | `status=hit`,SessionStart 注入一行 |
| 新 context key,但仅有一个旧 session 文件 | 不接受 fallback hold,不注入 |
| preference task 与 current task 不同 | `status=miss reason=task-mismatch`,不删除其它任务证据 |
| runtime missing/无 hold | `status=miss`,默认检查 |
| runtime corrupt/I/O error | `status=error`,不覆盖;SessionStart 省略提示并默认检查 |
| auto-loop start/resume 有陈旧 hold | 静默 clear 后 runner 正常推进 |

### 5. Good/Base/Bad Cases

- Good:首次实现通过定向测试后主 agent 直接进入 Check-All;不会像可选建议一样停住。
- Good:第一次 Check-All 执行后,即使报告了待确认问题,用户提出第一处视觉调整时 AI 仍先写
  `follow-up-edit` hold,
  修改并定向验证后提示可以继续改,也可说“下一步”进入检查。
- Good:上述修改过程中发生 compact;同一 session 的 SessionStart 只增加一行提示;
  用户随后说“可以检查了”,AI clear 并进入 Phase 2.2。
- Base:用户第一次实现时明确“先不走 check”;写 `user-explicit` 后正常停在检查前。
- Base:新 AI session 只能通过 active-task unique fallback 看见旧任务;helper 因 direct context key
  不匹配忽略旧 hold,恢复默认检查行为。
- Bad:每轮追加修改都立即跑完整 Check-All并同步三件套,造成重复成本和反馈延迟。
- Bad:把 hold 写入 `task.json` 或长期配置,导致新 session 和其他开发者继承个人交互节奏。
- Bad:auto-loop 读取 hold 并等待用户说“继续”,破坏 runner outstanding action 权威。
- Bad:暂缓完成后询问“是否收口并检查”,把软偏好变成每轮机械选择题。

### 6. Tests Required

- helper 单测覆盖 runtime missing、hold/status、clear、其它 runtime 字段保留、非法 source、
  task mismatch、同 session 恢复、不同 context key 不继承、损坏/I/O 文件不覆盖和写入失败。
- Codex/Claude 真实 SessionStart hook 测试覆盖匹配 hold 单行注入、无 hold 零动态行、
  新 session 不继承唯一旧 session hold。
- Patch/安装测试覆盖双平台 marker、helper 全装 manifest、选择性 workflow/auto-loop alias、
  二次应用幂等和 vendor/snapshot/dogfood 一致。
- 静态回归断言 auto-loop skill 在 start/resume 前 clear,runner 源不读取 pre-check 状态,
  workflow 首次实现默认进入 check 且 Post-Check gate 保持不变。
- 运行 `npm test`、`node scripts/check-ai-context-budget.mjs`、
  `node scripts/check-ai-context-budget.mjs --strict`、Python/JS 语法检查和 `git diff --check`。

### 7. Wrong vs Correct

#### Wrong

```markdown
Implementation is done. Ask the user whether to run Check-All. Persist defer=true
in task.json so future sessions keep waiting.
```

问题:首次实现可能提前结束,硬状态跨 session 泄漏,并把每轮反馈变成机械确认。

#### Correct

```markdown
First implementation defaults to Check-All. After Check-All has run once,
persist only a session-scoped hold for follow-up edits, whether the check passed
cleanly or reported findings; latest user intent and validated auto-loop override it.
```

原因:默认流程完整,高频反馈成本低,压缩可恢复,同时不会把暂缓偏好固化成长期锁。

## Scenario: Audit-Only Check-All

### 1. Scope / Trigger

- Trigger: 0.6 强化包需要让普通、轻量、全面、最终、提交前和 auto-loop 检查都进入
  Check-All,由真实任务、diff、风险和运行上下文智能选择 light/full 深度,同时保持
  audit-only collect-all 和稳定 `CHK-*` 修复循环。
- Scope: `trellis-check-all/SKILL.md` 定义深度策略、检查、报告、修复和 disposition;
  `trellis-route/SKILL.md` 与 `route_state.py` 只决定 inline/subagent 执行位置;
  `trellis-check` 只提供检查清单和验证方法,不能成为顶层轻量逃生口或带入自动修复语义。

### 2. Signatures

check route 只允许以下两个执行位置 mode:

```text
route_decision.target = check
route_decision.mode = check-all-inline | check-all-subagent
```

每次 Check-All 必须产生可审计画像:

```yaml
check_profile:
  context: interactive | auto-loop
  requested_depth: auto | light | full
  effective_depth: light | full
  confidence: high | fallback-full | escalated
  reasons: [string]
```

`route_state.py` 读取历史 runtime / CLI mode 时只做兼容归一化:

```text
check-inline   -> check-all-inline
check-subagent -> check-all-subagent
```

归一化后的 decision 必须只暴露 canonical mode,不得重新 dispatch 顶层 `trellis-check`。

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
- 所有用户可见 check 入口都调用 Check-All。`trellis-route(target=check)` 只决定执行位置,
  用户说 light/full 不创建新的 route mode。
- requested depth 优先使用当前请求内最后一次明确表达:`简单检查` / `轻量检查` /
  `light check` 表示 light;`全面检查` / `全量检查` / `最终检查` / `提交前检查` /
  `full check` 表示 full;其次读取 validated auto-loop action,否则为 auto。单独说
  `check` / `check-all` 只表示进入统一入口。
- effective depth 决策顺序固定:requested full -> full;命中 hard-full -> full;
  requested light 且无 hard-full -> light;requested auto 且高置信满足 light eligibility -> light;
  其它情况 fallback full,不得机械询问用户。
- hard-full 至少包括复杂三件套完整映射、跨层/跨仓/submodule、公共 API/CLI、schema/
  持久化/缓存、迁移/历史数据、权限/安全/资金、并发/状态机/回滚、workflow/skill/hook
  注入、安装/升级/发布/push 控制面、已有 full `CHK-*` 重检和未知影响面。
- light 只有在变更可完整归属、单一局部行为、无 hard-full、引用与回归路径可穷举、
  有定向验证且不在 full 修复链时成立。执行中发现强风险只允许单向升级 full。
- 高置信 light 通过正式满足 Phase 2.2 门禁;未执行维度必须标记 `N/A`,不得伪装成 full。
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
- Check-All 开始时默认 interactive;只有 runner `status` / `next` 验证 running、task 和
  outstanding check action 后才使用 auto-loop context,不得相信摘要或 raw runtime。
- interactive 报告后停止。validated auto-loop 不展示普通修复选择:有问题 `record failed`,
  真正产品/权限/生产副作用/破坏性边界 `record blocked`,无问题 `record ok`;随后立即
  `next`。subagent 只返回报告和 profile,主会话负责 `record + next`。

### 4. Validation & Error Matrix

| 条件 | 行为 |
|------|------|
| 工作区范围内无变更 | 提示无可检查变更并终止,不生成空问题清单 |
| 无 `prd.md` | 三件套实现标记 `N/A`,继续其它适用维度 |
| auto 且高置信局部低风险 | effective light;只追踪受影响条目、引用点、必要回归和定向验证 |
| requested light 命中 hard-full | effective full,confidence escalated,记录升级原因 |
| 无法高置信判断 | fallback full,不询问深度 |
| light 执行中发现影响面扩大 | 单向升级 full,补齐所有适用维度 |
| 历史 runtime mode 为 `check-inline` | 归一为 `check-all-inline`,可复用但不直达 trellis-check |
| 某个 lint/typecheck/test 失败 | 记录命令、退出状态和关键错误,继续其它独立验证 |
| 缺少历史数据或运行环境证据 | 标记 `部分验证` 或 `阻塞`,不得标记通过 |
| 规划冲突导致无法判断正确行为 | 输出统一阻塞报告,只询问解除阻塞所需的业务决策 |
| 验证可能修改生产数据或调用有副作用外部系统 | 不执行,标记阻塞或未覆盖风险 |
| 用户选择部分 `CHK-*` | 只批量修复选中 ID,未选问题保留在重检结果 |
| subagent 只有自修复型 `trellis-check` agent | 禁止 dispatch,让用户改选 `check-all-inline` |
| interactive Check-All 无问题 | 报告画像、通过和剩余风险,指向 Phase 3.3/3.4,停止等待 |
| validated auto-loop Check-All 完成 | 写回 effective depth/result/reason 并立即 next |

### 5. Good/Base/Bad Cases

- Good: 用户先说轻量检查、后改为最终检查;以最后一次表达选择 full,完成三个适用维度。
- Good: 两个验证命令和一个规划对照分别发现问题;Check-All 完成其余安全检查后输出
  `CHK-001` 至 `CHK-003`,用户回复“修复全部”,实现阶段一次修复并统一重检。
- Base: 只改一处 UI 文案且可穷举引用;auto 选择 light,API/历史数据/跨层维度标记
  `N/A`,定向验证通过后正式满足检查门禁。
- Base: 旧 runtime 保存 `check-subagent`;helper 输出 canonical `check-all-subagent`,
  后续仍执行 audit-only Check-All。
- Base: subagent 返回标准只读报告;主会话负责展示清单并询问一次修复范围,subagent 不修改文件。
- Bad: 第一个测试失败后立即问“要不要修”,导致后续 lint、规划和跨层问题未被发现。
- Bad: 用户明确轻量检查后 route 直接 dispatch `trellis-check`,绕过 hard-full 升级和画像。
- Bad: auto-loop 检查结束后套用 interactive stop gate,等待用户说“继续”。
- Bad: `trellis-route` 找不到专用 check-all agent 时改用带自修复语义的 `trellis-check` agent。
- Bad: 报告问题后直接生成 commit message、暂存范围或 push 确认。

### 6. Tests Required

- 静态检查 `trellis-check-all` 的 `.agents` / `.claude` 源副本一致,并确认包含
  requested/effective profile、hard-full、light eligibility、稳定 `CHK-*`、Auto-Loop Return Gate
  先于 Interactive Post-Check Stop Gate。
- 静态检查 `trellis-route` 不再把 `check-all-subagent` fallback 到
  `Agent({subagent_type: "trellis-check"})`,且 dispatch prompt 第一行包含当前任务路径。
- 测试 `route_state.py` 把 `check-inline/check-subagent` 归一为 canonical mode,原 decision
  输入不被原地篡改,resolve 后 runtime 可升级为 canonical 值。
- `npm run sync` 后用 `cmp -s` 确认 vendor 源、`enhancements/0.6` 快照和当前 dogfood
  `.agents` / `.claude` 副本一致;确认 `old` / `0.5` 无漂移。
- 快速路径场景断言未命中 Trigger 的维度为 `N/A`,不会展开无关检查。
- collect-all 场景断言多个独立失败被完整收集,报告只出现一次修复范围选择,检查阶段文件无变化。
- 修复/重检场景断言原问题 ID 保持稳定,修复复用 implement route,重检复用 check route。
- 深度场景覆盖 auto light、显式 full、显式 light 命中 hard-full、fallback full、执行中升级,
  以及 full 修复/blocked retry 不降级。
- disposition 静态/行为测试覆盖 interactive stop 和 validated auto-loop `record + next`。
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
Route every check intent through Check-All, derive an auditable light/full
profile from intent and risk, run every applicable safe read-only dimension,
then either stop once for interactive scope selection or return record + next
to the validated auto-loop runner.
```

原因:检查深度不再与执行位置耦合;用户先看到完整风险面再一次决策,auto-loop 则保持连续推进;
inline/subagent、修复和重检仍服从 Trellis 既有路由与阶段边界。

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
python3 ./.trellis/scripts/auto_loop.py start --tasks <task> [<task> ...] --profile commit-only [--check-depth auto|light|full]
python3 ./.trellis/scripts/auto_loop.py next [--run-id <run-id>] [--verbose]
python3 ./.trellis/scripts/auto_loop.py record --action <action> --result <ok|failed|blocked> [--effective-check-depth light|full] [--check-depth-reason <summary>] [...] [--verbose]
python3 ./.trellis/scripts/auto_loop.py record --action review_open_questions --result <ok|blocked> --review-verdict <resolved|blocking|ambiguous> [--summary <text>]
python3 ./.trellis/scripts/auto_loop.py retry-blocked [--run-id <run-id>] [--task <task>] [--check-depth auto|light|full] [--route-implement inline|subagent] [--route-check check-all-inline|check-all-subagent] [--all] [--verbose]
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
- planning PRD 的 `## Open Questions` 使用确定性 checkbox 契约:`- [ ]` 立即阻塞,`- [x]` 不阻塞,章节缺失或无有效条目直接放行。历史裸列表不得由 Python 关键词表猜语义,必须返回 `review_open_questions` action。
- `review_open_questions` action 必须携带裸列表和 PRD SHA-256。AI 回写 `resolved|blocking|ambiguous`;runner 在 record 时重算 hash,拒绝陈旧判断。`blocking` 与 `ambiguous` 都进入 blocked,修正文档后使用 `retry-blocked` 在同一 run 重跑门禁。
- 新 run 的 `check_depth` 默认 `auto`;显式 `--check-depth` 与 `--route-check` 独立。
  历史 state 缺少或包含非法值时按 full 读取,不要求迁移旧 JSON。
- `run_check_all` / `run_recheck` action 必须输出 `requested_check_depth`;首次检查的
  `minimum_check_depth` 为 null,已有检查记录的 retry/recheck 使用上次 effective depth 作为下限。
- 检查 action 的 record 必须保存 `item.last_check`:action、requested/minimum/effective depth、
  reason、result、recorded_at。旧调用缺 `--effective-check-depth` 时无条件记录
  `full / legacy-default-full`,即使调用方额外传了 reason 也不能覆盖兼容原因。
- requested full 或 minimum full 时,runner 必须拒绝 effective light 并保留 outstanding action;
  不得静默推进或替 agent 猜测结果。
- `route_state.py resolve` 顺序仍是 runtime -> prefs -> running auto-loop 临时授权;但
  session `current_auto_run` 或全局 `current.json` 指向非 running run 时必须忽略 stale pointer,
  再 fallback 扫描唯一 running run。
- route 临时授权必须匹配当前 task 的 pending/running 队列项。session 显式绑定的 run 损坏时失败关闭,不得 fallback 到其它 run;只有 missing/stale pointer 才允许唯一健康 run 恢复。
- auto-loop runtime 写入使用同目录临时文件、flush/fsync 和 `os.replace`;replace 失败保留旧文件。读取必须区分 missing、corrupt 和 I/O error;当前 run 损坏时非 `--force` start 不得创建第二个 run。
- run completed/stopped 后,`auto_loop.py` 只在 current pointer 仍指向本 run 时删除
  `.trellis/.runtime/auto-loop/current.json`;显式 `--run-id` 仍可查看历史 run。
- 队列处理完但存在 blocked item 时,run `status` 必须是 `blocked`,不能伪装成
  `completed`;全 item 本地提交完成才是 `completed`。
- blocked 是同一个 run 的可恢复状态。补齐 route / context / PRD 后,AI 应调用
  `retry-blocked` 把可恢复 blocked item 重置为 `pending`,并继续 `next`;不要用
  `start --force` 新建 run 来纠正漏传参数。
- `retry-blocked` 只写现有 run JSON:合并本次显式 `--route-implement` /
  `--route-check` 到 `route_authorization`,可更新 run 级 `check_depth`,清空 item 的 `blocked` / `last_action`,把 run
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
| Open Questions 包含 `- [ ]` | item 以 `open-questions` blocked |
| Open Questions 只有 `- [x]`、空章节或无章节 | 继续 `start_task` |
| Open Questions 是历史裸列表 | 返回带 PRD hash 的 `review_open_questions` action |
| AI review 为 blocking/ambiguous | 分别以 `open-questions` / `open-questions-ambiguous` blocked |
| review 后 PRD 内容变化 | record 返回 `stale-open-questions-review`,不得推进 |
| 新 run 未传 `--check-depth` | 保存 `check_depth=auto` |
| 旧 run 缺 `check_depth` | requested depth 按 full,不得静默变 light |
| record 缺 effective depth但带自定义 reason | 保存 `full / legacy-default-full`,忽略自定义 reason |
| requested/minimum full 却 record light | 返回 `check-depth-below-minimum`,outstanding action 保留 |
| full 检查 blocked 后 retry 同一 action | `minimum_check_depth=full`,不得重新降级 |
| 启动漏传临时 route 导致 `missing-implement-context` / `missing-check-context` | `retry-blocked --route-implement ... --route-check ...` 复用同一 run |
| 队列项 blocked 但 blocked reason 是非门禁类问题 | 默认不自动重试;指定 `--task` 或 `--all` 才重置 |
| 多个历史 run 且无 current/running | `status` 返回最近 run 列表,不报 `status-failed` |
| current.json 指向 completed/stopped run | route helper 忽略 stale pointer,扫描唯一 running run |
| session 绑定的 run JSON 损坏但存在其它健康 run | route helper 返回结构化 miss,不得套用其它 run 授权 |
| 当前 run JSON 损坏后 start 新 run | 非 force 返回 `current-auto-state-invalid`,保留损坏文件 |
| run completed/stopped | 清理仍指向本 run 的 current pointer |
| commit_only 时 staged 区已有文件 | auto-loop 记录当前 item blocked,不提交,queue 可继续 |
| commit_only 无法解释某个 dirty 文件归属 | 保留未提交或 blocked,不得猜测纳入 planned files |
| commit_only 发现非当前任务 `.trellis/tasks/**` | 保留未提交并记录 retained files |
| commit_only 成功 | trellis-push 本地 exact commit;auto-loop 回写 runner commit hash、files/message 和 decision_log |
| 多任务第一个 item blocked | `next` 继续后续 pending item,最终 summary 汇总 blocked/unarchived |

### 5. Good/Base/Bad Cases

- Good: 用户启动 auto-loop 前已有 `.route-prefs.tmp implement=inline`;`trellis-route` resolve
  写回 runtime,runner 启动后记录真实 `route_resolved`。
- Good: run 使用 `check_depth=auto`,局部检查 effective light 通过后 record `last_check`,立即
  next 到 spec_update;后续任务无需用户确认。
- Good: requested light 命中 workflow 控制面升级 full,失败后 run_fix -> run_recheck,
  recheck action 保持 minimum full。
- Good: 第一个任务 commit-only 因 staged 区不空 blocked;runner summary 记录 blocked,`next`
  继续第二个 pending 任务。
- Good: 第一次 start 漏传 inline route,三个 planning task 因 seed-only JSONL blocked;AI
  执行 `retry-blocked --route-implement inline --route-check check-all-inline`,同一个
  `run_id` 继续,目录中不新增第二个 `auto-*.json`。
- Good:历史 PRD 写 `- 无。当前实现口径已确认。`;runner 返回 review action,AI 以 `resolved` 结构化回写后进入 `start_task`。
- Base: run completed 后用户查 `auto_loop.py status --run-id auto-...` 仍可读历史结果;无
  `--run-id` 时不会让 stale current 影响新 run。
- Bad: `trellis-auto-loop` skill 默认传 `--route-implement subagent`;这绕过用户真实 route。
- Bad: Check-All 返回后先展示 interactive 修复菜单,未执行 runner record/next。
- Bad: 旧 record 未传 effective depth但把调用方 reason 当作可信深度证据。
- Bad: run blocked 后直接 `start --force` 启动同一任务队列,产生多个 JSON,用户难以判断哪次
  是权威状态。
- Bad:Python 看到 `无问题`、`TBD` 等词就自行放行或阻断;历史裸列表必须交给 AI review,并绑定当前 PRD hash。
- Bad: 主 agent 看到 `commit_only` action 后手动 `git add . && git commit`;这绕过
  `trellis-push` 边界且可能混入无关文件。

### 6. Tests Required

- Python runner 测试覆盖 auto light pass、legacy full fallback、failed -> fix -> full recheck、
  blocked full retry、retry 更新 check depth、多任务检查通过后无确认续跑。
- Open Questions 测试覆盖 unchecked/checked/空/无章节/TBD、resolved/blocking/ambiguous、stale hash 和 retry-blocked 后重新门禁。
- runtime/route 测试覆盖损坏 current run 阻止新 run、损坏 pointer 唯一恢复、session 绑定 run 损坏不 fallback、task mismatch/completed item 不授权、replace 失败保留旧文件。
- 健康集成回归必须覆盖 create -> active -> auto-loop `start_task` -> record/next,证明写入完整性修复不改变正常链路。
- 断言缺 effective depth时 reason 固定为 `legacy-default-full`;minimum full 时 light record 被拒绝。
- 静态测试检查 auto-loop skill 的 start/retry/record 参数、Check-All profile 和 workflow gate 顺序。
- `npm run sync` 后比较 vendor、enhancements 和 dogfood runner/skill;重复 enhance-only 后 diff hash 不变。

### 7. Wrong vs Correct

**Wrong**:auto-loop 只保存 check route,检查后依赖聊天摘要判断该跑 light/full,并套用普通停止门禁。

**Correct**:runner 保存 run 级 requested depth和 item 级 effective result;Check-All 完成后匹配
outstanding action 执行 `record + next`,交互式停止只在非 validated auto-loop 生效。

**Wrong**:把历史 Open Questions 裸列表直接当作非空即阻塞,或用少量关键词在 Python 中推断自然语言。

**Correct**:checkbox 走确定性解析;裸列表返回带 PRD hash 的 AI review action,结果结构化回写,无法判断时保守阻塞。

---

## Scenario: Autonomous Update-Spec And Post-Check Resume

### 1. Scope / Trigger

- Trigger:interactive Check-All 通过后需要保留用户继续卡点,但用户回复“下一步”后不应再次询问
  是否更新 spec,也不应在 Update-Spec 与 Trellis Push 之间再停一次。
- Scope:`overrides/patches/skills/trellis-update-spec/autonomous-evaluation/` 保存自主三态、证据、最小写入和自校验;
  workflow hub/state 只保存停止点与 resume-chain;auto-loop skill/runner 保存确定性 record 映射;
  Patch Engine 和独立 Python consumer 负责替换已有上游入口。

### 2. Signatures

Update-Spec 结果固定为:

```yaml
spec_update_result:
  status: no-op | written | needs-review
  reason: string
  evidence: [string]
  changed_files: [path]
  validation: [string]
```

普通流程:

```text
Check-All passed -> report + stop -> user next/continue
  -> trellis-update-spec
     no-op/written -> trellis-push plan in the same turn
     needs-review  -> one focused question, no Push plan
```

auto-loop 保持原 action 顺序:

```text
run_check_all -> run_spec_update -> commit_only
  no-op/written -> record ok -> next
  needs-review  -> record blocked(spec-needs-review)
```

### 3. Contracts

- Check-All 的 interactive stop 不变:通过报告输出后仍等待用户继续,不得提前运行 Update-Spec。
- 通过后用户表达 next/continue 或直接要求 push 时,若没有当前有效结果,同一轮必须先调用
  `trellis-update-spec`;不得询问“是否更新 spec”或先生成提交计划。
- `no-op` 用于无可复用契约、现有 spec 已覆盖、一次性实现、纯文案/格式变化或用户当前明确
  skip;不得为了避免 no-op 写原则性总结。
- `written` 只在代码/测试证据充分且目标权威 spec 唯一时成立。新增修改只能位于
  `.trellis/spec/**`,并且只改承载新契约所需的最小章节和最少文件;不得顺带整理、扩写或格式化
  无关内容。新增 spec 文件时同步对应 index。
- `needs-review` 只用于目标、语义、冲突或验证失败无法从仓库证据唯一解决的情况,只问一个
  解除当前歧义所需的问题。
- 证据顺序固定为任务 JSONL 引用 -> prd/design/implement -> Check-All 证据 -> 实际 diff、源码、
  测试/提交 -> `spec_router.py` 命中的现有 spec/index。聊天摘要和任务标题不能单独授权写入。
- `written` 返回前必须复读 spec diff、反向核对源码/测试并运行
  `git diff --check -- .trellis/spec`;适用时继续跑 index/link、签名或项目专用验证。无法唯一修复
  时降为 `needs-review`,越界修改不得进入 Push。spec 写入后不额外触发一次人工 Check-All。
- interactive 的 `no-op` / `written` 在同一轮加载 `trellis-push`,但最终 exact plan 确认不变;
  `needs-review` 不得进入 Phase 3.4。已有仍有效结果不重复运行,证据或用户意图变化后重新求值。
- auto-loop 必须调用同一三态协议:`no-op` / `written` record ok 后立即 next;
  `needs-review` record blocked 且 failure-type 固定为 `spec-needs-review`。
- override 源只维护增量块,不复制上游整份 skill。flower 与独立安装器的全装和三个精细别名
  必须一致;agents/claude/command 入口存在才注入,不存在时跳过且不创建平台入口。
- 真实源先改 `vendor/skill-garden/.trellis/0.6`,再 `npm run sync` 和 dogfood update;
  `enhancements/0.6`、当前 `.agents/.claude` 与 vendor 语义一致,0.5/old 不变。

### 4. Validation & Error Matrix

| 条件 | 行为 |
|------|------|
| Check-All passed,用户尚未继续 | 报告并停止,不运行 Update-Spec |
| 用户 next/continue,无新契约 | 返回 no-op,同轮进入 Trellis Push |
| 新契约有代码/测试证据且目标唯一 | 最小 written + 自校验,同轮进入 Trellis Push |
| 现有 spec 已完整覆盖 | no-op,不得重复写同义内容 |
| 目标 spec 或业务语义不唯一 | needs-review,只问一个问题,不生成 Push 计划 |
| 用户通过后直接要求 push,无当前结果 | 先补跑 Update-Spec,不得绕过 Phase 3.3 |
| Update-Spec 新增非 `.trellis/spec/**` 修改 | needs-review/boundary-violation,停止并返回检查流程,不得进入 Push |
| written 自校验失败且修复不唯一 | needs-review,不得伪报 written |
| validated auto-loop 得到 no-op/written | `record ok -> next` |
| validated auto-loop 得到 needs-review | `record blocked --failure-type spec-needs-review` |
| 精细安装目标入口不存在 | 结构化 skip,不创建 skill/command |

### 5. Good/Base/Bad Cases

- Good:Check-All 通过后先停止;用户说“下一步”,Update-Spec 判断现有规范已覆盖并返回 no-op,
  同一轮展示 Trellis Push 计划。
- Good:实现新增确定性 CLI 契约;Update-Spec 只更新现有权威场景的一个章节,定向验证通过后
  返回 written 并进入 Push。
- Base:用户明确“不更新 spec,直接走”;结果为 no-op/user-explicit-skip,随后仍由 Trellis Push
  展示最终确认。
- Bad:Check-All 报告刚输出就自动写 spec,提前越过用户继续卡点。
- Bad:为了让每次任务都有 spec diff,重写整份规范或顺带格式化无关章节。
- Bad:Update-Spec 返回 needs-review 后仍生成提交计划,或 auto-loop 把它记录成 ok。

### 6. Tests Required

- 静态断言 override 包含三态、证据顺序、`.trellis/spec/**`、最小修改、self-validation、
  interactive/auto-loop disposition。
- 静态断言 Check-All 仍含 Interactive Post-Check Stop Gate;workflow 在该 gate 内包含
  next/continue -> Update-Spec -> Push,且位于 Code Commit Confirmation Gate 之前。
- JS consumer 覆盖全装、三个精细别名、agents/claude/command、缺目标和二次运行幂等。
- Python 独立安装器覆盖相同别名、目标和 skip 行为。
- auto-loop 静态/行为测试覆盖 no-op/written ok+next 与 needs-review blocked。
- `npm run sync` 后比较 vendor/snapshot/dogfood;重复 enhance-only 的相关文件 hash 不变。
- 运行 `npm test`、默认/strict AI context budget、JS/Python/Bash 语法与 `git diff --check`。

### 7. Wrong vs Correct

#### Wrong

```text
Check-All passed -> auto Update-Spec -> ask whether to write -> stop -> ask whether to push
```

问题:提前越过既有 post-check 停止点,用户继续后仍保留两个机械卡点。

#### Correct

```text
Check-All passed -> report + stop -> user next
  -> autonomous Update-Spec(no-op/written/needs-review)
  -> no-op/written loads Trellis Push in the same turn
```

原因:保留唯一用户继续边界和最终 Git 确认,把中间可由仓库证据决定的步骤自动化。

---

## Scenario: Minimal Trellis Push And Task Progress

### 1. Scope / Trigger

- Trigger:普通 `trellis-check` / `trellis-check-all` 完成后,主 agent 可能绕过 Phase 3.4
  `trellis-push`,自行草拟 `Proposed commits`、commit message 和 commit-only 确认;大型或多仓
  计划也可能把普通文件全部铺开,造成高噪声输出。
- Scope:workflow hub Patch 与 in-progress state Patch 负责 post-check / Phase 3.4 硬门禁;
  `trellis-check-all` 负责纯检查汇总;`trellis-push` 只负责 exact plan、一次确认、业务 Git
  动作和普通 push 后的 task progress trigger;`task_progress.py` 只负责窄 schema 读写;
  `trellis-auto-loop` 仍只使用本地 commit-only 预授权。

### 2. Signatures

普通流程状态序列:

```text
trellis-check-all
  -> post-check report + stop
  -> user continue -> autonomous Phase 3.3 trellis-update-spec
  -> Phase 3.4 trellis-push plan
  -> user confirmation
  -> exact git add / git commit --only / push
  -> exact current-task record / progress commit / push
```

普通多仓计划可以在仓库间展示一个本地生成命令；命令成功且生成后的 dirty paths 未超出预计 exact files 时沿用同一次确认。

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
- Check-All 通过后的停止点不变;用户继续后 Phase 3.3 自主返回三态,no-op/written 同轮加载
  `trellis-push`,needs-review 停止。详细判断和写入边界由上一场景与 Update-Spec override 所有。
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
- 普通模式存在活动任务时,当前任务目录中可归属的 dirty/untracked 产物与预计由 helper 更新的
  `task.json` 组成独立任务记录 exact files。它们不进入业务 commit,也不显示为 retained;
  其他任务目录和无关 dirty/staged 文件保持原状。计划顶部的仓库/commit/file 总数必须包含
  任务记录提交所在 Git root、该提交和 exact files,并展示固定 message、branch/upstream 与
  exact files 或同一 exact set 的分组摘要。
- 当前任务目录可能整体未跟踪,默认 `git status --short` 会把它折叠为 `?? <task-dir>/`。
  发现任务记录 exact files 时必须运行
  `git status --short --untracked-files=all -- <task-dir>`,并拒绝把折叠目录当成文件、展示条目
  或 pathspec。
- 普通 `PUSH` 的多仓计划可用一行展示本地生成命令、工作目录和后续仓预计 exact files;
  仅在后续仓 `retained=0` 时使用,未知内容与增删行显示“生成后计算”。
- 前置仓成功后运行已展示命令并复用现有提交前预检。命令成功且后续仓 dirty paths 未超出
  预计 exact files 时直接继续;出现计划外路径或现有计划边界变化时重新规划。内容/hash/统计变化不重问。
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
  尚无成功 Git 动作时不得伪造 completed steps。progress 使用固定 message 对首次确认的当前
  任务 exact files 生成独立 commit 并立即 push,不增加第二次确认;该集合包含 helper 更新后的
  `task.json` 和首次计划时已存在且可归属的当前任务产物。finish-work 负责后续 release audit、
  archive 移动和 journal,不能作为普通 push 延后当前任务规划产物首次入库的理由。
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
| 生成命令后 dirty paths 未超出预计 exact files | 复用现有预检并继续,不二次确认 |
| 后续仓存在 retained dirty、命令失败或出现计划外 dirty path | 不使用旧确认,重新规划 |
| 当前任务存在 dirty/untracked 规划产物 | 纳入任务记录 exact files,不显示为 retained |
| 当前任务目录整体未跟踪 | 使用 `--untracked-files=all` 展开文件级 exact set,不得提交目录 pathspec |
| 其他任务目录存在 dirty/untracked 文件 | 保持 retained,不得进入当前任务记录提交 |
| 业务结束后当前任务 exact path set 扩大 | 原确认失效,重新生成并确认计划 |
| 普通模式存在计划外 staged 文件 | `git commit --only` 提交 exact planned files,保留原 staged 列表 |
| 无活动任务且 dirty 来源不明 | 全部放入 unrecognized,默认不提交 |
| 多仓第二仓执行失败且第一仓已 push | 保留第一仓结果,写 partial progress 与下一恢复动作 |
| 业务动作成功但 progress push 失败 | 不回滚业务提交;单独报告 progress sync failed |
| progress JSON 带额外字段 | helper 拒绝写入,防止旧 Git 编排状态混入 |
| 只有 legacy `last_push_snapshot` | status 映射为新 summary;下一次成功 write 迁移为 `progress` |

### 5. Good/Base/Bad Cases

- Good:check-all 通过后只报告三维检查、验证命令、Redis 未实机验证风险和下一步,等待用户;
  用户继续后自动完成 Phase 3.3,no-op/written 同轮进入 `trellis-push`。
- Good:单仓 20 个普通 planned files 按目录压成 6 行,2 个未识别 dirty 文件仍逐项展示;
  用户回复“展开文件”后看到原 20 个 exact paths。
- Good:两个业务仓库各自拥有 commit message 和 branch/upstream,顶部显示执行顺序和一行任务
  progress,用户只确认一次;业务 push 后自动生成独立 progress commit/push。
- Good:`skill-garden` push 后按计划运行 `npm run sync`;生成后没有计划外 dirty path,直接继续
  `flower-trellis` commit/push,不要求第二次确认。
- Good:当前任务有 2 个业务 planned files 和 6 个 untracked 任务产物,另一个规划任务有
  untracked 文件且 index 中有 1 个无关 staged 文件;业务 commit 只提交 2 个 planned files,
  随后的任务记录 commit 提交 6 个任务产物与更新后的 `task.json`,另一个任务和 staged 文件
  仍显示为 retained 并保持原状。
- Base:无活动任务但当前会话明确修改 2 个文件,它们进入 planned;仓库中另外 3 个旧 dirty
  文件进入 unrecognized 并排除。
- Bad:check-all 汇总后直接输出 `Proposed commits` 并说“不会推送”;这同时绕过 post-check、
  Phase 3.3 和 `trellis-push` 默认 push 语义。
- Bad:为了缩短输出把 staged/conflict 文件折叠成“其他 12 个文件”;风险范围不可审计。
- Bad:普通计划沿用 auto-loop 的 commit-only 文案;auto-loop 预授权不能泄漏到普通流程。
- Bad:为减少一次确认增加独立中间步骤流程、验证协议或新状态;现有计划和提交前预检已经足够。
- Bad:生成后出现预计列表外文件仍沿用旧确认,或仅因预计文件的 hash/统计变化重复询问用户。
- Bad:progress 记录 business commit hash 或 push mode,再让 finish-work 根据它决定是否 push。

### 6. Tests Required

- `git diff --check`
- `npm run sync` 后确认 vendor、`enhancements/0.6`、当前 `.agents` / `.claude` 对应 skill
  和 workflow override 语义一致。
- 静态扫描 post-check 文案,确认只允许检查结果/验证/风险/结论/下一步,且禁止
  `Proposed commits`、commit message、planned files 和提交确认。
- 静态扫描用户继续后的 resume-chain,确认 Update-Spec no-op/written 同轮加载
  `trellis-push`,且缺少当前结果时不能直接进入 Phase 3.4。
- 静态扫描 Phase 3.4 文案,确认必须加载 `trellis-push`,普通默认 push,commit-only 仅来自
  明确用户意图或合法 auto-loop 预授权。
- 静态扫描 hub 与 in-progress states,确认明确整段覆盖下层 `Proposed commits`、local-only、
  no-push walkthrough,而不是只依赖隐含优先级。
- 静态扫描 hub,确认只引用 `trellis-push` 的格式所有权和必要 Git 门禁,不重复 skill 的展示细节。
- 用 8 个、9 个和超过 12 个目录分组行的模拟计划验证展示阈值;风险文件始终逐项显示。
- 模拟单仓、多仓、无活动任务、用户展开文件、计划漂移、部分仓库失败六类输出。
- 模拟普通多仓生成命令:生成后 dirty paths 未超出预计 exact files 时只确认一次;新增计划外
  dirty path 时停止并重新规划。静态确认 skill 没有独立 `Step 4.1`、validation 协议或新状态。
- 静态验证计划和结果模板保留原有总览/分仓结构,用户可见文本不单独使用裸 `retained`,
  retained dirty 与真正 risk 分区展示。
- 在临时 Git 仓库验证 `git commit --only -- <planned files>` 不消费计划外 staged 文件,
  并验证 retained-only 变化不会触发计划重确认。
- `python3 -m py_compile` 验证 `task_progress.py`;临时任务覆盖新 progress 读写、额外字段拒绝、
  legacy 读取与下一次 write 迁移。
- 临时多仓/裸远端覆盖普通成功、部分失败、progress sync 失败和显式 commit-only;验证 progress
  commit 只包含首次确认的当前任务产物与更新后的 `task.json`,其他任务保持原状;commit-only
  不 push 也不生成远端 progress。
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
下一步:继续后自动执行 Phase 3.3,再进入 Phase 3.4 trellis-push。
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

原因:check 报告与 Git 计划职责分离,Phase 3.3 只在用户继续后自主求值,Phase 3.4 的默认 push、
文件范围和确认都由唯一入口负责。

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
