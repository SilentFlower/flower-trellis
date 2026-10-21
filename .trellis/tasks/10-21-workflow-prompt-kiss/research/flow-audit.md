# 流程精简证据

## Current Behavior

- `.trellis/workflow.md:232` 的 untracked check 状态仍要求等待 direct Git 或后续继续；同文件 `:615` 及 Check-All `references/reporting-and-disposition.md:225` 要求通过后默认同轮继续。作者源是 `overrides/patches/workflow/state-untracked/content.md:9`。
- `.agents/skills/trellis-route/SKILL.md:30` 与 `references/interaction.md:7` 把无偏好解析结果交给模式菜单；实现和检查独立选择。
- canonical route helper 为 `vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-route/scripts/route_state.py`。`resolve_route` 使用 runtime → prefs → auto-loop 顺序，最终返回 `no-valid-decision-pref-or-auto`；`read_pref` 空状态返回 `no-valid-pref`。
- `vendor/skill-garden/.trellis/0.6/scripts/auto_loop.py` 的 `_effective_route_authorization` 调用同一 helper 做只读预检，仅消费 `status=hit`、匹配 task 且合法的 mode；缺省模式必须同步到这个消费者。
- Check-All 默认入口总是读取 depth、所选 profile、fallback、DOC 与 reporting，profile 再读取 verification；DOC、runner 与完整报告细则仍在默认集合中。
- Brief 当前已包括 Technical Overview、Context & Decisions、Acceptance，并明确首次批准后的增量同步和恢复不重复评审；用户最新要求保持现状。
- Update-Spec 由 `overrides/patches/skills/trellis-update-spec/autonomous-evaluation/` 修改上游 target，不存在可直接覆写的同名 canonical SKILL.md。
- `src/builtin-plugins/skill-garden/content-adapter.js` 的 `addTree` 会清理目标树中未在源目录声明的文件，因此不能为了新增引用而投影一个缺少上游 SKILL.md 的同名目录。

## Baseline

以下为本轮规划开始时实际本地执行结果的字节数；它们是静态文本体量，不是每次请求重新注入量或耗时：

| 对象 | 字节数 |
| --- | ---: |
| 最终 workflow | 60148 |
| route SKILL.md | 7192 |
| light 常规入口与引用集合 | 46417 |
| Update-Spec SKILL.md | 16109 |
| Push SKILL.md | 23816 |

light 集合为入口、depth-routing、light-profile、fallback-findings、document-drift-auto-remediation、reporting-and-disposition、verification，不包含 full、Maven、注释专项和项目 spec。

## Required Conventions

- `ai-context-budget.md:62`：workflow/state 一跳指向；完整规则归 skill/helper。
- `ai-context-budget.md:142`：能力守恒优先，先 replace/remove 去重，再按条件加载，不调高预算掩盖增长。
- `enhancements-model.md:27`：0.6 作者源 → compiled targets / 快照 → Plugin 本地结果，禁止只修改生成物。
- `enhancements-model.md:2765`：规范评估三态、证据、最小写入、自检、默认继续和明确停止合同。
- `quality-guidelines.md:46`：按影响选择验证，运行时与未知范围完整回归，跨阶段复用有效证据；原生平台 CI 通过前不宣称兼容验收完成。

## Protected Assertions

现有断言入口详见 `implement.md`。迁移目标包括：保留完整审计维度与 CHK/FBK/DOC、保护路径准入、事实自修边界、hard-full/fallback-full、单向升级、strict pass、风险接受、repair 续行优先、runner record/next、Brief 首次批准、升级确认以及精确 Git 一次确认。

当前 `route-context-budget.test.js` 等测试仍约束无模式时交互；只改该正常空状态预期，保留未知/损坏状态、明确选择与授权隔离的断言。现有多个测试按文件位置匹配完整长文，拆分时应按 owner 与引用闭包核对能力，不维持重复正文来迎合旧路径断言。

## Dogfood Alignment

