# 实施计划：finish-work skill override + release 汇总

## 实施步骤

1. 撤回 workflow release 注入
   - 移除 `vendor/skill-garden/.trellis/0.6/overrides/workflow.md` 中的 release inference gate。
   - 移除 `workflow-states/in_progress.md` 和 `in_progress-inline.md` 中的 release sentinel。
   - 同步后确保 `.trellis/workflow.md` 也不含 release inference 规则。

2. 新增 finish-work skill override 源
   - 创建 `vendor/skill-garden/.trellis/0.6/overrides/skills/trellis-finish-work.md`。
   - 内容保持英文。
   - 只写 `Release Operations Inference Step` 增量块，不创建完整 `trellis-finish-work` skill 副本。
   - 不新增额外人工确认问题。
   - `release.md` 模板包含 `Batch / Deployment Scripts / Data Repair` 和 `External Systems / Dependent Platforms` 小节。

3. 增加 flower-trellis 注入逻辑
   - 新增 `src/lib/skill-override-inject.js`。
   - 从 `overrides/skills/*.md` 注入目标已有 `.agents` / `.claude` skill 和 Claude command。
   - 保证重复运行幂等，首次写入前备份。
   - 更新 `src/lib/apply-enhancements.js`：全量安装注入 skill override，`--skills finish-work-enhancement` 只刷新 skill override。
   - 更新 `scripts/sync-enhancements.mjs`：manifest 增加 `skillOverrides` 统计。

4. 新增 `trellis-release` skill 源
   - 创建 `vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-release/SKILL.md`。
   - 创建 `vendor/skill-garden/.trellis/0.6/.claude/skills/trellis-release/SKILL.md`。
   - 两份内容保持一致。
   - skill 内容包括版本 / 上线批次汇总流程、任务选择、缺失 `release.md` 处理、汇总模板、写盘确认和禁止事项。
   - 汇总模板按 SQL、配置、批处理 / 部署脚本 / 数据修复、外部系统 / 依赖平台、上线顺序、回滚、验证分组。
   - 缺失 `release.md` 默认列为“未记录上线事项”，不直接阻塞汇总。

5. 更新文档
   - 修改 `vendor/skill-garden/README.md` 的 Trellis 0.6 skill 列表和 override 说明。
   - 修改根 `README.md` 的能力说明。
   - 文档明确职责分工：finish-work skill override 负责归档前智能识别和条件写入，`trellis-release` 负责版本 / 批次汇总。

6. 同步发布快照
   - 运行 `npm run sync`。
   - 检查 `enhancements/0.6/` 新增 / 更新文件。
   - 比对 `vendor/skill-garden/.trellis/0.6/...` 和 `enhancements/0.6/...` 对应文件一致。

7. 同步当前项目已安装副本
   - 将 `enhancements/0.6/.agents/skills/trellis-release/` 同步到 `.agents/skills/trellis-release/`。
   - 将 `enhancements/0.6/.claude/skills/trellis-release/` 同步到 `.claude/skills/trellis-release/`。
   - 对当前项目的 `.agents/skills/trellis-finish-work/SKILL.md`、`.claude/skills/trellis-finish-work/SKILL.md`、`.claude/commands/trellis/finish-work.md` 注入 skill override。

## 验证命令

```bash
npm run sync
node scripts/check-snapshot.mjs
node --check src/cli.js
for f in src/lib/*.js src/commands/*.js; do node --check "$f"; done
git diff --check
python3 ./.trellis/scripts/task.py validate 06-17-skill-garden-release-ledger
```

建议额外检查：

```bash
diff -u vendor/skill-garden/.trellis/0.6/overrides/skills/trellis-finish-work.md enhancements/0.6/overrides/skills/trellis-finish-work.md
diff -u vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-release/SKILL.md enhancements/0.6/.agents/skills/trellis-release/SKILL.md
diff -u vendor/skill-garden/.trellis/0.6/.claude/skills/trellis-release/SKILL.md enhancements/0.6/.claude/skills/trellis-release/SKILL.md
rg -n "Release Operations Inference" .agents/skills/trellis-finish-work/SKILL.md .claude/commands/trellis/finish-work.md
rg -n "Release Operations Inference" .trellis/workflow.md vendor/skill-garden/.trellis/0.6/overrides/workflow.md || true
```

## 风险文件

- `README.md`
- `vendor/skill-garden/README.md`
- `vendor/skill-garden/.trellis/0.6/overrides/skills/trellis-finish-work.md`
- `vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-release/SKILL.md`
- `vendor/skill-garden/.trellis/0.6/.claude/skills/trellis-release/SKILL.md`
- `src/lib/skill-override-inject.js`
- `src/lib/apply-enhancements.js`
- `scripts/sync-enhancements.mjs`
- `enhancements/0.6/overrides/skills/trellis-finish-work.md`
- `enhancements/0.6/.agents/skills/trellis-release/SKILL.md`
- `enhancements/0.6/.claude/skills/trellis-release/SKILL.md`
- `.agents/skills/trellis-release/SKILL.md`
- `.claude/skills/trellis-release/SKILL.md`
- `.agents/skills/trellis-finish-work/SKILL.md`
- `.claude/skills/trellis-finish-work/SKILL.md`
- `.claude/commands/trellis/finish-work.md`

## 回滚点

- 如果 release inference 文案过长或触发不合适，收窄 `overrides/skills/trellis-finish-work.md`。
- 如果新增 skill 触发过宽，收窄 `trellis-release` 的 `description`。
- 如果确认不需要该能力，删除 finish-work skill override 和 `trellis-release` 源 / 快照 / 当前项目副本，再恢复当前项目 finish-work 入口。
