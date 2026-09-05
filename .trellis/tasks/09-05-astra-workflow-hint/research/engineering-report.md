# 工程验证记录

## 结果

源码和本项目安装资产一致。只在 Codex SessionStart 的 state 分段，针对严格命中 gpt-6-astra 的 startup / clear / compact 新增一次英文块。完整块 1502 UTF-8 字节，连同分隔换行增量 1503 字节。UserPromptSubmit 源文件、注册、额度及其他平台未修改。

完整 npm test 通过：519 项 JS、323 项 Python、Patch 冲突、compiled targets、默认预算与模板门禁。随后新增真实 UTF-8 超限保护测试，相关 Python 12 项再次通过。严格预算、语法、git diff --check 和快照校验通过；states-total 的既有 13119 字节 warning 保留，未抬高阈值。

## 正常安装

通过当前 CLI init -y --codex 在 /tmp/flower-astra-sessionstart 正常安装，随后 update --enhance-only 重复更新。独立 false 配置被保留，原工作流仍输出、新提示零块。配置首次改变后 ownership 状态重新收敛，再次更新整个安装文件树零变化。Plugin remove 与 uninstall 的 dry-run 均完成，无实际卸载。

本项目先 dry-run 确认只投影一项，再走正常 update --enhance-only。flower/skill-garden 锁内源摘要更新；原 .flower/plugins.json、外部 Plugin 锁条目、GitLab 技能、config.yaml、hooks.json、beginner-usage-guide 原始字节均保留。未修改 vendor 或 enhancements；发布快照与固定子仓提交 6199ab8b2e 一致。

## 真实宿主

客户端为 codex-cli 0.153.4。隔离记录器仅透明转发已审查的 Hook，保留原始 model/source 和完整输出；测试关闭无关的更新检查 Hook。Astra startup 命中一块，gpt-5.5 startup 零块，两者原工作流正常。

自动压缩阈值设为 26000，真实记录到 UserPromptSubmit 后的 SessionStart(compact)，三段合计一块，紧接的模型答复识别到提示。手动 TUI /compact 完成后，下条用户消息前先收到三个 compact 分段，再执行 UserPromptSubmit；同样只有 state 一块。TUI /new 在该版本产生 startup，未观察到 clear；clear 已由实际脚本回归覆盖，不冒充实测客户端事件。

## 冲突与限制

当前宿主通用避免标题要求与 Brief 模板冲突的清单见 feasibility.md；未找到可编辑的宿主源，因此只澄清候选提示适用范围，不声称删除或覆盖所有宿主规则，也未推测历史事件原因。

只验证新增提示的筛选，关闭或切换不能撤回历史。字节预算不是 token；完整 Hook 输出、命令证据及各分段计量见 engineering-evidence.json、host-hooks.jsonl 和 host-event-summary.json。持久化宿主 rollout 中已直接核对 role=developer 的完整正文及哈希，见 host-developer-receipt.json；不是仅依靠模型自述。行为结果另见 behavior-report.md，工程通过不代替效果证据。

## 验收映射

| 要求 | 代码/证据 | 结论 |
| --- | --- | --- |
| R1 / A1 | render_part 精确模型/source/platform/part 条件；连续模型输入回归；真实 Astra / 5.5 会话 | 通过 |
| R2 / A2 | 仅 state 的追加点；startup、自动及手动 compact 宿主记录；rules/stages 无共享先后依赖 | 通过 |
| R3 / R4 / A3 | 单一常量、true/false 明确解析、非交互及原禁用早退；正常更新保留关闭配置 | 通过 |
| R5 / R6 / A4 | 英文候选六项语义；feasibility 的冲突清单及宿主限制 | 通过，不声称提示效果已证实 |
| R7 / A5 | Flower 自有源资产、正常安装/dogfood 投影、重复更新零变化及子仓/快照一致 | 通过 |
| R8 / A6 | 12 项专项回归、全套 npm、严格预算、27 条真实 Hook 输出及相应模型答复 | 通过，clear 为脚本回归而非本客户端观测 |
| R9 / A7 | behavior-manifest.json 冻结场景和评分；behavior-report.md / 压缩原始记录 | 通过；六项主指标无明显改善，探索性模板信号和开销见独立报告 |

假设检查覆盖事件 schema → 模型筛选 → 项目配置读取 → additionalContext → 正常安装分发 → 宿主接收。无 API/数据库/前端迁移；配置缺失为默认开启，非法显式值仅停用可选提示并保留状态与诊断。未发现主路径或保护路径缺口。新增配置/预算的规范沉淀按下一阶段 trellis-update-spec 处理，README 已交付使用方式。
