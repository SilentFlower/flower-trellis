# 实施计划：统一 CLI 调用契约与帮助体验

## 1. 基线与影响面

- [x] 记录当前相关聚焦测试基线，并确认现有 `worktree --help` 未提交改动的测试状态。
- [x] 搜索仓库内所有依赖 `task.py current`、`untracked_flow.py status` 退出码的调用方，区分查询与严格门禁。
- [x] 确认 Skill-Garden canonical、Flower enhancement 快照和当前 `.trellis` dogfood 副本的生成路径。

## 2. Python 查询状态契约

- [x] 在 Skill-Garden Patch/Bundle 中调整 `task.py current`：有效空状态返回 0，并保持三种输出模式可机器判断。
- [x] 调整 canonical `untracked_flow.py`：`status` 对活动任务返回 `not-applicable`，写入型命令继续执行严格互斥校验。
- [x] 更新 workflow/skill 中仍把查询非零作为正常分支的调用方或说明（仓库内未发现依赖查询非零退出码的运行时调用方）。
- [x] 增加无任务、活动任务、runtime 损坏和写入前置条件回归测试。

## 3. 统一任务引用

- [x] 在公共 `task_utils` 中实现确定性的唯一后缀匹配和歧义诊断。
- [x] 让 `decision_log.py` 与 `task_progress.py` 复用同一解析能力，并保留活动任务目录边界校验。
- [x] 更新两个命令的帮助文本和错误提示。
- [x] 增加精确名、短名、歧义名、相对路径、绝对路径、项目外路径与不存在任务测试。

## 4. Progress 写入归一化

- [x] 在 canonical `task_progress.py` 中仅对缺失的 `updatedAt` 自动填充 UTC 时间。
- [x] 保持空值、错误类型、额外字段和其它必填字段的现有失败语义。
- [x] 为 `write --help` 增加字段说明和最小 JSON 示例。
- [x] 增加固定时钟、显式时间保留和非法输入测试。

## 5. Flower 帮助矩阵

- [x] 清点所有 Flower 自有一级命令现有的 `-h/--help` 行为和副作用边界。
- [x] 为 `update`、`self-update` 及其它缺口补充命令级帮助短路，并抽取最小 `hasHelpFlag` helper。
- [x] 保留并整合当前 `worktree --help` 改动，不覆盖用户或既有工作区修改。
- [x] 增加真实 CLI 帮助矩阵测试，断言退出 0、stderr 为空和关键导航内容。
- [x] 用隔离目录零写入测试和入口顺序断言覆盖联网、同步、写盘、prompt、PTY/子进程边界。

## 6. 同步与规范

- [x] 从 Skill-Garden canonical 运行 `npm run sync` 更新 `enhancements/0.6`。
- [x] 更新当前项目 dogfood 副本并检查 Patch compiled targets。
- [x] 更新 `.trellis/spec/flower-trellis/cli/cli-output.md` 和必要的 enhancement/runtime 契约章节。
- [x] 检查生成差异，只保留本任务相关派生变更。

## 7. 验证命令

```bash
python3 -m unittest discover -s test/python -p 'test_untracked_flow.py'
python3 -m unittest discover -s test/python -p 'test_decision_log.py'
python3 -m unittest discover -s test/python -p 'test_task_progress.py'
python3 -m unittest discover -s test/python -p 'test_task_current_query.py'
python3 -m unittest discover -s test/python -p 'test_task_reference_resolution.py'
node --test test/js/cli-help.test.js test/js/worktree-cli.test.js test/js/flower-update-contract.test.js
python3 -m py_compile vendor/skill-garden/.trellis/0.6/scripts/decision_log.py
python3 -m py_compile vendor/skill-garden/.trellis/0.6/scripts/task_progress.py
python3 -m py_compile vendor/skill-garden/.trellis/0.6/scripts/untracked_flow.py
npm run patch:targets:check
node scripts/check-patch-conflicts.mjs
npm test
```

`node scripts/check-snapshot.mjs` 依赖已提交的 submodule pin 和干净发布快照，仅在发版阶段运行，
不作为当前未提交实现阶段的质量门禁。

## 8. 完成前检查

- [x] 四类验收标准均有自动测试，不只依赖帮助文案人工检查。
- [x] 查询型成功与写入型失败的退出码矩阵保持一致。
- [x] canonical、enhancement 和 dogfood 三层无漂移。
- [x] 未回退当前工作区已有的 worktree 帮助与其他用户改动。
- [x] Full Check-All 重检已通过；当前进入规范更新与推送计划流程。
