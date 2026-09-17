# 实施计划

## 1. 开工与上下文

- [x] 完成三件套及 Brief 评审，再 task.py start；由 trellis-route 选择执行模式。
- [x] 读取 trellis-before-dev、JSONL/spec/research 和实际相关定义；保留 task_intent 捕获的主仓既有 untracked 与 vendor 基线。
- [x] 核对 canonical、发布快照及当前 dogfood 字节差异，确认运行时与决策日志 API，记录实际修改范围。

## 2. 先补真实事故回归

- [x] 在现有临时 Git fixture 补“旧 basename pending→文档修改→next”与“正确 pending→未 record→next”场景。
- [x] 补重复 next 不覆盖 issued_at/Check baseline/depth/预算的断言。
- [x] 补三轮实际纠正、第三次成功/失败、查询零计数、同 attempt-id 重放及跨压缩恢复的 CLI 场景。
- [x] 保留无 decision 漂移阻塞的反例，覆盖文档与代码 --file 的兼容用途。

## 3. Runner 最小实现

- [x] 增加 task-file 参数与路径预检；错误只写必要诊断，不产生无效 decision/pending/manifest。
- [x] 保存/重放原 action 与逐文件 baseline，独立纯诊断与现有会消费状态的 helper。
- [x] 增加可选恢复上下文、reconcile CLI、路径映射校验、三轮计数及幂等回执；持久 run/item 状态仍 running。
- [x] 复用追加决策日志实现旧 pending 路径纠正审计，保留原基线；处理日志已成功而 runtime 未落盘的重放。
- [x] 对正确 pending 返回原 action；仅原 record 进行基线重绑与阶段推进。
- [x] 按证据区分可纠正、既有 Check retryable、外部/保护/越权及预算耗尽；防止同错误双通道计数和依赖提前传播。
- [x] 补默认 status/resume 恢复摘要，保留紧凑输出、终态显式恢复与旧 schema 降级边界。

## 4. Owner 与分发同步

- [x] 同步 canonical 两份 Auto-Loop Skill 的参数示例、纠正顺序、三轮预算、同轮继续和终态边界。
- [x] 按 research/recovery-test-coverage.md 检查 route、Check、Update-Spec、会话恢复等消费者，补最小出口引用，避免新恢复被误当停止点。
- [x] 更新旧“其它 action 一律 artifact-drift 阻塞”等矛盾静态断言，保留不在本功能范围内的真实安全阻塞断言。
- [x] 通过既有生成链同步 compiled targets（如受影响）、enhancements 快照和受管 dogfood；不直接编辑投影作为作者源。

## 5. 验证矩阵与命令

| 验证组 | 必须证明 |
| --- | --- |
| 原事故 | 错路径在新登记时提示纠正；旧 pending 可有证据地原地修正；正确 pending 恢复不阻塞。 |
| 恢复身份 | 同 action、issued_at、baseline、Check depth/route 与 commits 不变；真正 record 后才下一阶段。 |
| 尝试预算 | 初始诊断 0、三轮实际纠正、第三轮失败终态；查询/回执重放不扣次、不追加重复日志。 |
| 安全反例 | 根同名歧义、越界/软链/未登记仓库、跨任务、protected、损坏决策、未知外部变化不放行。 |
| 既有功能 | Check DOC 白名单和重录预算、fix/recheck、commit-repair、依赖传播、独立任务、schema 1/2。 |
| 故障注入 | 日志/状态写入失败、成功回执丢失、变更发生在诊断之后；无静默接受和重复审计。 |
| 消费者 | retryable 不变成持久状态、不丢 route、不进入普通 Post-Check Stop；所有恢复入口同轮执行纠正。 |
| 分发 | 源码/快照/受管安装协议一致，重复安装幂等，输出预算不通过提高阈值规避。 |

使用已存在测试入口；实施时按实际新增用例名收窄首轮：

```bash
python3 -m unittest discover -s test/python -p 'test_auto_loop.py'
python3 -m unittest discover -s test/python -p 'test_route_state.py'
node --test test/js/workflow-gate-ownership.test.js test/js/update-spec-auto-decision.test.js test/js/check-all-smart-depth.test.js
python3 -m py_compile vendor/skill-garden/.trellis/0.6/scripts/auto_loop.py
npm run patch:targets
npm run sync
npm test
git diff --check
git -C vendor/skill-garden diff --check
```

compiled targets 只在相关 Patch/目标投影受影响时生成，其 --check 已包含于 npm test。完整测试通过后不无故重复；新增修改、失败或未解决风险才重跑受影响验证。dogfood 用现有 CLI 对隔离临时目标走安装、更新与第二次应用，具体命令在实施时依据项目 SOP 固定，不操作原事故 run。

## 6. 收口与回退

- [x] 全范围 Check-All，按用户 AC 逐项回读证据；不得将测试通过写成真实历史 run 已恢复。
- [x] trellis-update-spec 局部更新 Auto Loop 路径、自纠/预算/恢复合同。
- [x] 展示精确双仓提交范围并按 trellis-push 执行；用户确认普通双仓提交与推送，未借用原事故的 commit-only 授权。
- [ ] 归档、push、发布依各自明确授权；不手写任何历史 runtime、不重写已成功 commit。
- [ ] 需回退时恢复 canonical 与生成投影，保留审计；新恢复上下文存在时不热降级旧 runner。

## 本轮验证记录（2026-09-15）

- Auto-Loop 70 项回归通过，覆盖原事故两条恢复链、三轮纠正、回执幂等、状态写失败后的审计恢复、保护边界、旧 schema 2 和依赖传播。最后补充 Check 编辑后禁止补登记的定向回归通过。
- 完整 `npm test` 通过；包含 JavaScript/Python 全套、Patch 冲突、compiled targets 零漂移、AI context budget、输出模板检查。定向消费者 20 项通过；双仓 `git diff --check` 与 runner 语法校验通过。
- 隔离 Claude/Codex 安装与当前项目均通过受管 Plugin 生命周期同步，二次应用零修改；外部 rd-guide Plugin 锁定记录保留，未操作原事故项目 runtime。
- 全套校验中修正两个既有测试夹具：beta 版本显式选择以进入真实事务回滚测试；Patch 集合与 compiled plan 比较以替代固定的 43 项计数。
- 原 action 使用可选 generation 防止秒级时钟碰撞；恢复摘要不展开完整回执。规范已局部更新。双仓业务代码已提交并推送，快照来源与安装锁已同步；未发布或归档。
