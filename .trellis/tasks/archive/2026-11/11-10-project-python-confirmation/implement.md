# 项目内 Python 确认运行时实施计划

## Preconditions

- 人工确认最终 Brief 后执行 task.py start，再进入 trellis-route(target=implement)。
- 实施前读取 trellis-before-dev、任务三件套、确认运行时、质量、Python 命令物化与 Plugin 投影相关规范。
- 本任务保持 `meta.confirmationTimeoutDisabled=true`。

## Implementation Sequence

1. [x] 建立旧行为到新测试的场景映射，覆盖 store/runtime/Codex/Claude/安装与关闭；补齐隔离项目无 Node/npm/Flower 的测试夹具。
2. [x] 新增 Flower Python 入口与运行时包，移植有界存储、锁、状态转换、正式协议、信号取消和执行记账。直接复用 confirmation_policy 与前台身份 helper。
3. [x] 实现仅供既有 Unix socket 的标准库 WebSocket/JSON-RPC，移植 Codex 只读快照、原生队列、rollout 和窗口观察。
4. [x] 迁移 Claude 原生事件、Stop 后台命令绑定、transcript 与通知来源校验；更新两端 Hook 与 --entry 查询。
5. [x] 将入口、运行时包和前台 helper 纳入资产清单及 Plugin 事务；迁移 Trellis 控制状态核验和项目关闭取消调用，覆盖更新失效与卸载竞争。
6. [x] 删除 confirm Node 命令、帮助分发和旧确认模块；迁移其测试至 Python 与真实项目入口。检索现行源码、规则和测试，清理旧调用。
7. [x] 更新 Skill-Garden 作者源中的 confirmation.md、三个 owner 及相关唤醒指引/断言；刷新 compiled targets、发布快照和 Plugin 本地投影。
8. [x] 执行专项、完整回归、隔离生命周期和原生场景验证，记录实际覆盖与平台条件。
9. [x] 按 Check-All → Spec → 精确 Git 计划继续完成链。匹配交付提交的必需 CI 成功后完成任务记录。

## Verification Plan

### Runtime And Contracts

- Python unittest：策略和冻结快照、状态读写与多进程竞争、Windows 锁权限重试、worker 重复、单调时钟、完整展示、单次 claim/started、人工输入竞争、信号退出和终态记账。
- Codex：WebSocket 握手与帧边界、JSON-RPC 错误/超时、精确 rollout、完整消息来源、原生队列回执未知、窗口 pidfd 和同会话双窗口。
- Claude：四类 Hook、Python wait 命令引号/路径、Stop 绑定、原生 task-notification、human 伪通知与 runId 替换。
- 无依赖场景：隔离 PATH，使用 Python 的绝对路径启动项目脚本；实际断言六个命令和 Hook，完整链路由受控原生宿主提供协议事件。
- 真实 CLI：帮助移除 confirm，旧子命令走未知命令处理；有效项目的 Python 帮助/空状态查询保持零写入。
- 原生验证：分别记录进程生命周期、Codex 队列唤醒和 Claude 后台通知；只管理本任务创建的隔离会话。

### Distribution And Lifecycle

```text
npm run patch:targets
npm run sync
npm test
node scripts/check-snapshot.mjs
npm run patch:targets:check
node scripts/check-ai-context-budget.mjs --strict
node scripts/check-output-templates.mjs
```

专项使用 `node scripts/run-python-tests.mjs <本轮相关测试文件>` 与 `node --test <安装/控制相关测试文件>`。受影响源码执行 Python/Node 语法检查。完整回归后复用当前内容与环境的成功结果。

使用 `.trellis-tmp/` 内的隔离目标执行 init、重复 update、关闭/开启与 uninstall，断言用户 Hook 和 confirmation_timeout 保留、旧请求失效、目录清理和幂等。开发期使用本仓 `node bin/flower-trellis.js` 执行安装生命周期。

推送后保存匹配 headSha 的 CI run 与现有四组 Python 兼容结果。Python 3.8 缺少 pidfd 时验证人工分支；受支持 Linux/WSL 自动路径另有真实原生验证。

## Review Gates

- AC1～AC7 逐项登记证据；原生宿主替身、真实原生和 CI 的证据分别记录。
- 确认所有现行协议和 owner 使用项目 Python 入口；历史任务和 CHANGELOG 作为历史证据保留。
- 旧 Node 模块删除前核对全部调用方，项目关闭和卸载保持可用。
- 任务完成沿用项目的跨平台 CI 门禁。

## Rollback Points

- Python 主链路与原生校验完成后再切换入口及删除旧实现。
- 安装资产、Hook 和规则通过同一受控生命周期切换；事务失败复原该组文件。
- 回滚保持旧请求失效状态，已 started 的副作用继续据实记账。

## Validation Evidence

- 迁移初版完整 `npm test`：JavaScript 689 项，687 通过、2 项按平台条件跳过；Python 591 项，589 通过、2 项按平台条件跳过。完整命令退出码 0。
- Windows 补修后的当前完整 `npm test`：JavaScript 689 项，687 通过、2 项按平台条件跳过；Python 593 项，591 通过、2 项按平台条件跳过。完整命令退出码 0。
- 严格上下文预算、actionlint、源码/快照/投影字节一致性与 npm pack dry-run 校验通过；发布载荷包含完整 Python 运行时并排除缓存。
- Codex 使用当前 Provider 和默认模型，在自有沙盒完成报告展示、2 秒等待、真实队列唤醒、单次领取、修复、Check-All 重检及 completed 记账。会话：`01a1c430-d17b-71f1-8cde-5b62efbb81b5`。
- Claude 原生终端与回环模型替身完成后台通知、领取、两项修复测试及终态记账。最近会话：`5db9fa05-ff03-44f2-a42e-489b7ea51ce5`。
- 真实进程退出与 pidfd 由 `test_flower_tui_lifetime.py` 覆盖。隔离 PATH 的两端完整命令链路由 `test_confirmation_native.py` 覆盖。
- 作者源提交并推送后已重建快照和项目投影。发布溯源及真实 Patch 冲突门禁通过：Patch 59、operation 249、ready target 1390、warning 0。

