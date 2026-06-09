# config.yaml 多仓库化与 spec 按包重组(monorepo)

> **状态:已 brainstorm,规划完成,待 review。** 本任务 2026-06-09 从「发布流程 + submodule」任务拆出,
> 同日完成 brainstorm:决策见下方 ADR-lite,Open Questions 已全部收敛。待 review 后 `task.py start`。

## Goal

把 flower-trellis 从单仓库正式配成 **monorepo**:在 `.trellis/config.yaml` 声明 packages(主包 + `skill-garden` 包),并让 `.trellis/spec/` 按包重组,使 Trellis 正确识别「主仓库 + vendor/skill-garden submodule」这种多仓库布局。

## Background / Known Context(已查清的 Trellis 机制)

- **触发点**:`.trellis/config.yaml` 一旦配 `packages`,`is_monorepo()` 即为 `true`,会**立刻**改变:
  - spec 解析:`get_spec_base(package)` → `spec/<package>/`(单仓是 `spec/`);`packages_context.py` 按 `spec/<package>/<layer>/` 扫描。
  - `task.json` 的 `package` 字段开始生效;`get_spec_scope` / active-task package 限定 spec 扫描范围。
  - `guides/` 始终是**共享层**(不属于任何 package)。
- **破坏性**:现有 `spec/cli/` 在 monorepo 模式下需迁到 `spec/<package>/cli/`,否则按包扫描找不到;**或**依赖「无 package 的 task → `get_spec_base` 回退 `spec/`」这个 fallback(需实测各工具 trellis-before-dev / check / get_context 是否一致支持)。
- **skill-garden 无自己的 spec**:`vendor/skill-garden/.trellis` 只有强化包变体(`old/0.5/0.6`),它是「随包发布的素材源」,不是被开发的常规代码包 —— 给它套 monorepo + spec 分层的收益存疑。
- 相关代码:`.trellis/scripts/common/config.py`(`get_packages` / `get_submodule_packages` / `get_git_packages` / `get_spec_base` / `is_monorepo` / `get_spec_scope`)、`packages_context.py`(`_scan_spec_layers`)。
- config.yaml 的 packages 示例已支持 `type: submodule` 与 `git: true`。

## 已查清机制(2026-06-09 brainstorm auto-context,代码实测)

> 以下由阅读 `config.py` / `packages_context.py` / `session_context.py` / `add_session.py` /
> `paths.py` / `trellis-before-dev` SKILL 得出,用于关闭部分 Open Questions。

- **路径模型多一层**:单仓是 `spec/<layer>/`(当前实为 `spec/cli/*.md`,`cli` 是 **layer** 不是 package);
  monorepo 是 `spec/<package>/<layer>/`。无论主包叫什么,`spec/cli/*` 都必须下移成 `spec/<主包>/cli/*`。
- **迁移不可避免(fallback 不通用)**:`get_spec_base(None)` 在 monorepo 下虽回退 `spec/`,但只在「task 无
  package + 直接调用」时生效。`trellis-before-dev` 第 2 步 `get_context --mode packages` 与默认 session
  context 的 PACKAGES section 都走 `get_packages_info → _scan_spec_layers(spec_dir, pkg_name)`,**硬扫
  `spec/<pkg>/`**。不迁移 → monorepo 视图里主包 specLayers 为空,cli 的 8 个 spec 在按包发现路径上丢失。
- **guides 永远共享**:`_scan_spec_layers` 显式排除 `guides`,迁移不影响 `spec/guides/`。
- **触发只需一个 package**:`is_monorepo()` 只要 `packages` 非空即 true,主包单独声明即可触发,不依赖 skill-garden。
- **skill-garden 声明为 package 无 spec 收益**:它无自身 spec,声明后 `specLayers=[]`(显示 "Spec: not configured")。
- **submodule vs git:true 的展示差异(实测)**:`get_submodule_packages` 在 scripts 内**无消费者**;
  `type: submodule` 的唯一效果是 PACKAGES 列表加 `(submodule)` 标签。要在 session context 展示 skill-garden 的
  **独立 git 状态 / 最近 5 条 commits**(`## GIT STATUS (skill-garden: vendor/skill-garden)`),需 `git: true`
  (经 `get_git_packages` → `_collect_package_git_info`;submodule 的 `.git` gitlink 文件可被正常识别)。两者可叠加。
- **既有 submodule 已就绪**:`.gitmodules` 已含 `vendor/skill-garden`,git 层面已是标准 submodule;
  是否声明为 Trellis package 是独立选择。

## 已确认方向(2026-06-09 用户拍板)

- **正式 monorepo 化**:config.yaml 声明主包 + skill-garden 包,spec 按包重组,**接受 spec 迁移**。
- 同步范围当时只确认到「正式 monorepo」,未细化主包命名 / 迁移方式。

## Decision(ADR-lite,2026-06-09 brainstorm)

**Context**:正式 monorepo 化会立刻触发 spec 按包重组;brainstorm 实测确认 spec 迁移不可避免、
skill-garden 声明为 package 无 spec 收益(仅 git-context 展示价值)。需在「完整 / 最小 / 放弃」三方案中定调。

**Decision**:采用 **方案 A(完整 monorepo)**。
- 主包:`flower-trellis`,`path: .`,设为 `default_package`。
- skill-garden:声明为 package,`path: vendor/skill-garden`、`type: submodule` + `git: true`(在 session context 展示其独立 git 状态/最近 commits),**不配 spec layer**。
- spec 迁移:`spec/cli/*.md` → `spec/flower-trellis/cli/*.md`;`spec/guides/` 原地不动(共享层)。

