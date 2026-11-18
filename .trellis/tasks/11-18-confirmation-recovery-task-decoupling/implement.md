# 实施与验证计划

## 开工前

- [x] 核对两个现场的原生日志、确认材料和会话记录。
- [x] 复现默认身份误选及显式 Codex 身份正确解析。
- [x] 确定管理源、安装层和受影响回归入口。
- [x] 展示完整 Brief，并取得本机制开发所需的人工开工确认。
- [x] 通过 `task.py start` 激活实现状态，进入 `trellis-route(target=implement)` 与 `trellis-before-dev`。

## 实施顺序

1. 在公共身份解析的持久 Patch 中修正多平台环境选择，补齐宿主明确身份、显式覆盖和单候选兼容回归。
2. 策略改为读取材料声明的任务，移除相等准入条件，冻结独立会话绑定；更新三类材料、空绑定和异任务绑定的用例。
3. 在 Codex 来源适配中增加恢复关联与输入锚点衔接，调整来源结构验证及续读状态；补齐真实日志形状的隔离链路测试。
4. 同步确认协议和相关规范，保持准备、展示、等待、领取、started 与终态记账一致。
5. 按管理源顺序生成快照、编译目标和 dogfood，核对用户已有改动基线。

## 验证

先运行受影响专项：

```bash
node scripts/run-python-tests.mjs test_confirmation_policy test_confirmation_native test_confirmation_origin test_project_confirmation test_confirmation_windows test_task_current_query test_task_start_brief_gate
```

新增身份解析专项若采用独立文件，将其加入同一命令及实际 CI 测试清单。

行为矩阵：

- 普通用户回合、一次恢复、连续恢复、准备前插话及准备后插话。
- 恢复链缺失、错误线程、循环、日志变动及原窗口退出。
- Brief/Check/Push 目标分别与绑定相同、不同、空绑定；目标材料与等待期间绑定变化。
- 两种平台变量共存、单候选、显式平台、显式上下文与原生 Hook 输入。
- 完整展示后起算、独立进程 wait/claim/started、旧请求和重复回执拒绝。

共享运行时变更执行完整验证与产物检查：

```bash
npm run sync
npm run patch:targets
npm run patch:targets:check
npm test
node scripts/check-ai-context-budget.mjs --strict
node scripts/check-output-templates.mjs
```

对实际变更的 Python 源运行语法校验；按项目 Plugin 生命周期刷新 dogfood，执行安装/更新幂等与 dry-run 验证。推送后等待变更提交的 Ubuntu/Windows 必需 CI 全部成功，并保存 run 链接及 headSha。

发布前的 `node scripts/check-snapshot.mjs` 要求子仓源码和主仓快照均已提交。实施阶段实际运行已确认其以源工作区有待提交内容退出；提交链中先提交子仓、重新同步 sourceCommit，再提交主仓快照，最后运行该发布门禁。提交前的内容一致性由编译目标检查、Patch 冲突检查及源/快照逐文件比较验收。

## 完成链与回退点

- 通过 `trellis-route(target=check)` 进入 Check-All；依据实际 findings 处置后重检。
- 本机制自身开发的确认保持人工，由既有 Brief/Check/Push owner 处理。
- 通过后进入 Spec 评估及精确 Push 计划。
- 回退单位包含持久源、同步快照、编译目标及 dogfood 管理输出。原始现场日志和任务状态作为诊断证据保留。

## Check-All 修复续行

- CHK-001：Linux 宿主识别增加实际 ELF 映像名 `claude.exe`，嵌套进程回归断言在内层宿主即停止遍历。
- CHK-002：任务进度 CLI 测试使用独立 `TRELLIS_CONTEXT_ID`，其子进程关闭字节码写入，移除对外部工具身份和宿主模块的隐式依赖。
- 定向验证：`PYTHONDONTWRITEBYTECODE=1 node scripts/run-python-tests.mjs test_session_host_identity test_task_progress`，19 项通过。
- 完整验证：使用 `PYTHONDONTWRITEBYTECODE=1 npm test` 重跑，并在完成后复核实际结果。

## CI 续修

- 首次交付 CI 的 Python 3.8 暴露动态编译 Patch 测试未继承目标模块延迟注解的问题；保持目标模块相同的编译语义。
- 原生确认普通回合链路的等待子进程提前退出；补齐退出诊断后在 Python 3.8 重现，依据真实原因修复并回归普通及恢复回合。
- 新增修复采用独立增量提交，沿用现有业务提交和推送现场；完成态等待修复后匹配提交的全部必需 CI。

- 并发复验已复现正常追加被同大小 mtime 变化保护误拒绝。增加固定 50 ms 的元数据稳定观察，仅在后续增长且身份/边界一致时识别为追加；补齐确定性边界测试后重跑受影响原生与完整 Python 套件。

## 本地续修验收

- [x] Python 3.8/3.12 各 18 项原生及身份专项通过；新增元数据时序用例两版本独立复验通过。
- [x] 两版本各 66 项其余确认模块通过（各跳过 2 项）。
- [x] 真实双进程原生链路 16 次通过；安装专项 7 项通过。
- [x] Python 3.8 完整 638 项通过（跳过 8 项）；追加时序补修由新专项补齐。
- [x] 源和部署副本、重复更新幂等、语法及 diff 检查通过。
- [x] 完整重检与规范更新完成。
- [x] 确认补充精确 Push 范围，提交并推送新增修复。
- [x] 匹配修复提交的全部必需 CI 成功。
- 任务完成态与 Close 通过既定 helper 原子写入，任务记录按已确认范围提交与推送。
