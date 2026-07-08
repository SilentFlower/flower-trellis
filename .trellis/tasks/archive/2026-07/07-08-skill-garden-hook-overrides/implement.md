# 支持 skill-garden hook override 实施计划

## Checklist

1. 准备 hook override 源
   - 从当前 Trellis shared `inject-workflow-state.py` 拷贝为
     `vendor/skill-garden/.trellis/0.6/overrides/hooks/shared/inject-workflow-state.py`。
   - 在 override 源中加入 `_codex_has_trellis_session_start(root)`。
   - 修改 Codex no_task bootstrap 注入条件,保留 `<codex-mode>` 和 `<workflow-state>`。

2. 同步快照
   - 确认 `scripts/sync-enhancements.mjs` 已递归复制 `overrides/`。
   - 增加 manifest 统计字段 `hookOverrides`,递归列出 `overrides/hooks/` 下文件。
   - 运行 `npm run sync`。

3. 实现 hook override 注入模块
   - 新增 `src/lib/hook-override-inject.js`。
   - 定义首批 shared hook 映射:
     - `inject-workflow-state.py` -> `.codex/hooks/inject-workflow-state.py`
     - `inject-workflow-state.py` -> `.claude/hooks/inject-workflow-state.py`
   - 目标文件不存在时计为 missing/skip,不创建目录。
   - 内容一致时计为 unchanged,不写盘。
   - 内容变化时先 `preserveFirstBackup()` 再写入。

4. 接入全装链路
   - 在 `src/lib/apply-enhancements.js` 中导入并调用 `injectHookOverrides()`。
   - 仅 `skills.length === 0` 时调用。
   - 输出保持简洁:有 changed 时打印注入数量;无源或无目标时使用跳过/无需更新语义。

5. 同步 dogfood 项目
   - 对当前项目运行或等价调用全装路径,让 `.codex/hooks/inject-workflow-state.py` 和
     `.claude/hooks/inject-workflow-state.py` 应用 override。
   - 保留 `.trellis/.backup-flower/` 中首次备份。

6. 同步规范
   - 更新 `.trellis/spec/flower-trellis/cli/enhancements-model.md`:
     - hook override 目录约定。
     - 全装应用边界。
     - 不写 manifest paths 的原因。
     - 幂等与备份规则。

7. 验证
   - `node --check src/cli.js && for f in src/lib/*.js src/commands/*.js scripts/*.mjs; do node --check "$f"; done`
   - `python3 -m py_compile vendor/skill-garden/.trellis/0.6/overrides/hooks/shared/inject-workflow-state.py enhancements/0.6/overrides/hooks/shared/inject-workflow-state.py .codex/hooks/inject-workflow-state.py .claude/hooks/inject-workflow-state.py`
   - 模拟 Codex no_task hook,已注册 SessionStart 时断言:
     - `bootstrap=False`
     - `codex_mode=True`
     - `workflow_state=True`
   - 在临时副本中移除 `.codex/hooks.json` 的 `SessionStart`,再次模拟 no_task hook,断言
     `bootstrap=True`。
   - 重复运行注入模块,确认第二次 unchanged。
   - `git diff --check`

## Review Gates

- 实现前:用户确认 `prd.md` / `design.md` / `implement.md` 可以进入 implementation。
- 启动任务前:生成并展示 `brief.md`。
- 实现后:运行完整验证并进入 check/check-all。

## Rollback

- 若 hook override 注入行为异常,可从 `applyEnhancements()` 暂时移除
  `injectHookOverrides()` 调用,目标项目会保留已写文件。
- 若目标项目 hook 内容需要回滚,使用 `.trellis/.backup-flower/<平台 hook 路径>` 中的首次备份。
- 若 sync 后快照不符合预期,删除 `vendor/skill-garden/.trellis/0.6/overrides/hooks/` 并重新
  `npm run sync`。
