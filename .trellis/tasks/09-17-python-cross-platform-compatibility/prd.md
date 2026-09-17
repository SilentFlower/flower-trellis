# 修复 Python 跨平台兼容并扩展回归门禁

## Goal

修复 Flower/Trellis Python 运行链在 Windows 与 Linux 上的已知兼容问题，并扩大审计与持续回归，避免 SessionStart 专项通过但其它工作流脚本仍不可用。

## Background

- 用户要求修复上一轮列出的兼容问题，并扩大搜索其它跨平台问题。
- 旧任务 `09-16-cross-platform-sessionstart-hooks` 已推送；CI 35121142010 的 Ubuntu/Windows job 均通过。本任务独立承接扩大后的范围。
- 实际 Windows Python 为 3.8.10；python.exe 可用，python3.exe 指向 WindowsApps 占位入口并返回 9009。
- 已复现问题及源码定位见 `research/compatibility-audit.md`；部署目录 E:\tt 也保留相关调用。
- 用户原有未跟踪 `.trellis/tasks/09-05-telemetry-roadmap/` 不归本任务所有。

## Requirements

- R1：兼容当前 Windows Python 3.8.10 与 Linux Python 3.12，修复 auto-loop、route、decision-log、pre-check 已知失败，不以强制升级 Python 代替修复。
- R2：Python 内部子进程使用当前解释器；开发/测试 Node、npm 入口正确选择有效 Python 并保留 argv 边界，不依赖 WindowsApps 占位别名。
- R3：遥测 Hook 的 Windows CMD/BAT 调用原样传递中文、空格、百分号、感叹号和 shell 特殊字符路径；保留静默失败、禁用和不传递会话内容的合同。验证只用本地替身，不向真实采集端发送数据。
- R4：共享标准流初始化兼容真实标准流与 StringIO 等捕获流，不关闭或破坏调用方持有的流；Codex/Claude Hook 同类路径一起检查。
- R5：扩大扫描生产 Python、Skill-Garden 作者脚本、Hook、测试与直接启动 Python 的 Node/npm 入口，覆盖版本 API/语法、解释器、编码、路径及临时文件/替换/软链边界；同类且有证据的问题一起修复，未证实风险明确登记。
- R6：保持既有状态/schema、路由、日志编号、失败关闭、路径 containment、软链和会话绑定合同，兼容替换不得弱化安全边界。
- R7：通过作者源、Patch、快照与 Plugin 链分发，保持 canonical、快照、compiled targets、dogfood 一致，不只修部署文件。
- R8：扩展 Ubuntu/Windows 与 Python 3.8/3.12 持续回归；夹具自包含，区分原生 Windows 实测、模拟条件和真实宿主加载。

## Acceptance Criteria

- [x] AC1（R1/R2）：无有效 python3 别名时 auto-loop/route 可调用正确解释器；3.8 下路由探测、日志连续追加、损坏会话诊断不再抛 AttributeError。
- [x] AC2（R3）：原生 Windows CMD 替身接收完整 argv 与输入一致，特殊路径无展开/拆分，禁用零调用且无真实遥测发送。
- [x] AC3（R4）：真实流与内存流正反例通过，无 detach 异常、流关闭或正文丢失；现有 SessionStart 14 项保持通过。
- [x] AC4（R5/R6）：审计清单列明范围、证据、复现/修复/待验证状态；版本、编码、路径回归保持失败语义和安全限制。
- [x] AC5（R2/R7）：Windows 开发验证入口能启动有效 Python；快照、Patch/compiled targets、受管安装及幂等检查通过。
- [x] AC6（R8）：Linux/Windows 受影响专项通过，配置两系统 × 3.8/3.12 CI；完整 npm test 和必要静态检查通过，未覆盖项明确说明。

## Out of Scope

- 不修改 Codex/Claude 上游客户端，不升级用户 Python 或系统设置。
- 不改变遥测采集范围、路由授权语义、工作流门禁或持久化协议。
- 不修无关产品功能，不承诺未实测的 macOS、Python 3.7 或更早版本。
- 本轮规划与实现不含 npm 发布、版本标签、外部消息或未经确认的 Git 推送。
