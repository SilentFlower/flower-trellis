# 实施计划

## 步骤

1. 进入实现路由，读取 trellis-before-dev，补读相关函数和测试完整定义。
2. 修改作者源的 GPT 匹配、通用提示生成及总开关，保留三个型号的兼容路径。
3. 扩展 SessionStart Python 回归、JS 预算夹具及断言，更新 README。
4. 按既有资产投影链同步本项目部署副本，检查安装路径一致性。
5. 执行专项和 strict 预算，通过 Check-All 后评估 Spec，进入精确 Git 计划。
6. 推送后核对对应提交必需 CI，包括 Ubuntu/Windows Python 3.8/3.12；成功后完成任务。

## 验证命令

- `node scripts/run-python-tests.mjs test/python/test_flower_session_start.py`
- `node --test test/js/ai-context-budget.test.js`
- `node scripts/check-ai-context-budget.mjs --strict`
- `node scripts/ci-impact.mjs --rules`
- 按影响补充资产投影/安装专项；共享运行时契约影响扩大时运行 `npm test`。

## 评审与回退

首次实施遵守 Brief 评审门禁。已有独立任务的改动保持各自归属。旧开关失效、重复提示、预算测量漏项是主要验证风险。回退恢复本任务精确文件集合，或关闭 GPT 总开关。
