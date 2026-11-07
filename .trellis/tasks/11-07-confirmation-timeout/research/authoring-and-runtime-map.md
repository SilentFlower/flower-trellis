# 作者源、配置与完成链接入位置

记录日期：2026-11-07。本文标注现有接口与候选改动位置，不表示已进入实施。

后续决定：用户已接受 Codex 与 Claude 都走统一前台入口及标准 MCP 等待工具。最新实验见 [mcp-wait-results.md](mcp-wait-results.md)，正式设计以任务 design.md 为准；下文最初候选与“仍需收敛”的描述保留其初次研究时间范围。

## 已确认的产品决定

- 首版目标为 Codex 与 Claude Code；其他 Harness 保留人工确认。
- 支持的运行模式默认开启，保留项目级和确认类型级关闭开关。
- Brief：正文 1000 字以内 100 秒；超出后每 500 字加 30 秒，不足一档按一档计算。
- 检查：首条待处置问题 100 秒，每多一条加 30 秒；无待处置问题不等待。
- 提交确认：200 秒，执行当前有效计划的原有 Git 模式，不切换成本地提交特例。
- Brief 超时进入实施；检查超时修复当前报告全部待处置问题并重检，新业务取舍仍暂停。
- 当前待决事项绑定本次活跃主会话；退出后取消，手动重开不补跑。

## 现有作者源与部署边界

- `.flower/state.json` 的 `flower/skill-garden` 当前平台为 `claude` / `codex`，拥有受管 Patch 与脚本投影。
- 三个入口的作者源分别位于 `vendor/skill-garden/.trellis/0.6/.agents/skills/` 和 `.claude/skills/` 下的 `trellis-task-brief`、`trellis-check-all`、`trellis-push`。
- workflow 作者源通过 `vendor/skill-garden/.trellis/0.6/overrides/patches/workflow/` 的 Patch 管理；不能直接修改 `.trellis/workflow.md` 后声称交付。
- Codex 的统一交互提示由 Flower 自有 `src/assets/flower_session_start.py` 的 `CODEX_USER_INTERACTION_HINT` 注入；现规则只允许当前工具 schema 许可的同步询问，禁止自行添加不存在的 timeout 参数或异步询问入口。
- `.trellis/spec/flower-trellis/cli/trellis-patch-engine.md` 的 `Codex Synchronous User Interaction Defaults` 场景是这条提示与平台配置的现有合同，新增超时策略应明确其与普通同步询问的边界。

## 可复用的现有接口

- `src/lib/copy-scripts.js` 的 `copyScriptAssets(target, variantDir, skills = [])` 按脚本别名选择投影；新增脚本若用于 Brief / Check-All / Push 的选择性安装，需要补齐相关 alias。
- `src/builtin-plugins/skill-garden/content-adapter.js` 的 `projectSkillGardenContent(options)` 也维护 `SCRIPT_ALIASES` 并投影变体 `scripts/` 的直接文件。legacy 与 Plugin 两条分发路径必须同步。
- `.trellis/scripts/common/trellis_config.py` 的 `read_trellis_config(repo_root)` 返回嵌套配置，但简单 YAML 读取器将标量保留为字符串，且读取/解析异常返回空字典。超时配置不能直接使用 `bool("false")` 或将损坏配置无差别当作默认开启。
- `src/lib/config-preserver.js` 的 `captureConfigPreserveSnapshot(target)` / `restoreConfigPreserveSnapshot(target, snapshot)` 目前只保护 `packages` 与 `default_package`。新增用户可调整的超时配置还需验证 Flower update 整文件覆盖后的保留行为。
- `.trellis/scripts/common/active_task.py` 的 `resolve_context_key(platform_input, platform)` 负责现有会话身份，不证明用户窗口仍然打开。不能使用“唯一活动任务回退”给定时决定猜测所属会话。
- `.trellis/scripts/pre_check_state.py` 已有临时文件、`fsync`、`os.replace` 的原子 JSON 写法，但它是暂缓检查偏好，不是并发领取或存活授权机制；只参考原子写模式，不复用它伪装超时授权。
- `src/lib/trellis-runner.js` 已有 Node PTY 转发及退出时恢复 raw mode / resize / input / Windows 终端状态的经验；如后续选择启动器，需要复用相应边界和测试模式，而不是将 Trellis 子进程运行函数直接当成 Harness 生命周期 API。

## 三个流程入口应保留的责任

- Brief owner 继续负责最终材料、展示与启动条件；超时模块只返回当前方案的默认选择结果。
- Check-All owner 继续 audit-first，并只对当前报告按默认选择进入修复与重检；超时不能等同于接受全部风险。
- Push owner 继续生成精确计划、核对 Git 基线、精确提交和恢复；超时结果不能覆盖变化后的计划或改变 `commit-only` / 普通推送模式。
- validated auto-loop 沿用原有 runner 预授权，不重复启动交互式倒计时。

## 接入能力的真实缺口

- 当前项目 hooks 只登记了一部分宿主事件，不能据此断言宿主不存在 Stop / SessionEnd；具体平台能力由同目录的专门研究文件记录。
- 同步 Stop hook 可作为完整响应结束后的继续入口，但需要证明等待期间人工输入能撤销默认决定，以及窗口关闭会立即使许可失效。
- 单靠 server PID、历史 thread、SessionStart 记录或持久排队消息不能证明当前窗口存活。
- 前台启动器持有 PTY 和生命周期、通过 IPC 串行处理输入与截止事件是候选方案。它会改变用户启动方式，须在最终设计前收敛产品取舍。

## 后续验证范围

- 此功能涉及新的运行时、hook、配置和跨平台生命周期，按 `quality-guidelines.md` 执行完整回归，而非仅规则文案检查。
- 需要计时公式边界、人工输入/截止竞争、重复通知、退出/强杀、旧请求重开不补跑、默认开关和配置损坏回退的行为测试。
- 需要隔离目标的 init / 重复 update / 选择性安装 / uninstall，以及 source→snapshot→compiled target→dogfood 的一致性验证。
- 原生 Ubuntu / Windows CI 与两个真实 Harness 的交互验证尚未运行；不能用静态 Patch 通过或模拟宿主替代最终平台验收。
