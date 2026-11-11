# 原生 Windows 后台确认设计

## 共同边界

Windows 与 Linux/WSL 共用材料策略、日志指纹、倒计时、单次领取和 started 复核。平台分支只处理原生 Hook、控制服务连接、前台生命周期以及启动后台命令的参数。按能力开放；无法验证原会话归属或关闭时必须给出人工回退原因。保留普通原生启动方式。

## Claude

接入 Windows 原生 Hook，验证实际命令 shell、带空格和中文的路径、Python 启动器参数及 Stop 传入的精确后台任务 ID。沿用 runId、transcript 原生通知和输入代次；关闭窗口要通过实际 SessionEnd 或可核验的原前台进程退出证据作废请求。原会话重开和双开必须与已有请求隔离。

## Codex

Windows Python 3.12 的 socket 模块未提供 `AF_UNIX`。本机 Codex 的 `app-server proxy --sock` 已在隔离、仅当前用户可访问的目录中连接原生控制 socket，并通过现有 WebSocket 握手。优先复用该本地代理和现有协议封装；先验证普通启动窗口的真实共享服务、精确线程和队列能力。代理只连接已存在的精确本地端点，退出时只回收本次代理。

用 Windows 的监听端口归属与进程创建时间、退出句柄核对原前台。候选 API 为 GetExtendedTcpTable、GetProcessTimes 和 Windows 进程等待句柄。保持现有同会话双开拒绝语义；进程名、最新日志或另一个窗口的监听不能单独用于授权。探针未覆盖真实窗口归属及同会话双开，需在实施中单独验证。

## 分发和回退

以当前未提交的容量工作为明确基线。实施前记录其精确状态和哈希，保存原工作树，隔离会覆盖同一文件的 Windows 新增差异；后续分别审核两项的交付范围。按 Flower 资产及 Skill-Garden 作者源路径同步，沿用升级作废旧请求机制。Windows 适配失败时保持人工确认。
