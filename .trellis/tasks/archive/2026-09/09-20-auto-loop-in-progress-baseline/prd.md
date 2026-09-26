# 修复 auto-loop 接管在途任务的基线与旧运行恢复

## Goal

修复已进入 in_progress 的任务在 auto-loop 中合法修改规划文档后被误阻断的问题，恢复 Workflow V3 内核原运行。

## Background

现场 auto-20260920002543 的 DEC-0003、pending、原 action 的逐文件基线和 action 身份一致；queue item 的 planning_sha256/handoff_sha256 却为空。作者源 auto_loop.py 的 _next_prepare 对 in_progress 提前 continue，未初始化两项摘要；_pending_event 因此拒绝合法决策。用户已确认“先补齐基线初始化、验证旧运行恢复路径并添加回归测试，再继续内核”。

## Requirements

- R1：新接管的 in_progress 任务在首个 action 前冻结规划与交接摘要；已有冻结值不得重新采样覆盖。
- R2：旧运行仅在两项摘要均缺失、原 action 与 pending 逐文件基线/身份及同 run 的决策日志一致时恢复遗漏字段；保留原 action、pending、预算和审计记录。
- R3：已终止的运行必须显式 retry-blocked；缺证据、部分摘要、日志冲突、未知/受保护漂移均不放行。只有真实 action record 才消费 pending。
- R4：修复作者源、同步分发快照，经 Plugin 生命周期应用到当前项目，然后恢复原内核运行。

## Acceptance

- AC1：真实 CLI 覆盖在途任务 start → decide → 文档编辑 → 多次 next/status/resume → record，原 action 稳定、record 前不消费决策，record 后仅一次重绑。
- AC2：旧缺失基线的运行可凭原证据恢复；终态查询不复活，显式 retry 保留 action；所有不可信反例继续拒绝。
- AC3：受影响 Python 套件、本地全量门禁通过；作者源/快照/目标安装一致，第二次 Plugin 应用无目标修改。
- AC4：现有内核改动及其它任务文件不被覆盖。原 run 恢复到真实未完成 action，不伪造实现或检查完成。

## Non-Goals

不改变任务业务范围、权限、Git 安全边界；不手写真实 runtime，不新建 run 绕过失败，不 push、发布或归档。Windows/Python 3.8 CI 保留现有矩阵，未运行前不宣称跨平台验收完成。
