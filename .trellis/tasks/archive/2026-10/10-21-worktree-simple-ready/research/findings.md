# Worktree 简化调研依据

## 现场与历史

- 原始会话：Codex `01a15cab-bcd0-7fa2-bdf9-676b5342f8bb`，cwd 为 `/root/project/xhgj-ai-harness`，2026-10-21；已通过 `trellis mem context` 和保留的工具回执核对。
- 13:30 目标任务脚本明确拒绝 `--base-branch origin/prod --no-start`。
- 13:48 确认 `.trellis/config.yaml` 的旧记录为 `sha256:fbf52dea…`，实际内容为 `sha256:c5d7420d…`。
- 13:51 同版本重应用回执核对 173 个文件内容不变，仅四条 Patch resultHash 刷新。
- 13:51 重试预检返回 `flower-installation-conflict`，路径为 `.flower/plugins.json`：已提交基线 0.6.11，源安装 0.6.12-beta.1。
- 14:14 官方 create 因目标缺少 `.codex/config.toml` 返回 `flower-installation-invalid`，已回滚。该文件明确被根仓 `.gitignore:37` 忽略。
- 最终原生 Git 创建 + 目标同版本 Plugin 生成独立本地配置后成功。交接记录为 `/tmp/issue90-worktree-handoff.md:69`；该临时文件只作为现场补充证据，需求和结论已经写入本任务。
- 历史任务 `.trellis/tasks/archive/2026-09/09-07-worktree-flower-installation-status/` 的目的本来是让缺失安装信息可以补齐，不是让任何来源状态异常都阻断 Git 创建。仍保留“不能复制不匹配记录冒充安装事实”的约束。

## 当前实现

| 证据 | 当前行为与影响 |
| --- | --- |
| `src/plugin/application-service.js:549` | verify 遍历 applied.paths，没有遍历 applied.patches；与 worktree 校验不一致。 |
| `src/plugin/install/state-validation.js:37` | 对每条 Patch 检查整文件 resultHash，相同 target 被重复计算；共享配置无关变化也会报告漂移。 |
| `src/lib/worktree-flower-state.js:146` | transfer 在目标记录不完整时依赖 source 安装集合，先校验源，再比较已有目标记录；任何冲突抛异常。 |
| `vendor/skill-garden/.trellis/0.6/scripts/worktree_setup.py:1200` | create 预检强制要求目标 task.py，但仅检查存在性。 |
| `vendor/skill-garden/.trellis/0.6/scripts/worktree_setup.py:1214` | Flower 继承预检是 create 计划的必经步骤，未独立返回可恢复问题。 |
| `vendor/skill-garden/.trellis/0.6/scripts/worktree_setup.py:1263` | 完整展示对象参与确认指纹，包含不会复制的源 dirty 清单与子仓现场信息。 |
| `vendor/skill-garden/.trellis/0.6/scripts/worktree_setup.py:1347` | 硬编码新版 create 参数，任何后续异常都会进入整 worktree/branch 删除补偿。 |
| `src/commands/worktree.js:167` | create 必须提供 task title/slug，Git 建目录与任务创建绑在一起。 |
| `src/builtin-plugins/skill-garden/provider.js:160` | 当前随包 Provider 只提供当前版本与完整性身份，不能假定任意旧版包可离线重放。 |
| `src/plugin/application-service.js:323` | replay 使用 lock-first；已有 Plugin 事务与 changed-only 可复用，不能另造安装 writer。 |
| `src/plugin/sources/gitlab-provider.js:196` | prepareLocked 缓存缺失会联网；自动 worktree bootstrap 不能直接调用它再声称全程离线。 |

## 旧脚本兼容的真实边界

已只读核对平台本地 `origin/prod` 的 `.trellis/scripts/task.py`、`common/task_store.py` 与 `common/active_task.py`：

- create 支持 title/slug/assignee/description，但不支持 base-branch/no-start。
- 单独的 set-base-branch 与 set-branch 命令存在，可以创建后补齐。
- task_store.cmd_create 会通过 resolve_context_key 自动绑定当前会话；直接删掉不支持的参数仍会把来源会话身份带入目标。
- 该版本 resolve_context_key 从 TRELLIS_CONTEXT_ID、平台 session/conversation/transcript 环境变量和目标本地 Cursor ticket 解析身份。
- 因此兼容路径必须使用不带来源会话上下文的子进程环境，并验证没有生成 session/current-task；无法确认兼容时将任务保持 pending，而非猜测接口或修改目标脚本。

## 所有权与发布路径

- Flower 自有：`src/commands/worktree.js`、`src/lib/worktree-flower-state.js`、Plugin 共享校验及测试。
- Skill-Garden 作者源：`vendor/skill-garden/.trellis/0.6/scripts/worktree_setup.py` 和 `.agents/.claude/skills/trellis-worktree/SKILL.md`；flower-update 中 project_unknown 的交接文案也需同步。
- `enhancements/0.6/` 是 `npm run sync` 的发布快照；项目 `.trellis/` 和平台技能为 dogfood，不能只修改部署结果。
- `.flower/state.json` 明确登记上述 runtime/skill 的 ownership；本轮通过既有同步及 Plugin 生命周期更新，不手工改摘要。

## 首版取舍（已由 KISS 收缩决定替代）

- 将整文件摘要保留为安装管理的诊断证据，移出 Git 创建的必要条件；本轮不扩张为全局 Patch provenance/schema 改造。
- 优先目标本地状态，安装继承只是可以放弃的优化；需要复制 state 时仍严格校验全部证据。
- 自动准备仅允许验证后的固定版本以及不会改动现有内容的计划；缺包、内容改动或新增授权需求列入待办。
- 用现有 common-dir registry 保存最小 setupRequest，支持 prepare 重试；不引入新的独立状态机文件。

## KISS 收缩后的边界

- 用户明确要求收缩：移除默认来源回退、整仓安装预演、registry setupRequest 和任务自动续行。
- 当前设计以 prd/design/brief 为准；本文件前述首版取舍仅记录设计来源，不再作为实施要求。
