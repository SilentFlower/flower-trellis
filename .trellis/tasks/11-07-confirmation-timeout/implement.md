# 实施与验证计划

## 开工门禁

- [x] 复核最新 PRD、design 与研究结果；确认没有未决产品事项。
- [x] 由 trellis-task-brief 生成并完整展示 Brief，用户“确认开始”批准该完整 Brief。
- [x] 批准后执行 `task.py start`，通过 `trellis-route(target=implement)` 进入 inline 实现。

## 实施顺序

1. **策略与请求合同**：实现共享计时公式、严格配置解析、规范化材料摘要、授权来源、当前实例与请求版本；明确准备、展示、等待、领取和执行边界。
2. **通用控制器与 MCP**：实现单 wait 工具、IPC、单调计时、输入先撤销、重复请求幂等、timeout_ready 后再次领取；限制模型可用接口，保持正文与审计在工具定义之外。
3. **前台入口与 Harness 接入**：新增 `session` 命令及 help；`--` 后原样透传，不吞 Harness 的 `--target` 等参数。保留原有权限与工具，只预授权新增等待工具；配置单次注入，不修改用户全局文件。
4. **进程与终端生命周期**：实现正常退出、HUP / EOF、CLI 强杀和入口强杀；提供 Linux 与原生 Windows 生命周期约束。清理只作用于自有进程，恢复 raw mode / resize / ConPTY 状态。
5. **流程 owner 接入**：在 vendor 作者源接入 Brief、Check-All、Push；冻结正文并交由控制器完整展示，排空后再 arm。检查报告和 Git 计划仅按跨进程校验需要冻结到 gitignored runtime；领取后仍执行现有 owner 前置检查；普通交互、auto-loop、Spec 歧义继续由原 owner 管理。
6. **配置与安装**：增加项目 / 单类默认开关和时长配置；补齐 update 保留、两套脚本别名、选择性安装及生命周期删除。同步 SessionStart 的授权说明与必要 workflow / task-start Patch。
7. **同步与验收**：运行 source→snapshot→compiled targets→dogfood；执行下方测试，再进入 Check-All、Spec 与 Push owner，提交之前展示精确计划。

## 行为测试矩阵

| 范围 | 必须验证 |
| --- | --- |
| 时间 | Brief 1000 / 1001 / 1500 / 1501 字；检查 0 / 1 / 2 条及重复项；提交 200 秒；独立开关与参数互不覆盖 |
| 配置 | 缺失采用默认；显式 false、字符串整数、非法数值、损坏 YAML、读取失败；更新整文件覆盖后保留用户值 |
| 展示 | 准备不计时；完整材料与当前版本展示后才开始；缺段、旧摘要、错误默认动作或预算不足均回人工 |
| 授权 | 无授权、非当前 root 会话、跨 task / instance 请求拒绝；source 明确区分 human、policy_timeout、cancelled |
| 竞争 | 人工输入早于截止、临界时刻、工具返回后而领取前、重复领取、RPC 重试、材料 / Git 基线变化 |
| 生命周期 | 正常退出、输入 EOF / PTY HUP、CLI 强杀、入口强杀；无旧默认动作、无退出后模型续跑、无孤儿进程；手动重开不消费旧许可 |
| 动作 | Brief 进入已展示方案；检查修复全部当前项并重检，新增业务取舍暂停；Git commit+push / commit-only、范围漂移与失败恢复 |
| 平台 | Codex / Claude 普通 TUI 的人工、超时、退出场景；100 / 130 / 200 秒；Ubuntu 和原生 Windows；未通过的模式不默认开启 |
| 分发 | init、重复 update、选择性安装、uninstall；vendor / enhancements / compiled / dogfood 一致；关闭功能后原人工路径正常 |
| 上下文 | 单工具定义和结果的实际尺寸；等待不产生每秒模型请求；不得把 Code Mode 的既有包装全部算作新工具成本 |

## 验证命令与证据

- JavaScript 用 `node:test`，Python 用 `unittest`；添加有行为意义的专项用例，不复制实现做自证测试。
- 运行新增 / 受影响的 Node、Python 专项与语法检查，再运行完整 `npm test`。共享运行时与未知影响不只运行规则文案专项。
- 按作者源修改执行 `npm run sync`、必要的 `npm run patch:targets` 与 `npm run patch:targets:check`；核对 Patch 冲突、上下文预算、输出模板及 source 快照一致性。
- 在 `.trellis-tmp/` 隔离目标运行 init、重复 update、选择性安装和 uninstall；不得使用真实项目或用户全局配置作破坏性夹具。
- `.github/workflows/ci.yml` 和 `scripts/ci-impact.mjs` 纳入新运行时、入口、Python 与原生退出场景。原生 Ubuntu / Windows job 实际执行并通过后才报告平台验收成功；不能靠 skip 或 continue-on-error 代替。
- 保存相应 commit 的 CI 链接、headSha、平台矩阵和有效 probe 时序。当前 research 的回环 mock 仅证明宿主能力，不代替产品真实流程或 Windows 验收。

## 风险与回滚点

- 先交付严格的准备 / 展示 / 领取与生命周期合同，再启用 owner 路径；未验证状态始终回人工。
- 每一步保留配置关闭开关；回退时撤销当前实例许可，移除本次会话注册，不恢复旧待决。
- 真实 Git 动作只在 Push owner 的精确计划确认后测试 / 执行；前期用无副作用回执验证继续链路。
- 发布前不能用当前尚未交付的超时功能批准本任务的 Brief、检查处置或提交计划。

## Check-All 修复续行

- 用户已选择全部修复：CHK-001、FBK-001、FBK-002；复用当前任务的 inline implement / check 路径。
- 为两套脚本分发增加 `python` / `py -3` 命令物化与重复更新回归。
- 注入各状态审计失败，验证不产生许可、取消照常返回、输入仍透传、关闭端口和重复关闭完整完成。
- 为实际异步检查增加正常退出、超时、关闭入口与强杀控制器的进程树回归，覆盖原生 Ubuntu / Windows CI。
- 定向验证后运行完整回归和 Check-All 重检；通过后继续 Spec 和精确 Push 计划，原生 Windows 与匹配 SHA 的 CI 仍待提交推送后验收。
- 首次提交CI续行：修复原生探针对本机MCP名称的依赖，按原生只读目录停用实际存在的服务器；Windows夹具复用生产CLI的显式退出收尾，避免ConPTY残留句柄拖住测试，进程停止后的目录句柄释放使用有界清理重试；为原生探针补充失败终端摘要，并保留人工输入追加回合时的最终结果标记。
- 第二轮CI续行：原生Ubuntu/Windows共20个场景通过，Windows Node验证只剩两个夹具等待输入超时；将测试管道中的LF换为真实Enter的CR编码，保留输入透传和实际退出结果断言，并在已确认文件范围内继续验证。
- 第三轮CI续行：人工输入用例通过，Windows出现目录清理钩子的EBUSY；Node 22的同步rimraf初始目录EBUSY不进入重试，改用异步 `fs.promises.rm` 的外层有界重试，继续保留全部进程存活与许可断言。
- 最终匹配提交CI：10/10个必需job和24个目标步骤成功；Ubuntu/Windows的20个真实CLI场景通过，两组Windows Node入口各99项通过；失败历史与最终证据已保存在原研究文件，12项AC完成验收。
