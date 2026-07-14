# Check-All Collect-All 实施计划

## 实施步骤

1. 更新 0.6 `trellis-check-all` 的 `.agents` 源副本。
   - 将执行模式改为 audit-only collect-all。
   - 增加适用维度快速路径与 `N/A` / 部分验证 / 阻塞状态。
   - 删除 Step 1、Step 2 的普通问题立即暂停规则。
   - 明确 Step 3 只复用 `trellis-check` 检查清单，不继承自动修复指令。
   - 增加统一问题模型、检查报告、单次修复选择和修复结果模板。
   - 明确普通模式与 auto-loop 的不同后续动作。

2. 将同一语义同步到 0.6 `.claude` 源副本。
   - 两份文件除平台必要差异外应内容一致。

3. 更新 0.6 `trellis-route` 的 `.agents` 与 `.claude` 源副本。
   - 保留 inline check-all 映射。
   - subagent check-all 不再回退到 `trellis-check` agent。
   - 定义专用 audit-only agent优先、通用 subagent fallback、无兼容 subagent 时阻塞的映射。
   - dispatch prompt 保留 `Active task:` 首行和任务上下文加载协议。

4. 运行 `npm run sync` 生成 `enhancements/0.6` 快照。

5. 从生成后的 0.6 快照同步当前 dogfood 副本。
   - `.agents/skills/trellis-check-all/SKILL.md`
   - `.claude/skills/trellis-check-all/SKILL.md`
   - `.agents/skills/trellis-route/SKILL.md`
   - `.claude/skills/trellis-route/SKILL.md`

6. 静态复核输出契约和工作流边界。
   - 检索并确认不再存在普通问题“立即暂停”或 check-all 自动修复指令。
   - 确认 `trellis-check` agent fallback 已移除。
   - 确认 Post-check、Phase 3.3/3.4 和 auto-loop 文案未被破坏。

7. 运行一致性与质量验证。

## Validation Commands

```bash
# 0.6 同平台源副本一致
diff -u \
  vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-check-all/SKILL.md \
  vendor/skill-garden/.trellis/0.6/.claude/skills/trellis-check-all/SKILL.md
diff -u \
  vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-route/SKILL.md \
  vendor/skill-garden/.trellis/0.6/.claude/skills/trellis-route/SKILL.md

# 发布快照与源一致
diff -u \
  vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-check-all/SKILL.md \
  enhancements/0.6/.agents/skills/trellis-check-all/SKILL.md
diff -u \
  vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-route/SKILL.md \
  enhancements/0.6/.agents/skills/trellis-route/SKILL.md
diff -u \
  vendor/skill-garden/.trellis/0.6/.claude/skills/trellis-check-all/SKILL.md \
  enhancements/0.6/.claude/skills/trellis-check-all/SKILL.md
diff -u \
  vendor/skill-garden/.trellis/0.6/.claude/skills/trellis-route/SKILL.md \
  enhancements/0.6/.claude/skills/trellis-route/SKILL.md

# dogfood 副本与快照一致
diff -u enhancements/0.6/.agents/skills/trellis-check-all/SKILL.md .agents/skills/trellis-check-all/SKILL.md
diff -u enhancements/0.6/.claude/skills/trellis-check-all/SKILL.md .claude/skills/trellis-check-all/SKILL.md
diff -u enhancements/0.6/.agents/skills/trellis-route/SKILL.md .agents/skills/trellis-route/SKILL.md
diff -u enhancements/0.6/.claude/skills/trellis-route/SKILL.md .claude/skills/trellis-route/SKILL.md

# 关键语义检查
if rg -n '\| `subagent check-all` \|.*Agent\(\{subagent_type: "trellis-check"\}\)' \
  vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-route/SKILL.md; then
  exit 1
fi
rg -n "CHK-001|修复全部|仅保留报告|audit-only|auto-loop|Phase 3.3|trellis-push" \
  vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-check-all/SKILL.md \
  vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-route/SKILL.md

git diff --check
git -C vendor/skill-garden diff --check
```

`node scripts/check-snapshot.mjs` 要求 vendor 与 `enhancements/` 均已提交，因此不作为 Phase 2.2 提交前工作区检查命令。

## Phase 3.4 双仓交付

1. 使用 `trellis-push` 仅处理 vendor 中的 0.6 源改动，父仓所有 dirty 保持未提交。
2. vendor commit/push 成功后，在父仓重新运行 `npm run sync`。
3. 确认 `enhancements/MANIFEST.json.sourceCommit` 等于新的 vendor HEAD，并重新执行本文件的源、快照、dogfood 一致性命令。
4. 使用 `trellis-push` 处理父仓改动。
5. 父仓提交完成且双仓工作区干净后运行：

```bash
node scripts/check-snapshot.mjs
```

该顺序是生成依赖，不得压缩成一个预先固定文件内容的多仓提交计划。

## Review Gates

- Gate 1：collect-all 规则不得把真正阻塞条件也延迟到最终报告。
- Gate 2：普通模式只能有一次修复范围确认；auto-loop 不展示该确认。
- Gate 3：subagent check-all 不得调用带强制自修复语义的 `trellis-check` agent。
- Gate 4：报告不得包含提交计划或进入 `trellis-push` 的确认文案。
- Gate 5：0.5 和 old 变体无任何内容变化。
- Gate 6：Phase 3.4 先交付 vendor，再重新 sync 和交付父仓；最终 `check-snapshot` 通过。

## Rollback Points

- 源 skill 编辑后、运行 `npm run sync` 前：可只回退 vendor 中四个源文件。
- 快照生成后：恢复 vendor 源并重新运行 `npm run sync`，不要手工逐份回退派生副本。
- dogfood 同步后：以重新生成的 `enhancements/0.6` 为唯一复制来源恢复。
