# 实施计划

1. 进入实现前加载 Flower CLI 规范、Patch/事务契约和确认分发边界。核对 `src/lib/platform-patch-adapters.js`、`src/lib/patch-engine.js`、`src/builtin-plugins/skill-garden/` 的目标合成与预览入口。
2. 从历史启动代码、Patch、分发脚本与备份形态建立脱敏正例和近似反例。验证从旧 MCP、旧 CLI Hook、共享服务 Hook 到当前 Python 的跨版本升级；先测现有事务的收敛行为，再补确认有缺口的迁移。实现项目根内、字段级、默认保留的匹配与改写。无匹配、歧义和文件越界均保持原样。
3. 接入受管项目升级计划和现有回滚。覆盖普通升级、可适用的预演/重放和重复升级；不登记整份用户配置的专属所有权。
4. 运行 `node --test test/js/confirmation-install.test.js test/js/flower-update-contract.test.js` 及新增的迁移专项。用隔离项目验证实际预演、升级、故障恢复和重复执行。
5. 运行 `npm test` 和相关 Patch 冲突检查。推送后按质量规范核对同一提交的 Ubuntu/Windows 安装回归。