**Consequences**:
- PACKAGES 视图会展示主包(含 cli layer)+ skill-garden(submodule,Spec: not configured)。
- config 多一个无 spec 的包,可接受。
- 破坏性:所有硬编码 `spec/cli/` 的引用需同步改为 `spec/flower-trellis/cli/`(范围见下)。

## 迁移影响范围(2026-06-09 实测 grep + before-dev 复核)

- **spec 文件内部**:`spec/cli/*.md` 之间**无** `spec/cli/` 路径自引用 → 整目录搬迁,文件内容零改动。
- **整目录搬迁**:`spec/cli/`(8 个 .md)→ `spec/flower-trellis/cli/`;`spec/guides/` 原地保留。
- **外部 `spec/cli/` 引用经复核:全是通用示例 / 模板悬空引用,均不指向本仓被迁移的真实文件 → 不改动**:
  - 本仓 `spec/cli/` 下**无任何子目录**(仅 8 个 .md)。`task.py` help 的 `spec/cli/backend/auth.md`、
    `workflow.md` 的 `spec/cli/backend/workflow-state-contract.md` 均指向不存在的 `backend/` 子层,是 Trellis
    模板的演示/契约引用,与本仓迁移无关。
  - trellis-meta `spec-system.md` / `task-system.md`(+ `.agents/` 镜像)中的 `spec/cli/backend|unit-test/...`
    是讲解「cli 作为 package」的 monorepo 概念示例,改写反而破坏文档正确性。
  - ∴ 本任务**不改任何引用**;迁移零死链。提交前 grep 仅用于确认无指向真实迁移文件的死链。

## Requirements(收敛后)

1. `.trellis/config.yaml` 声明 `packages`:
   - `flower-trellis`:`path: .`(主包),并设 `default_package: flower-trellis`。
   - `skill-garden`:`path: vendor/skill-garden`、`type: submodule` + `git: true`(展示其独立 git 状态/commits;不配 spec layer)。
2. spec 按包重组:用 `git mv` 把 `spec/cli/` 整目录迁到 `spec/flower-trellis/cli/`;`spec/guides/` 保留为共享层。
3. 同步更新硬编码 `spec/cli/` 引用(`task.py` help、`workflow.md`、`trellis-meta/references/*` + `.agents/` 镜像),
   使其自洽(本仓实路径用 `spec/flower-trellis/cli/`,泛指示例可保留 `spec/<package>/<layer>/`)。
4. 迁移前做一次快照备份(沿用 `.trellis/.backup-*` 习惯),便于整体 `git revert` 回滚。
5. 启用后实测四条链路:`get_context --mode packages`、`trellis-before-dev`、`trellis-check`、路由。
6. 日常 package 标注:靠 `default_package` 兜底,新任务不强制标 `package`;仅针对 skill-garden 的任务才显式标。
7. 不设 `session.spec_scope`(skill-garden 无 spec,默认全扫无噪音)。

## Open Questions(2026-06-09 已全部收敛)

- 主包命名/归属 → `flower-trellis`,`path: .`,`default_package`。
- skill-garden 配置 → `path: vendor/skill-garden`、`type: submodule` + `git: true`;不配 spec。(实测:`type: submodule` 仅给列表加标签,展示独立 git 状态/commits 需 `git: true`。)
- 现有 `spec/cli/` 处置 → `git mv` 迁到 `spec/flower-trellis/cli/`(实测确认 fallback 不被 before-dev/get_context 主流程吃,迁移不可避免)。
- skill-garden 是否需 spec → 否,`specLayers` 为空(合法,显示 "Spec: not configured")。
- `task.json` package 对归档任务影响 → 归档任务不参与 active spec 扫描,不受影响;无 package 任务靠 `default_package` 兜底。
- 实测行为 → 列入 Acceptance,迁移后逐条跑。
- 回滚预案 → 迁移前快照备份 + `git revert`(`git mv` 改动可整体回退)。

## Out of Scope

- 本任务不含发布流程 / submodule 接入(已在 06-09-release-and-submodule 完成)。
- 不给 skill-garden 配 spec 分层(它无自身 spec)。
- 不设 `session.spec_scope`。

## Acceptance Criteria

- [x] config.yaml 声明 `flower-trellis`(path `.`,default)+ `skill-garden`(submodule);`is_monorepo()` 返回 true。
- [x] `get_context --mode packages` 显示主包 `cli` layer(8 个 spec 可达)+ skill-garden(submodule + git repo,Spec not configured)。
- [x] 默认 session context 出现 `## GIT STATUS (skill-garden: vendor/skill-garden)` 与其最近 commits(`git: true` 生效)。
- [x] `trellis-before-dev` 能按 `spec/flower-trellis/cli/.../index.md` 读到迁移后的 spec;`spec/guides/` 仍被读到。
- [x] `spec/cli/` 已不存在,`spec/flower-trellis/cli/` 含全部 8 个原文件(经 `git mv` 保留历史)。
- [x] `spec/cli/` 引用经复核均为通用示例/模板悬空引用(指向本仓不存在的 `backend|unit-test` 子层),不指向真实迁移文件 → 无死链、无需改。
- [x] `trellis-check` / 路由在 monorepo 下正常运行,无报错。
- [x] 现有归档任务、日常工作流不被破坏;`default_package` 兜底生效(无 package 任务仍解析到主包 spec)。
