# Brief — 拆分 Trellis Push 输出模板

## Goal

- 把 `trellis-push` 的交互式计划、结果模板及展示规则拆到单独 reference，并在每次实际输出前即时读取，同时保持 Git 与 Auto-Loop 行为不变。

## Scope

- 新增一个 `trellis-push/references/output-templates.md`，集中保存现有计划模板、结果模板和共用展示规则。
- 精简主 `SKILL.md`，保留确认门、文件归属、精确提交、推送、任务进度、失败恢复和 auto-loop 内部 `commit-only` 的完整执行语义。
- 普通模式和用户 `commit-only` 在计划与结果输出前分别即时读取 reference；文件缺失时失败关闭。
- 同步 Skill Garden canonical、Flower `enhancements/0.6` 和当前 `.agents` / `.claude` dogfood 副本，并更新相关静态契约测试。
- Flower 父仓切换到既有 `beta`，并以 `--ff-only` 从当前 `main` 快进后再实施；Skill Garden 保持现有 `beta`。

## Non-Goals

- 不修改 `trellis-push` 的确认次数、Git 执行协议、任务进度或 merge 行为。
- 不修改 Auto-Loop runner schema、action、重试预算、profile 或远端授权。
- 不把计划和结果再拆成多个 reference，也不批量迁移其它 Skill。
- 不通过 force、reset 或历史改写重建已有 `beta`。

## Key Decisions

- 只拆展示层：主 Skill 继续是唯一执行契约，reference 不拥有安全或状态机语义。
- 使用单个 reference：计划与结果共享展示规则，集中维护比两个文件更容易保持一致。
- 采用输出事件级即时读取：不在 Skill 入口提前加载；计划输出和结果输出分别读取一次。
- Auto-Loop 内部模式不渲染交互式计划或结果，因此不为执行加载 reference；它仍由主 Skill 形成逐仓执行数据，再由 `trellis-auto-loop` 完成 `record + next`。
- 父仓已有 `beta` 且没有独有提交，选择 fast-forward 到当前 `main`，达到“从当前 main 拉 beta”的目标并保留 Git 历史。

## Key Context

- Durable source 位于 `vendor/skill-garden/.trellis/0.6/`，Flower `enhancements/0.6` 是发布快照，项目 `.agents` / `.claude` 是 dogfood 输出。
- 任务确认时父仓 `main=f5f4894`、`beta=558a7bd`，`main...beta=3/0`；Skill Garden 已在 `beta=e6ec6a5`。
- 当前主 `trellis-push/SKILL.md` 约 350 行，预计拆分后降到约 260 至 280 行。
- `trellis-check-all` 已使用“薄入口 + 输出前读取 reporting reference”的同类结构。
- `scripts/check-output-templates.mjs` 会递归扫描 Skill 下的 Markdown，新 reference 可直接进入现有渲染守卫。

## Risks / Deferred

- 若只搬模板却遗漏测试的数据源，现有静态契约会误判主 Skill 缺少字段；测试必须分别从主 Skill 校验语义、从 reference 校验展示。
- 分层措辞若不明确，未来可能误让 Auto-Loop 展示确认 UI；需要固定“不渲染、不再次确认”的回归断言。
- Skill Garden 提交后才能让 `enhancements/MANIFEST.json.sourceCommit` 指向新 HEAD，最终提交需继续走 `trellis-push` 的确定性多仓链。
- 若开始实施前 `beta` 出现独有提交或无法 fast-forward，必须停止，不自动覆盖该分支。

## Acceptance

- 主 `SKILL.md` 不再内嵌完整计划/结果模板，并在对应输出点明确即时读取 reference；缺失时阻塞而非凭记忆重建。
- 新 reference 完整保留现有字段、顺序、条件小节、文件阈值和确认文案。
- 普通模式仍只确认一次；auto-loop 内部 `commit-only` 仍不确认、不 push、不执行 Step 5，逐仓数据和恢复契约不变。
- Flower 父仓在 `beta` 上实施，且 `beta` 通过 fast-forward 包含任务确认时的当前 `main`，不改写历史。
- canonical、enhancements 和 dogfood 副本一致，定向测试、输出模板检查、完整 `npm test`、Patch target、上下文预算和 diff 检查通过。

## Next Step

- 实现与验证已完成，当前进入 Check-All；通过后按 Trellis 完成链等待用户继续进入 `trellis-update-spec`，再由 `trellis-push` 生成精确多仓提交计划。
