# 设计：finish-work skill override + release 汇总

## 总体方案

本任务只扩展 skill-garden 强化包和 flower-trellis 叠加逻辑，不改 Trellis 本体。职责分成两层：

1. Skill override：在目标项目已有 `trellis-finish-work` 入口中注入英文 `Release Operations Inference Step`。它是 `overrides/skills/trellis-finish-work.md` 的增量块，不是完整 skill 副本。
2. `trellis-release`：版本 / 上线批次汇总。它读取多个任务的 `release.md`，生成 `.trellis/releases/<release-name>.md`。

不在 `.trellis/workflow.md` 的 hub 或 workflow-state sentinel 中放 release inference 规则。

## 文件布局

源文件：

```text
vendor/skill-garden/.trellis/0.6/overrides/skills/trellis-finish-work.md
vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-release/SKILL.md
vendor/skill-garden/.trellis/0.6/.claude/skills/trellis-release/SKILL.md
```

flower-trellis 代码：

```text
src/lib/skill-override-inject.js
src/lib/apply-enhancements.js
scripts/sync-enhancements.mjs
```

同步产物：

```text
enhancements/0.6/overrides/skills/trellis-finish-work.md
enhancements/0.6/.agents/skills/trellis-release/SKILL.md
enhancements/0.6/.claude/skills/trellis-release/SKILL.md
.agents/skills/trellis-release/SKILL.md
.claude/skills/trellis-release/SKILL.md
```

当前项目注入目标：

```text
.agents/skills/trellis-finish-work/SKILL.md
.claude/skills/trellis-finish-work/SKILL.md
.claude/commands/trellis/finish-work.md
```

运行期用户产物：

```text
.trellis/tasks/<task>/release.md
.trellis/releases/<release-name>.md
```

## skill override 设计

`overrides/skills/<skill>.md` 的语义类似现有 `overrides/workflow.md`：源文件只保存需要注入的高优先级增量块，安装时注入目标已有文件。第一版只支持 `trellis-finish-work.md`。

注入规则：

1. 读取 `enhancements/0.6/overrides/skills/*.md`。
2. 对每个 `<skill>.md`，按目标平台寻找已有入口：
   - `.agents/skills/<skill>/SKILL.md`
   - `.claude/skills/<skill>/SKILL.md`
   - `.claude/commands/trellis/<skill without trellis->.md`
3. 目标存在才注入；目标不存在则跳过，不创建完整 upstream skill。
4. 先删除旧的同名 `<!-- BEGIN skill-garden skill override <skill> ... -->` 到 `END` 块，再注入当前块。
5. 有 YAML frontmatter 的 skill 注入到 frontmatter 后；无 frontmatter 的 command 注入到文件顶部。
6. 首次写入前创建 `<target>.flower-skill-garden.bak`，后续保留既有备份。
7. 只有内容变化时写盘，保证重复运行幂等。

`finish-work-enhancement` 精细安装只刷新 skill override；`workflow-enhancement` 只刷新 workflow override。全量安装两者都会刷新。

## finish-work override 内容

`trellis-finish-work.md` 使用英文内容，核心规则：

- 在 finish-work Step 2 dirty-path 分类成功后、Step 3 archive 前执行。
- 不新增用户确认。
- 不因缺少 `release.md` 阻塞 finish-work。
- 读取 active task 的 `task.json`、`prd.md`、`design.md`、`implement.md`、`implement.jsonl`、`check.jsonl`、已有 `release.md`，并结合 recent commits、`git diff --name-only`、dirty path 分类。
- 已有 `release.md` 时保留并只补明显遗漏。
- 无 `release.md` 时：
  - 高置信存在上线事项：自动写入。
  - 高置信无上线事项：不创建，最终报告说明未识别上线事项。
  - 不确定但存在上线风险：自动写入，并标记 `Needs human review`。

## `release.md` 设计

写入时使用英文基础模板：

```md
# Release Operations

## Conclusion
Release operations exist. / Needs human review.

## SQL Changes
None

## Configuration Changes
None

## Batch / Deployment Scripts / Data Repair
None

## External Systems / Dependent Platforms
None

## Release Order
No special order.

## Rollback Notes
Rollback code only.

## Post-release Verification
Verify according to task acceptance criteria.
```

每条操作应尽量包含目标环境、执行时机、依赖顺序、回滚方式和验证方式。部署脚本、数据修复、一次性命令、定时任务触发等归入 `Batch / Deployment Scripts / Data Repair`；H0 接口中转平台这类不在当前仓内但需要配合上线的系统归入 `External Systems / Dependent Platforms`。明确无上线操作时默认不创建文件。

## `trellis-release` skill 设计

触发场景：

- 用户说“生成上线单”“汇总 release.md”“正式上线前整理操作单”“版本上线总结”“trellis-release”等。

工作流：

1. 读取当前任务、`.trellis/tasks/` 和 `.trellis/tasks/archive/`。
2. 根据用户输入确定任务集合：显式任务列表优先；其次日期范围或版本名；不足时向用户问一个问题。
3. 读取每个任务的 `release.md`。
4. 对缺失 `release.md` 的任务列为“未记录上线事项”。默认不阻塞汇总，但在输出里单独列出，便于正式上线前人工复核。
5. 生成 `.trellis/releases/<release-name>.md` 草案，按 SQL、配置、批处理 / 部署脚本 / 数据修复、外部系统 / 依赖平台、上线顺序、回滚、验证分组。
6. 写盘前展示目标路径、任务列表、缺失记录列表和草案摘要，等待用户确认。

输出文件应保留任务来源引用，例如 `[06-17-example-task]`，避免汇总后无法追溯。

## 兼容性与边界

- `scripts/sync-enhancements.mjs` 继续全量复制 `.agents`、`.claude`、`overrides`，因此新增 `overrides/skills` 会自然进入快照；manifest 增加 `skillOverrides` 统计便于核对。
- `src/lib/apply-enhancements.js` 在 copy skill 和 workflow 注入后调用 `injectSkillOverrides`。
- 注入目标属于 Trellis 管理文件，不写入 `.trellis/.flower-manifest.json` 的 `paths`，避免 uninstall 或升级清理误删 Trellis 原生入口。
- 不调整 `.trellis/workflow.md` 的 release 规则；workflow 仍只承载 routing、push、bookkeeping 等现有 hub 规则。

## 风险与取舍

- 修改 Trellis 管理文件会在后续 `trellis update` 冲突提示中显示本地修改；这是使用 override 注入的必要代价。保留 `.flower-skill-garden.bak` 便于定位首次注入前内容。
- 相比完整维护 `trellis-finish-work` skill 副本，增量块更小，后续上游 finish-work 主体升级时冲突面更低。
- Markdown 比 JSON schema 更灵活，但机器校验弱。第一版优先保证可用性，后续如果需要可以再加校验脚本。

## 回滚方案

- 删除或回退 skill-garden 0.6 中新增的 `overrides/skills/trellis-finish-work.md` 和 `trellis-release` skill。
- 重新运行 `npm run sync` 刷新 `enhancements/`。
- 对当前项目 finish-work 入口删除 `skill-garden skill override trellis-finish-work` 注入块，或从 `.flower-skill-garden.bak` 恢复。
- 从当前项目 `.agents/skills/` 和 `.claude/skills/` 删除 `trellis-release` 副本。
