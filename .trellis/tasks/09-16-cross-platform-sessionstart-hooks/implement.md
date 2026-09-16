# 实施计划

## 1. 开工与上下文

- [x] 完成三件套与 Brief 评审，经 `task.py start` 后由 `trellis-route(target=implement)` 选择执行模式。
- [x] 读取 curated JSONL、PRD、设计、实施计划及 SessionStart/Patch/上下文预算规范，核对当前 dirty 基线，
  不覆盖 `09-05-telemetry-roadmap` 等用户既有未跟踪内容。
- [x] 记录 Linux / Windows 客户端基线：Codex `0.154.0`、Claude Code `2.1.260`，并确认旧 Windows
  Codex 会话已重启后再做真实宿主证据。

## 2. 先锁定事故回归

- [x] 把 Python 测试入口从硬编码 `python3` 改为 `sys.executable`，所有子进程显式使用 UTF-8，确保
  Windows runner 不依赖命令别名或系统代码页。
- [x] 增加伪原生 Hook 重配真实标准流的回归：旧同进程捕获触发 `detach`，新边界返回合法 state JSON。
- [x] 增加原生 stderr 透传、非零退出码、空 stdout 跳过、非法 JSON 的正反例。
- [x] 把 state 单元夹具从 patch `_load_hook` 迁移到新的原生执行辅助函数，保持 Astra 和诊断断言完整。

## 3. 实现最小隔离边界

- [x] 在 `src/assets/flower_session_start.py` 引入 `subprocess`，删除 state 路径不再需要的
  `redirect_stdout` / `StringIO` 捕获。
- [x] 实现 `_run_native_hook()`：白名单路径、`sys.executable -X utf8`、`shell=False`、固定 cwd、
  环境继承、UTF-8 bytes 管道、stderr 透传、退出码与 JSON 校验、空输出语义。
- [x] 重排 `render_part()`：state 不在父进程导入原生模块；rules/stages 保持生成器、跳过条件和无副作用路径。
- [x] 保持 workflow 唯一块校验、`additional_context` 清理、原诊断、Astra 开关、分段标签和预算行为逐字兼容。

## 4. 分发与持续集成

- [x] 新增 SessionStart 专项 GitHub Actions，矩阵运行 `ubuntu-latest` / `windows-latest`，仅在相关文件
  与工作流变化时触发，执行同一 Python 专项测试。
- [x] 运行 Flower Plugin 隔离安装，验证作者源投影、Codex/Claude 三 handler 注册、额度保留、ownership
  与二次应用幂等；再用受管安装入口更新当前 dogfood 投影，不手改投影冒充源修复。
- [x] 核对 `.codex/hooks.json`、`.claude/settings.json` 仍只注册 `startup|clear|compact`，每个平台顺序为
  `state/rules/stages`，超时和 `additionalContextLimit` 合同不变。

## 5. 验证矩阵

| 验证组 | 必须证明 |
| --- | --- |
| 平台无关事故夹具 | 会执行 `detach()` 的原生入口在隔离边界成功，旧故障不能回归 |
| Linux 脚本 | Codex/Claude 六个 handler 均退出 0、JSON 合法、正文完整、无注入错误 |
| Windows 脚本 | 无 BOM 输入下重复 Linux 六项，原 state `detach` 用例转为成功 |
| 行为兼容 | resume、全局禁用、Codex 非交互、原生跳过、损坏输出、并行、Astra 与预算合同不变 |
| 安装链 | 作者源与投影一致，配置迁移和 ownership 正确，重复安装零变化 |
| 真实宿主 | 两系统分别新建 Codex/Claude 会话，区分脚本成功、宿主 Hook 执行和上下文加载证据 |
| 持续门禁 | GitHub Actions Ubuntu/Windows 两个矩阵 job 均通过 |

定向与完整命令：

```bash
python3 -m unittest discover -s test/python -p 'test_flower_session_start.py'
node --test test/js/platform-patches.test.js test/js/apply-enhancements.test.js test/js/ai-context-budget.test.js
node scripts/check-ai-context-budget.mjs
node scripts/check-ai-context-budget.mjs --strict
npm test
git diff --check
```

Windows 实机使用当前 Python 可执行文件执行同一 unittest，并逐个调用已部署的六个 handler；输入通过
UTF-8 无 BOM 管道发送。真实客户端命令在执行前以 `--help` 回读当前版本支持的非交互参数，避免猜测接口。

## 6. 收口与回退

- [x] 生成四象限验证记录，列出版本、命令、退出码、每段标签/错误状态、宿主证据和可见性限制。
- [x] 运行 Check-All，修复范围内问题后重跑受影响验证。
- [x] 进入 Update-Spec，记录 state 子进程隔离形成的新稳定契约。
- [ ] 未经单独授权不提交、不推送、不发布；需要回退时恢复作者源、测试与 CI，再通过 Plugin 链恢复投影。
