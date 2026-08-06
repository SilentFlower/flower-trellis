# Implement - Worktree 多仓基线确认与会话交接

## Ordered Work

- [x] 在 canonical `worktree_setup.py` 中提取只读 create plan，默认 base 使用当前分支，detached HEAD 回退 `HEAD`。
- [ ] 增加来源仓库、base、target、task、submodule inventory 和 confirmation DTO。
- [x] 复用稳定 Git porcelain 解析，增加来源根仓 dirty 摘要和 plan fingerprint。
- [x] 增加 `--yes` / `--plan-fingerprint`；无 `--yes` 返回 `confirmation-required`，fingerprint 不匹配返回 `create-plan-changed`，匹配才进入现有写入事务。
- [x] 增加 route 偏好 allowlist 读写：拒绝 symlink/非普通文件，只生成规范化合法字段。
- [x] `create` 仅为同一开发者继承 route 偏好；缺失、非法或开发者不同只报告不继承。
- [x] `prepare` 增加显式 `--inherit-route-prefs`，校验来源/目标同 Git common-dir、同开发者，并保留目标已有偏好。
- [x] 让真实 create 复用 plan 中的 effective base，并扩展 handoff workspace/session 字段。
- [ ] 更新 Flower `worktree` facade 参数校验、source 注入、人类输出和 CLI help。
- [ ] 更新 canonical Codex/Claude `trellis-worktree` Skill，加入预检、单问题确认、harness 多仓分开展示、改选重检和新 workspace 会话交接。
- [x] 更新 Branch-Local Trellis Worktree 规格，包括签名、状态、确认门禁、harness 和兼容性矩阵。
- [ ] 扩展 Python 测试：零写预检、当前分支默认、detached fallback、改选 ref、非法 ref、submodule inventory、dirty 摘要、fingerprint stale、同/异开发者 route 偏好、非法偏好、prepare 显式继承、目标保留、`--yes` 创建和回滚。
- [ ] 扩展 Node 测试：`--yes` / fingerprint / prepare inherit parse-forward、非法命令使用、dirty/transfer 确认摘要和真实 JSON 计划。
- [x] 运行 `npm run sync`，核对 vendor canonical 与 `enhancements/0.6` 快照一致。
- [x] 按项目 SOP 刷新/检查 compiled targets 和 dogfood Skill 投影。

## Validation

```bash
python3 test/python/test_worktree_setup.py
python3 -m py_compile vendor/skill-garden/.trellis/0.6/scripts/worktree_setup.py
node --test test/js/worktree-cli.test.js
npm run sync
npm run patch:targets:check
node scripts/check-patch-conflicts.mjs
npm test
npm pack --dry-run --json
git diff --check
```

## Risk Points

- `create` 默认从写入变为预检会影响现有脚本；必须在 help、Skill 和错误矩阵中明确 `--yes`。
- fingerprint 把 dirty 和 route 偏好纳入确认事实；稳定排序或字段漂移会导致无意义的重新确认，DTO 和测试必须锁定顺序。
- base 默认值从字符串 `HEAD` 改为当前分支名后，task `base_branch` 记录会变化；detached HEAD 必须保持可用。
- submodule 只用于展示，不能误触发 checkout、fetch 或分支创建。
- route 偏好只能做字段级 allowlist，不能复用目录复制或跟随 symlink；`.claude/settings.local.json` 明确不进入实现。
- vendor 子仓是 canonical 源；根仓快照必须通过同步脚本生成，不能只改生成副本。
