# 本任务相关项目契约摘录

以下为规划时项目规范的逐段摘录，避免大文件注入被截断。原文路径与行号保留；本任务明确改变的旧 worktree 行为由评审后的 design.md 所有，其余约束继续适用。


## 来源：.trellis/spec/flower-trellis/cli/config-and-state.md:567

### 3. Contracts

- `status` 只读；稳定状态为 `ready-local`、`needs-init`、`needs-prepare`、
  `needs-migration`、`blocked`、`error`。输出稳定包含 target/Git 身份、branch、HEAD、entry、
  local state、legacy、registry、actions、conflicts 和 reason，不再输出新流程 `sourceRoot`。
- `--target` 可指向 worktree 根、子目录或文件；缺省为当前目录。target 必须解析到 Git worktree
  toplevel，非 Git 目录返回 `reason=not-git-worktree`。
- `.trellis` 必须是当前 worktree 的真实目录；平台入口按目标 `.template-hashes.json` 和当前真实
  目录识别，未启用平台可以缺失。任何整目录 symlink 一律进入 legacy 或 conflict 分支。
- Hook、untracked helper 等向上解析项目根时，必须先检查当前目录的本地 `.trellis`，随后在遇到
  第一个 `.git` 文件、目录或 symlink 时停止；不得越过嵌套仓库 / linked worktree 边界命中父项目。
- Flower `worktree` facade 作为外部 bootstrap 入口时，不得从目标目录的生成文件推断 Python
  命令；目标可能仍是 legacy symlink。只允许使用显式 `TRELLIS_PYTHON_CMD` 或当前平台默认值。
- `prepare` 默认只创建目标自己的 `.trellis/.developer`、`.trellis/.runtime/sessions` 和 registry
  元数据；身份来自 `--developer`、目标本地文件或 common registry，不读取其它 worktree 文件。
  显式 `--inherit-route-prefs` 时，Flower facade 把当前控制 worktree 作为 engine `--source`；同时显式
  `--inherit-flower --source <path>` 时使用该同仓来源。engine
  必须先验证 source/target canonical git-common-dir 和开发者身份相同，再读取 source 的普通文件
  `.trellis/.route-prefs.tmp`。目标偏好已存在时保留，来源缺失或无合法值时完成 prepare 但报告未继承。
  获取 registry 锁后必须重新读取并校验 registry，再进行任何目标本地写入。
- `.flower` 缺失单独作为 Flower 安装记录不完整处理，即使模板声明过该目录也不据此要求重装 Trellis。
  `ready-local` 不证明 Flower 完整；skill 对 `flower.installation=incomplete` 也必须处理补配。
- create 默认把 Flower 继承纳入计划；prepare 仅在 `--inherit-flower --source <path>` 下继承。
  源/目标 canonical Git common dir 必须相同。白名单为缺失的 plugins、plugin-lock、state；settings
  仅在同开发者且目标缺失时继承规范化 updateCheck 策略。目标已有记录保留原字节与权限，部分记录
  必须与整个来源安装集合一致，不拼接不同版本。源记录缺失返回 unavailable，损坏或冲突失败。
- 继承前使用 Flower 既有 schema、lock 可达性及状态摘要规则校验声明、lock、state、平台和内容选择。
  源与目标的受管文件/目录/Patch 必须匹配；校验所有祖先路径，不跟随跨 worktree 软链接。
  本地 Plugin 来源必须在目标存在且内容与来源一致。不能仅复制版本记录冒充已安装，也不调用 replay、
  下载包或复制插件内容补平分支差异。源或目标存在 trellis-control 时停止继承，保留恢复语义。
- Flower JS 随包服务拥有完整校验和写入；facade 提供自身 Node 与服务路径，由 Python engine 在生命周期
  内通过 JSON 调用。不得从目标分支加载适配器；直接 engine 缺少适配器时，Flower 继承明确要求外部 CLI，
  纯 Trellis 仍可准备。status 单独返回版本来源和 complete/incomplete/invalid；无适配器为 unchecked。
- facade 固定 `FLOWER_WORKTREE_NODE=process.execPath` 和 `FLOWER_WORKTREE_HELPER` 为自身随包服务，
  覆盖继承环境中的同名值。内部 stdin JSON 的 `operation=status|plan|apply|rollback`；成功必须返回
  `{ok:true,result:{...}}` 且退出 0，非法结果或 60 秒超时返回 `flower-adapter-failed`。
  `localStateTransfer.flower.action` 为 `inherited|preserved|unavailable|notRequested`；有计划时包含
  `source`、`paths`、`digest`、`validationPending` 和 `reason`，回执不进入公开结果。
  冲突沿用顶层 `status=error` 与 `reason/path`，不伪装成成功结果中的 blocked action。
- 安装载荷原始字节摘要进入 create 指纹；忽略或未提交的白名单记录变化也使旧计划失效。
  checkout 后、task 创建前重新验证目标。prepare 用项目外回执记录写入 inode 与摘要，失败仅清理本轮
  创建且未被修改的文件；适配器输出丢失也能从回执恢复。已有忽略规则不覆盖 state 时拒绝写入，
  缺少局部 `.flower/.gitignore` 时生成标准规则，不改根忽略策略，不复制缓存或事务。
