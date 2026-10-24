# 实施计划

## KISS 收缩范围

用户已明确要求按收缩方向实施，沿用当前任务，不重复评审整个 Brief。上一版的 Git 提交计划失效；旧测试记录仅作历史，不作为收缩版验收。

## Execution Order

- [x] 默认 Flower 准备改为目标单路径：删除 archive 预演、source records/previousState 注入、继承回退、重复预演和准备指纹。
- [x] 复用 Runtime writer 扩展点一次校验并应用；保留精确固定包、禁止覆盖、忽略与事务恢复保护。
- [x] 删除 setupRequest 及校验/任务自动续行；默认 prepare 复用既有本地准备入口，不触碰任务。
- [x] create 在 Git 建立后独立尝试准备和可选任务；任务失败保留路径，返回目标具体命令。
- [x] 同步 CLI、双平台作者技能、README、必要回归和发布快照。
- [x] 比较上一版核心代码增量，确认真实减少机制和分支。
- [x] 完成聚焦/必要集成验证；follow-up-edit hold 下不自动进入 Check-All。
- [x] 用户进入检查后，重新 Check-All、Update-Spec 和精确 Git 交付计划；原生 CI 成功前保持 in_progress。

## Validation

```bash
npm run sync
FLOWER_NO_TELEMETRY=1 node --test test/js/worktree-cli.test.js test/js/worktree-flower-state.test.js test/js/worktree-setup.test.js test/js/plugin-lifecycle-cli.test.js
node scripts/run-python-tests.mjs test/python/test_worktree_setup.py
npm test
npm pack --dry-run --json
```

语法、源/快照逐字节一致和 git diff --check 随最终范围验证。发布前 check-snapshot 的提交干净性检查仍在两仓实际提交后进行；不自动提交、推送或发版。

## Baseline

上一版独立核心源码为 4 个 JS 文件 + 作者 Python，合计净增 500 行；其中 Python +215，worktree Flower 服务 +253。收缩前本地完整测试与检查已通过，但新改动必须重新验证。原生 Ubuntu/Windows CI 未执行。

## 当前证据

- 作者 Python 和快照均已移除 setupRequest、自动任务恢复及 setup-plan/setup-apply；默认安装仅一个 setup 调用。
- 以唯一作者源计，含两项 Check-All 修复的核心代码相对原基线净增 188 行（上一版 500 行），减少 312 行，约 62%。
- Python 专项 42 项运行通过，1 项 Windows 扩展路径场景按平台跳过；后续完整套件已在固定快照后重跑通过。
- 已完成受影响 JS 语法、Python AST、作者源/快照逐字节一致和两仓 diff whitespace 检查。
- 首次完整回归曾与快照同步重叠，出现临时 catalog 不完整错误，该轮不作为验收证据。

- 固定快照后的完整 `npm test` 退出 0：JS 666 项（664 通过、2 项平台跳过），Python 508 项（2 项平台跳过）；日志 `/tmp/worktree-kiss-final-npm-test.log`。Patch 冲突、compiled targets、默认上下文预算和输出模板门禁均通过。
- 临时 Git 仓库实际 init、update --dry-run、uninstall --dry-run 均退出 0。最终 npm dry-run 清单通过，源/快照逐字节一致，两仓 diff whitespace 检查通过。
- 收缩版首次 full Check-All 发现 FBK-001（子进程超时丢失已有任务交接）和 FBK-002（任务基线名称未进入指纹）；用户选择修复全部，沿用当前任务定向修复和复检。该阶段尚未提交或推送，后续交付与原生 CI 结果见下节。

## Check-All 修复

- [x] FBK-001：统一任务子进程错误，保留已创建任务和剩余设置命令；覆盖 create 后超时、设置超时及启动失败。
- [x] FBK-002：仅请求任务时将实际 base_branch 纳入指纹；覆盖同提交别名变化与无任务场景。
- [x] 同步作者源和快照，运行定向回归后复检；不恢复额外状态或自动任务续行。

两项新增用例在修复前失败、修复后通过。最终定向验证为 Python 44 项（1 项 Windows 专属场景跳过）、JS 49 项全部通过；测试故障注入路径规范化后再次运行新增用例 2 项通过。日志为 `/tmp/worktree-fbk-python.log`、`/tmp/worktree-fbk-js.log` 和 `/tmp/worktree-fbk-regression.log`。编译检查、canonical compiled targets 零漂移、5 份源/快照逐字节一致及两仓 diff whitespace 检查通过；npm dry-run 清单验证通过。

