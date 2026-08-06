# xhgj-gitlab-collaboration 真实使用证据

> 由 JSON 生成，请勿手工编辑。
> 机器 canonical：`tests/fixtures/real-usage.json`
> 规范化内容 SHA-256：`ad3d5a79ad9fb3193f28aaaaeea44bf2d5925ff01df94a9e7fc455daf93f635d`

## 元数据

- Skill 版本：`0.4.2`
- 客户端：ChatGPT Codex 与 Claude Code on a Maintainer-controlled Windows workstation
- 环境：Maintainer-controlled Windows workstation; prior ecommerce-docking-management and record_worktime workflows plus rd-guide Project 238 merge-gate readback, MR !39 squash-result readback, and cross-Project GitLab Markdown render validation
- 事实截止：`2026-07-31`
- 状态：`passed`

## 实战元数据

- 工具：ChatGPT Codex and Claude Code
- 客户端版本：不可得：`not-collected`
- 模型精确快照：不可得：`not-collected`
- 会话 ID：不可得：`not-collected`
- 采集时间：2026-08-03T21:31:26+08:00
- 采集方式：retrospective-from-existing-canonical-evidence
- 操作系统：Windows workstation
- Shell：不可得：`not-collected`
- Node 版本：不可得：`not-applicable`
- 浏览器版本：不可得：`not-applicable`
- 资产版本：0.4.2

## Review

- Agent 状态：`passed`
- Agent 摘要：prior controlled workflows and v0.3.0 deterministic evidence remain valid through the 0.4.2 patch; 0.4.2 retires the activated ticket-ops source from transition use to historical audit only, without adding any GitLab action, endpoint or permission
- Maintainer 状态：`passed`
- Maintainer 摘要：the Maintainer approved the 0.2.0 to 0.3.0 minor bump, confirmed the zero-enforcement gap after MR !39, and required an honest gap window, concrete mutation failures and no installed-copy sync in follow-up execution session 019fb211-a090-7a01-a86c-461efe8bc3ab

## 场景

### 1. controlled-live-preflight

- 类型：`positive-preflight`
- 结果：`passed-with-finding`
- 非空输出行数：`5`

#### 输入

```text
在 Windows 工作站使用本人预期身份、Group 继承 Owner 角色和域名 remote，对 ecommerce-docking-management 执行只读 preflight。
```

#### 读取文件

- `SKILL.md`
- `references/source-index.md`
- `references/execution-contract.md`

#### 输出

```text
当前目标：ecommerce-docking-management 受控真实使用的工作站就绪检查。

已确认事实：用户为许海川，有效角色为 Group 继承 Owner，remote 为 hostname-form，分支为 docs/bootstrap，工作树干净，凭据材料未读取未输出。

停止条件：Windows Python 3.7 默认 GBK 解码首次触发 UnicodeDecodeError 和二次 IndexError；显式 UTF-8 模式后同一只读 preflight 成功。

未执行动作：未修改 Skill 安装副本，未变更权限、保护规则或凭据配置。

下一步：在 Skill runner 中固定字节级 UTF-8 解码并增加中文输出回归。
```

### 2. controlled-note-authorization-roundtrip

- 类型：`note-roundtrip`
- 结果：`passed-with-finding`
- 非空输出行数：`5`

#### 输入

```text
在 rd-guide #6 创建受控真实使用授权 Note，并按真实 Note ID 全文回读。
```

#### 读取文件

- `SKILL.md`
- `references/execution-contract.md`
- `references/troubleshooting.md`

#### 输出

```text
当前目标：登记 ecommerce-docking-management 受控试点授权。

已确认事实：note 19796 创建成功，Project、范围、禁止动作、停止条件和 AI 会话签名均可按真实 ID 回读。

停止条件：首次 JSON 文件调用因缺少 Content-Type 返回 HTTP 415，服务端未创建对象；补充 application/json 后成功。

未执行动作：未自动重发未知状态请求，未创建重复授权 Note。

下一步：把 JSON content type 固化为写入契约和回归门禁。
```

### 3. controlled-git-and-pipeline-roundtrip

- 类型：`git-push-pipeline`
- 结果：`passed`
- 非空输出行数：`5`

#### 输入

```text
在既有 docs/bootstrap 分支推送两个增量 commit，并回读目标 Pipeline。
```

#### 读取文件

- `SKILL.md`
- `references/execution-contract.md`

