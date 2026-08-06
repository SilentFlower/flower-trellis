# 改进 Worktree 多仓基线确认与会话交接

## Goal

让用户在创建并行 worktree 前清楚知道操作的是哪个 Git 仓库、从哪个分支和 commit 创建、哪些来源 dirty 不会进入目标，以及哪些个人状态会继承或重建；在 harness 多项目目录中分别标识根编排仓库与子仓库，避免混淆各仓基线和状态边界。

## Background

- 当前 Python engine 在未传 `--base` 时静默使用 `HEAD`，随后立即创建 branch、worktree 和 planning task，见 `vendor/skill-garden/.trellis/0.6/scripts/worktree_setup.py:769`、`:778`、`:790`。
- Flower facade 只转发参数和打印结果，不提供创建前确认，见 `src/commands/worktree.js:27`、`:69`、`:91`。
- 当前 `trellis-worktree` Skill 直接给出写命令，没有要求先展示来源仓库、当前分支和解析 commit，见 `vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-worktree/SKILL.md:27`。
- harness 根仓中的 submodule 或独立 Git package 拥有自己的分支语义；创建根 worktree 只创建根仓分支，不会自动为子仓创建业务分支。
- Trellis SessionStart、workflow state、task runtime 和平台入口绑定会话启动时的 workspace root/cwd；仅在旧会话终端执行 `cd` 不能完成上下文重绑定。
- 当前 `create` 只继承 `.trellis/.developer` 中的开发者名字并新建空 runtime；个人 route 默认 `.trellis/.route-prefs.tmp` 不会进入目标。
- `git worktree add` 只检出选定 commit，来源工作区的 tracked dirty、untracked 和 gitignored 本地状态都不会自动进入目标；“从当前分支创建”不等于“复制当前工作目录”。

## Requirements

### R1. 创建默认只做预检

- `flower-trellis worktree create` 未显式传入 `--yes` 时必须只读返回创建计划，不创建 branch、worktree、task、registry 或本地 runtime。
- 预检成功状态固定为 `confirmation-required`，并明确 `changed=false`、`requiresConfirmation=true`。
- `--yes` 只允许用于 `worktree create`；其他 worktree 子命令传入时必须返回参数错误。
- 预检必须返回覆盖仓库选择、base、目标、来源 dirty 和本地状态转移计划的稳定 fingerprint；真实创建必须携带最新 fingerprint，计划任一事实变化时返回稳定 `create-plan-changed`，不得继续写入。

### R2. 默认基线与改选

- 未传 `--base` 时，默认基线使用来源根仓库的当前分支名；来源处于 detached HEAD 时才回退到 `HEAD`。
- 预检必须同时返回用户输入 ref、实际采用 ref、是否来自当前分支默认值，以及解析后的 40 位 commit。
- 用户可以提供本地分支、远程分支、tag 或 commit 作为 `--base`；改选后必须重新执行预检并展示新结果。
- 原工作区不得为了改选基线而执行 checkout/switch；选择只影响 `git worktree add ... <base>`。

### R3. 仓库身份必须明确

- 创建计划必须标明来源根仓库名称、绝对路径、当前分支和 HEAD。
- 必须标明目标 worktree 路径、待创建根分支和 planning task 标识。
- 人类可读 CLI 输出和 JSON 输出使用相同事实来源，不允许只显示模糊的 `branch/base` 而缺少所属仓库。

### R4. Harness 多仓说明

- 预检必须列出选定根仓 commit 中声明的 Git submodule，至少包含名称、项目相对路径、gitlink commit、初始化状态，以及已初始化时的当前分支和 HEAD。
- 根仓条目必须明确标记为本次 worktree 创建的 `selected=true` 仓库；子仓条目必须明确标记本次不会自动创建分支。
- `trellis-worktree` Skill 还必须读取 Trellis package context，识别配置的独立 Git package；对所有受影响子仓分别展示仓库名、路径和待确认基线。
- 子仓基线不允许从根仓分支名推断；需要修改子仓时，必须在 handoff 后按仓库分别确认和创建分支。

### R5. 用户确认流程

- Skill 在真实创建前必须先运行不带 `--yes` 的 create 预检。
- Skill 必须向用户展示根仓库、默认/选定基线、解析 commit、新分支、目标目录和子仓说明，并允许用户确认、改选 ref 或取消。
- 只有用户对最新预检结果作出明确确认后，Skill 才能用完全相同的参数追加 `--yes` 和该计划 fingerprint 执行真实创建。
- 预检之后用户改动了仓库选择、base、branch、target、task 参数、来源 dirty 或可继承 route 偏好时，旧确认失效，必须重新展示最新预检。

### R6. 新会话交接

- 创建结果必须返回 `handoff.cwd`、`handoff.workspaceRoot` 和 `handoff.requiresNewSession=true`。
- Skill 必须说明要求是“新 AI 会话以目标 worktree 作为 workspace root/cwd”，不强制用户手动 `cd`；客户端打开目标目录并重启/重绑 SessionStart 也满足要求。
- 仅在旧会话 shell 中执行 `cd` 不得描述为已完成交接。
- 新会话只读取目标 worktree 自己的 `.trellis`、`.agents`、`.codex`、`.claude` 和 `.flower`。

### R7. 本地状态转移计划

