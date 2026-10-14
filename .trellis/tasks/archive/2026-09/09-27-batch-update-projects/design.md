# 批量更新多个 Flower 项目：技术设计

## 边界与入口

- 新增一级命令 update-all，保持现有 self-update 的单项目语义不变。
- CLI 参数层收集重复的 --root 和 --target；命令层校验 --dry-run、--yes、未知参数及空输入。根帮助、命令帮助和 README 同步说明。
- 扫描仅发生在显式 --root 内；识别同时具有 .trellis 和现代 Plugin lock 或旧 Flower manifest 的项目。显式 --target 允许单独报告无效路径。
- 扫描时跳过符号链接及 .git、node_modules、.trellis、.flower 等内部目录；按真实路径去重并稳定排序，避免重复更新和目录循环。

## 处理流程

1. 只读发现候选项目并保留各输入错误；按真实路径去重。
2. 只读取得每个项目的 Flower/Trellis 版本证据和 Git 根；对每个 Git 根执行一次初始 clean 检查，对每个项目执行活动任务检查。版本未知、脏工作区、活动任务或不可读目标均不进入写入队列。
3. 通过现有版本推荐函数读取一次 npm dist-tags；网络不可用时明确标注远端未确认，仍可把本地版本落后的项目追平到已安装 CLI。
4. 对 --dry-run 输出目标版本、逐项目预计动作和原因后结束，不写缓存、安装包或更新项目。真实执行必须显式 --yes。
5. 存在可更新项目且发现更高版本时，调用现有精确版本安装函数一次；安装失败是全局阻断，后续项目不执行。安装后用新版 CLI 的结构化 self-check 输出核对实际 Flower/Trellis 版本。
6. 顺序调用新版 flower-trellis update --target <project> --no-update-check --force，复用现有完整更新及项目级补偿链路。项目失败记录后继续。相同 Git 根下的项目共用写入前的 clean 判断，避免本批次前一项目造成的 dirty 状态误阻断后一项目。
7. 最终输出 updated、up-to-date、skipped、failed 数量和逐项目原因；存在失败或安全跳过时返回非零。发生项目写入时输出可供 trellis-push 接续的结果块，但本命令不执行 Git 操作。

## 兼容性与取舍

- 已有 --target 对单项目命令仍取最后一个值；重复 --target 仅由 update-all 作为集合使用。新增 --root 同步登记为 Flower 自有参数，禁止误传给 Trellis。
- 显式批量命令不受 SessionStart 的提示冷却、snooze、skip 或通知策略控制；写入授权来自 --yes。原有 self-check 与 self-update 的策略不变。
- 不建立全局项目注册表，也不做跨项目回滚。根目录必须由用户指定，避免无边界扫描。
- 全局 CLI 安装后的实际版本由新进程读取，不能把旧进程已加载的模块状态当成升级证明。
- 预检一次覆盖同一 Git 根的多项目；运行中若有外部进程并发修改该仓库，本命令不能提供跨进程事务隔离，结果需保留每项目成败证据。

## 验证

- 单元与临时 Git 项目测试覆盖组合发现、真实路径去重、符号链接、无效输入、版本证据、dirty/活动任务、预览零写入、全局安装一次、项目失败后继续、退出码及结构化结果。
- 真实 CLI 帮助矩阵覆盖 update-all；本地运行 npm test、ESM 语法检查和隔离临时项目 dogfood。
- update-performance GitHub Actions 在 Ubuntu 与 Windows 的现有显式测试清单中运行新回归；提交后以对应 headSha 的两平台成功结果作为跨平台验收证据。
