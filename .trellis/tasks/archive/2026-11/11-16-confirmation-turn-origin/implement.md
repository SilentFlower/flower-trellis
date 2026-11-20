# 实施计划

## 前置条件

- [x] 读取当前状态机、两端适配器、SessionLog、现有测试和分发/质量约定。
- [x] 在隔离项目复现两端内部唤醒回合中 cancel 后再次 prepare 失败，记录到 research/reproduction.md。
- [x] 基于当前 dirty 工作区建立独立规划任务；基线由 task_intent 保存。
- [x] 按 trellis-task-brief 完整展示本轮 Brief，并取得人工确认（本会话用户回复“确认”）。
- [x] task.py start 后按 trellis-route 解析为 inline，并读取 trellis-before-dev 及当前规范。

## 顺序

1. 先补能够在修复前失败的来源恢复回归，覆盖 Codex 和 Claude 的独立客户端/进程。
2. 在状态中实现单个独立 turnOrigin 记录的有界结构、保存和失效；复用原目录锁与 SessionLog。
3. 改造两端准备/领取路径，核验来源后原子保存；新 request 替换时保留同回合有效来源。
4. 补齐 Hook、人工输入、回合/运行切换、日志漂移、窗口失效和项目生命周期的清理或拒绝路径。
5. 验证 started 尚未终结、准备竞争、迟到通知、旧回执、重复 worker/claim 的许可边界。
6. 运行受影响专项和完整回归；通过安装事务在隔离目标验证资产、更新失效和幂等。
7. 默认进入 Check-All；按照实际结果同步规范，再进入精确 Push 计划。

## 验证命令

```bash
node scripts/run-python-tests.mjs test_confirmation_native test_project_confirmation test_confirmation_store test_confirmation_windows test_flower_confirmation_hook
node --test test/js/confirmation-install.test.js
npm test
git diff --check
```

若变更 Skill-Garden 协议作者源，按所有权顺序额外执行 `npm run sync`、`npm run patch:targets`、`npm run patch:targets:check` 与 `node scripts/check-snapshot.mjs`，随后通过 Plugin 生命周期刷新隔离/本仓投影。

具体隔离安装/更新命令在执行前读取当前 CLI 帮助和安装测试，使用 gitignored 临时目标。已有成功验证仅在内容和环境保持有效时复用。

## 场景与预期

| 场景 | 预期 |
| --- | --- |
| 原通知领取后准备新确认 | 来源与当前请求独立保存 |
| 同回合 cancel 后重新 prepare | 最新确认准备成功，原来源仍可核验 |
| 连续替换及跨进程恢复 | 每次新请求独立冻结，最新请求可完成 wait/claim/result |
| 替换后尚未完整展示 | 新倒计时保持等待展示状态 |
| 旧通知、旧回执或重复执行 | 保持单次领取和 started 约束 |
| 人工输入、换回合/运行、退出、日志漂移 | 旧来源与许可按适用规则失效 |
| prepare 复核后新输入抢先写入 | 锁内拒绝旧候选，保留新代次 |
| 旧状态缺少来源字段 | 来源充分时精确建立，来源异常时人工回退 |
| 更新资产或关闭/卸载项目 | 来源失效，started 执行事实仍可记账 |

## 评审与回滚点

- 来源字段只承担追溯，不进入 action 授权。
- 源码和既有任务改动交叉时，以 task_intent 基线区分增量；不覆盖其他工作。
- Check-All 必须检查真实 JSONL、Hook、状态锁和各 CLI 进程之间的数据流。
- 本任务是确认机制自身开发，task.json 设置 confirmationTimeoutDisabled=true；本任务的评审沿用人工分支。
- Git 写入与外部项目升级各自沿用原确认边界。推送后匹配提交的原生矩阵成功是跨平台交付门禁。

## 初轮实施与验证证据（拦截条件收敛前）

- 四个 Flower 运行时作者源新增独立 turnOrigin 保存与复核，显式取消保留来源，人工输入和项目生命周期清理来源。原请求的展示、计时、claim、started 许可保持独立。
- Claude 技能元消息按原生 isMeta 标记与来源字段缺失组合识别，适用于任意技能文本。明确来源继续按原规则核验。
- 真实业务会话只读重放到失败点通过，8 条技能元记录被正确识别，真实人工基线保持原 ID。
- `node scripts/run-python-tests.mjs test_confirmation_origin`：8 组通过，覆盖两端两个宿主分支、连续替换、来源独立、竞态、日志/窗口漂移和元消息兼容。
- `test_confirmation_native.py` 两端真实 CLI 链路各增加两轮 prepare/cancel/prepare/prepare/wait/claim/result，原生宿主边界替身范围沿用原测试。
- 最终 `npm test` 退出 0：JavaScript 692 项中 690 通过、2 项跳过；Python 622 项中 618 通过、4 项跳过；Patch 冲突、compiled targets、上下文预算、输出模板检查通过。日志 `/tmp/flower-turn-origin-full-final.log`。
- 相关 Python 3.8 语法解析与 `git diff --check` 通过。原生 Windows 内核场景的跳过保留既有原因，后续匹配提交的原生 CI 是交付门禁。
- 当前 Git 分支 origin/main 前有 5 个既有提交，运行时文件还混有容量/Windows/来源核验的既有改动。Git 交付归属需由 Push preflight 处理。

