# Codex 同步用户交互实施计划

## 当前状态

- 处于 in_progress，完整 Brief 已展示，用户于当前对话回复“确认”批准开工。
- 已通过 `task.py start` 激活；route helper 命中当前用户 inline 偏好。
- 已实现配置与通用交互规则，本地验证、当前项目投影、业务推送及跨平台 CI 验收完成；用户全局配置及信任设置未改。任务已通过进度 helper 原子标记 completed + Close。

## 实施顺序

- [x] 完整展示并确认 Brief，再运行 `task.py start`。
- [x] 进入 `trellis-route(target=implement)`；复用合法 inline 决定，按 `trellis-before-dev` 加载项目规范。
- [x] 补受控 TOML 默认布尔键 adapter 和 Flower Codex Patch，纳入 full-only 平台 Bundle；先验证既有值保留、各种 key 形状、字符串伪匹配、歧义/损坏零写入与幂等。
- [x] 新增与模型无关的短 Codex 交互块，只在 state 的支持来源追加；保留既有模型 hint 原文和原生跳过/诊断。
- [x] 扩展预算结构检查，测实际差分，不提高预算阈值。
- [x] 用隔离真实 CLI 验证 init/update/dry-run/uninstall-dry-run 与平台范围；所有真实 Flower 命令使用 `FLOWER_NO_TELEMETRY=1`。
- [x] 通过 Flower `update --enhance-only` 生命周期投影到当前项目，检查受管配置和 script 一致；确认其它 Plugin 约束未变化。
- [x] 执行正式 Check-All，再进入 Update-Spec 和 Push 方案；用户已确认精确计划，业务及补充测试提交已推送，必需 CI 通过。

## 验证

定向入口：

```bash
node --test test/js/platform-patches.test.js test/js/ai-context-budget.test.js
python3 -m unittest discover -s test/python -p 'test_flower_session_start.py'
node scripts/check-ai-context-budget.mjs --strict
node --check src/lib/platform-patch-adapters.js
node --check scripts/check-ai-context-budget.mjs
git diff --check
```

完成前按项目要求运行 `npm test`，保留平台 Patch、Python 3.8 与 Windows 原生协议回归。检查过程允许复用未变范围的已有证据，不为普通规则拼接增加镜像实现的冗余测试。

配置矩阵至少包含：缺少配置文件、缺少 features、已有 features/其它 key、已有 true、已有 false、dotted key、inline table、CRLF、引号/多行字符串内伪键、重复 section/key、非法 feature 值、缺失平台、skill-only、重复执行无变更。

注入矩阵至少包含：Codex 各模型/缺失模型、三个启动来源、Claude、rules/stages、Hook 禁用和原生跳过。保留原模型 hint hash 与预算规则。

## 交付证据与风险

- 记录新块原文、实际注入 bytes/token 差分及配置加载证据。
- 明确“规则已经注入”“配置被加载”与“当前宿主实际调用同步询问”是不同验证结论；不伪造真实工具弹窗验证。
- `request_user_input` 的宿主限制与 feature 成熟度不会由 Flower 改写；不可用时仍应主对话等待。
- 任务完成记录仅在已确认业务交付成功后，由既有 task progress/lifecycle owner 写入。

本地完成证据（共八组，最终审查复用）：

1. `npm test` 退出 0：JS 655 项（653 通过、2 个 Windows 专属场景跳过），Python 501 项（499 通过、2 个 Windows 专属场景跳过）；Patch 冲突、935 个 compiled 文件零漂移、默认预算和模板检查通过。日志 `.trellis/.runtime/verification/codex-sync-user-interaction/npm-test.log`。
2. 最终定向 JS 三文件 28/28 通过，覆盖完整 TOML 解析、原文保留、配置清理顺序、首次/重复 Plugin 记录、真实 init/update/dry-run/uninstall-dry-run。全量 JS 之后的唯一局部调整为排除模板注释的字符串同文命中，已由此最终回归覆盖。
3. Python SessionStart 专项 25/25 通过，验证各模型、来源、分段、原文 hash、禁用和故障路径；全量 Python 同样包含该套件。
4. Strict budget 退出 0：通用块 455 B；最大三段合计 18,360 → 18,816 B，control total 108,214 → 108,670 B。推荐阈值产生 SessionStart warning，低于 20 KiB review ceiling；既有 states-total warning 不变。
5. 真实当前任务 compact / gpt-6.1-sol 前后输出仅 state 增加 456 B / 93 `o200k_base` tokens；rules/stages 逐字一致，模型 hint 原文保持。原文与 metrics 保存在 Git 忽略的 verification 目录。
6. 当前项目的真实 app-server `config/read` 返回项目层开启，`disabledReason=null`；未启动模型推理或真实询问。
7. 当前项目 Flower 生命周期更新成功，部署 wrapper 与源码逐字一致，后续 update 及 dry-run 为零目标变化；外部 rd-guide Plugin 锁定项保持一致，Skill-Garden 子仓干净。
8. 四份 JS 语法、源/部署 Python 编译、任务 manifests 校验及 `git diff --check` 通过。

`[上线后验证]`：用户重启 Codex 后，在新会话触发一次需要回答的普通询问，检查同步工具暂停等待、没有异步询问/通知窗口；当前工具 schema 不能由项目配置在运行中改写。若宿主仍不允许该同步工具，应回退到主对话等待。该项不冒充已执行的弹窗或模型遵循验证。

## 交付过程

- 用户已确认 1 仓 2 commit 29 文件提交范围，业务提交 `8f56915` 已成功推送。
- 初次 CI：SessionStart Ubuntu/Windows 通过，更新链路 Ubuntu 通过；Windows 新集成测试在全局同步阶段触发 npm 安装后超时，尚未进入目标行为断言。
- 仅修正已确认文件 `test/js/codex-sync-user-interaction.test.js`：复用现有 `isolatedGlobalTrellis`，使用捆绑依赖和独立 npm prefix、CLI 用户环境，避免读取或安装机器全局 Trellis；真实 init/update 与所有目标断言保留。
- 此补充不改变产品范围或配置/注入语义，定向验证后补充提交并以新 SHA 的 CI 为准；此前模型提示和配置证据继续有效。
- 补充提交 `4ad9c0c` 已成功推送；本地定向 13/13 通过，light 重检三个维度通过、CHK/FBK/DOC 均为 0；现有全局同步/测试隔离规范已覆盖，本轮 Spec 为 no-op。
- 最新提交 `4ad9c0c62acaef101f5fcce2356cd79d6b73ac77` 的必需 CI：
  - [Python 跨平台兼容回归](https://github.com/SilentFlower/flower-trellis/actions/runs/38556884990)：Ubuntu/Windows × Python 3.8/3.12，4/4 success。
  - [更新链路跨平台回归](https://github.com/SilentFlower/flower-trellis/actions/runs/38556885008)：Ubuntu/Windows × Node 22，2/2 success；新集成测试实际执行。
- [SessionStart 跨平台回归](https://github.com/SilentFlower/flower-trellis/actions/runs/38556153903)：业务提交 `8f56915b297c8b797cd03d1255f5a6847f7af7b0` 的 Ubuntu/Windows，2/2 success。补充仅修改 JS 集成测试，SessionStart 源码、部署、Python 专项及 workflow 的提交间 diff 为空，因此沿用其有效证据。
- 8/8 必需矩阵通过；没有 skip 目标行为、删除矩阵、放宽断言或提高超时来掩盖首轮失败。重启后的真实同步询问仍按 `[上线后验证]` 保留。
