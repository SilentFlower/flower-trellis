# SessionStart 索引预算验证记录

## Implementation Evidence

- 用户对完整 Brief 回复“确认”后，任务已从 `planning` 启动为 `in_progress`；实现路由返回 `inline`。
- 受影响的十个原生 Hook 在修改前均逐字命中原索引输出块和计数块各一次。
- `session-start-context-trim` 新增两项精确替换：固定发现入口，以及空目录也显示真实计数；索引收集器和已有 Claude 包筛选保持原样。
- `npm run patch:targets` 成功；`npm run sync` 成功；477 个 override 文件源/快照逐字节一致；十个平台最终 Hook 均移除全量索引输出循环。

## Focused Verification

| 命令或场景 | 结果 |
| --- | --- |
| 新增 499 索引 compact 回归，修复前 | 按预期失败；Codex 30590 字符，Claude 27731 字符 |
| 同一回归，源 Patch 与编译目标更新后 | 通过 |
| 两平台、三种重建事件、两种任务状态、0/少量/499/1000 索引与长路径 | 通过；关键状态、提示和计数完整，各段 ≤8000 字符，目录增长造成的 state 变化小于 256 字符 |
| 现有 spec_router 查找未常驻列出的索引 | 通过 |
| JS 预算及平台额度专项 | 7 项通过，0 失败 |
| 严格预算 checker，二十个真实场景 | 退出 0；Codex 最大 state 7855 字符，Claude 4996 字符；三段最大合计 18481 字节，处于既有 warn 范围，无 high-warning |

矩阵开发阶段发现测试任务缺少现代 `closeout` 字段，引发正常的旧任务迁移诊断。已使用 `common.tasks.pending_closeout()` 构造正确夹具，并重跑矩阵及发现命令测试：2 项通过。未改动 production maintenance 行为，也未吞掉诊断。

## Isolated Project Update

从受影响项目复制 Trellis、平台与 Plugin 受管基线到隔离目录，并使用同一任务材料绑定隔离验证会话。所有 Hook 基线刷新均只写隔离副本，未使用真实会话 runtime 进行脚本测量。

| 平台 | 更新前 state | 更新后 state | rules / stages |
| --- | ---: | ---: | --- |
| Codex | 34571 字符 | 6748 字符 | 6907 / 3664 字符，逐字不变 |
| Claude | 31945 字符 | 4122 字符 | 6907 / 3581 字符，逐字不变 |

- 当前状态、任务状态、workflow-state、平台和模型提示块更新前后逐字相同。
- 第一次真实隔离更新修改两个原生 Hook；第二次更新零目标变化。
- 两个真实项目的更新预览均成功：xiaoxian-desktop 仅两个原生 Hook；Flower 另有上一提交已存在的十份 Meta 术语源投影待同步。

## Full Regression And Deployment

- `FLOWER_NO_TELEMETRY=1 npm test` 退出 0：JavaScript 共 684 项，682 通过、2 条条件跳过；Python 共 546 项，544 通过、2 条条件跳过。未把跳过项计为平台通过证据。
- 同一命令完成真实 Patch 冲突门禁（57 个 Patch、243 个 operation、0 warning）、canonical compiled targets 零漂移及默认预算和输出模板检查。
- 两个真实项目更新均成功；各自第二次更新均为零目标变化。
- xiaoxian-desktop 的六个预先记录的配置/工作流/Hook 文件中，仅两个原生 Hook 改变，且更新后与 compiled full 目标逐字节相同；Plugin verify 返回 `ok=true`、空 changes 和空 diagnostics。
- 目标项目的 `.flower/plugin-lock.json` 也随受管更新同步。该项目原业务会话的工作区未纳入维护仓库的提交计划，本次仅应用和验证本地受管文件。
- Flower 更新后仅因已提交的 Meta 术语源顺带刷新十份受管文档；对这些文档和原生 Hook 的新增内容复验为 Python pre-check 3 项、JS Meta 4 项，全部通过。其它实现与完整回归时内容相同，复用完整结果。
- 完整修改模块的 Python 3.8 语法扫描、两份 JS 语法检查及两仓 `git diff --check` 通过；语法扫描不冒充原生 Python 3.8 运行。
- 完整详细日志与隔离输出位于本次项目外验证目录；关键结果已写入本文件，临时日志不作为持久唯一证据。

## Git Delivery And Native CI

- 用户已确认两仓业务提交及独立任务记录的精确 Push 计划；验收缺口按该计划写入 partial 进度。
- Skill-Garden 的 `main` 已推送 [c71dbe89261b6426313ce931ff2543ef630da189](https://github.com/SilentFlower/skill-garden/commit/c71dbe89261b6426313ce931ff2543ef630da189)。
- Flower 的 `main` 已推送 [975cf5f5c1927bd614b2f3e8c09c940dd70301a0](https://github.com/SilentFlower/flower-trellis/commit/975cf5f5c1927bd614b2f3e8c09c940dd70301a0)，远端 API 已核对完整 SHA。
- 提交后 `node scripts/check-snapshot.mjs` 通过：作者源、子模块 pin、已提交快照均为同一 Skill-Garden 提交；57 个 Patch、243 个 operation、0 warning。
- 原生 CI：[run 42029120355](https://github.com/SilentFlower/flower-trellis/actions/runs/42029120355)，head SHA 为上述 Flower 业务提交。
- 下表为 `2026-11-05 12:51:11 UTC` 的直接查询结果；整个 run 当时仍在运行。

| 必需检查 | 实际结果 |
| --- | --- |
| 判断验证范围、规则与产物 | 通过 |
| Ubuntu / Node 22、Windows / Node 22 | 通过 |
| Ubuntu / Python 3.12 | 通过 |
| Windows / Python 3.8、Windows / Python 3.12 | 查询时仍在运行，未计为通过 |
| Ubuntu / Python 3.8 | 失败；未进入测试 |

Ubuntu / Python 3.8 的 [job 127250799741](https://github.com/SilentFlower/flower-trellis/actions/runs/42029120355/job/127250799741) 在 `actions/setup-python@v7` 安装阶段报告：`The version '3.8' with architecture 'x64' was not found for Ubuntu 26.04.` 当前工作流使用 `ubuntu-latest`。这是已观察到的解释器供应阻塞，不能据此宣称该平台测试通过，也不能用本地语法扫描替代必需运行结果。本次已确认的 Git 文件范围不包含 CI 工作流修改。

## Remaining Stage Gates

- [上线后验证] AC5 的真实宿主接收：受影响原窗口拥有者在下一次实际 `compact` 重建后，核对无截断提示、任务状态与尾部规则完整。本轮已更新 Hook、验证真实脚本输出和受管哈希；只读复核原窗口历史，最新 state 仍是 `2026-11-05T10:23:20.022Z` 的旧截断记录（10101 字符，缺少 `task-status` 和末尾闭合）。尚未取得该原窗口使用新 Hook 的接收记录，不打断原窗口或改写其 runtime 来代替验收。
- AC6 的原生 CI 尚未全部通过；先解决 Ubuntu / Python 3.8 解释器供应问题，再核对必需矩阵的成功结果。
- Check-All full 已通过，无 CHK/FBK，唯一 DOC 为任务状态事实同步；Spec 结果为 `written`，仅修改两份 CLI 权威规范并完成边界与反向核对。
- 两维护仓业务提交、推送及提交后快照门禁已完成；AC5、AC6 尚未齐备，任务保持 `in_progress`，不提前写入完成态或 Close。