- 预检必须返回结构化本地状态转移摘要，区分 `inherited`、`initialized`、`notInherited` 和 `sourceDirty`，人类输出必须说明同样事实。
- `create` 在来源和目标解析为同一开发者时，自动继承 `.trellis/.route-prefs.tmp` 中合法的 `implement` / `check` 枚举；来源缺失、类型不安全、无合法值或显式目标开发者不同均只报告不继承，不复制原始文件。
- `prepare` 默认仍不读取其它 worktree；只有显式传入 `--inherit-route-prefs` 时才从当前控制 worktree 读取，并要求来源与目标属于同一 Git common-dir、开发者一致。目标已存在 route 偏好时必须保留，不得覆盖。
- route 偏好写入必须由字段级校验后的规范化值生成，不允许复制任意 `*.tmp`、未知字段或整个本地目录。
- `.trellis/.runtime/sessions` 必须在目标新建为空；session route 决策、current task、untracked flow、pre-check hold 和其它会话状态不得继承。
- auto-loop、Ralph、agent/session 临时态、更新检查缓存、下载 cache、transaction、backup、Python cache 和故障证据不得继承。
- `.flower/state.json` 不得直接复制来源字节，因为 ownership、hash 和 Patch provenance 必须与目标 commit 的实际文件一致。
- `.claude/settings.local.json` 和其它平台私有本地设置不属于本轮继承范围；预检只需明确归入 `notInherited`，不得读取其权限明细或复制内容。

### R8. 来源工作区 Dirty 披露

- 预检必须读取来源根仓的 tracked dirty、staged、untracked 和 conflict 摘要，并明确这些内容不属于选定 base commit、不会进入目标 worktree。
- dirty 状态只用于确认和风险说明，不改变选定 base commit，也不得通过隐式 copy、stash、commit 或 patch 应用进入目标。
- 用户在最新预检后提交、清理或改变来源 dirty 状态时，旧确认失效，必须重新预检。

## Compatibility

- 已经显式使用 `--base` 的调用仍可选择同一 ref，但需要追加 `--yes` 才会写入。
- 未传 `--yes` 的历史自动化调用由“直接写入”变为“返回确认计划”；写入调用还必须携带最新 plan fingerprint，这是有意的安全收紧。
- `prepare` 不带 `--inherit-route-prefs` 时保持现有目标本地初始化语义；新 flag 只开放严格校验后的 route 偏好继承。
- `status`、`migrate`、`remove` 的状态和写入语义保持不变；`prepare` 的默认路径保持不变，仅显式 inherit flag 增加受限写入。
- 不增加跨 worktree 目录复制或整目录 symlink。
- 不把来源 working tree snapshot、stash 或未提交 patch 自动应用到目标。

## Out Of Scope

- 不自动为 submodule 或独立 Git package 创建 worktree、checkout 或业务分支。
- 不自动选择 `origin/main`、`origin/master`、`origin/prod` 等远程基线。
- 不在旧会话中模拟 workspace 重绑定，也不修改 Codex/Claude 客户端本身。
- 不改变 task 的规划、启动、auto-loop、check、push 或 remove 生命周期。
- `rd-guide` HTTPS 修改不属于本任务。
- 不复制 session runtime、活动任务指针、auto-loop run、缓存、transaction、backup 或故障证据。

## Acceptance Criteria

- [ ] 不带 `--yes` 的 `worktree create` 返回 `confirmation-required`，且 Git branch、worktree、task、registry 和目标路径均无变化。
- [ ] `--yes` 携带最新 plan fingerprint 才能写入；参数、dirty 或可继承 route 偏好变化后返回 `create-plan-changed` 且零写入。
- [ ] 未传 `--base` 时，预检展示来源仓库当前分支为默认基线及其解析 commit；detached HEAD 回退到 `HEAD`。
- [ ] 传入其他合法 ref 后，预检展示改选结果；非法 ref 返回稳定 `create-base-invalid`。
- [ ] 预检和真实结果都明确包含来源仓库名称/路径、当前分支、HEAD、选定 base、目标分支和目标路径。
- [ ] harness fixture 中根仓和 submodule 分开显示，submodule 明确标记为不会自动创建分支。
- [ ] 追加 `--yes` 后沿用现有事务顺序创建 worktree、planning task 和 registry；失败回滚语义不变。
- [ ] Skill 明确执行“预检 -> 用户确认/改选 -> `--yes --plan-fingerprint` 创建 -> 新 workspace 会话 handoff”。
- [ ] handoff 明确要求目标 workspace root/cwd，并说明客户端打开目录等价、旧会话单纯 `cd` 不等价。
- [ ] 预检列出本地状态 transfer plan；route 个人偏好不再静默丢失，session/auto-loop/cache 等状态明确不继承。
- [ ] `create` 只在同一开发者时继承规范化 route 偏好；不同开发者、非法来源或缺失偏好不创建目标偏好文件。
- [ ] `prepare --inherit-route-prefs` 只允许同 Git common-dir、同开发者来源，且不覆盖目标已有偏好；默认 prepare 不跨 worktree 读取。
- [ ] 来源根仓存在 tracked dirty、staged、untracked 或 conflict 时，预检明确说明这些内容不会进入目标；状态变化后旧确认失效。
- [ ] `.flower/state.json` 和 `.claude/settings.local.json` 均不会从来源复制到目标。
- [ ] canonical Skill、Flower 快照、双平台投影和相关规格保持同步。
- [ ] Python/Node 定向测试、语法检查、快照同步检查、compiled target 检查和 `git diff --check` 通过。