#### 输出

```text
当前目标：验证受控分支 push 与 Pipeline 事实链。

已确认事实：commit 1f8f4a8 和 b1ed4fe 已推送；Pipeline 10616/job 46255 成功，日志为 OK: validated 18 UTF-8 text files。

停止条件：Pipeline 失败或 SHA 不一致时停止进入后续对象更新。

未执行动作：未 force push、未改写历史、未直推目标分支。

下一步：按同一 head SHA 回读既有 MR 与 Issue。
```

### 4. controlled-mr-and-issue-readback

- 类型：`mr-issue-readback`
- 结果：`passed`
- 非空输出行数：`5`

#### 输入

```text
更新 ecommerce-docking-management 既有 MR !1 与 Issue #1，并回读全部授权字段。
```

#### 读取文件

- `SKILL.md`
- `references/execution-contract.md`

#### 输出

```text
当前目标：完成既有 MR 与 Issue 的受控更新和全文回读。

已确认事实：MR !1 head 为 b1ed4fe、mergeable、squash=false、auto-merge=false；Issue #1 保持 opened、原 assignee/截止日期和三个目标标签。

停止条件：source/target、head SHA、状态、assignee、截止日期或标签任一不一致即停止。

未执行动作：未 merge、auto-merge、关闭 Issue/MR 或变更成员权限。

下一步：把完整执行结果登记为 rd-guide #6 note 19802 并等待 Maintainer review。
```

### 5. controlled-result-backflow

- 类型：`experience-backflow`
- 结果：`passed-with-finding`
- 非空输出行数：`5`

#### 输入

```text
将受控试点结果、真实对象和三个可复用缺口回流到 rd-guide #6。
```

#### 读取文件

- `SKILL.md`
- `references/execution-contract.md`
- `references/troubleshooting.md`

#### 输出

```text
当前目标：形成首个受控真实使用结果证据。

已确认事实：rd-guide #6 note 19802 状态为 executed-pending-maintainer-review，记录了 source commit、Project、commits、Pipeline、MR、Issue 和未执行高影响动作。

停止条件：GitLab 会裁剪 Note 末尾 CR/LF，原始字符串比较因此误判；裁剪双方末尾 CR/LF 后全文一致。

未执行动作：未把本次 Owner 闭环宣称为成员验收、Skill active 或团队分发完成。

下一步：固化尾换行规范化和 hash 语义，完成独立硬化 MR 后交 Maintainer review。
```

### 6. hardening-python37-live-regression

- 类型：`positive-preflight-regression`
- 结果：`passed`
- 非空输出行数：`5`

#### 输入

```text
在默认 Python 3.7.9、未启用 -X utf8 的 Windows 环境运行修订后 Skill live preflight。
```

#### 读取文件

- `SKILL.md`
- `scripts/self_check.py`
- `references/troubleshooting.md`

#### 输出

```text
当前目标：验证 Windows Python 3.7 中文 glab 输出解码修复。

已确认事实：修订后的 runner 以字节模式捕获 stdout/stderr 并显式按 UTF-8 解码；对 rd-guide 的 live preflight 成功回读本人身份、Group 继承 Owner、hostname remote、分支和提交身份。

停止条件：任何非 UTF-8 输出统一返回 preflight-output-not-utf8，不转发原始认证输出。

未执行动作：未修改系统 locale、未启用 -X utf8、未执行 GitLab 写入。

下一步：由 Maintainer review 本硬化 MR；Skill 在 review 通过前继续保持 incubating。
```

### 7. controlled-worktime-timelog-create

- 类型：`worktime-recording`
- 结果：`passed`
- 非空输出行数：`5`

#### 输入

```text
在负责人明确授权下，于 rd-guide #6 用 GraphQL timelogCreate 完成一次探针写入与一次本人确认后的工时写入，并做三面回读。
```

#### 读取文件

- `SKILL.md`
- `references/execution-contract.md`

#### 输出

