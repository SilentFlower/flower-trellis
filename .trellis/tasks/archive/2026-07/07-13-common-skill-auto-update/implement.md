# common skill 自动随新版更新 - Implement

## Checklist

1. 扩展 common skill catalog
   - 为 canonical 与 legacy 目标建立明确的“目标路径 → 快照源”映射。
   - 增加读取 `enhancements/MANIFEST.json.common.removedSkills` 的容错能力。
   - 增加同步函数：只覆盖当前快照中已存在的目标目录，并精确删除 tombstone 命中的目录。
   - 保持 `installCommonSkills()`、`removeCommonSkills()` 和菜单安装状态使用同一组名称/路径定义。

2. 接入全量强化流水线
   - 在 `applyEnhancements()` 的无 `--skills` 分支调用 common skill 同步。
   - 输出刷新数、删除数和无操作摘要。
   - 不把 common skill 路径并入目标 `.flower-manifest.json.paths`。

3. 累计发布快照 tombstone
   - `scripts/sync-enhancements.mjs` 清空 `enhancements/` 前读取旧 manifest。
   - 根据旧 current、旧 removed 与新 current 计算排序去重后的 `common.removedSkills`。
   - 加入 `sub2api-account-json-fix` 首次迁移 tombstone。
   - 运行 `npm run sync` 更新并审核 `enhancements/MANIFEST.json`。

4. 更新文档和项目规范
   - README 的强化包更新说明补充：已启用 common skill 自动刷新、未启用不安装、已移除自动删除。
   - 实现验证后将 common skill 更新/删除契约写回 `enhancements-model.md`。

5. 验证
   - 运行全仓 Node.js 语法检查和 `git diff --check`。
   - 在临时 Trellis 目标构造 Codex、Claude、双平台和 legacy `.agents` 安装。
   - 验证当前技能内容覆盖、内部旧文件清理、新增未安装技能不落盘。
   - 验证 tombstone 删除 canonical/legacy 精确路径且保留其它用户技能。
   - 验证全量 `--enhance-only` 执行同步，`--dry-run`、`--no-enhance`、带 `--skills` 不同步。
   - 连续运行两次同步/叠加，确认幂等且 tombstone 不丢失。

## Validation Commands

```bash
node --check src/cli.js
for f in src/lib/*.js src/commands/*.js; do node --check "$f"; done
node --check scripts/sync-enhancements.mjs
npm run sync
git diff --check
```

临时项目行为验证使用仓库内 `node bin/flower-trellis.js` 或直接导入目标 lib，测试目录放在已忽略的 `.trellis-tmp/` 或系统临时目录，验证后清理。

## Review Gates

- 自动删除只接受固定 common 根目录与精确 tombstone 名称。
- 新 common skill 在没有目标目录时不得被复制。
- common skill 不进入目标工作流强化 manifest paths。
- `enhancements/MANIFEST.json` 的 tombstone 必须跨连续 `npm run sync` 保持稳定。

## Rollback Points

- 若运行时同步有误，先撤回 `applyEnhancements()` 接入，保留 catalog 辅助函数不执行写入。
- 若 tombstone 生成有误，恢复同步前 manifest 计算逻辑并重新运行 `npm run sync`，不得手工只改生成后的快照。