## Delivery Evidence

- Skill-Garden 已推送：`ada1fe170443e2ffc4c0baeb1d74928628c13141`。
- Flower 业务提交已推送：`016cde775f1a8dec3a1a01634802915369e9c19e`。
- 完整 CI：[42772306755](https://github.com/SilentFlower/flower-trellis/actions/runs/42772306755)，`workflow_dispatch`，核对准确 headSha；Windows / Python 3.8 出现锁释放共享占用与卸载竞争等待失败；两组 Windows 均命中相同两例失败，另外 6 个 CI job 通过。

## Windows CI 补修计划

1. [x] 为 Windows 原子替换和锁释放增加仅针对文件操作的有限权限重试，断言回调单次执行及原错误保留。
2. [x] 卸载竞争通过 queued 事件同步并保证线程回收，保留真实后台线程与目录缺失断言。
3. [x] 同步项目投影，执行相关专项和完整回归；完成 Check-All、规范更新和补充 Git 计划后复验新提交 CI。

- 补修专项：`node scripts/run-python-tests.mjs test/python/test_confirmation_store.py test/python/test_project_confirmation.py`，24 项通过，退出码 0。

## Beta 交付计划

用户选择直接发布新 beta，目标为 `0.6.13-beta.8`。

- 先提交已通过本地完整回归的 6 个 Windows 补修文件。
- 按发布 SOP 执行 `npm run sync`，预计仅更新 `enhancements/MANIFEST.json` 的同步时间，并以独立快照提交记录。
- 使用已预览的 `--prerelease beta` 策略执行正式发布，生成 package.json、package-lock.json、CHANGELOG.md 的 release commit 和 `v0.6.13-beta.8` 标签。
- 推送当前分支与该精确标签，由 Release 工作流先对标签提交运行完整 CI，成功后发布 npm beta 并创建 GitHub prerelease。
- 核对准确 headSha、四组 Python 兼容任务、npm beta 版本与 GitHub prerelease 后，完成当前任务的进度及 Close，并提交原有 7 个任务记录文件。
- 正式 release 前等待版本号与 CHANGELOG 预览的人工确认；本轮保留确认机制自身开发的人工边界。

## Beta 发布执行证据

- Windows 补修提交：`8e24d131abc7724413ce4bac26137e18447fed33`。
- 独立快照提交：`2699c0873d0eacf99da70cc67f3ad370317d1d4f`，仅同步时间变化。
- 发布提交：`559ba5b1eb44a1f35758ec663c0669f197f48d40`，标签 `v0.6.13-beta.8`，均已推送。
- Release 工作流：[42776155682](https://github.com/SilentFlower/flower-trellis/actions/runs/42776155682)，准确 headSha 为发布提交；9 个 CI/发布 job 均为 success，npm registry 版本与实际压缩包均已核对通过。

### 发布标签 CI 兼容结果

| 平台 | Python | 总数 | 通过 | 条件跳过 | job |
| --- | --- | ---: | ---: | ---: | --- |
| ubuntu-24.04 | 3.8 | 593 | 585 | 8 | success |
| ubuntu-latest | 3.12 | 593 | 589 | 4 | success |
| windows-latest | 3.8 | 593 | 529 | 64 | success |
| windows-latest | 3.12 | 593 | 529 | 64 | success |

- Linux 常规跳过为 Windows CMD/BAT、Windows 扩展路径和 WSL/Windows Maven 工具链；Python 3.8 另跳过 4 个缺少 pidfd 的原生窗口用例。
- Windows 跳过为 POSIX Maven 53 例、Linux 原生确认 5 例、pidfd 窗口 4 例、POSIX 权限语义 1 例和 WSL ext4 边界 1 例，共 64 例。
- Windows 的状态锁、真实多进程争锁、单次回调和卸载竞争补修用例实际执行并通过。两组启动入口与原生编译产物检查均通过。
- GitHub 预发布已创建：[v0.6.13-beta.8](https://github.com/SilentFlower/flower-trellis/releases/tag/v0.6.13-beta.8)。npm 发布日志返回成功。随后 registry 版本与 beta dist-tag 均回读为 `0.6.13-beta.8`，实际发布包校验通过。

### npm 发布包回读

- `npm view flower-trellis@0.6.13-beta.8 version --prefer-online --registry=https://registry.npmjs.org` 返回 `0.6.13-beta.8`。
- `beta` dist-tag 为 `0.6.13-beta.8`；GitHub Release 为正式可见的 prerelease，正文与 npm flowerReleaseNotes 一致。
- 下载的 npm 压缩包共 913 个文件，9 个确认 Python 资产与发布提交逐字节一致；旧 Node 确认实现及 Python 缓存均已排除。
- 完整性：`sha512-bc9ME9LqT/4/tAmuscZ6Jo1CpcM4FXcSrS9wqu4xrdHuGG3wu1aZMrILcJWB+6cJP6GGn45FDoXWcBuhsC+FHA==`。
