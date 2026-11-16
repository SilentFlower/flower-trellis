# 实施与验证计划

## 已完成调查

- [x] 读取升级快照、扩展、沙箱和恢复实现及现有回归。
- [x] 隔离复现默认快照误扫运行时研究软链。
- [x] 核对同版本预演与真实快照的路径差异。
- [x] 明确默认排除与 Plugin 精确写入目标之间的边界。

## 实施顺序

1. 补运行时研究资料、链接及真实更新/回滚的失败回归。
2. 调整共用扫描层，将运行时及既有排除范围的判定前置；维护显式目标边界、既有父目录和祖先路径校验。
3. 补 near-name、forcedScopes、新建子树、外部目标及现有受管软链回归。
4. 执行定向、真实隔离更新及完整回归；进入 Check-All 并记录规范。
5. 精确提交代码和任务记录，等待对应提交的原生 CI。
6. 续接用户要求的新版 beta 发布 SOP，先展示真实 dry-run 版本与 CHANGELOG，再执行已确认的发布链。

## 验证命令

```bash
node --test test/js/update-backups.test.js
node --check src/lib/update-transaction.js
npm test
git diff --check
```

实际隔离 dogfood 使用源码 CLI 的 init/update/uninstall 与临时目标，关闭测试遥测并复用已安装的同版全局 Trellis。涉及回滚的验证必须实际运行恢复路径，断言运行时文件、链接和父目录状态。共享运行时变更由 Ubuntu/Windows 原生矩阵承接，发布标签仍执行发布 SOP 的完整验证。

## 交付边界

业务项目保持只读研究范围。源码作者源位于 Flower 仓库，本轮不改上游 node_modules。当前无关 dirty 文件沿任务 intent 基线保留。发版版号在发布阶段按 registry 与远端标签确定，预计为 beta.16。
