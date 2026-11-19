# 自动确认输入事件序号实施计划

## 实施顺序

- [x] 1. 重新读取任务材料、运行时定义与受影响规范，核对现场 peer 复现证据。实施前进入 `trellis-route(target=implement)`，按 route 结果加载上下文。
- [x] 2. 在隔离夹具增加两端缺少历史人工消息 ID 的准备场景，以及 Claude 当前 peer 回合场景。固定现有失败位置。
- [x] 3. 在共同状态契约中引入输入序号，更新快照、准备、观察、派发、领取及 started；保留请求代次和单次回执。
- [x] 4. 更新 Claude 宿主事件分类、当前回合与新增 transcript 观察；覆盖 Hook 早于日志、peer 回传和精确后台通知。
- [x] 5. 更新 Codex Hook、当前回合与恢复路径，去掉历史人工消息定位作为准入；保留原生队列、窗口与展示核验。
- [x] 6. 同步 `turnOrigin`、测试夹具和升级兼容；验证旧等待取消、旧 started 终态记账、只读状态与卸载行为。
- [x] 7. 更新作者源协议、必要的 owner 说明和项目规范，完成快照、compiled targets 与隔离安装/更新验收。
- [x] 8. 执行专项、完整回归及原生宿主验收；进入 Check-All、Spec 与精确 Push 流程。推送后核验匹配提交的跨平台 CI，再按证据完成任务。

## 主要文件

| 文件/目录 | 责任 |
| --- | --- |
| `src/assets/flower_confirmation_runtime/{runtime,store,claude,codex,session_log}.py` | 共享输入序号契约、两端事件与观察边界。 |
| `src/assets/flower_confirmation{,_hook}.py` | 入口与事件转发；按实际需要调整，保持现有 CLI。 |
| `src/patches/platforms/{claude,codex}/confirmation-hooks/patch.json` | 仅在宿主接入确需变更时同步 Hook。 |
| `src/lib/confirmation-lifecycle.js`、相关安装测试 | 验证旧许可失效与升级兼容，按实际缺口修改。 |
| `vendor/skill-garden/.trellis/0.6/scripts/confirmation.md` 及必要 owner | 协议作者源。 |
| `enhancements/0.6/`、compiled targets、本项目部署产物 | 通过既有工具同步。 |
| `test/python/confirmation_fixture.py` 与确认专项 | 生产者/消费者一致性、真实 CLI、并发和来源回归。 |
| `.trellis/spec/flower-trellis/cli/confirmation-runtime.md` | 记录新契约，保留其余安全与生命周期规则。 |

## 必须验证的行为

| 需求 | 场景与预期 |
| --- | --- |
| R1 / R3 | 两端没有历史人工消息记录也能准备；Claude 当前为 peer 的主会话能完成准备和展示。 |
| R2 | 原生用户输入及中断在 prepare、display、wait、dispatch、claim、started 前发生，旧许可失效。使用事件屏障而非长时间睡眠。 |
| R3 / R4 | peer、工具结果、技能与无关来源保留分类；精确原生通知可领取；人工粘贴通知取消旧许可。 |
| R4 | 完整展示后才计时；材料/任务绑定/Git 状态变化失效；原窗口退出、双开和服务重绑继续按原契约处理。 |
| R5 | 连续 prepare、cancel 后重建、迟到通知、跨进程续接、旧 contract、旧 started 终态均不重复执行。 |
| R6 | 作者源、分发与 dogfood 一致；Linux/WSL 和原生 Windows 均保留验证证据。 |

## 验证命令与阶段证据

关联专项：

```bash
node scripts/run-python-tests.mjs test_confirmation_origin test_confirmation_native test_project_confirmation test_confirmation_store test_confirmation_windows test_flower_confirmation_hook
node --test test/js/confirmation-install.test.js
```

按实际变更同步并校验产物：

```bash
npm run sync
npm run patch:targets
node scripts/check-snapshot.mjs
npm run patch:targets:check
```

共享运行时最终完整回归：

```bash
npm test
```

- 关联验证与完整回归复用同一最终内容的有效结果；代码或环境变化后补跑受影响部分。
- 安装/更新验证使用隔离目标，分别检查 dry-run、实际更新、重复更新和状态兼容。
- 按 `.trellis/spec/flower-trellis/cli/quality-guidelines.md` 核验匹配提交的 Ubuntu/Windows × Python 3.8/3.12 CI，记录 run、headSha、矩阵和合理 skip 原因。
- 原生实测分别记录 Codex 的真实队列唤醒、Claude 的真实后台通知、两端子代理回传后的主会话准备、新输入取消及重复执行拒绝。协议替身结果单独标注。
- 实测使用独立项目/窗口和配置，清理仅限本任务创建的资源，保留用户现有窗口及共享服务。

