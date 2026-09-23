# 技术设计

## 边界与权威源

- 行为权威源：`vendor/skill-garden/.trellis/0.6/scripts/task_lifecycle.py`。
- 快照：通过 `npm run sync` 生成 `enhancements/0.6/scripts/task_lifecycle.py`。
- 编译目标：通过 `npm run patch:targets` 生成并以 `npm run patch:targets:check` 校验。
- dogfood：通过 Flower Plugin 生命周期更新当前项目的 `.trellis/scripts/task_lifecycle.py`。
- 回归测试：`test/python/test_task_lifecycle.py`；项目合同：`.trellis/spec/flower-trellis/cli/enhancements-model.md`。

## 候选分类

收敛前同时读取候选目录的 tracked files、Git porcelain 状态和 `git ls-files --others --exclude-standard` 文件集。

完全未跟踪候选必须满足：

1. tracked files 为空；
2. porcelain 记录非空且全部为 `??`；
3. `task.json` 位于可纳管的未跟踪文件集；
4. 目录仍通过既有任务解析和状态校验。

除此之外，只有当前已支持的 verified runner-owned `task.json` 变更可以越过 dirty guard。混合状态和已跟踪人工修改继续返回 `candidate-dirty`。

## 精确提交数据流

为 reconciliation 批次分别累计：

- `writes`：需要原子改写的 `task.json` 及新 JSON；
- `commit_paths`：普通候选使用精确 `task.json`，完全未跟踪候选使用任务目录根；
- `expected_files`：普通候选加入 `task.json`，完全未跟踪候选加入目录内全部 Git 可纳管未跟踪文件。

扩展批量写入 helper，使其可接收显式 `commit_paths` 与 `expected_files`，未传时保持现有“仅提交 writes”默认语义。写入失败或提交尚未更新 HEAD 时，仍只回滚被改写的 JSON 原始字节；其余未跟踪文件从未被修改。

精确提交层继续负责临时 index、文件集相等校验、候选外指纹、固定分支引用与 HEAD、CAS、journal 恢复和真实 index 刷新。

## 兼容性与安全性

- 被 Git ignore 的文件不进入 `git ls-files --others --exclude-standard`，保持本地且不纳入提交。
- 中文、空格、制表符路径继续使用 NUL 分隔的 Git 输出，不新增按行解析。
- 批次内 pathspec 可同时包含任务目录和其他任务的 `task.json`；排序去重由精确提交层完成。
- GC 和 restore 不复用此次放宽条件，避免扩大物理移动/恢复授权。
- 若文件集在候选计算与提交之间变化，既有 staged fileset 校验必须失败关闭。

## 回滚

代码回滚只需恢复 helper 参数扩展与 reconciliation 候选分支；已由 maintenance 创建的任务记录提交是普通本地 Git commit，不在运行时自动反向改写。
