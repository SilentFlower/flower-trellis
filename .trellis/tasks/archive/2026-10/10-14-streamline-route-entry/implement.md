# Implementation — 精简路由入口并同轮衔接执行

## Execution Plan

- [x] 展示完整 Brief 并完成首次开工 review；按现有个人 implement/check 默认走 inline。
- [x] 在作者源精简两平台入口，集中定义同轮执行、简短展示和明确指令生效。
- [x] 提取交互、subagent 分发、异常细则到条件 references，删除重复的原则、反模式和审计段落。
- [x] 将现有受保护契约测试迁移到其实际 owner；补充入口、总量、条件加载及真实平台投影回归。
- [x] 执行源/快照同步、必要的 compiled target 刷新和项目 Plugin 投影；重复应用验证零漂移。
- [x] 完成 focused validation、全面 Check-All、Update-Spec；检查通过后同轮展示具体 Push 计划。
- [x] 获具体提交范围批准后推送，核验该业务 SHA 的跨平台 CI，再进入 completed + Close 同步。

## Validation

- 必验场景：默认命中、runtime 恢复、当前任务修复重检、明确临时指定、明确更新默认、缺少默认、含糊目标、旧数字/摘要、平台能力缺失、task/untracked 隔离和损坏状态。
- 执行 `python3 -m unittest discover -s test/python -p 'test_route_state.py'` 及相关 auto-loop 回归，确保现有 helper 行为守恒。
- 用 Node 内置测试验证每平台真实分发 reference、入口 ≤ 8,192 B、说明总量 ≤ 39,950 B，以及迁移后的契约；不把文案全量快照视为模型行为验证。
- 运行 skill-creator `quick_validate.py`、`npm test`、`npm run patch:targets:check`、默认及 strict AI context budget、输出模板检查和 `git diff --check`。
- 使用真实 CLI 在隔离目录运行 init、update dry-run、uninstall dry-run；项目投影通过 `update --enhance-only --no-update-check` 并验证第二次零目标变化。
- 如模板可执行命令或分发配置发生变动，核对 GitHub Actions 路径触发及原生 Ubuntu/Windows 回归；本地证据不能替代必需跨平台 job。

## Review Gates

- 初次 Brief 是开工 gate；之后已批准范围内的细节只增量同步，不重复全 Brief 确认。
- 用户决定 mode，helper 校验并保存；不得以体量目标取消风险边界或复制控制逻辑。
- 未经批准不提交或推送；本任务状态、权限和 Git 行为继续由已有 owner 管理。

## Measurement Baseline

| 平台 | 默认入口 | 全部说明及分发材料 | 入口目标 |
| --- | ---: | ---: | ---: |
| `.agents` | 26,262 B | 39,950 B | ≤ 8,192 B |
| `.claude` | 26,262 B | 39,950 B | ≤ 8,192 B |

基线测部署后的实际文件，包括共享引用；计量为 UTF-8 字节，非 token。预算阈值不提高。

## Execution Evidence

- 当前两平台实际入口均为 6,795 B，全部路由材料均为 30,382 B；相对原默认入口下降约 74.1%，总材料下降约 23.9%。
- 7 个相关 Node 测试文件的 43 项定向回归通过；route helper 的 14 项 Python 回归通过，包括临时选择恢复及保存默认目标隔离。
- 两平台 skill-creator 校验通过；改动 JS/Python 语法及 diff whitespace 检查通过。
- 源、快照和当前两平台 route 投影一致；compiled targets 检查为 935 个文件零漂移，无须重建。
- 隔离目录真实 CLI init、update dry-run、uninstall dry-run 通过，两平台参考文件完整。当前项目第二次 enhance-only dry-run 为 0 项目标变化。
- helper 两平台源码与原 HEAD、部署副本逐字节相同；本机 implement/check 默认未改变。
- 现有跨平台更新链路新增 7 个路由相关 Node 测试文件；Python CI 已包含 route helper 回归，远端结果已按最新业务 SHA 核验。
- 全量 `npm test` 通过：JavaScript 647 项（645 通过、2 项 Windows 专属跳过）；Python 500 项（498 通过、2 项 Windows 专属跳过）；Patch conflict、935 个 compiled 文件、默认预算及输出模板门禁通过。
- strict AI context budget 通过；本次不修改 workflow/SessionStart，控制面总量保持 108,214 B。既有全部状态正文合计 13,835 B 的推荐预算告警保持原样，低于审阅阈值。
- 正式 inline Check-All：requested=auto、effective=full、confidence=high；三维通过，CHK/FBK 为 0，DOC 1（同步本文件执行事实）。
- Update-Spec 为 written：仅更新既有 enhancements-model 中的路由契约；非 spec 文件摘要保持原样，whitespace 与 22 项相关 Node 回归通过。

## Delivery Evidence

- Skill-Garden 作者源提交 `148a3648070ec6a423c2db6ac709746f044982dc` 已推送；Flower 业务提交 `b38853d59844c63245102081c2a4d446b2437d7a` 已推送，快照 sourceCommit 与子仓一致。
- 该业务 SHA 的 Windows 更新链路 CI 暴露测试夹具错误：参考文件未按目标 Python 命令物化，compiled agent 夹具直接保留 canonical `python3`。日志：<https://github.com/SilentFlower/flower-trellis/actions/runs/38542175495>。
- 修复仅涉及 `test/js/platform-skill-distribution.test.js`，复用已有 `resolveTrellisPythonCommand` / `materializeTrellisPythonText`；原有平台矩阵、内容一致性、体量及只读角色断言保持。
- 本地默认命令路径 14 项回归通过；显式 `TRELLIS_PYTHON_CMD=python` 路径 10 项回归通过。原生 Windows 验收需补充提交后的 CI，不以 Linux 模拟代替。
- 补充测试修复提交 `e07287a523f777e7f389adac8064a4b82b3272b2` 已推送，最新业务提交的两个适用 CI 工作流 6/6 job 均为 success：
  - Python：<https://github.com/SilentFlower/flower-trellis/actions/runs/38544573996>，Ubuntu/Windows × Python 3.8/3.12，4/4。
  - 更新链路：<https://github.com/SilentFlower/flower-trellis/actions/runs/38544574124>，Ubuntu/Windows × Node 22，2/2；原生 Windows 已覆盖修复后的目标命令物化与完整平台投影断言。
- 补充提交只改测试文件，未修改 SessionStart 代码、配置或其 workflow；该能力复用前一业务提交的成功结果：<https://github.com/SilentFlower/flower-trellis/actions/runs/38542175279>，Ubuntu/Windows，2/2。
- 本地 Windows 专属用例跳过不作为平台验收证据；以上原生 CI job 全部通过后，才执行任务完成态与 Close。