## 用户后续明确调整

- 按 research/interception-audit.md 删除不参与授权的格式、全文和固定期限门槛。沿用首次 Brief 授权及用户对该增量的明确指令。
- 新增未知上下文、来源单字段/旧字段、通知内容分块和外壳、非 UUID 原生 ID、长展示及迟领取的正向回归。
- 更新 Skill-Garden 共享确认协议作者源并同步快照，最终定向与全套验证须覆盖当前最终内容后再恢复 Check-All / Spec / Push 完成链。

## 拦截条件收敛后的最终验证

- JavaScript 全量：692 项中 690 通过、2 跳过，日志 `/tmp/flower-interception-full.log`。安装/更新/卸载最终专项 7 项通过，日志 `/tmp/flower-interception-install-final.log`。
- Python 全量：624 项，619 通过、4 跳过，1 个旧文件名约束断言报错。该断言已改为验证真实文件缺失错误。更新后的全部受影响模块重检 56 项，54 通过、2 按原生平台条件跳过，日志 `/tmp/flower-interception-verification-final.log`。全量其余未变化部分复用有效证据，不声称该次全量进程退出 0。
- 两端真实 CLI 连续替换、不同通知文案/分块、最终正文字符串/附加块，以及 10 组独立来源/拦截回归通过。原生 ID 覆盖非 UUID、Unicode、超过 256 字符及不同 JSON 转义，原生日志覆盖不同文件名布局。
- Claude 真实会话只读重放通过。主字段优先、旧字段回退、未知附加事件旁路；isMeta 的专项判断已删除。
- Patch 冲突、compiled targets、上下文预算和输出模板全部通过，日志 `/tmp/flower-interception-artifacts.log`。Python 3.8 语法检查和 diff check 通过。
- `npm run sync` 已刷新共享协议快照，compiled targets 生成/校验无漂移。发布前 check-snapshot 当前要求先提交 vendor 作者源并更新 pin；该项由后续 Git/发布顺序收敛。
- 最新 Check-All：full，本地验收通过，无 CHK/FBK；规范已同步最小拦截契约。跨平台 CI 保留为提交后的交付门禁。

## 远端整合续接

- 两仓业务提交分别为 d12d725（已推送）和 3702d40（本地主仓提交）。主仓推送因远端 main 已推进至 52d8afa / beta.14 被拒绝。
- 用户明确授权“整合并继续”。在临时克隆中合并两条历史，逐个审阅预检的 13 个冲突路径；原工作区保留文件继续按内容摘要核对。
- 作者源运行时与远端差异已经逐项核对。整合保留独立来源和最小拦截契约，同时引入远端发布、既有任务及原生运行时基线。
- 合并结果运行 npm test；共享协议重新同步后核对 compiled targets、预算和输出模板。检查通过后恢复精确 Git 交付计划，CI 仍是完成态写入前置。

## 整合后的验证与交付证据

- 独立临时克隆完成整合。合并提交 e17a46e2e7fd9cb767c4b60abf7486af3b7f17b6 的父提交为 3702d40 与 52d8afa，已推送 origin/main。
- 整合结果 npm test 退出 0：JavaScript 692 项中 690 通过、2 跳过；Python 624 项中 620 通过、4 跳过。Patch、compiled targets、上下文预算及输出模板通过。日志 /tmp/flower-confirmation-integration-full.log。
- 严格上下文预算通过。17 个作者源及测试与已审查修复逐字一致；远端版本、发布记录和项目配置保留 beta.14 内容。CI 分流结果为 full/contracts/python/update 全部 true。
- 合并提交后的 check-snapshot 与 Patch 冲突检查退出 0，快照和 d12d725 子模块 pin 一致。
- Check-All full 通过，CHK/FBK/DOC 均为 0。规范复核沿用已有契约，本次为 no-op。
- 原生 CI：https://github.com/SilentFlower/flower-trellis/actions/runs/43820662860 ，headSha=e17a46e2e7fd9cb767c4b60abf7486af3b7f17b6。验收结果：8 个必需 job 全部 success。

### 原生矩阵最终结果

| 运行器 | Python | 总数 | 通过 | 跳过 | 结论 |
| --- | --- | ---: | ---: | ---: | --- |
| Ubuntu latest | 3.12 | 624 | 618 | 6 | success |
| Ubuntu 24.04 | 3.8 | 624 | 614 | 10 | success |
| Windows latest | 3.12 | 624 | 560 | 64 | success |
| Windows latest | 3.8 | 624 | 560 | 64 | success |

跳过沿用测试中已有的平台与能力条件：Windows 专属内核、路径和 CMD 用例由 Windows 矩阵执行；Linux/WSL 原生协议、pidfd、POSIX/Maven 与 WSL 文件系统边界由适用平台执行。Python 3.8 的 Linux 组合额外跳过依赖 pidfd 的场景。新增 10 组来源回归在所有矩阵均实际执行。4 组矩阵的 Node 到 Python 入口与平台编译产物步骤全部 success。CI 日志已逐个回读。

原工作区已快进到整合提交；原有 41 个文件逐字恢复和核验，其中 33 个与新基线一致，剩余 8 个本地变更保留。
