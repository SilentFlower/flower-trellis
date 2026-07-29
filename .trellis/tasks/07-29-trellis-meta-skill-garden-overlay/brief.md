# Brief — 补全 Trellis Meta 的 Skill-Garden 增强架构

## Goal

- 通过 Skill-Garden 0.6 Patch Engine 外科式增强上游 `trellis-meta`，准确表达 Flower/Skill-Garden 的架构、所有权和修改入口；同时修复 Auto-Loop 与 Check-All DOC 自动修复之间的 hash 冲突，使可证明的 action 内漂移能够有限自纠。

## Scope

- 在 `vendor/skill-garden/.trellis/0.6/overrides/` 以四组声明式 Patch 增强既有 `trellis-meta` 文档，保留仍成立的上游事实并替换冲突操作建议。
- 新增 full-or-selected `trellis-meta` Bundle，覆盖全量、`trellis-meta`、`meta-architecture`、`trellis-create-command` 和 `create-command` 选择路径。
- 扩展 conflict policy、JS/Python consumer tests、compiled targets 和 Flower dogfood 验证。
- 在 canonical `auto_loop.py` 中为 `run_check_all` / `run_recheck` 保存逐文件 artifact baseline，并新增重复的 `--doc-remediation-file` record 参数。
- DOC 重绑只允许当前任务 `implement.md` 与 `brief.md`，声明集合必须与真实变化完全一致；合法变化追加带来源和文件列表的 manifest revision。
- 未声明 Check artifact drift 前 3 次返回 `status=retryable` 并保留原 outstanding action；第 4 次、显式 `blocked + artifact-drift`、其它 action 漂移和 protected drift 继续 terminal blocked。
- 为所有 Skill-Garden 管理能力增加 `trellis-meta` 影响复核合同，结论固定为 `no-op | patch-required`；owner 内部 SOP 不复制进 meta，稳定架构、所有权、发现或分发面变化才更新 canonical meta Patch。
- 同步 vendor 源到 `enhancements/0.6`，刷新 compiled targets，并通过 Flower enhance-only 更新 `.agents`、`.claude`、`.trellis/scripts` dogfood 产物。

## Non-Goals

- 不修改或发布上游 `@mindfoldhq/trellis` npm 包，不完整 fork 上游 meta 文档树。
- 不重新设计 Patch Engine、Plugin Runtime 或各 workflow owner 的完整业务流程。
- 不把 retryable 扩大到 implement、spec update、commit-only、权限、生产、产品语义或 protected path 等真实阻塞。
- 不允许 DOC 通道修改 PRD、design、其它任务或未知外部内容，也不把机械 DOC 修复伪装成 AI 产品决策。
- 不把当前 dogfood 文件当作者源直接维护，不扩展 0.5/old 变体。

## Key Context

- 作者源位于 `vendor/skill-garden/.trellis/0.6/`；`npm run sync` 生成 `enhancements/0.6`，Flower Plugin transaction 再生成当前项目 dogfood。
- `.flower/plugin-lock.json` 和 `.flower/state.json` 是受管 ownership、operation provenance 与结果 hash 的权威。
- meta Patch 使用 schema v2、精确 selector/baseline、`each-existing` 和 `missing: skip`；上游 0.6.5 漂移必须预检失败关闭。
- workflow hub 只保留 owner 指向；Auto-Loop CLI 字段、DOC 白名单和重试矩阵由 runner 与 owner skills 维护。
- Planning Brief 显式预授权仍由 `trellis-task-brief` 与 task-start brief guard 拥有，meta 的 Planning handoff 路由保持准确，因此本次影响复核为 `no-op`。
- 本次故障由 `record` 在消费 Check-All 结果前比较冻结聚合 hash、清空 `last_action` 并直接 blocked 引起；新合同以 Check action 的逐文件 baseline 提供可审计归因。
- Brief preauthorization 任务已经提交并归档；当前共享聚合文件以其提交为基线，只保留本任务新增的 meta/auto-loop 语义，不能回退已提交 Brief 合同。

## Acceptance

- 增强后的 meta 能解释 Flower Plugin、Patch/Bundle、五类 ownership、真实源/快照、更新回滚路径和 workflow owner 发现方式，且不保留相反的直接编辑建议。
- 全量和四个选择别名的 Patch selection、operation order、provenance、跨平台最终字节、幂等和 conflict assertions 有自动化覆盖。
- Check-All 对当前任务 `implement.md` / `brief.md` 的合法 DOC 修复可完成 manifest 重绑并继续推进，不进入 `completed_with_blocked`。
- 漏声明的 Check drift 返回 retryable、保留 outstanding action，并可在补声明后重录；预算耗尽或明确无法归因时才 blocked。
- PRD/design/其它任务/声明不一致/protected 漂移均失败关闭；其它 action 不使用 Check 自纠预算。
- vendor、snapshot、dogfood 三层一致，compiled targets 无漂移，第二次 enhance-only 为 0 修改。
- auto-loop Python 全量回归、控制面 JS tests、Patch tests、`npm test`、strict context budget 和双仓 diff check 通过；并明确区分任何并发任务导致的独立失败。
- code-spec 固定 `trellis-meta` 的双态影响复核，最终 meta 继续路由到 Brief owner 且不复制显式预授权交互细节。

## Next Step

- Check-All 已通过；按交互式完成门禁等待进入 `trellis-update-spec`，再由 `trellis-push` 生成精确提交计划。
