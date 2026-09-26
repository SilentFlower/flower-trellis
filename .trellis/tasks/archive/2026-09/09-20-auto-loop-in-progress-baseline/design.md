# Design

## 修复边界

作者源 vendor/skill-garden/.trellis/0.6/scripts/auto_loop.py；回归 test/python/test_auto_loop.py；分发 enhancements/0.6/scripts/auto_loop.py。复用既有摘要、_pending_event、action 身份、保护路径与决策审计校验。

## 新任务基线

_prepare 的 in_progress 分支只在尚未发出 action 且两项摘要均未初始化时读取当前文档。部分摘要或已有历史不可作为全新基线处理。已有 hash 保持冻结。

## 旧运行恢复

两项摘要均为空时，构造只读候选，取 pending 中登记时的摘要，并通过原 action 的完整逐文件基线、action 身份、决策日志和文件权限复核。成功只补遗失字段并追加审计，不取当前文档作为旧基线。失败不迁移。显式 retry-blocked 在清空 action 之前处理旧证据；含合法 pending 的恢复保持原 action，后续 next 重放它。未知漂移仍由原检查器拒绝，record 继续独占重绑。

## 应用与回滚

先隔离回归，npm run sync 后执行项目现有门禁。Plugin dry-run 复核实际目标后更新项目，第二次更新验证零修改；真实 runtime 只通过 runner CLI 读取和推进。现有旧 run 与日志保留。回滚代码通过精确源码回退和 Plugin 生命周期执行，不改运行历史。
