# Brief — 修复 Python 跨平台兼容并扩展回归门禁

## Goal

- 修复已复现兼容问题，并扩大扫描与回归，让相关 Python 运行链在 Windows/Linux 上正常工作。

## Scope

- 修复 auto-loop、route、decision-log、pre-check 的解释器选择与 Python 3.8 API 兼容。
- 修复遥测 Hook 的 Windows 特殊路径传递及共享标准流/StringIO 的 detach 隐患。
- 修复测试中的解释器与语法问题，检查 npm/Node 启动 Python 的入口。
- 扩查编码、路径、临时文件、替换、软链及 UNC，修复有证据的同类问题并记录未证实风险。
- 同步作者源、Patch、快照、compiled targets、受管投影，扩展跨平台 CI。

## Non-Goals

- 不升级用户 Python，不修改上游客户端、采集范围、授权规则或持久化协议；不自动发布、打标签或推送。

## Key Decisions

- 保留当前 Windows Python 3.8.10，验证 3.8/3.12；内部子进程使用当前解释器，兼容替换保持安全边界。
- Windows CMD 参数用受控传递方式；遥测测试仅使用本地替身。

## Key Context

- Flower 资产和测试在父仓；Skill-Garden 脚本在 vendor 子仓，原生模板用 Patch 修改。
- 规划时扫描 77 个 Python 文件并记录 8 组故障；实施扩为 90 个文件及 23 组兼容/验证问题，包括 CI 揭示的依赖、夹具、初始化版本、CRLF 检出与 Windows 扩展路径前缀问题，证据见 research/compatibility-audit.md。
- 原 SessionStart 任务已完成；原有 telemetry-roadmap 未跟踪内容保留。

## Risks / Deferred

- 当前 Windows 默认编码是 UTF-8，非 UTF-8 场景需额外模拟；软链权限差异单独验证。未实测平台不作保证。

## Acceptance

- 已复现故障转为通过，特殊路径原样到达，状态/诊断/权限语义保持。
- Linux 与原生 Windows 专项、完整 npm test、安装幂等与生成一致性通过，CI 覆盖两系统 × Python 3.8/3.12。
- 审计清单逐项说明修复证据、模拟条件与未覆盖内容；Full Check-All 通过。

## Next Step

- 修复、Full Check-All、规范更新与两仓补丁推送已完成，Python 四组合及 SessionStart 两系统 CI 全绿；同步完成记录，发布或归档另行授权。
