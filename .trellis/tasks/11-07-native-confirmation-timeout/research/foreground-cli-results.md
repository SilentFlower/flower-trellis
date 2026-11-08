# 前台命令验证

用原版 Codex 0.167.0 TUI、同版本共享 Unix App Server、原版 Claude Code 2.1.293 和正式 `ftl confirm`。模型请求只发到回环 mock；验证使用临时项目、本地 bare Git 及专用套接字，不连接实际业务远端或现用 App Server。Codex 保持 `workspace-write` 和 `on-request`，正常客户端使用隔离 HOME 的原控制入口；Claude 用默认权限模式和正常安装写入的项目 Hook。

单窗口对照只启动一个原版 Codex 窗口，没有第二客户端或旁观订阅。用 SIGHUP 和 SIGKILL 分别关窗；两组中，普通 Shell 等待都在约 4 秒到期，模型收到测试回执，共享后台仍在线。这是未经见证的对照，没有执行业务动作；会话只有一个窗口也需要核验原连接。

| 场景 | 结果 |
| --- | --- |
| 两端正常等待 | 原生终端先显示完整正文。Brief 开工、Check-All 修复并重检、commit-only 均执行一次；隔离 Git 保留计划外 staged 文件。 |
| 两端默认 Push 200 秒 | 正文先显示，保持沉默到期，各领取一次；只提交计划文件，推送到本地 bare 仓。Codex 共享服务及另一个订阅者仍在线。 |
| 两端回复、Esc、临界 Esc、关窗、关窗后恢复 | 跨过原截止后无许可、无隔离业务动作，恢复不补跑。 |
| 共享 Codex 的唯一窗口在等待 Push 时关闭 | 无第二客户端；正式命令记录取消，跨过原截止后没有领取、提交或推送。原 App Server 仍在线。 |
| 两端材料/策略变化、正文裁剪、重复等待 | 变化取消原决定，裁剪不开始计时，已领取请求拒绝再次等待。 |
| Codex 领取刚返回，模型尚未发出动作时关窗 | 通过原上游连接收到原回合中断，模型随后的 Shell 调用没有执行；旁观订阅仍在线。 |
| Claude 显式禁止确认 Bash | 默认辅助命令的 Hook 不覆盖用户的 deny 规则。 |
| beta.2 安装后连续升级两次再卸载 | 项目时长和单类开关保留；每个确认 Hook 仅注册一次。卸载清理受管确认 Hook，保留用户的项目 Hook、个人设置和 MCP。 |

复现：`node test/helpers/confirmation-native-matrix.mjs <原版 Codex 二进制> <原版 Claude 二进制>`；`node test/helpers/confirmation-native-install.mjs`。GitHub Actions 使用锁定 npm 发行版本中的实际二进制，不从源码重编。普通安装只部署 Flower CLI 和项目 Hook，不切换用户的 Codex 共享连接。

补充连接层回归：`confirmation-runtime.test.js` 验证直接断开、仅退订及退订后立即断开。中断回执延迟时仍保持上游连接，内部回执不转发给客户端；仅退订保留客户端连接，旁观连接退订不影响原窗口。修复后另用原版 Codex 复验唯一窗口关窗、正常到期及领取后动作尚未开始时关窗，均通过。

修复后的本地 `npm test` 退出 0：JavaScript 708 项通过、2 项跳过，Python 共运行 556 项、2 项跳过，无失败。Patch 冲突、compiled targets、输出模板和严格上下文预算检查通过；`actionlint .github/workflows/ci.yml` 通过，最终提交的托管 CI 尚未运行。
