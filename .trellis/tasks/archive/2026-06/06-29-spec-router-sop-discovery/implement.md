# Implement Plan

## Checklist

1. 新增 `vendor/skill-garden/.trellis/0.6/scripts/spec_router.py`。
   - 实现 `.trellis/` 根目录发现。
   - 实现 `.trellis/spec/**/*.md` 扫描，明确覆盖 `.trellis/spec/guides/**/*.md`。
   - 实现简单 frontmatter 解析。
   - 实现轻量打分、排序和 Markdown 输出。
2. 更新 `vendor/skill-garden/.trellis/0.6/overrides/workflow.md`。
   - 增加 `Project Knowledge Discovery` 小节。
   - 使用用户确认的 query 文案，不写死为 `user request`。
3. 更新 0.6 workflow-state sentinel。
   - 至少覆盖 `no_task`、`planning`、`planning-inline`、`in_progress`、`in_progress-inline`。
   - 保持短句，不复制 hub 长规则。
4. 如需要，更新 `src/lib/copy-scripts.js` 中 `spec_router.py` 的 `--skills` 别名。
   - 保持全装路径不变。
   - ESM 导出和 JSDoc 风格不变。
5. 运行 `npm run sync`，把 skill-garden 源同步到 `enhancements/0.6`。
6. 同步当前 dogfood 项目副本：
   - `.trellis/scripts/spec_router.py`
   - `.trellis/workflow.md` 中的 skill-garden hub/state sentinel（通过现有注入机制或手动同步后验证）
7. 验证。

## Validation Commands

```bash
python3 -m py_compile vendor/skill-garden/.trellis/0.6/scripts/spec_router.py
python3 -m py_compile enhancements/0.6/scripts/spec_router.py
python3 -m py_compile .trellis/scripts/spec_router.py
python3 vendor/skill-garden/.trellis/0.6/scripts/spec_router.py "beta release publish tag changelog"
python3 ./.trellis/scripts/spec_router.py "beta release publish tag changelog"
python3 ./.trellis/scripts/spec_router.py "cross layer reuse thinking guide"
npm run sync
cmp -s vendor/skill-garden/.trellis/0.6/scripts/spec_router.py enhancements/0.6/scripts/spec_router.py
cmp -s enhancements/0.6/scripts/spec_router.py .trellis/scripts/spec_router.py
git diff --check
```

如修改 `src/lib/*.js`：

```bash
node --check src/lib/copy-scripts.js
```

## Risky Files

- `vendor/skill-garden/.trellis/0.6/overrides/workflow.md`
- `vendor/skill-garden/.trellis/0.6/overrides/workflow-states/*.md`
- `src/lib/copy-scripts.js`
- `enhancements/0.6/**`
- `.trellis/workflow.md`

## Rollback

- 删除 `spec_router.py` 源、快照和 dogfood 副本。
- 回退 workflow / workflow-state 中的 Project Knowledge Discovery 文案。
- 重新运行 `npm run sync` 让快照回到源状态。