- schema v1 `.trellis-worktree.json` 只读兼容。自动迁移要求 manifest target/path 白名单有效、
  symlink 仍指向 manifest 声明来源，并且目标分支 `HEAD` 能重建全部受管真实目录。
  旧 `sourceRoot` 只用于验证 symlink，禁止作为迁移内容源。
- `_same_symlink_target(link: Path, expected: Path) -> bool` 读取 `os.readlink(link)`，相对目标以
  `link.parent` 为基准，再用 `actual.samefile(expected)` 校验文件身份。Windows 3.12 的 `resolve()`
  可能保留 `\\?\` 前缀，不能用两侧解析后路径的文本相等替代身份校验；readlink/stat 的 `OSError`
  返回 False，双方均缺失也不能视为相同。manifest 白名单和目标 HEAD 内容来源合同保持不变。
- 迁移先在目标项目外临时目录执行 `git archive HEAD` 和内容验证，再事务替换 symlink；成功删除
  v1 manifest，失败恢复原链接和 manifest。新流程不再创建 worktree manifest。
- registry 固定为 `{schemaVersion:1,developer?,worktrees:{<id>:{path,gitDir,branch,head,task,
  trellisVersion,updatedAt}}}`；ID 从 canonical git-dir 哈希派生，写入使用同目录临时文件、
  `fsync` 和原子替换。
- registry 写入前必须全表校验：同一 worktree ID 的 path/gitDir 不得漂移，不同 ID 不得复用
  path 或 gitDir，同一 task 路径不得绑定多个 worktree，非对象条目必须失败关闭。
- registry 写操作先用原子 `mkdir` 获取 `registry.lock/`；无法可靠证明旧 owner 已退出时必须阻断，
  不得无锁覆盖。
- `create` 必须在 task 规划文件产生前运行，并固定为两阶段：不带 `--yes` 时只读返回
  `status=confirmation-required`、`changed=false`、`requiresConfirmation=true` 和 plan fingerprint；真实
  创建必须同时传 `--yes --plan-fingerprint <sha256>`。engine 重新计算完整计划，任一事实变化都返回
  `reason=create-plan-changed` 和最新计划，且零写入。
- `create --base` 缺省时使用来源当前分支；来源 detached 时回退 `HEAD`。计划必须展示 source 仓名、
  canonical path、branch、HEAD，requested/effective base 与 resolved commit，以及 target branch/path/task。
  来源根仓 tracked/staged/untracked/conflict 状态只作为 warning，明确 `includedInBase=false`；不得 stash、
  提交或把 dirty 自动升级为 blocker。只有单独列入 Flower 继承计划的白名单记录可作为目标候选，
  其它 dirty 内容不得复制。
- 计划必须按 selected base commit 盘点根仓与 mode `160000` gitlink，记录各 repository name/path/base
  commit；根仓固定 `selected=true`、`createsBranch=true` 并记录 target branch，submodule 固定
  `selected=false`、`createsBranch=false`、`targetBranch=null`。已初始化来源 submodule 额外记录
  branch/HEAD，但不得 fetch、checkout 或复制 working tree。
- create/prepare 的个人偏好限于规范化 Flower 更新策略及 `.trellis/.route-prefs.tmp`。后者只读取普通文件，只接受
  `implement=inline|subagent` 和 `check=check-all-inline|check-all-subagent`，按 implement/check 固定顺序
  重写规范值，禁止复制原始字节。create 仅在目标 developer 与来源 `.developer` 相同时自动继承。
- 不继承 current task/session、untracked/pre-check/auto-loop/Ralph、agent 临时状态、Flower control/detached 状态、
  `.claude/settings.local.json`、cache、transaction 或 backup。handoff 必须返回 cwd、workspaceRoot、
  `requiresNewSession=true` 和原因；目标后续规划必须在新会话开始。
- 确认后执行顺序为：校验 path/branch/base/fingerprint -> `git worktree add -b` -> local readiness ->
  目标 developer/runtime/规范化 route 偏好 -> 校验并继承 Flower -> `task.py create --no-start` -> `set-branch` -> registry ->
  handoff。失败只逆序清理本轮创建的 task/worktree/branch/registry。
- `remove` 要求 registry 精确匹配、Git clean、无活动 session/锁，且绑定 task 不处于 planning 或
  in_progress；主 worktree 和唯一 worktree 永远不得通过该命令移除。成功只移除 worktree 和
  registry 条目，保留 branch。Git remove 后若 registry 提交失败，必须用原 branch/HEAD 重建
  worktree，并恢复删除前快照中的 gitignored Trellis/平台本地状态；补偿不完整时返回独立 reason。
- hook 和 `untracked_flow.py` 只能向上查找当前 cwd 本地 `.trellis`。Hook 已加载但 cwd 缺本地
  Trellis 时输出 `worktree-local-trellis-missing` bootstrap 诊断，不读取其它 worktree workflow/runtime。



## 来源：.trellis/spec/flower-trellis/cli/flower-plugin-runtime.md:131

### Platform And Install Plan

- 平台名单只从 `ENHANCEMENT_SKILL_TARGETS` 派生。显式 `--platform` 必须全部合法；未显式选择时
  按每个逻辑平台的原生检测路径判断。共享物理 Skill root 只用于 target 去重，不能把全部消费者
  视为已启用，也不能让 Plugin 自己生成的平台文件成为下一次检测证据。
- 生命周期平台优先级固定为“本轮显式选择 -> 既有 Plugin state 实际平台 -> 首次安装自动检测”。
  update/replay/remove 不得依赖受管 Skill 目录反推平台；否则共享 root 收窄后会让已安装 Plugin
  无法更新或删除。Skill-Garden wrapper 可以显式传入重新检测结果，用于纠正旧的错误 state。
- `resolveSkillGardenPlatforms(projectRoot)` 是 Skill-Garden wrapper 的平台事实入口：优先使用
  Trellis `getConfiguredPlatforms()` 从 `.trellis/.template-hashes.json` 推导当前模板配置，并将
  `claude-code` 映射为 Plugin 平台 `claude`；只有缺少 hash 证据或读取失败时，才回退到
  `detectPluginPlatforms()` 的原生检测和 Claude compatibility fallback。不得让既有
  `.flower/state.json` 的污染平台列表成为 Skill-Garden update 的默认事实源。
- 完全没有可用平台时返回 `PLUGIN_PLATFORM_SELECTION_REQUIRED`，不得沿用增强链的 Claude fallback，也不得创建 `.trellis/` 或安装 `skill-garden`。
- 多个逻辑平台共享同一物理 root 时只生成一个 mutation，并在 provenance 中保留全部逻辑平台。
- `createInstallPlan()` 在写盘前统一检查安全相对路径、父路径软链、同目标多 owner/内容、文件目录前缀、现有用户文件和 state ownership。
- 普通内容与后续 Patch mutation 必须进入同一个 `InstallPlan`；不能建立第二套 writer 或依赖写入顺序解决冲突。

### Transaction And Lifecycle

- 所有目标、声明、lock 和 state 在任何写入前完成解析、包摘要、平台、payload 和冲突 preflight。
- `TransactionWriter` 写前复核 target/directory before hash 和 payload after hash；任一漂移时不得创建成功 state。
- 安装态目录摘要与包来源 `integrity` 是两套口径：包摘要走严格 canonical tree，任何多余文件都改变摘要；
  受管目录的 ownership / drift 判定必须忽略解释器就地生成的 `__pycache__` 与 `.pyc`，否则执行过受管
  Python 脚本的项目会被误判为「目录已被用户修改」，硬阻断 replay、update 与 Trellis enable。
  既然摘要忽略这类产物，`directoryRemovals` 删除受管目录前也必须先清掉它们，避免非递归 `rmdir` 报 `ENOTEMPTY`。
- 写入顺序固定为目标 mutation、`plugins.json`、`plugin-lock.json`、最后 `state.json`。失败时逆序恢复；恢复不完整时保留 `.flower/transactions/<id>/` 证据并返回 repair blocker。
- `dryRun` 返回同一 graph、plan、changes 和 diagnostics，但不创建 `.flower/`、事务目录或目标文件。
- changed-only：before/after hash 相同的目标不重写；空项目 `plugin update` 返回 `unchanged`，且不初始化 Runtime。
- `remove` 只删除 state 中归属当前 Plugin 且当前 hash 仍匹配的路径，并只清理不再从当前声明可达的传递依赖。孤儿 exclusive 目标已经缺失时视为幂等清理，只移除 lock/state 元数据；仍存在且 hash 匹配时删除；仍存在但漂移时整次事务前失败。单个路径冲突不得阻止其它 hash-clean exclusive 路径清理；冲突、shared 和仍被其它 owner 使用的证据继续保留在 state。
- `verify` 只读检查声明、lock roots、当前声明可达性、固定包、state ownership、版本和目标 hash，不更新 Provider、不修复文件。陈旧 `lock.roots` 仍报告 root-extra/root-missing，任意不可达 lock 节点统一报告 `verify.lock-orphan`。
- 项目存在合法 `.flower/trellis-control.json` 且状态为 `disabled` 时，真实
  `plugin add/update/remove/replay` 必须通过 `runWithTrellisIntegrationEnabled()` 临时恢复 Trellis
  入口，执行原 Plugin 事务后再按最新 ownership 重新 detach。最终状态必须仍为 `disabled`；
  外部 Plugin 的声明、lock、state 和目标内容必须保留。
- disabled 包装只作用于会修改项目的生命周期命令。`list`、`verify`、source/auth/search、作者工具和
  所有 `dryRun` 继续遵守原只读边界，不得为了检查而 materialize Trellis 入口。
- Plugin 事务或重新 detach 任一步失败时，外层 update snapshot 必须恢复调用前完整 disabled 现场；
  恢复不完整升级为 Trellis control `repair-required`，不能输出 Plugin 成功后留下可发现入口。



## 来源：.trellis/spec/flower-trellis/cli/enhancements-model.md:11

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
