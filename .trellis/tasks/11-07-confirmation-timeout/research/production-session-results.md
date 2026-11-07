# 产品入口实测

本机 Linux，实际 Codex 0.167.0 / Claude Code 2.1.293，经正式 `ftl session`、PTY、生产 MCP 和 Python 客户端贯通。全部模型响应来自 `127.0.0.1` mock，没有真实推理费用。明细见 [production-session-evidence.json](production-session-evidence.json)。

| 场景 | Codex | Claude |
| --- | --- | --- |
| 100 秒 | 100.001 秒，通过 | 100.001 秒，通过 |
| 130 秒 | 130.001 秒，通过 | 130.002 秒，通过 |
| 200 秒 | 200.000 秒，通过 | 200.001 秒，通过 |
| 最终三秒短场景 | 超时返回并成功单次领取 | 超时返回并成功单次领取 |
| 等待中人工输入 | 约0.519秒撤销，不领取 | 约0.520秒撤销，不领取 |
| 强杀前台入口 | 跨过原截止后无新主对话请求 | 跨过原截止后无新主对话请求 |

共12组有效产品协议场景。等待起点和结束来自生产审计；正常场景共4次主请求，依次准备、等待、领取、确认领取结果。等待期间停留在第2次请求，不发生每秒模型轮询；人工撤销场景3次，强杀场景2次。

完整报告由生产控制器直接写入终端，排空并复核后才开始计时，结束后恢复原生界面。真实PTY测试另覆盖正常CLI退出码、EOF、HUP、入口SIGKILL、MCP及普通后代清理；状态机测试覆盖准备/展示/领取期间输入、工具返回后的撤销、材料变更、重复准备/等待/领取及旧实例拒绝。

## 上下文尺寸

- 生产服务端单工具定义386字节；Claude实际展开定义314字节。
- 生产超时结果按当前UUID格式序列化为101字节；正文不进入该结果或工具定义。
- 本轮未单独采集Codex最新工具元数据。Phase 1.2原型的313字节和既有Code Mode包装14721字节保留为原型证据，不当作本版本精确增量。
- 使用时还需按需读取 `.trellis/scripts/confirmation.md`，并产生准备、领取等工具输出；不能把单工具定义当作整个流程的上下文成本。字节不等于token，mock的usage不作计费证据。

Claude `timeout` 是单服务器工具总预算，并提高该服务器的idle窗口下限，按[官方环境变量说明](https://code.claude.com/docs/en/env-vars)和已安装2.1.293的配置描述核验；未提高其它MCP服务器的全局预算。仅本次关闭MCP自动后台化。

## 证据边界

- 100/130/200秒使用配置化check等待，未执行业务修复、commit或push；计时公式和Git模式绑定分别由Python行为测试覆盖。
- 探针通过真实原生shell会话变量桥接绑定，避免改写Codex的全局Hook批准。真正的SessionStart路径由实际Python helper、两平台原生事件和回环TCP集成测试覆盖。
- 本地长场景在实现迭代中运行，最终短场景复验状态机领取合同；最终提交的Ubuntu/原生Windows CI已重跑两个真实CLI的完整20场景。
- 最终CI覆盖Ubuntu/Windows × Python 3.8/3.12、原生进程约束及单独的真实CLI矩阵，10个必需job全部成功；已核对headSha和24个目标步骤实际执行成功。模型响应使用回环mock，其他Harness仍保留人工确认。
- 作者源与快照已经按确认计划提交，`check-snapshot.mjs` 及Patch门禁通过；最终CI验收证据和此前失败历史保存在本任务原有研究文件。

## 首轮 CI 与夹具修复

- [首轮CI](https://github.com/SilentFlower/flower-trellis/actions/runs/42358479110) 对应产品提交 `551783027f3ada4057c86b1f992a06b0169f305b`：6个job成功、3个失败、1个取消。
- Codex探针向干净环境中不存在的两个MCP名称只写 `enabled=false`，会使配置缺少transport；本机使用不存在的MCP名称已复现该启动错误。修复为按原生只读目录停用实际存在的项。
- Windows的两版Python完整套件均成功：556项、55项能力相关跳过；Node的PTY夹具未采用生产CLI已有的显式退出收尾，四个用例等待退出超时。3.8另有进程已停止后的目录句柄释放导致EBUSY，已采用项目现有的有界清理重试。
- Windows原生Claude的100秒等待与claim成功，但外层探针未结束，后续场景没有执行，job最终取消。该结果不能替代完整Windows验收。
- 三个验证夹具已在本地修复，21项定向测试、两个真实Harness的超时/人工/强杀共6组短场景通过。人工输入排队成追加回合时保留已经核验的结果标记；这类新增回合发生在人工介入后，不是等待期间模型轮询。
- 首轮三个夹具修复已提交；第二轮CI的20个原生场景通过，但Windows Node入口的两个人工输入用例因夹具发送LF而非真实Enter的CR超时。补正后第三轮9个job成功，3.12仅两个目录清理钩子出现初始EBUSY。

## 最终 CI 验收

[最终CI](https://github.com/SilentFlower/flower-trellis/actions/runs/42363218845) 对应 `6d051883e1e0dbad98c690dfa18a1de23948b798`，10/10个必需job成功，24个目标步骤实际执行成功。

- Ubuntu与原生Windows各10个真实CLI场景全部通过：Codex 0.167.0、Claude Code 2.1.293各验证100/130/200秒、人工撤销和强杀；共20个场景。证据中的 `elapsed_ms` 是场景总耗时，不冒充审计等待时长。
- Windows Python 3.8/3.12均完成556项Python测试，其中55项为能力相关跳过；两组Node入口各99项通过，0失败、0取消、0跳过，原生平台编译产物检查通过。
- Ubuntu Python矩阵、两平台更新行为、JavaScript完整套件、快照、Patch、compiled targets、严格上下文预算和输出模板检查均通过。
- 清理修复的依据是实际Node 22 rimraf源码及故障注入：同步删除面对初始EBUSY只尝试1次就抛错，异步删除第2次成功。两个清理钩子使用异步有界重试，全部进程停止、许可及输入透传断言保留。

| CI轮次 | 结果 | 处置 |
| --- | --- | --- |
| [首轮](https://github.com/SilentFlower/flower-trellis/actions/runs/42358479110) | 6成功、3失败、1取消 | 修复MCP目录发现及Windows验证进程退出 |
| [第二轮](https://github.com/SilentFlower/flower-trellis/actions/runs/42360683991) | 8成功、2失败 | 修正两个夹具的Enter编码 |
| [第三轮](https://github.com/SilentFlower/flower-trellis/actions/runs/42361968270) | 9成功、1失败 | 修复初始EBUSY未重试的目录清理 |
| [最终轮](https://github.com/SilentFlower/flower-trellis/actions/runs/42363218845) | 10成功 | Ubuntu/Windows验收完成 |
