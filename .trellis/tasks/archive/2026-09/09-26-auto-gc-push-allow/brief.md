# Brief — 自动 GC 提交默认放行

## Goal

- 普通 `trellis-push` 默认允许经验证的 SessionStart GC 归档提交随已确认的推送发布，免去针对该 GC 提交的额外许可。

## Scope

- 在 Skill-Garden 托管的 Codex/Claude `trellis-push` 中识别历史 ahead GC 提交，并覆盖普通推送、任务记录发布及 push-only 恢复。
- 在计划和结果中标明随推送携带的已验证 GC；同步作者源、发布快照、本项目部署结果和长期规范。
- 用真实 GC 提交、隔离正反例及项目检查验证判断边界和分发一致性。

## Non-Goals

- 不改变 GC 的创建、移动、恢复或提交算法，不在 Push 中主动运行 GC。
- 不为其它自动提交建立通用白名单，不免除正常业务提交计划的一次确认。
- 不默认放行同时改写任务内容的 GC 提交；该形态仍需单独核验来源。

## Key Decisions

- 只有单父、固定消息、完整且内容不变的 closed 任务归档移动或同内容去重才获得默认许可；消息相同但证据不符仍属于未知 ahead。
- 同批多个任务可一起识别；归档月份必须与 `closedAt` 的 UTC 月份一致。
- 已验证 GC 作为历史 ahead 随正常 push 发布，不计入本轮业务 planned files 或任务记录提交，也不增加第二次确认。

## Key Context

- Push 当前在 `.agents/skills/trellis-push/SKILL.md` 的 Step 2、Step 5 阻断无法归属的历史 ahead；恢复细节位于 `references/completed-task-recovery.md`，展示格式位于 `references/output-templates.md`。
- `task_lifecycle.py` 生成本地 `chore(task): gc closed tasks`，已发生的 `0c02fb7` 是两份 closed 任务的 15 个纯重命名。
- Skill-Garden 作者源位于 `vendor/skill-garden/.trellis/0.6/`，经 `npm run sync` 进入 `enhancements/0.6/`，再由 Flower Plugin 投影到本项目。

## Risks / Deferred

- 仅凭提交消息无法证明来源，判断必须核对提交树、文件内容与关闭态；证据缺失时继续停止。
- 由 runner bookkeeping 导致任务内容变化的合法 GC 暂不在本次默认放行范围内。

## Acceptance

- `0c02fb7` 形态、多任务同批和同内容去重可识别并在计划中展示，无 GC 专项许可。
- 同消息但有额外业务改动、任务内容变化、错误月份或未关闭任务的提交不能通过识别。
- 任务记录 push-only 恢复适用同一规则；未知 ahead、Git 集成态和原有 exact file 安全条件保持阻断。
- 作者源、快照、项目运行 skill 与规范一致，相关同步及验证通过。

## Next Step

- 确认 Brief 后启动任务，读取 `trellis-before-dev` 指向的规范并实施 Push 识别规则。
