# 实现计划

## Prerequisites

- [x] 隔离复现缺失记录但 up_to_date，确认 worktree 没有 Flower 继承步骤。
- [x] 根据用户纠正将 skill + create/prepare 继承作为主线，诊断作为兜底。
- [x] 读取 canonical 源、ProjectStore/schema、状态摘要验证和 dirty 基线。
- [x] 展示修订 Brief 并完成规划评审；用户已确认。
- [x] task.py start 后进入 trellis-route(target=implement)，命中个人 inline 配置。

## Ordered Work

1. [x] 增加真实 Git fixture 回归：.flower 被忽略，源安装有效，目标同内容，create/prepare 应补齐记录。
2. [x] 提取最小共享 Plugin 状态验证，新增安装信息服务，处理白名单、来源/目标兼容性、路径边界及无缓存离线验证。
3. [x] 实现文件组写入与失败清理，覆盖已有/部分缺失、版本冲突、摘要漂移、settings 开发者边界和独立文件。
4. [x] 接入 facade 和 canonical engine；增加 prepare 显式继承参数，create 默认继承并把载荷摘要纳入指纹，在 task 创建前完成目标校验与落盘。
5. [x] 补齐 status、预检和完成输出；真实随包 CLI 创建和补配场景已通过。
6. [x] 更新子仓两平台 worktree skill 的计划视图、已有 worktree 补配及不继承列表。
7. [x] 实现 self-check 未知兜底，更新普通 self-update 和人工更新 skill；hook 静默未知状态及真实更新提示测试已通过。
8. [x] 通过保护入口同步快照、核对源一致性，更新相关继承契约规范。
9. [x] 串行完成针对性和全量门禁；全量出现的两项旧测试失败均已定向关闭。check 路由为 check-all-inline，full 检查证据见 verification.md。
10. [x] 完成规范更新及精确文件评审；用户确认后，两仓业务提交与推送完成，任务记录进入同次确认的独立提交。未发布。

## Required Scenarios

| 场景 | 预期 |
| --- | --- |
| 根 ignore 排除 .flower、源目标同内容 | create 补齐独立有效记录，self-check 读出实际版本 |
| 手动 git worktree add，Trellis 已 ready-local | skill 调用 prepare 补配，重复执行无额外变化 |
| 目标已有不同 lock / 部分记录不兼容 | 保留原字节和权限，不拼接安装事实 |
| 源缺 state、损坏、未提交插件内容或目标漂移 | 不写半套记录及误导性 state，报告原因/路径 |
| 声明、lock 图、state 集合、平台/选择不一致 | 校验拒绝，不只比较版本 |
| 没有缓存及网络 | 合法继承可完成，不调用包下载 |
| 祖先软链、跨仓来源、本地 Plugin 来源不可用 | 写入前拒绝，不读取或覆盖边界外文件 |
| 设置继承、不同开发者、已有目标设置 | 合法策略按规则继承，不复制缓存或覆盖目标 |
| 源/目标禁用或恢复中 | 明确停止继承，保留控制及恢复状态 |
| 预检后源安装记录改变 | 指纹失效，不执行旧载荷 |
| 适配器异常、逐步写入或 task 创建失败 | prepare 清理本轮记录，create 保持原回滚保证 |
| 纯 Trellis、旧投影迁移、route 偏好 | 原能力和显式边界不回归 |
| 同版远端、目标版本仍未知 | project_unknown，退出 0，无写命令及阻塞提示 |
| 同版/异版、legacy、远端新版、离线、缓存 | 保持有效行为，本地证据每次计算 |

## Validation

重任务逐条经 /root/.local/bin/wsl-safe-run 串行执行，75 时等待，内存/超时失败先缩小范围。当前实现和 Phase 2.2 检查已完成；命令结果、定向重检及环境限制见 verification.md。

针对性 JS 使用 node --test --test-concurrency=1，覆盖 worktree-cli、新增 worktree-flower-state、update-check、flower-update-contract、cli-help 及受共享校验影响的 Plugin lifecycle/preserveIds 测试。

针对性 Python 使用 python3 -B -m unittest discover，覆盖 test_worktree_setup.py 和新增 test_flower_update_hook.py。安装/更新联调使用临时 Git 项目，FLOWER_NO_TELEMETRY=1，注入远端 metadata。

交付及全量门禁按 package.json 的 npm test 顺序逐项执行，每一项各自经过保护入口：

1. npm run sync。
2. node --test --test-concurrency=1 test/js/*.test.js。
3. python3 -B -m unittest discover -s test/python -p 'test_*.py'。
4. node scripts/check-patch-conflicts.mjs。
5. npm run patch:targets:check。
6. node scripts/check-ai-context-budget.mjs。
7. node scripts/check-output-templates.mjs。

已通过项只在新增修改、失败或未解决风险时重跑。JSONL 所列规范与研究在实现和检查前加载。

## Ownership And Recovery

- canonical 子仓和根仓均先核对当前状态，现有用户变更不撤销。
- 两个根 .flower 配置、GitLab 技能及 telemetry-roadmap 为保留集合，验证前后核对。
- 开发过程中不 reset 仓库；安装继承失败只清理本次操作拥有的写入。
- 后续提交需重新展示精确文件与多仓顺序，不能复用之前升级提交授权。
