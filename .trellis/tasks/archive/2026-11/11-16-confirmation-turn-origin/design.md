# 技术设计

## 边界与已有契约

Flower 运行时作者源在 `src/assets/flower_confirmation_runtime/`。项目 `.trellis/scripts/` 是分发结果。当前工作区已包含容量、Windows 与 Claude 来源核验的改动，本任务在这些内容之上增量实现。

当前正式状态为 version 2，当前请求契约为 version 3。`runtime.prepare()` 在锁内构造新状态时仅保留会话身份、代次、人工消息、native 和新 request。Codex 准备时从当前 consumed 请求恢复原唤醒 ID。Claude 准备时从当前 consumed 请求恢复通知所属请求、任务 ID 和人工基线。这是来源与请求生命周期耦合的位置。

两端使用同一个修复契约，一起交付。来源记录和单次许可跨两端共用验收，因此采用单任务。

## 独立的当前回合来源

在原状态文件增加一个版本化的顶层 `turnOrigin` 记录。该字段为本任务新增设计。最多保存当前一个已核验来源，大小纳入原状态上限。

逻辑内容包括：来源记录版本、原生回合/输入身份、真实人工消息基线、已验证日志起点和观察点、输入种类及原始唤醒身份，以及适用的宿主运行/窗口身份。精确字段实现时沿用已有命名和数据结构。内部唤醒的原请求 ID、Codex client_id 或 Claude task ID 仅用于追溯原生来源。

该记录不包含新的执行许可。当前 `request` 继续保存本次冻结材料、时长、队列项、claim 回执与执行状态。新 request 可以整体替换，当前有效 turnOrigin 随同保存。

## 建立、恢复和持久化

1. 适配器根据当前 Hook 的准确回合和原生日志共同验证输入，生成来源候选。Hook 记录只提供定位信息。
2. 新来源在成功 prepare 的状态转换中，与本次代次、人工消息和原生回合检查一起在同一目录锁内持久化。首次内部来源仍从精确匹配的已消费原请求核验，随后来源独立于该请求保存。claim 保持本次原生唤醒与许可核验。后台观察保持只读，避免轮询写锁。
3. 当前回合已有来源时，先核对回合/运行身份及窗口边界，再通过 `SessionLog` 校验文件身份、记录边界和随后事件。满足全部条件后恢复人工基线。
4. 准备前后的两次快照保持一致。锁内继续核对读取期间的 generation、native 回合和人工基线，防止新输入在来源读取与请求写入之间被覆盖。
5. 重新准备使用最新材料和新的 request ID。每次新请求独立完整展示、计时、领取和 started。来源复用不会沿用旧倒计时或旧回执。

## 生命周期

| 事件 | 当前回合来源 | 当前确认请求 |
| --- | --- | --- |
| 同回合创建、替换或显式取消确认 | 保留并在后续使用时复核 | 新建或作废对应请求 |
| 真实人工输入/Interrupt | 清理旧来源并按当前输入重建 | 继续原人工输入失效语义 |
| 原生回合切换 | 原记录停止适用，新回合重新核验 | 按当前原生来源验证投递与领取 |
| Claude SessionStart/SessionEnd、runId 变化 | 清理或拒绝旧来源 | 沿用原运行失效规则 |
| 原窗口失效、日志替换/截断/回滚或来源异常 | 每次复核均拒绝复用，后续原生输入或项目生命周期清理记录 | 沿用原失败和人工回退规则 |
| 项目更新、关闭或卸载 | 清理来源，保留已 started 的执行事实 | 沿用既有项目生命周期取消 |

Codex 的伪造同文消息继续通过 client_id 与正文及原生记录区分。Claude 的通知继续核对结构化 origin、promptId 和本项目任务映射。原生 Hook 对通知正文的识别保持候选语义。

