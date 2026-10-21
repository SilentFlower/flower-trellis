# Current Rules And Baseline

## Evidence

- Flower HEAD：`ad1a1df956c1de506f5ac58d054268dc04116dad`；Skill-Garden HEAD：`8689c04e7d3adf058c55a79ce6eca944424268b1`。建任务前两仓干净。
- `.flower/state.json` 的 `flower/skill-garden` 拥有两平台 route 入口、helper 及公共 reference；耐久作者源位于 `vendor/skill-garden/.trellis/0.6/`。
- `SKILL.md:196` 和 `:283` 分别规定下一轮执行；`:268` 规定常规回复必须保留 YAML。`:52` 把所有覆盖意图都强制导向菜单；明确 target/mode 的请求因此也需二次选择。
- helper 已提供 `resolve`、`write`、`read-pref`、`write-pref`、`clear-pref`。`--save-pref` 区分临时选择与个人默认，无须增加自然语言解析器。
- 当前 `.trellis/.route-prefs.tmp` 为 `implement=inline` 与 `check=check-all-inline`；本任务实施和检查继续使用这些默认。

## Actual Projected Bytes

每平台部署后的文件与体量相同：

| 文件 | UTF-8 字节 |
| --- | ---: |
| `SKILL.md` | 26,262 |
| `references/check-all-agent-body.md` | 3,429 |
| `references/platform-dispatch.json` | 10,259 |
| 合计 | 39,950 |

canonical `.claude` 只维护入口和 helper，公共 reference 从 `.agents` 投影。因此不能将 canonical `.claude` 的 26,262 B 当全部材料基线。

## Protected Consumers

- `test/python/test_route_state.py`：历史 mode 归一、task/auto-loop 授权隔离、损坏状态失败关闭、原子写入及 pref-only 边界。
- `test/js/check-all-smart-depth.test.js`：Check-All 统一入口、light/full 归属、catalog 只在 subagent 路径加载。
- `test/js/check-all-fallback-findings.test.js`：CHK/FBK/DOC、部分验证、上线后验证和只读专用 agent。
- `test/js/untracked-flow-gate.test.js`：pref-only、临时不持久化、自包含 untracked dispatch。
- `test/js/workflow-gate-ownership.test.js` 与 `pre-check-feedback-gate.test.js`：合法来源和 implement completion 归属。
- `test/js/platform-skill-distribution.test.js` 与 `plugin-skill-garden.test.js`：所有平台分发及辅助文件投影。

## Plan Decision

已明确的用户目标足以收敛方案，无待决产品问题。首先展示完整 Brief；当前“可以”是同意上述改法，尚未完成新任务的首次完整 Brief 交接。
