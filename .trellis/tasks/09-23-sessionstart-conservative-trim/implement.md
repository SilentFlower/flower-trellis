# 实施计划

## 1. 开工与基线

- [ ] Brief 经用户确认后运行 `task.py start`，再由 `trellis-route(target=implement)` 选择执行模式。
- [ ] 按 JSONL 顺序加载规范、PRD、设计和本计划；核对根仓与 Skill-Garden 基线，不覆盖
  `09-05-telemetry-roadmap` 等用户既有未跟踪内容。
- [ ] 保存当前预算输出：SessionStart 19,177 B、Codex 三段 7,081 / 7,060 / 5,036 B、Claude 三段
  4,682 / 7,060 / 5,036 B、控制面总量 108,611 B。

## 2. 先建立回归断言

- [ ] 更新 `workflow-gate-ownership` 测试：17 项 owner 行保持完整，更新/GC 常驻机制句不存在，
  其余跨阶段顺序及关键 owner 契约仍被锁定。
- [ ] 为 workflow 精简增加正反断言：Phase 1.3 行为句存在，平台枚举、3.1 历史和 Guardrails 重复句消失；
  `Planning Artifacts`、阶段导航、详情命令及受保护规则仍存在。
- [ ] 在 SessionStart Python 测试中覆盖 `<ready>` 删除、Codex/Claude 平台文本、共享 Hook 已识别平台、
  未知平台完整回退、分段边界和 Astra 不变。
- [ ] 扩展更新契约测试，覆盖动态块最终 `ai.mode` 的 `ask` / `auto` / `notify`（含 `auto` 安全降级）、
  先于普通路由、可暂缓/跳过和成功后 `trellis-push`；补足 GC 无动作与 moved/deferred/error 结果断言。

## 3. 修改 Skill-Garden 作者源

- [ ] 新增或扩展窄 Patch，删除各已存在原生 SessionStart Hook 的 `<ready>` 块；使用精确 selector，
  不删除 `<task-status>`、guidelines 或首答提醒。
- [ ] 新增 workflow 精简 Patch，替换 Phase 1.3，删除 Guardrails 重复句和 3.1 历史说明；保持
  `### Planning Artifacts` 锚点不变。
- [ ] 修改 Hub Patch，仅移除常驻更新与 GC 机制句，保留完整 owner 表和其余跨阶段顺序。
- [ ] 在 Codex 与共享 SessionStart Hook Patch 中加入纯平台裁剪函数：共同协议恒定、Codex 补充原生
  注入说明、共享 Hook 复用 `_detect_platform()`、未知平台返回原完整段落。
- [ ] 验证 Grok/Kimi 平台配置与生成入口仍保留 `spawn_subagent`、`coder` / `explore` 的真实调用契约。

## 4. 修改 Flower 条件资产

- [ ] 调整 `src/assets/flower_session_start.py` 的 rules/stages builder 调用，显式传入 Codex 或 Claude；
  state、维护、Astra、workflow-state 刷新、预算和错误降级保持不变。
- [ ] 调整 `src/assets/flower_update_hook.py` 的动态指令，完整表达展示、确认、执行、snooze/skip 和
  普通请求顺序；无事件路径保持零输出。
- [ ] 保持 `src/commands/self-update.js` 的 `run_trellis_push_confirmation` 结果契约不变，除非测试证明
  需要仅做文案一致性修正。

## 5. 生成与投影

- [ ] 在根仓运行 `npm run patch:targets`，审查 Skill-Garden compiled targets 只包含预期变更。
- [ ] 运行 `npm run sync` 生成 `enhancements/0.6` 快照，逐字节核对作者源与快照。
- [ ] 在隔离目标通过正式 Flower 安装链验证支持平台，再更新当前项目 dogfood；重复执行一次，第二次
  必须为零目标变化。
- [ ] 核对 `.codex`、`.claude` 及受影响共享 Hook 的最终输出来自生成链，不保留手工漂移。

## 6. 验证矩阵

| 验证组 | 必须证明 |
| --- | --- |
| 常驻内容 | 五类选定内容退出常驻上下文，完整 owner 表与关键流程约束仍在 |
| 平台 | Codex、Claude 和共享已识别平台只得到适用说明；未知平台完整回退；Grok/Kimi 入口合同仍在 |
| 更新 | 无事件零注入；最终 `ai.mode` 三种动作及 `auto` 安全降级、暂缓、跳过、成功路径顺序和授权不变 |
| GC | startup/resume、三天阈值、无动作静默、动作/延后/错误报告不变 |
| 分段 | state/rules/stages、Planning Artifacts 锚点、额度、Astra、心跳和错误降级不变 |
| 生成 | canonical、compiled targets、snapshot、隔离安装与 dogfood 一致，第二次安装幂等 |
| 历史路径 | 规范发现、planning 范围隔离、实现后检查、直接 push、交互停止、auto-loop 返回和 compact 恢复可达 |

定向及完整验证命令：

```bash
python3 -m unittest discover -s test/python -p 'test_flower_session_start.py'
node --test test/js/workflow-gate-ownership.test.js test/js/flower-update-contract.test.js \
  test/js/platform-patches.test.js test/js/apply-enhancements.test.js test/js/ai-context-budget.test.js
node scripts/check-patch-conflicts.mjs
npm run patch:targets:check
node scripts/check-ai-context-budget.mjs
node scripts/check-ai-context-budget.mjs --strict
npm test
git diff --check
```

## 7. 结果记录与收口

- [ ] 在研究记录中追加修改后真实字节数、各平台差异、更新事件增量及字节/token 口径说明。
- [ ] 分开记录确定性结构/入口证据与真实模型对话证据；明确后者的样本限制。
- [ ] 运行 Check-All，修复范围内问题并重跑受影响门禁；随后进入 Update-Spec，更新上下文预算、
  Patch 所有权和平台裁剪稳定契约。
- [ ] 未经单独确认不提交、不推送、不发布。需要回退时恢复作者源与 Flower 资产，再重跑相同生成链。
