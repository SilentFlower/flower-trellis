# 实施与验证

1. 先以隔离原版 Codex 建立可重复案例，分别记录内置窗口、正常共享窗口、未知额外前台及同一共享会话双开。验证本机队列 RPC、写锁与控制连接对端的实时读接口，保留当前回合及切换时序。
2. 在 `src/assets/flower_tui_lifetime.py` 扩充 Linux/WSL 的只读身份取证与退出观测；在 `src/assets/flower_confirmation_runtime/` 接入内置前台绑定及额外窗口精确分类。复用现有 `_validate` 调用点及队列单次领取、撤回路径。保持存储与跨平台调用兼容。
3. 在现有 `test/python/test_flower_tui_lifetime.py`、`test_confirmation_native.py` 和 `test_project_confirmation.py` 补混用回归。覆盖丢失/漂移的证据、同会话双开、独立内置窗口与原进程关闭。原生探针用临时 `CODEX_HOME`、实际 CLI 和本机模型替身，验证 `0.170.0` 内置端加 `0.171.0` 共享端的完整行为。验证真实撤回及退出、输入、恢复、迟到和重复领取，无需向用户会话投递。
4. 按实际变化同步规范、协议及 dogfood。运行受影响确认与安装升级专项，再运行 `npm test`。需要同步 Skill-Garden 协议时依项目约定运行 `npm run sync`、编译产物及冲突门禁，并校验对应作者源与部署结果。
5. 进入 Check-All，核对授权、跨进程竞态、Linux/WSL 与原生 Windows 兼容。匹配变更提交的必需 CI 和混合版本原生证据齐备后才报告交付。实现阶段使用正式任务 Brief 的人工审批。
