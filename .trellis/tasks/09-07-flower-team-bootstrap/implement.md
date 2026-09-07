# 实施计划

## 阶段

- 最终 Brief 已审阅，任务已启动为 in_progress；安装体验及复用现有 hook 均已确认。
- 启动后进入 `trellis-route(target=implement)`，由 route 决定执行模式，并遵循 `trellis-before-dev`。
- 保留 task.json 基线的 19 条变更，不在当前脏项目上做升级验证。

## 执行顺序

1. [x] 完成忽略规则与事务接口。
   - 在 Skill-Garden 适配器旁增加窄范围元数据规划 helper，返回现有 mutation/payload，不增加新安装引擎。
   - 更新 ProjectStore 局部规则及根文件存在时的 managed block；保持共享三文件可见和 settings 本地属性。
   - 修正 TransactionWriter 在 ensureLayout 前保存局部原字节并失败恢复，兼容普通插件和 worktree 使用同一规则集。
2. [x] 完成旧记录退出。
   - manifest 模块增加纯迁移规划，内置适配器合并配置写入与旧文件删除。
   - 验证所有目标进入 update 补偿；仅在发现覆盖缺口时修改 update/update-transaction。
   - 移除无生产调用的旧写入 API、调整测试夹具和 `update-check get` 过时提示。
3. [x] 完成会话安装引导。
   - 更新 Flower hook：缺失诊断、严格锁版本解析、bootstrap-only 和成员确认协议。
   - 更新两份 vendor 手动升级 skill，生成 enhancements；保持原平台注册协议。
4. [x] 验证并同步说明。
   - 补充真实 Git、迁移、失败回滚、dry-run、hook 和平台分发测试，必要时增加聚焦元数据集成测试。
   - 在 README 相关安装/升级说明中记录共享文件和成员安装体验。
   - 更新相关 spec，移除仍要求成功保留旧 manifest 的有效契约。
5. [x] 进入 `trellis-route(target=check)`，完成 Check-All 和规范更新阶段。
   - 本次不发版；后续提交按 trellis-push 展示实际范围再确认。

## 验证命令

聚焦验证、sync、全量 npm test、语法及隔离 dogfood 已通过。`FBK-001` 已修复，本轮 Python 9/9、平台/迁移/克隆回归 19/19 和语法校验通过；复用首次 full 证据完成 light 重检，剩余 CHK/FBK 为 0，详见 [检查记录](./check-report.md)。步骤 5 已完成；规范复核修正 enhancements-model.md 中旧 manifest 成功后保留的过时描述，结果为 written，已核对实现、测试及格式。当前进入 trellis-push 提交计划阶段，尚未提交或推送。所有重任务串行经保护入口；返回 75 等待，资源失败缩小范围，不绕过保护。

```bash
/root/.local/bin/wsl-safe-run node --test test/js/plugin-project-store.test.js test/js/plugin-transaction-writer.test.js test/js/plugin-skill-garden.test.js test/js/plugin-e2e-migration.test.js test/js/update-check.test.js test/js/worktree-flower-state.test.js
/root/.local/bin/wsl-safe-run python3 -m unittest discover -s test/python -p 'test_flower_update_hook.py'
/root/.local/bin/wsl-safe-run npm run sync
/root/.local/bin/wsl-safe-run node --test test/js/flower-update-contract.test.js test/js/platform-patches.test.js test/js/platform-skill-distribution.test.js
/root/.local/bin/wsl-safe-run npm test
```

- 语法校验按实际改动执行，新增测试加入聚焦命令。
- `npm test` 含 JS/Python、Patch 冲突、compiled targets、默认上下文预算和输出模板；通过后不无理由重复全量。
- canonical targets 若因本次源 skill 修改发生预期漂移，按仓库生成入口刷新，审阅范围后重跑失败门禁。
- dogfood 在隔离临时目标执行真实 init、重复升级、dry-run、卸载预览；不升级当前项目、不做真实全局 npm 安装。安装分支使用隔离可执行夹具验证。
- 人工审阅一份实际 hook 输出的版本、确认、命令和验证步骤；注入成功不等于保证所有宿主模型遵循。

## 验收矩阵

| 场景 | 预期 | PRD |
| --- | --- | --- |
| 根/局部通配忽略、LF/CRLF、重复升级 | 共享文件可见，无重复，保留用户规则 | A1/A2 |
| 无根 gitignore | 不新建，标准本地数据仍被忽略 | A2 |
| legacy-only、现代与旧记录并存 | 配置保留、现代优先、旧文件删除 | A3 |
| 损坏配置、目标/lock/state 写入失败 | 明确失败、原字节恢复或修复证据 | A4 |
| dry-run、no-enhance、普通插件项目 | 各入口不越过迁移边界 | A5 |
| 无 CLI、有合法项目锁 | 提示并等待确认，验证后继续 | A6 |
| 无锁/损坏锁、重复条目、非法版本、无 npm、CLI 异常 | 不猜版本、不误导重装或成功 | A7 |
| 升级共享后克隆，目标无 state/CLI | 版本可读，启动输出安装引导 | A8 |

## 回滚与审阅

- 根/局部 gitignore、settings/cache 和旧 manifest 都纳入事务/补偿，每个新增写入能追溯失败测试。
- Plugin state 不独占根忽略文件或个人设置，旧文件删除只针对固定 manifest 路径。
- 不修改当前项目两份既有 `.flower` 记录来制造验证通过，不带入 GitLab skill/遥测文件。
- 若后续扩大自动提醒平台、改变确认体验或共享更多内容，先更新三件套和 Brief。
