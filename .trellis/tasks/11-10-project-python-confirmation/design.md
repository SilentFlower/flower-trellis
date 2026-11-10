# 项目内 Python 确认运行时设计

## Architecture

采用替换迁移，Python 为唯一确认运行时。项目入口拟为 `.trellis/scripts/flower_confirmation.py`，使用 `prepare|wait|claim|result|status|cancel` 子命令，参数和 JSON 结果沿用现有正式契约。脚本内部通过 `sys.executable` 调用 Python，UTF-8 协议采用 `-X utf8` 与显式编解码。

职责划分：

| 作者源 | 项目部署位置 | 职责 |
| --- | --- | --- |
| `src/assets/flower_confirmation.py`（新增） | `.trellis/scripts/flower_confirmation.py` | 参数、帮助、平台/会话识别、结果输出和信号清理 |
| `src/assets/flower_confirmation_runtime/`（新增） | `.trellis/scripts/flower_confirmation_runtime/` | 状态存储、协议编排、两端客户端和 Codex 传输 |
| `src/assets/flower_confirmation_hook.py` | `.trellis/scripts/flower_confirmation_hook.py` | 原生事件转交项目 Python 实现与入口查询 |
| `src/assets/flower_tui_lifetime.py` | `.trellis/scripts/flower_tui_lifetime.py`（新增部署） | 复用前台身份、覆盖核验和 pidfd 观察 |
| `vendor/skill-garden/.trellis/0.6/scripts/confirmation_policy.py` | `.trellis/scripts/confirmation_policy.py` | 复用策略、任务材料和 Git 冻结快照 |

运行时包按状态存储、正式编排、Codex、Claude 和本机传输划分模块。安装时整体投影并记录 ownership。直接运行入口只依赖 Python 标准库及项目现有 `common`、策略模块。帮助与空状态查询保留零写入语义，并在宿主连接前处理。

删除 `src/commands/confirm.js`、`src/lib/confirmation-runtime.js`、`codex-confirmation.js`、`confirmation-protocol.js`、`codex-queue-client.js`、`codex-confirmation-client.js`、`claude-confirmation-client.js`、`codex-tui-lifetime.js`，清理 `src/cli.js` 分发、帮助和确认专属信号分支。`confirmation-uninstall.js` 继续负责安装器的 Hook 清理规划。

## State And Protocol

1. 复用 `.trellis/.runtime/confirmation-<platform>/<sessionId>.json` 的 version 2 状态及正式 contract.version=2。Python 对 JSON 的结构、整数、UUID、大小、普通文件和路径链进行同等校验。
2. 原子写入使用同目录独占临时文件、fsync 和 replace。目录锁沿用 `.json.lock/owner.json` 的 pid/token 契约，并保持有限等待、陈旧锁复核和 Windows 短暂权限异常规则。
3. prepare 在活动回合冻结策略、材料、消息基线和原生窗口/runId；wait 先确认最终正文完整展示，再用单调时钟计时。派发、claim 和 started 都复核材料及人工输入代次。
4. 状态流仍为 prepared → waiting → dispatching → queued → consumed。保留 cancelled、failed、delivery_unknown 及回执执行状态；到期只唤醒所属工作流。
5. SIGINT/SIGTERM 使请求失效并清理自有连接和观察器；退出码维持 130。结果未知沿用单次投递约束。
6. 取消和查询遵守 create=false；运行目录缺失时沿用空状态。模块导入产生的 Python 缓存沿用受管目录既有忽略与卸载规则。

## Native Clients

### Codex

通过已有 `$CODEX_HOME/app-server-control/app-server-control.sock` 连接原生服务。使用标准库实现仅供该本机 Unix socket 的有界 WebSocket/JSON-RPC 传输；覆盖握手核验、客户端帧掩码、分片与控制帧、UTF-8、超时、断连和最大消息预算。该传输随项目部署。

