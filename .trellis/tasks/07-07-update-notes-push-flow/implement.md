# 优化自动更新变更说明与推送联动 - Implement

## Checklist

1. 发布 metadata 生成
   - 抽出 CHANGELOG 段落解析复用逻辑,避免 `extract-changelog.mjs` 和新脚本各自维护标题正则。
   - 新增 `scripts/write-release-notes-metadata.mjs`,读取当前 `package.json.version`,抽取 CHANGELOG 对应版本段,写入 `package.json.flowerReleaseNotes`。
   - 在 `package.json` 的 `commit-and-tag-version.scripts.postchangelog` 接入新脚本。
   - dry-run 或脚本直接运行时提供可验证输出,不创建 tag / 不发布。

2. registry metadata 与 release notes 聚合
   - 扩展 `src/lib/update-check.js`,在一次 registry 请求中解析 dist-tags 和 `versions[*].flowerReleaseNotes`。
   - 保持 `fetchPackageDistTags()` 兼容。
   - 新增 release notes 聚合函数:按 from/to/channel 过滤版本、限制 5 个版本 / 1600 字符 / 单版本 500 字符。
   - 处理缺失、损坏、版本不匹配、超长和无 notes 的情况。

3. manifest 与 self-check
   - 更新 `src/lib/manifest.js` 的 `DEFAULT_UPDATE_CHECK` / `normalizeUpdateCheck()`,支持 `lastReleaseNotes`。
   - 更新 `src/lib/self-check.js`:在 `update_available` 和 `project_out_of_sync` 中填充 `releaseNotes`。
   - 成功远端探测时写入 `lastReleaseNotes`;失败时不刷新 `lastCheckedAt`,不覆盖已有可用 notes。
   - 保持 `lastRemote` 只记录 dist-tags。

4. hook 注入
   - 更新 `src/assets/flower_update_hook.py`,输出 release notes JSON、range、truncated / moreVersions 标记。
   - `policy=ask` 时在 AI 指令中要求先展示摘要与命令,再询问用户确认。
   - 同步项目 dogfood 副本 `.trellis/scripts/flower_update_hook.py`。

5. self-update 输出
   - 更新 `src/commands/self-update.js`:dry-run 输出 notes 预览和 `post_action_preview`。
   - 真实执行成功后检查目标 git dirty 状态,输出 `<flower-update-result>` 和 `post_action=run_trellis_push_confirmation`。
   - 确认不执行 git add / commit / push。

6. workflow override 与快照
   - 更新 `vendor/skill-garden/.trellis/0.6/overrides/workflow.md`,增加轻量 flower update 兜底段。
   - 运行 `npm run sync` 同步 `enhancements/0.6`。
   - 同步当前项目 `.trellis/workflow.md` / dogfood 副本,确保当前会话后的 update 行为一致。

7. 规范同步
   - 更新 `.trellis/spec/flower-trellis/cli/config-and-state.md`:manifest、self-check、hook release notes、缓存语义。
   - 更新 `.trellis/spec/flower-trellis/cli/release-and-publishing.md`:postchangelog 写 metadata 的 release 合同。
   - 更新 `.trellis/spec/flower-trellis/cli/enhancements-model.md`:workflow override 同步要求。
   - 必要时更新 `.trellis/spec/flower-trellis/cli/quality-guidelines.md` 的验证清单。

## Validation Commands

```bash
node --check src/cli.js && for f in src/lib/*.js src/commands/*.js; do node --check "$f"; done
node --check scripts/extract-changelog.mjs
node --check scripts/write-release-notes-metadata.mjs
python3 -m py_compile src/assets/flower_update_hook.py
python3 -m py_compile .trellis/scripts/flower_update_hook.py
git diff --check
```

行为验证:

- 用 fixture registry JSON 或可控函数输入验证 stable 目标不混入 beta notes。
- 验证 beta 目标只聚合 beta notes。
- 验证超过 5 个版本、单版本 500 字符、总 1600 字符时设置截断标记。
- 验证无 `flowerReleaseNotes` 的历史版本不会让 self-check 失败。
- 验证 `self-check --json` 在 `update_available` 和 `project_out_of_sync` 中都输出 `releaseNotes`。
- 用假 `flower-trellis self-check --json` 驱动 `flower_update_hook.py`,stdout 是合法 SessionStart JSON,且顶层不包含 `additional_context`。
- 验证 `self-update --dry-run` 输出 `write=false` 和 `post_action_preview`,不输出真实 push post_action。
- 验证真实 `self-update` 完成输出 `post_action=run_trellis_push_confirmation`,但不执行 git 提交。
- 运行 `npm run release:dry` 或等价脚本验证 `postchangelog` metadata 生成路径不会破坏 release dry-run。
- `npm pack --dry-run --json` 检查包内容和 package metadata 体积可控。

## Risk Points

- registry 根文档较大,必须完整读取并解析;不要像固定字节前缀读取那样截断 JSON。
- release notes 是可选增强,不得影响版本判断、远端缓存失败语义或 hook 启动。
- package metadata 字段发布后会被历史 npm 版本保留;字段结构先按内部 schema 处理,读取方要宽容。
- workflow override 必须先改 `vendor/skill-garden`,再 sync 到 `enhancements`;不要只改当前项目副本。
- `self-update` 后检测 git dirty 不能替代 `trellis-push` 的文件归属判断;只作为后续动作提示。

## Review Gate

实现前确认:

- PRD 已收敛且无开放问题。
- `design.md` 已覆盖发布 metadata、self-check、hook、manifest、self-update 和 workflow override。
- `implement.jsonl` / `check.jsonl` 已替换为真实 spec / research 条目。
- 用户已审核并同意进入 `task.py start`。
