# 升级备份精简与 Sol 专属提示实施计划

## 实施顺序

- [x] I1 核对现有常量、CLI 解析、备份计划、Astra SessionStart 注入及测试中的字段、签名和边界。
- [x] I2 将升级备份默认数量改为 1，同步默认值测试、README 和备份保留规范；保留显式覆盖与受保护备份例外。
- [x] I3 在 Flower SessionStart 源资产中复用 Astra 正文生成 Sol 最终块，加入精确模型选择、独立开关和对应失败诊断。
- [x] I4 扩展 Python SessionStart 回归与 JS 上下文预算 fixture；核对两个模型的唯一注入、开关、异常和最大实际输出。
- [x] I5 在隔离项目验证正常安装、重复更新与 dry-run 备份计划；检查源资产、部署结果和无关快照一致性。
- [x] I6 运行定向测试、完整 `npm test`、Python/Node 语法检查和 `git diff --check`；进入 Check-All 并记录实际证据与限制。

## 验证命令

```bash
node --test test/js/update-backups.test.js test/js/ai-context-budget.test.js
python3 -m unittest discover -s test/python -p 'test_flower_session_start.py'
node scripts/check-ai-context-budget.mjs
npm test
node --check src/constants.js
node --check scripts/check-ai-context-budget.mjs
python3 -m py_compile src/assets/flower_session_start.py
git diff --check
```

隔离 dogfood 必须覆盖默认保留 1 份的 dry-run 输出且不删除真实项目备份。若涉及正常安装回写，只使用临时项目；不以临时项目结果冒充真实宿主行为或跨平台 CI 结果。`npm test` 已包含默认上下文预算与快照一致性检查。本任务不修改 Skill-Garden canonical 源，因此不重建其快照。

## 检查与回滚点

- I2 后若默认计划删除本轮保护项，先修正备份契约再继续。
- I4 后若其他模型收到提示、原生 state 丢失或单一模型重复注入，修正选择与分段逻辑后重跑专项测试。
- I6 后按 Trellis 检查结果修复并复验；真实模型行为、未执行的 CI 平台与预算 warning 分别如实报告，不借助阈值提高掩盖增长。