full 复检沿用原全量回归中未受影响的有效证据，并补齐上述定向验证，剩余 CHK/FBK 均为 0。最终原生验收结果见下节。

## 原生 CI 后续

- 用户已确认的两仓业务提交均已推送；快照一致性及 Patch 冲突门禁通过。
- 首轮 Python 兼容矩阵：四个环境的 Python 套件均运行 446 项并通过（Ubuntu 各跳过 4 项，Windows 各跳过 55 项平台/能力相关场景）；Ubuntu 3.12 全部通过；Ubuntu 3.8 在测试清理临时 Git 目录时遇到 ENOTEMPTY；Windows 3.8/3.12 的 CLI 回归均有 11 项失败，根因是 Unix 路径断言、短长路径比较和夹具未固定 LF。首轮验收未通过，修正后结果见后文。
- SessionStart 与更新链路的 Ubuntu/Windows 共 4 个 job 均通过。原生回执以 [Python 兼容运行](https://github.com/SilentFlower/flower-trellis/actions/runs/39579254207)、[SessionStart 运行](https://github.com/SilentFlower/flower-trellis/actions/runs/39579254147)、[更新链路运行](https://github.com/SilentFlower/flower-trellis/actions/runs/39579254150) 为准；受验代码提交为 83c51b53e334dae4e847a05628cf8602c1f70411。
- [x] 仅修复 4 个测试文件：跨平台路径断言、两类 Git 夹具的 LF 属性、临时目录清理的有界重试；不放宽产品摘要或 Patch 校验。
- [x] core.autocrlf=true 下先复现 9 项换行失败，修复后目标 3 文件的 28 项全部通过；完整 JS 666 项运行通过（664 通过、2 项 Windows 专属场景跳过）。日志为 `/tmp/worktree-ci-crlf-before.log`、`/tmp/worktree-ci-fixtures-crlf.log`、`/tmp/worktree-ci-fixtures-js.log`，4 文件语法及 diff whitespace 检查通过。
- [x] 用户确认补充 Git 范围后，测试夹具修正已推送并通过原生矩阵；完成态与 Close 由 task_progress.py 同步，任务记录由 Push 提交。

## 最终原生验收

测试夹具修正提交为 `4d9bf4ca3f980c121ad0c05231cf4c66e8ddfc19`，两组工作流均已 completed/success，全部 6 个 job 成功，必需的测试、编译产物和上下文预算步骤均实际执行且通过。

| 工作流 | 环境 | 结果 | 回执 |
| --- | --- | --- | --- |
| Python 跨平台兼容回归 | Ubuntu/Windows × Python 3.8/3.12 | 4/4 成功 | [39581764877](https://github.com/SilentFlower/flower-trellis/actions/runs/39581764877) |
| 更新链路跨平台回归 | Ubuntu/Windows × Node 22 | 2/2 成功 | [39581764805](https://github.com/SilentFlower/flower-trellis/actions/runs/39581764805) |
| SessionStart 跨平台回归 | Ubuntu/Windows × Python 3.12 | 2/2 成功，复用未受后续测试改动影响的提交 `83c51b53e334dae4e847a05628cf8602c1f70411` | [39579254147](https://github.com/SilentFlower/flower-trellis/actions/runs/39579254147) |

- 四个兼容矩阵各运行 Python 446 项；Ubuntu 各跳过 4 项，Windows 各跳过 55 项。跳过条件来自 Windows 扩展路径/CMD/原生 Maven 专属场景、POSIX 权限与 Maven/WSL 专属场景，以及 Windows 软链权限不足（WinError 1314）；本轮新增的任务超时/启动失败和基线别名回归没有 skip 条件。
- 四个矩阵的 Node 到 Python、worktree 和 Plugin 真实 CLI 回归均为 56/56 通过、零跳过；旧 Windows 路径/换行失败及 Ubuntu 临时目录清理失败均未再出现。
- 四个矩阵的 canonical compiled targets 检查均为 935 个文件、467 个变更 target，无漂移；上下文预算门禁通过。更新链路中的平台专属跳过保留原条件，未删除矩阵或放宽产品校验。
- 任务记录提交只同步当前任务产物、进度和 Close，不改变本次已验收的运行源码、测试或配置。
