# 拆分 Trellis Push 输出模板

## Goal

把 `trellis-push` 中稳定但篇幅较长的交互式计划、结果模板及展示规则拆到单独 reference，并要求每次真正输出前即时读取。主 Skill 继续保留 Git 安全、确认、执行、任务进度和 auto-loop 内部 `commit-only` 的完整语义，避免分层改变现有行为。

## Background

- 当前 canonical `trellis-push/SKILL.md` 约 350 行，Step 3 与 Step 6 同时承载执行语义和大段 Markdown 输出模板。
- 本次复盘确认：当会话在预检后发生上下文压缩时，即使已经读取过主 Skill，模型仍可能凭压缩摘要生成缩写版确认计划，导致标题、字段和风险展示偏离 canonical 模板。
- `trellis-check-all` 已采用薄入口加 `references/reporting-and-disposition.md` 的分层方式，并明确在报告或 runner 结果输出前即时读取，可作为结构先例。
- Auto-Loop 当前只通过内部 `commit-only` 复用 `trellis-push` 的仓库发现、动态多仓链、精确提交和失败保留能力；它复用预授权，不展示交互确认，也不执行普通模式的任务进度提交。

## Requirements

### R1. 只拆展示层，不迁移执行语义

- 在 canonical `.agents` 与 `.claude` 的 `trellis-push` 目录下新增同名 `references/output-templates.md`。
- reference 只承载交互式计划模板、交互式结果模板及其展示规则。
- 主 `SKILL.md` 必须继续拥有模式定义、完成链证据、文件归属、确认门、精确提交、推送、任务进度、失败恢复和禁止事项。
- 不把 exact files、确认条件、计划漂移、任务完成态或 auto-loop runner 协议搬入 reference，避免展示文件变成第二份执行契约。

### R2. 每次输出前即时读取

- 普通模式或用户 `commit-only` 在展示 Step 3 计划前，必须即时读取 `references/output-templates.md` 的计划部分，再按其中模板渲染。
- 普通模式、用户 `commit-only` 或 untracked 路径在展示 Step 6 结果前，必须再次即时读取 reference 的结果部分，再按其中模板渲染。
- 不在 Skill 入口或 Git 预检前提前加载 reference；该文件只在实际需要用户可见输出时进入上下文。
- reference 缺失或无法读取时失败关闭，报告阻塞，不允许凭记忆重建模板。

### R3. Auto-Loop 内部 `commit-only` 行为不变

- Auto-Loop 内部模式继续复用 runner 预授权，不新增确认、不 push、不执行 Step 5，也不展示交互式 `Trellis Push 计划` 或 `Trellis Push 结果`。
- 内部模式仍在主 Skill 语义下形成逐仓执行数据，用于自检、恢复和调用方 `record`；不得因为模板迁移而省略 exact files、message、retained、已完成 commits 或失败位置。
- `auto_loop.py record` 参数、重试预算和 runner 结果格式继续由 `trellis-auto-loop` / runner 所有，不复制到新 reference。
- 本任务不修改 Auto-Loop profile、状态机、脚本或用户授权边界。

### R4. 分发副本保持一致

- Flower 父仓实现必须在 `beta` 分支进行；当前既有 `beta` 没有独有提交且仅落后 `main` 3 个提交，因此先将其 `--ff-only` 快进到任务确认时的当前 `main`，禁止 force、reset 或改写历史。
- `vendor/skill-garden` 已位于 `beta`，保持现有分支，不新建或重写同名分支。
- 先修改 `vendor/skill-garden/.trellis/0.6/` canonical `.agents` / `.claude` Skill 与 reference。
- 同步生成 `enhancements/0.6/` 快照和当前项目 `.agents` / `.claude` dogfood 副本。
- 新增 reference 必须随整个 Skill 目录递归复制，不能只在 canonical 或单一平台存在。

### R5. 回归守卫覆盖新分层

- 调整读取 `trellis-push` 输出模板的静态契约测试，使其从新 reference 校验模板字段，同时继续从主 Skill 校验执行语义。
- 增加断言：主 Skill 在交互式计划和结果输出前读取 reference；Auto-Loop 内部模式不渲染交互模板、不重新确认。
- 现有输出模板扫描器应递归扫描新 reference，并继续保证 Markdown 渲染契约。

## Acceptance Criteria

- [ ] `trellis-push/SKILL.md` 不再内嵌完整计划和结果 Markdown 模板，改为在对应输出点即时读取 `references/output-templates.md`。
- [ ] 新 reference 完整保留现有计划、结果和展示规则，用户可见字段、顺序、条件小节和确认文案无语义退化。
- [ ] reference 缺失时明确阻塞，主 Skill 不允许凭记忆生成替代模板。
- [ ] 普通模式和用户 `commit-only` 仍只确认一次；确认前仍禁止 `git add`、`git commit` 和 `git push`。
- [ ] Auto-Loop 内部 `commit-only` 不读取或渲染交互模板，不要求用户确认，不 push，不执行 Step 5；逐仓执行数据和失败恢复契约保持不变。
- [ ] `trellis-auto-loop/SKILL.md`、`auto_loop.py` 和 workflow 不因本次展示层拆分发生无必要修改。
- [ ] Flower 父仓 `beta` 通过 fast-forward 精确对齐任务确认时的 `main` 基线，实施和验证均在 `beta` 完成；不存在 force/reset 或历史改写。
- [ ] canonical `.agents` / `.claude` 内容一致，`enhancements/0.6` 与当前 dogfood 副本同步包含新 reference。
- [ ] 定向静态契约测试、输出模板检查、完整 `npm test`、Patch target 检查、上下文预算检查和 `git diff --check` 通过。

## Out of Scope

- 改写 `trellis-push` 的 Git 执行协议、确认次数、任务进度或 merge 行为。
- 修改 Auto-Loop runner schema、action、重试预算或 profile。
- 把计划模板与结果模板再拆成多个文件。
- 为所有 Skill 统一迁移输出模板；本次只处理 `trellis-push`。

## Notes

- 用户当前选择是“输出前读取”，不额外引入“压缩后检测并重读”的独立协议；每次实际渲染前即时读取已经覆盖该场景。
- 预计主 `SKILL.md` 可减少约 70 至 90 行，具体以保持语义完整后的最终 diff 为准。
