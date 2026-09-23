# Implement

- [x] 新增真实 CLI 回归并确认复现旧失败。
- [x] 修复新接管任务基线与证据完整的旧运行恢复。
- [x] 覆盖日志/身份/基线冲突、未授权与 protected 漂移、终态不自动复活。
- [x] 运行 Python 专项、npm test、语法与 diff 检查，同步快照。
- [x] Check-All 审查并记录 spec 契约；远程兼容矩阵尚未运行则保留该限制。
- [x] Plugin dry-run 后应用、验证第二次零修改；显式恢复 auto-20260920002543。
- [x] 返回 Workflow V3 内核原 action 继续完成。

## 验证证据

- 先红后绿：原实现的在途接管测试因 planning_sha256 为空失败，修复后通过。
- npm test：JS 604 通过、2 平台限定跳过；Python 403 通过、2 平台限定跳过，含 auto-loop 79 例。日志 /tmp/auto-loop-baseline-full.log。
- Patch 冲突、compiled targets、strict context budget、Python 3.8 AST 语法与 git diff --check 通过。原生 Windows/Python 3.8 CI 未执行，不宣称跨平台最终验收。
- Plugin dry-run 仅 auto_loop.py 改变；实际应用后再次应用零修改；作者源/快照/安装字节一致。日志 /tmp/v3-runner-plugin-{plan,apply,repeat}.json。
- 原 run auto-20260920002543 已经显式 retry-blocked + next 返回原 run_implement，DEC-0003 pending 未消费，无真实 runtime 手写。
- full Check-All：本地三个维度通过，无 CHK/FBK；源码与测试暂未提交，原内核仍在实现中。
