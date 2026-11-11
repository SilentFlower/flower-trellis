# 后台确认容量实施计划

1. 记录真实 `vibecoding-bench` 只读 Git 快照和合成多仓、超限普通文件、超长会话的时间与尺寸基线。
2. 修改 Skill-Garden 策略的流式 Git / 文件指纹及诊断；保留原快照覆盖和 Git 超时终止，补齐 Windows 与 Linux 的子进程回收用例。
3. 修改 Flower 两端日志读取和缓存；覆盖替换、截断、未完成行、超大无关记录、旧通知与新人工消息。
4. 按测量修订材料、策略、状态预算与展示/领取期限；分别记录当前值、保留理由和过期错误。保持现有默认动作和用户倒计时。
5. 更新确认运行时规范；同步作者源、`npm run sync` 和本项目投影，核对精确生成范围。
6. 运行 `node scripts/run-python-tests.mjs test/python/test_confirmation_policy.py test/python/test_confirmation_native.py test/python/test_project_confirmation.py test/python/test_confirmation_store.py`，再运行 `npm test`。实际复测大仓 Git 快照；保留匹配提交的跨平台 CI、原生 Linux/WSL 确认结果和回退证据。

回滚点：按策略、日志、预算分组审查；安装层按整组确认资产回退并维持旧请求失效。