用户在实施后明确要求盘点并删除不必要拦截，本节调整替代早先针对 isMeta 的单项兼容。Claude 只识别可用的人工和原生通知证据，附加/未知记录不参与判断。结构化 origin.kind 为主来源；缺失时兼容旧 turnOrigin，停止重复来源字段一致性与平台分支约束。缺少本次必需输入/通知时，由定位或领取阶段拒绝使用。

通知身份以原生标识为依据，停止完整文案、固定外壳和单一文本块约束。Codex 保留 Flower 请求标记与原生 clientId 的对应关系；Claude 从通知文本中提取唯一 task ID，再与本项目任务映射匹配。原生回合/消息/task ID 作为非空不透明字符串处理，资源预算由状态和日志整体控制，Flower 自有会话、请求、回执和 runId 保持 UUID。

Codex 最终回复提取字符串或各内容块中的文本，附加内容块忽略。实际冻结正文仍须完整展示。删除展示与领取各 300 秒的硬期限，保留用户倒计时、来源/材料/窗口失效与 worker 最大运行期限。

## 兼容与回滚

- 保留状态 version 2 和请求 contract version 3，新来源自身带版本。缺少新来源的旧状态，在当前原生输入与既有请求足以完成精确核验时建立来源；证据缺失继续人工回退。
- started 未终结的执行继续阻止新 prepare。终态记账复用原回执入口。
- 新来源结构损坏、跨平台/会话或版本未知时拒绝使用。保留当前请求与实际执行事实用于诊断。
- 源码更新经已有安装事务投影，并由 `invalidateChangedConfirmations()` 在资产实际改变前作废旧请求与来源。回滚代码沿用同一安装生命周期。
- 默认时长、用户交互与业务 action 集保持原契约。

## 受影响位置

- `src/assets/flower_confirmation_runtime/store.py`：可选来源结构校验、原子保存与生命周期清理。
- `src/assets/flower_confirmation_runtime/runtime.py`：prepare 保存来源，request 替换和许可边界；claim 沿用本次通知核验。
- `src/assets/flower_confirmation_runtime/codex.py`、`claude.py`：来源建立、恢复、Hook 失效及日志核验。
- `test/python/test_confirmation_native.py`、`test_project_confirmation.py`、`test_confirmation_store.py`、`test_confirmation_windows.py`：复现、真实子进程与跨平台来源/竞态回归。
- `test/js/confirmation-install.test.js`：验证分发资产与更新失效行为。
- `.trellis/spec/flower-trellis/cli/confirmation-runtime.md`：完成实现后记录新来源契约。

如果实现需要调整共享确认协议说明，在 `vendor/skill-garden/.trellis/0.6/scripts/confirmation.md` 作者源维护，再同步快照及产物。运行时源码由 Flower 直接分发。

## 验证策略与实际限制

隔离项目先覆盖真实适配器和策略进程，再以独立 CLI 子进程执行 prepare、cancel、wait、claim、result；宿主边界替身的范围需单独记录。补齐通知唤醒后连续替换和重新计时的完整链路，验证旧提醒与旧回执无重复许可。

本地完整回归完成后，跨平台交付沿用匹配变更提交的 GitHub Actions Ubuntu/Windows × Python 3.8/3.12 矩阵。现有 Ubuntu Python 3.8 使用 ubuntu-24.04。原生 TUI 实机结果和协议替身结果分别记录；外部项目升级属于后续独立操作。

## 已授权的远端分叉整合

用户在主仓推送被拒绝后明确回复“整合并继续”。整合保留本地修复提交 3702d40 与远端 beta.14 提交 52d8afa 的完整历史。使用独立临时克隆进行合并和验证，当前工作区的 41 个保留文件按原内容保留。

逐个对照运行时差异后，远端在重叠作者源中的差异均属于本任务已明确调整的来源、格式及期限契约。本任务的作者源、对应测试和规范作为这些冲突的合并结果；远端版本、发布记录、既有任务记录及受管投影沿用远端内容。子模块使用已推送且直接继承 fd7f2c6 的 d12d725，快照由 canonical sync 重新生成。最终以合并结果的完整回归和对应提交原生 CI 验收。