全量 Plugin 同步还将本地五个已落后于既有作者源的文件对齐：双平台 `trellis-worktree/SKILL.md`、双平台 `trellis-flower-update/SKILL.md` 及 `.trellis/scripts/worktree_setup.py`。本任务没有修改这些作者源或升级确认门禁；实际 preflight 将它们列为既有内容投影。保留这项机械一致性同步，最终提交计划单独披露，不描述成本任务的新 worktree 实现。

## Implementation Evidence

| 默认读取对象 | 修改前 B | 修改后 B | 下降 |
| --- | ---: | ---: | ---: |
| route 入口 | 7192 | 5285 | 26.5% |
| light 入口与必要引用 | 46417 | 21657 | 53.3% |
| Update-Spec 最终入口 | 16109 | 10735 | 33.4% |
| Push 主入口 | 23816 | 12524 | 47.4% |

light 当前集合为入口、depth-routing、light-profile、verification、reporting-and-disposition；条件命中仍加载相应细则。全部 Markdown 说明总量 route 22670→20961 B、Check-All 57123→56734 B、Push 35656→35649 B；拆分没有通过重复正文增加总量。strict budget 的 control-context-total 为 104208 B，未提高预算。

- Node 完整回归：680 项，678 通过、2 项既有平台 skip，零失败；日志 `/tmp/flower-kiss-js-final.log`。此后路由错误诊断及提示词指向的局部调整由 32 项定向测试和 17 项 helper 测试再次通过。
- 原生本机 Windows Python 3.8.10：最新 route 17/17，planning/auto-loop 集成 3/3，均零 skip。日志 `/tmp/flower-kiss-windows-route-final.log`、`/tmp/flower-kiss-windows-auto-loop.log`。Linux 当前解释器为 Python 3.12.3。
- Patch 冲突：57 patches、234 operations、1339 ready targets、8 target kinds、warning 0；compiled targets 935 文件 / 467 targets 零漂移。
- 全部 canonical/snapshot 文件集合与字节一致；双平台新引用全部可定位；Plugin verify 无诊断，二次 dry-run 的 transaction.changed 和 projectFiles 均为 0。
- Brief、升级 hook/自更新门禁及 worktree 作者源与各自 HEAD 逐字节一致。
- `check-snapshot.mjs` 在源提交、重新 sync 和主仓提交后通过，快照来源与已提交 submodule pin 一致；日志 `/tmp/flower-kiss-snapshot-final.log`。
- 提交前暂存区检查发现新增材料的末尾空行，已在同一文件范围内修正并重新生成；25 项真实 Patch/幂等回归、19 项相关规则回归和 strict budget 通过。
- 两个业务仓库已按用户确认的计划推送；[本次提交的原生 GitHub CI](https://github.com/SilentFlower/flower-trellis/actions/runs/39626727730) 已成功。四组 Ubuntu/Windows × Python 3.8/3.12 各执行 514 项 Python，Ubuntu 各 4 skip、Windows 各 55 skip；完整 Node 回归 680 项、678 通过、2 skip，零失败。平台 CI 还通过 Node→Python 启动入口与原生 compiled targets 校验，更新矩阵通过。
- 原生 Windows CI 的平台性 skip 不涉及本次新增的默认路由、只读预检和 auto-loop 回归；它们没有 symlink 跳过前置。本机 Windows 的 17 项 route 与 3 项 auto-loop 定向运行另有零 skip 证据。

最终 Python 完整回归：514 项，512 通过、2 项既有 skip，耗时 335.902 秒，退出 0；日志 `/tmp/flower-kiss-python-full.log`。最新 Windows route 17 项再次通过，包含非法授权结构不落入缺省的子场景。此次 Check-All 使用 `requested=auto effective=full confidence=high context=interactive`，原因是路由行为和完成链状态条件变化；完整验收映射与能力保持核对通过，无 CHK/FBK。实施清单状态按实际完成事实同步。