沿用 initialize、thread/read、thread/loaded/list、mcpServerStatus/list、thread/queue/add/delete 的现有准确载荷。只读观察和后台轮询维持现有语义。rollout 保留精确路径、session_meta、文件身份、完整行、128 MiB 文件与 2 MiB 记录预算以及增量读取。

直接复用 Python 前台 helper 的出生身份、真实监听者、覆盖核验与 pidfd。观察句柄属于本请求 worker。原窗口退出后旧请求失效；新窗口需要新请求。原生队列 client_id 和完整唤醒正文共同识别内部消息。

### Claude

迁移 SessionStart/UserPromptSubmit/Stop/SessionEnd 状态更新和 transcript 核验。Stop 解析项目 Python wait 命令并绑定精确后台 task ID；通过 argv token 识别入口和 request，覆盖路径、引号和中文空格。

wait 先落盘 queued 再结束后台命令，原生任务通知唤醒模型。claim 继续核对 task-notification 来源、task ID、prompt ID 和 runId。人工粘贴文本由 human 来源识别。

## Project Lifecycle And Ownership

- Flower Python 运行时及 helper 归 `src/assets/` 管理，进入 `src/lib/flower-assets.js` 和 `src/builtin-plugins/skill-garden/content-adapter.js` 的同一事务及路径记录。运行时目录使用现有树投影能力。
- Skill-Garden 的协议和 owner 文案从 `vendor/skill-garden/.trellis/0.6/` 作者源修改，经 compiled targets、`npm run sync`、Plugin 生命周期投影同步。
- `flower_confirmation_hook.py --entry` 返回当前 `sys.executable` 和项目脚本的精确 argv。Hook 直接转交项目内实现。协议示例统一为 `python3 -X utf8 .trellis/scripts/flower_confirmation.py <子命令>`，实际目标解释器遵守安装器命令物化规则。
- `src/lib/trellis-control.js` 的项目关闭逻辑通过随 Flower 发布的 Python 实现取消现有项目许可。该内部集成使用独立的项目取消调用，保持公开六个子命令的范围。
- 与确认相关的 Trellis 关闭、漂移和 repair-required 只读判定迁移至 Python；使用同一控制状态夹具核对现有拒绝结果。
- 更新前取消旧活动请求，再部署新运行时；已 started 的回执保留真实执行状态并支持后续终态记账。旧 worker 随取消自行退出。旧队列通知只作为过期请求处理。
- 卸载按 ownership 清理项目脚本和自有 Hook；保留用户配置、Hook 与执行证据的现有边界。

## Tradeoffs And Rollback

- 用户选择删除旧入口。本轮同时迁移所有现行调用、帮助和验证，采用一次性切换。
- 标准库本机 WebSocket 增加协议实现代码，换取项目运行时的独立部署。通过传输协议测试和真实原生唤醒分别验证。
- 安装器继续使用现有 Node/Plugin 体系。确认阶段独立依赖 Python。
- 升级中的旧等待直接失效。回滚使用既有安装事务/更新快照恢复整组资产和 Hook；旧计时器保持失效。

## Validation Boundaries

Python 测试覆盖迁移后的状态机、两端客户端、传输和 Hook；Node 测试覆盖安装生命周期、CLI 清理及跨语言调用。采用原测试的行为场景映射，移除旧模块测试时将对应断言迁移至新入口。

隔离项目使用仅含所需 Python/Git 的 PATH，实际启动完整命令与 Hook，通过受控宿主覆盖完整链路。原生实测分别记录无模型窗口生命周期、Codex 队列唤醒和 Claude 后台通知。CI 使用现有 Ubuntu/Windows × Python 3.8/3.12 矩阵验证可加载、平台拒绝和通用行为；自动路径按既有能力条件验收。

## Windows CI 补修

原生 Windows 争锁回归发现读取 owner.json 与删除锁的共享占用竞争。对原子 replace 和锁清理的权限异常使用有界文件操作重试；状态转换回调仅执行一次，持续拒绝保留原错误。卸载竞争测试以 queued 进度事件同步，避免反复读取状态文件干扰 Windows 原子替换，并保证失败路径回收线程。
