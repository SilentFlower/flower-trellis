# Trellis 0.6.14 升级实施计划

## 1. 建立新上游基线

- [x] 把 `package.json` 的 `@mindfoldhq/trellis` 精确版本改为 `0.6.14`，刷新 `package-lock.json` 并确认 Trellis/Core 均为 `0.6.14`。
- [x] 使用仓库现有生成器创建官方 `0.6.14` all-platform fixture，记录迁移 manifest 与目标文件差异。
- [x] 在任何 Patch 编辑前运行 required preflight，保存 20 条已知失败及是否出现新增失败。

## 2. 合并 Session Context 与 SessionStart

- [x] 重定基线 `scripts/session-context-update-boundary` 的 helper/output selector，适配公开 `get_update_hint()`。
- [x] 新增共享 SessionStart update relay 的局部 Patch，覆盖 Claude、CodeBuddy、Cursor、Factory、Gemini、Kiro、Qoder、Trae、ZCode。
- [x] 更新 bundle、target、operation ordering 与 `conflicts.json`，断言 Flower update hook 唯一且 first-reply notice 保留。
- [x] 通过 required 漂移零写入、冲突断言和最终产物回归覆盖双提示、无提示、ImportError 死路径与整块误覆盖风险。

## 3. 重定基线 Trellis Meta

- [x] 用 `0.6.14` `collect<Platform>Templates()` 章节更新 platform Skill Root baseline。
- [x] 重写 Flower managed content，保留 21 平台 root、共享 `.agents/skills` 与 ownership 说明。
- [x] 更新 18 个平台输出的集合/最终内容测试，不手工维护平台副本。

## 4. 验证上游跨平台修复未被覆盖

- [x] 增加 Gemini、Qoder、CodeBuddy、Droid、Trae、ZCode shell-ticket/env session identity 回归。
- [x] 增加 CodeBuddy/ZCode/Trae 平台检测顺序与 CodeBuddy `cwd=/` fallback 回归。
- [x] 断言 CodeBuddy、Trae、Qoder 的 PreToolUse matcher 最终值。
- [x] 组合验证 Flower active-task missing/corrupt/io_error、原子替换、clear/fallback 与新 context key。
- [x] 核对 shared SessionStart、inject-workflow-state、task context 等当前 Patch 目标，只有真实 selector 漂移时才做局部重定基线。

## 5. 接入 memory 与 Grok

- [x] 验证 `@mindfoldhq/trellis-core@0.6.14` 的压缩 turn 恢复与 Grok session reader 可由 `trellis mem` 使用。
- [x] 更新 Flower managed `trellis-session-insight` 平台说明与测试，加入 Grok，明确 OpenCode 仍不支持。

## 6. 更新兼容声明与生成产物

- [x] 把 `vendor/skill-garden/.trellis/0.6/overrides/compatibility.json.testedVersions` 改为仅 `0.6.14`。
- [x] 更新 conflicts、fixture、测试、README 和长期 spec 中属于“当前精确基线”的 `0.6.12` 引用；保留历史场景中确实表示升级来源的 `0.6.12`。
- [x] 生成 `vendor/skill-garden/compiled-targets/0.6.14/full`，移除旧精确 compiled target。
- [x] 运行 `npm run sync`，验证 vendor canonical 与 `enhancements/0.6` 逐字节一致。
- [x] 对当前 dogfood 运行 Flower replay，比较关键 Hook/Skill/workflow 最终语义，并确认第二次 replay 为零变化。

## 7. 定向验证

- [x] `node bin/flower-trellis.js -v` 显示 bundled Trellis `0.6.14`。
- [x] Patch targets、required preflight、conflict audit 和 compiled target check 全部通过。
- [x] 更新提示、first-reply notice、Active Task、session identity、platform matcher、Meta 和 memory/Grok 专项通过。
- [x] 使用最小 `0.6.12` 项目运行普通 `update --dry-run`，断言来源树零写入并预览升级到 `0.6.14`。
- [x] 覆盖真实 Plugin replay 失败补偿、`--no-enhance`、同版本 dry-run 和错误 `--enhance-only` 基线。

## 8. 全量门禁

按仓库实际命令执行并记录：

```bash
npm test
npm run sync
npm run patch:targets
npm run patch:targets:check
node scripts/check-patch-conflicts.mjs
node scripts/check-ai-context-budget.mjs --strict
node scripts/check-output-templates.mjs
node bin/flower-trellis.js -v
node bin/flower-trellis.js update --dry-run --no-update-check
npm pack --dry-run --json
git diff --check
git -C vendor/skill-garden diff --check
```

- [x] 运行发布快照一致性检查；当前仅因 `vendor/skill-garden` 尚未提交命中 Git-stage 门禁，canonical/snapshot 字节一致、compiled target 与冲突检查均已通过，提交子仓并更新 pin 后须重跑。
- [x] 使用 `trellis-check-all` 做最终 full-scope 检查，剩余 `CHK-*` / `FBK-*` 为零。
- [x] 长期契约变化已通过 `trellis-update-spec` 回写，再进入 `trellis-push`；本任务不执行 npm 发布或 tag。

## 9. 高风险文件与回滚点

- `vendor/skill-garden/.trellis/0.6/overrides/patches/scripts/session-context-update-boundary/`
- 新增的共享 SessionStart update boundary Patch、相关 bundle 与 `conflicts.json`
- `vendor/skill-garden/.trellis/0.6/overrides/patches/skills/trellis-meta/managed-architecture-and-ownership/`
- `vendor/skill-garden/compiled-targets/0.6.14/full/`
- `package.json`、`package-lock.json`、`enhancements/0.6/`

若上述任一层无法同时收敛，应整体回退依赖、canonical 和 snapshot 到 `0.6.12`，不得保留混合基线。