```text
当前目标：在 rd-guide #6 以 GraphQL timelogCreate 完成本人已确认的工时写入。

已确认事实：探针 Timelog/162（1m、归属 2026-07-28）与本阶段 Timelog/163（29m、归属 2026-07-30）均写入成功且 errors 为空；spentAt 接受 date-only 完成补录，中文 summary 经 UTF-8 文件载荷全文保留，录入身份为本人 GitLab 账号；GitLab 自动生成 system note 20380 与 20381；REST time_stats 与 GraphQL Issue.timelogs 同为 3600 秒。

停止条件：mutation 回声、time_stats 与 Issue.timelogs 任一不一致或结果不明即停止；REST 没有 timelog 列举端点，该路由的 404 不作为环境故障处理。

未执行动作：未发送 /spend 或任何其它 quick action，未在本人确认前写入 timelog，未删除或整体清空既有工时条目。

下一步：把实测证据登记为 rd-guide #6 note 20382，并由本能力 MR 将 record_worktime 从 candidate 转为正式动作。
```

### 8. controlled-cross-project-render-gate

- 类型：`cross-project-references`
- 结果：`passed`
- 非空输出行数：`5`

#### 输入

```text
在 rd-guide 上下文渲染 `digital-initiative-governance/ecommerce-docking-management#1`，提取实际 href 与 data-project-path，再用 v0.3.0 操作证据门禁核对目标 Project。
```

#### 读取文件

- `SKILL.md`
- `references/execution-contract.md`
- `scripts/self_check.py`
- `tests/fixtures/operation-evidence-v0.3.0.json`

#### 输出

```text
当前目标：验证跨 Project 完整路径引用与写后渲染目标回读。

已确认事实：GitLab Markdown API 在 `project=digital-rd-governance/rd-guide` 上下文中把引用渲染到 `http://gitlab.xhgjdev.com/digital-initiative-governance/ecommerce-docking-management/-/work_items/1`，`data-project-path=digital-initiative-governance/ecommerce-docking-management`；v0.3.0 `--evidence` 校验通过。

停止条件：出现未确认裸引用、缺少 locator 的渲染目标或实际 Project 与完整路径声明不一致时 fail closed。

未执行动作：未创建或修改 GitLab Issue/Note/MR，未修改任何安装副本。

下一步：将同一操作证据格式用于后续含跨 Project 引用的正式写入。
```

### 9. controlled-project-merge-gate-readback

- 类型：`merge-gate`
- 结果：`passed`
- 非空输出行数：`5`

#### 输入

```text
回读 rd-guide Project 238 的平台设置与 MR !39 Pipeline 10880，并用 v0.3.0 两层门禁检查验证准入证据。
```

#### 读取文件

- `docs/playbooks/gitlab-collaboration-onboarding.md`
- `references/execution-contract.md`
- `scripts/self_check.py`
- `tests/fixtures/operation-evidence-v0.3.0.json`

#### 输出

```text
当前目标：验证流水线内容可信与平台强制成功两层门禁同时成立。

已确认事实：Project 238 回读 `only_allow_merge_if_pipeline_succeeds=true`；Pipeline 10880/job 47300 success，job 执行 control-plane validator、仓级 unittest 与全部 Skill checks；v0.3.0 `--evidence` 校验通过。

停止条件：流水线内容未完成 review、项目设置未回读或实际值不为 true 时，不得宣称已具备可信 CI 准入。

未执行动作：未修改项目设置、分支保护、Pipeline 或 MR 合并状态。

下一步：每次以 CI 作为 MR 准入证据时重新冻结项目设置回读和内容充分性判断。
```

### 10. controlled-mr39-squash-result-readback

- 类型：`merge-result`
- 结果：`passed`
- 非空输出行数：`5`

#### 输入

```text
对已合入的 rd-guide MR !39 同时回读项目 squash_option、MR squash 字段与 squash_commit_sha，并用 v0.3.0 检查实际结果。
```

#### 读取文件

- `docs/playbooks/gitlab-collaboration-onboarding.md`
- `references/execution-contract.md`
- `scripts/self_check.py`
- `tests/fixtures/operation-evidence-v0.3.0.json`

#### 输出

```text
当前目标：验证项目默认、单个 MR 字段与实际 squash 结果三面一致性。

已确认事实：rd-guide `squash_option=default_off`，MR !39 `squash=true`，实际 `squash_commit_sha=05b343a6dd4dab159117fee917ba62e8ba3acaa1`；v0.3.0 `--evidence` 按预期 squash 校验通过。

停止条件：只读取 merged 状态、未比较项目/MR 设置，或 squash_commit_sha 有无与预期不一致时 fail closed。

未执行动作：未合并 MR、未改写 main 历史、未修改项目 squash 设置或安装副本。

下一步：后续合并仍由人执行，Agent 仅在合并后回读并报告实际结果。
```
