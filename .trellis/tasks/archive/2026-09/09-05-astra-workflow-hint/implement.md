# Astra SessionStart 提示实施计划

## Authorization And Scope

用户已确认原 Brief，任务已启动；随后明确将首版收敛到仅 SessionStart，以减少重复。按该调整更新三件套后继续既有 inline 实现路由，不重复索取实现授权。

只修改 Flower 自有 SessionStart 资产、相关测试/预算与规范。UserPromptSubmit 源 Patch 不改。原有 .flower 修改、GitLab 技能和 beginner-usage-guide 产物保持独立。

## Ordered Work

- [x] I1 核对正式客户端 SessionStart 输入、模型字段、startup/compact 事件及实际接收；记录版本和证据限制。（A4、A6）
- [x] I2 在 flower_session_start.py 实现单一提示正文、精确筛选、独立开关及可选失败诊断；保留规则分段与原生状态。（A1—A4）
- [x] I3 增加模型、source、part、platform、配置、禁用和异常路径回归；验证普通 UserPromptSubmit 不新增。（A1—A3）
- [x] I4 扩展预算 fixture 至 Astra 命中、开关及三种来源，计量完整实际输出，不调高阈值。（A6）
- [x] I5 跑专项和项目质量门禁；在隔离临时项目按正常安装/重复更新回读结果，再通过正常资产投影更新本项目 dogfood，保留已有插件修改。（A5）
- [x] I6 冻结六场景和评分，在独立固定 Astra 会话完成开关各 5 次，输出原始证据、分项对照及限制。（A7）
- [x] I7 按 Phase 2.1 completion contract 进入 Check-All；后续规范与提交按所属流程处理，不跳过质量检查。（A4—A7）

## Validation Commands

```bash
python3 -m unittest discover -s test/python -p 'test_flower_session_start.py'
node --test test/js/ai-context-budget.test.js test/js/platform-patches.test.js test/js/apply-enhancements.test.js
node scripts/check-ai-context-budget.mjs
npm test
node scripts/check-ai-context-budget.mjs --strict
```

仅对实际修改 JS 做 node --check；新增 Python 源检查语法。不修改 Skill-Garden 源时不运行会制造时间戳漂移的同步命令；由现有快照一致性及 compiled targets 检查证明它们未受影响。只在测试失败或新修改需要时补跑，避免无理由重复。

真实安装使用当前 CLI 的受支持参数，在临时项目完成 init/update/repeat update 和卸载 dry-run。更新本项目前核对所有权和现有 dirty 文件，不覆盖无关插件声明或修改。

## Evidence And Completion

在本任务 research 保存：工程命令/结果、事件与模型字段、各分段块数/字节数、宿主正文或预览接收、冲突来源/层级/处置、60 次行为运行配置/提示哈希/原始记录/评分、正常安装及重复更新证据。

工程注入正确不能替代行为改善。真实宿主或 Astra 实验不可执行时，明确记录缺口、保持相应验收未完成。发生原上下文丢失、错误模型命中、其他平台变化或用户开关覆盖时先修正重验，不带入实验。不增加 Stop 或 SubagentStart 补救平台。

## Completion Evidence

I1—I7 已完成：英文提示及开关、12 项专项回归、完整 npm/严格预算、正常安装与幂等、真实 Astra/5.5/手动及自动 compact、60 次行为对照、inline full Check-All。工程详见 research/engineering-report.md，行为详见 research/behavior-report.md。主指标未显示提升；探索性模板信号与工具开销上升均保留。任务保持 in_progress，后续规范和提交按阶段流程处理。
