# Python 跨平台兼容设计

## 1. 基线与边界

保留 Windows Python 3.8.10，并验证 Linux/Python 3.12。修复运行和验证链兼容，保持业务状态与授权语义；跨 Flower 与 Skill-Garden 的同一问题集合归一个新任务。

## 2. 解释器与版本 API

- Python 内部调用使用 sys.executable，必要时加 -X utf8，不读取模板物化后的命令字符串。
- Node/npm 入口优先复用 src/lib/trellis-python-command.js 的解析与 trellisPythonInvocation()；区分目标命令证据与开发环境有效解释器，支持显式测试解释器覆盖。现有 helper 不足时才加窄探测 helper。
- is_relative_to 用 relative_to + ValueError 等价判定，保留 resolve、containment 和软链拒绝；removeprefix 用 startswith 后切片，禁止 lstrip 近似。
- 3.8 测试语法改为等价嵌套或续行 context manager，保留 mock 生命周期。

## 3. Windows 命令与流

- telemetry CMD/BAT 复用已验证的 update_hook 方案：绝对 COMSPEC/SystemRoot、/d /v:off /s /c、带引号的环境占位符传递入口和 target；其它入口沿用 argv。用本地替身证明特殊字符无展开。
- 标准流优先 reconfigure；内存流原样保留，不对 StringIO 调用 detach，不关闭或破坏调用者底层流。原生 Hook 同类 fallback 用 Patch 安装。
- Python/JSON 已明确 UTF-8 的边界显式编解码；保持 stdout 协议与 stderr 诊断的原失败语义，不用 errors=ignore 掩盖损坏。

## 4. 作者源与分发

- Flower assets/tests/Node 启动入口在父仓修改。
- Skill-Garden scripts 与两平台 route helper 在子仓源修改；common/原生 Hook 修改通过声明式 Patch，selector/baseline 保留原文、载荷继承目标语言。
- 核对真实依赖顺序后重建 compiled targets、同步 enhancements、通过 Plugin 验证 dogfood 与隔离 Windows 目标；不伪造发布版本或子仓提交状态。

## 5. 验证和回退

- 第二轮 CI 修复：两仓以 `text=auto eol=lf` 固定文本检出，保持 Patch 精确匹配与二进制原字节；用真实 `autocrlf=true` 临时 Git 检出验证，不靠放宽 selector 匹配。
- 兼容矩阵仅在 CI 环境显式设置 `TRELLIS_PYTHON_CMD` 为 setup-python 对应的平台命令，上游 init 采用其支持的 override 生成模板；运行期继续固定矩阵解释器，不改变用户环境的上游最低版本策略。
- legacy 链接目标按真实文件身份比较，避免 Windows 3.12 保留扩展路径前缀造成误判；`readlink` 或目标 stat 失败时拒绝。补相对链接、扩展前缀、错误目标、缺失及权限失败回归。

- 已复现条件补最小回归，保留 SessionStart 内容/禁用/诊断/Astra/并行/预算。
- CI Ubuntu/Windows × Python 3.8/3.12 跑受影响套件，准备 Node/submodule；不依赖登录态或真实遥测。
- Linux 完整 npm test；Windows 原生跑受影响 Python/Node 并扩大覆盖；能力限制精确登记，不宽泛 skip。
- 回退只恢复本任务源与生成物，经同一安装链恢复，不改变用户 Python 与全局 npm 安装。
