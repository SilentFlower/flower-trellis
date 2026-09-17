# 实施计划

## 1. 准备

- [x] 核对旧任务推送/CI，建立独立 planning task。
- [x] 记录已复现与扩大扫描证据，核对 E:\tt。
- [x] Brief 已获“开始任务”确认并启动，沿用个人配置 inline 实现。
- [x] 读取父子仓规范及 Patch/物化/telemetry/worktree 合同，固定用户 dirty 基线。

## 2. 修复

- [x] auto-loop/route 使用当前解释器，替换 3.8 不支持的路径 API；补无 python3、containment 正反例。
- [x] decision-log/pre-check/auto-loop 前缀兼容，验证连续编号和损坏会话诊断。
- [x] telemetry CMD 特殊路径，扩展原生 Windows argv 替身，保持禁用/静默契约。
- [x] common/平台 Hook 标准流 Patch 与真实流/StringIO 回归。
- [x] 9 个测试文件解释器与 3 个文件的括号式 with 兼容；修复精确测试路径导入和临时 common 缓存污染。
- [x] npm/Node Python 启动边界，保留 canonical 文本物化测试含义。
- [x] 扩查编码、路径、临时文件/替换/软链/UNC；额外修复子仓 MSYS 路径、compiled targets 平台差异，更新审计清单。

## 3. 分发与验证

- [x] 同步两平台源、Patch、compiled targets、enhancements、dogfood，Linux Plugin 重复更新内容零变化，Windows 物化安装幂等通过。
- [x] Windows 原生 3.8/Linux 3.12 跑专项；非 UTF-8 编码使用受控条件并准确标注。
- [x] CI 两系统 × 3.8/3.12 已配置，准备依赖与 submodule，不用真实用户认证；首轮暴露的依赖安装与 Windows 夹具问题已追加修复并推送，复验结果见审计记录。
- [x] 完整 npm test、相关 JS/Windows 专项、Patch/compiled/budget/语法检查、git diff --check；后续测试夹具修改用定向回归闭环，具体证据见审计记录。
- [x] 按 Phase 2.1 completion contract 进入 check-all-inline，Full Check-All 三维通过，CHK/FBK 为 0；任务验收和验证记录已同步。

## 4. 收口

- [x] Update-Spec 记录稳定合同，区分实机、CI、模拟证据和限制。
- [ ] 提交推送按精确父子仓计划确认，CI 成功后同步任务进度；发布/归档另行授权。

两仓业务提交及追加补丁已推送，追加补丁对应的 SessionStart 两系统 CI 通过。Python 四组合复验仅 Ubuntu 3.12 全绿：Ubuntu 3.8 初始化受上游最低版本限制，Windows 3.8 初始化后的 Patch 预检失败，Windows 3.12 两项 legacy 迁移仍失败。任务保持 in_progress，不能将已推送或局部模拟成功等同 CI 完成。

- [x] 首轮 CI 追加补丁完成本地定向验证和 Light Check-All，依赖构建与短名夹具合同已补入质量规范。
- [x] 追加补丁提交推送并重新核验四组合 CI，记录实际失败位置；Windows 隔离目录的五项迁移/回滚模拟全部通过且无跳过。
- [ ] 处理初始化版本边界、Windows Patch 预检及 Windows 3.12 原生软链迁移失败，四组合 CI 全部通过后同步任务完成态。

主要命令使用现有入口：npm run patch:targets、npm run sync、npm run patch:targets:check、npm test、node scripts/check-ai-context-budget.mjs --strict、git diff --check。生成顺序以脚本实际依赖核对结果为准，不绕过 source/ownership 门禁。