## 风险与恢复

- 状态契约改动前先固定旧状态/旧 started 夹具；升级时沿用既有确认资产变化失效机制。
- 若任一平台出现漏取消、伪造来源取得许可或重复执行，停止交付并修复；保留真实失败证据。
- 回退按作者源与分发资产整体处理，先取消尚未执行的等待。已 started 动作先核对并记录实际终态。
- 本任务属于自动确认机制自身开发，任务元数据设置 `confirmationTimeoutDisabled=true`；阶段确认使用人工分支。

## 规划检查

- [x] 已将用户确认的 Claude/Codex 输入序号方向写入 PRD。
- [x] 已保留现场日志与源码证据，纠正搜索窗口猜测。
- [x] 已区分输入失效、回合展示、通知身份和执行许可。
- [x] 已纳入状态迁移、并发、原生验证与安装分发。
- [x] 完整展示 Brief 并取得首次实施确认后激活任务。

## 当前验证记录

- 两端输入序号、peer/恢复回合和锁内竞争专项已通过；原生 Python CLI 完成普通 Claude、peer Claude、Codex 及 Codex 恢复回合的 prepare/wait/claim/started/completed。
- Windows NT 原生 Python 3.8.10、3.12.2 各运行 74 项确认专项，均通过，7 项 Linux 专属场景按条件跳过。
- JavaScript 全套运行 701 项，699 通过、2 项按平台条件跳过。
- 首轮全量 Python 的同一旧夹具遗漏顶层输入序号，两个宿主子场景触发预期的严格状态校验；夹具补齐后，最终完整 Python 运行 647 项通过，4 项按平台条件跳过。
- 本项目通过实际 Plugin 更新同步 5 个运行时与协议，第二次预演目标变化为 0。
- 当前真实 Codex 窗口的 prepare_snapshot 与前台绑定只读核验通过。
- Claude 原生 TUI 使用回环模型响应，完成 1 秒展示后计时、后台通知、领取、started、隔离动作与 completed；动作次数为 1。
- Codex 原生 TUI 使用独立配置与进程空间、回环模型响应，完成 1 秒展示后计时、真实队列唤醒、领取、started、隔离动作与 completed；动作次数为 1。
- 两端原生 TUI 在 3 秒倒计时期间注入新用户输入，均进入 cancelled，动作次数为 0；Claude 对随后旧领取明确返回 cancelled。
- Patch 冲突、compiled targets、上下文预算与输出模板检查通过；5 个运行时源码与 dogfood、协议作者源与快照及 dogfood 均逐字节一致。
- CHK-001 已按用户“修复全部”更正 Codex 恢复回合旧锚点说明；作者源经 sync 和 Plugin 生命周期同步，协议三份一致，重复预演目标变化为 0，相关四项门禁与格式检查通过，轻量重检通过。
- 软件发布用 check-snapshot 门禁在子仓与快照提交后通过，sourceCommit 与子模块 pin 一致。
- 业务提交 `eb41a073d7379b83fb5bf9dcbb6e3646c04f897f` 的 [CI run 44480901377](https://github.com/SilentFlower/flower-trellis/actions/runs/44480901377) 已完成，8 个 job 全部 success；包括规则与产物、Ubuntu/Windows Node 22 更新链路，以及下方四个 Python 矩阵。各 Python job 的 Node 启动入口和原生 compiled targets 检查均成功。

| CI 矩阵 | 总数 | 通过 | 跳过 | 跳过原因 |
| --- | ---: | ---: | ---: | --- |
| Ubuntu 24.04 / Python 3.8 | 647 | 637 | 10 | Windows 专属 4 项、WSL/Windows 工具链 2 项、Python 3.8 缺少 pidfd 的内核实测 4 项。 |
| Ubuntu latest / Python 3.12 | 647 | 641 | 6 | Windows 专属 4 项、WSL/Windows 工具链 2 项。 |
| Windows latest / Python 3.8 | 647 | 581 | 66 | POSIX Maven 53 项、Linux 原生 socket/CLI 7 项、pidfd 4 项、POSIX 权限 1 项、WSL 文件系统边界 1 项。 |
| Windows latest / Python 3.12 | 647 | 581 | 66 | 同上；Windows CMD、文件路径、原生进程与状态锁专项均实际执行。 |
