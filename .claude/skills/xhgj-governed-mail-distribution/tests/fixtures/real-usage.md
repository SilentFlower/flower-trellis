# xhgj-governed-mail-distribution 真实使用证据

> 由 JSON 生成，请勿手工编辑。
> 机器 canonical：`tests/fixtures/real-usage.json`
> 规范化内容 SHA-256：`b1d454eaaa404fbfebabe4a7e2acb078311f7a52e6eb5675ff766f5c6ec3eaac`

## 元数据

- Skill 版本：`0.2.2`
- 客户端：Claude Code maintainer-side controlled installation, client admission and one real controlled delivery on the owner workstation; session f0802b6c-7c0d-4fe5-a86d-186e40c09201
- 环境：Claude Code on Windows following docs/playbooks/skill-controlled-installation.md and docs/playbooks/enterprise-mail-delivery.md: the install source was frozen twice, first at rd-guide main 4a534fec261678bace535015c6f8b048ebde542b for 0.2.0 and then at 2b54512 for 0.2.1, across the same three-layer topology (~/.agents entity, ~/.claude per-Skill junction, ~/.codex independent copy) with staging and backup kept outside the client discovery roots. The final round additionally exercised one real controlled mail delivery through the installed copy over enterprise SMTP with a post-send readback; credentials were read from runtime environment variables only and no recipient address, payload, attachment, receipt or RFC identifier is recorded here
- 事实截止：`2026-08-05`
- 状态：`passed`

## 实战元数据

- 工具：Claude Code
- 客户端版本：2.1.220
- 模型精确快照：claude-opus-5
- 会话 ID：f0802b6c-7c0d-4fe5-a86d-186e40c09201
- 采集时间：2026-08-05T23:10:00+08:00
- 采集方式：maintainer-side-controlled-installation-and-consumer-path-delivery
- 操作系统：Windows
- Shell：Git Bash
- Node 版本：不可得：`not-applicable`
- 浏览器版本：不可得：`not-applicable`
- 资产版本：0.2.2

## Review

- Agent 状态：`passed`
- Agent 摘要：本轮在维护侧受控安装与客户端准入证据之上补齐消费路径：0.2.1 受控安装后三入口与 canonical 零落差，并在安装副本上完成一次真实正式邮件投递，SMTP 接受、零拒收、返回 RFC Message-ID 且收件端回读一致；放行经 owner 两次独立授权，未使用 DWS 投递，未接受宽权限回退
- Maintainer 状态：`passed`
- Maintainer 摘要：owner 已 review 本轮受控安装与真实受控投递结果并确认通过，据此把 real_usage 推进到 passed，并作为 Migration Ledger 的 consumer-path 证据。本证据仍不覆盖 ChatGPT Codex 在 0.2.0 及以上版本的客户端重验；review 通过只针对真实使用结果，不改变 contract.status=incubating，不构成宣发、生效或任何后续发送的预授权，每一次真实发送仍需 owner 单独显式授权

## 场景

### 1. source-preflight-freeze

- 类型：`maintainer-source-preflight`
- 结果：`passed`
- 非空输出行数：`1`

#### 输入

```text
按 Playbook 第 2、3 节冻结安装 source 并做写前预检。
```

#### 读取文件

- `repo:docs/playbooks/skill-controlled-installation.md@4a534fec`
- `skills/xhgj-governed-mail-distribution/contract.yaml`
- `skills/xhgj-governed-mail-distribution/scripts/self_check.py`

#### 输出

```text
把本地默认分支 rebase 到 origin/main 后冻结 source commit=4a534fec261678bace535015c6f8b048ebde542b，并在该 source copy 上执行 self_check.py --expect-version 0.2.0 与完整离线套件：自检返回 version=0.2.0、status=incubating、routing_cases=5、preflight_cases=22，unittest 49 项全绿。冻结表登记 Skill、版本、status=incubating 的受控范围、工作站、三层拓扑与回滚路径。
```

### 2. installed-copy-baseline-classification

- 类型：`maintainer-baseline-classification`
- 结果：`passed`
- 非空输出行数：`1`

#### 输入

```text
按 Playbook 第 5 节先比较三个安装副本，并用冻结基线判定差异属于版本升级还是本地个性化。
```

#### 读取文件

- `repo:docs/playbooks/skill-controlled-installation.md@4a534fec`
- `skills/xhgj-governed-mail-distribution/scripts/self_check.py`

#### 输出

```text
0.2.0 source 对 ~/.agents、~/.claude、~/.codex 三个入口 --compare 报出同一组 11 个受保护路径差异且 installed=0.1.0；随后从 commit 63b0150 导出 0.1.0 完整 Skill 目录到发现根之外的 D:/tmp/gmd-baseline-0.1.0，用该版本自己的 self_check.py --compare 逐个比对，三个副本均返回 no-differences，因此归类为纯版本升级、无本地个性化，允许继续。
```

### 3. staging-and-upgrade-switch

- 类型：`maintainer-controlled-installation`
- 结果：`passed`
- 非空输出行数：`1`

#### 输入

```text
按 Playbook 第 6、8、8.1 节对两个物理目标串行执行 staging、切换与 junction 处理。
```

#### 读取文件

- `repo:docs/playbooks/skill-controlled-installation.md@4a534fec`
- `skills/xhgj-governed-mail-distribution/contract.yaml`

#### 输出

```text
对 ~/.agents 与 ~/.codex 串行执行：staging 建在各自发现根之外的 .skill-install-operations 下，三连验证（staging 自检 expect-version 0.2.0、49 项 unittest、source --compare no-differences）全过后才切换；旧 0.1.0 副本 Move 到同一 operation 目录的 backup 而非删除，切换失败路径保留把 backup 移回的回滚。~/.claude 仅做验证：根目录仍是普通目录，逐 Skill 条目 LinkType=Junction 且 target 精确等于 ~/.agents 实体，未重建或替换。首轮因 PowerShell ConvertFrom-Json 读取契约失败中止于切换之前，目标副本未被改动，改用标准库剥离注释行后重跑，中止产生的 staging 目录已单独清理。
```

### 4. post-install-three-entry-verification

- 类型：`maintainer-post-install-verification`
- 结果：`passed`
- 非空输出行数：`1`

#### 输入

```text
按 Playbook 第 9 节从三个入口逐一验证安装生效。
```

#### 读取文件

- `repo:docs/playbooks/skill-controlled-installation.md@4a534fec`
- `skills/xhgj-governed-mail-distribution/scripts/self_check.py`

#### 输出

```text
~/.agents、~/.claude、~/.codex 三个入口逐一执行安装副本自检 --expect-version 0.2.0、各自 tests 目录 49 项 unittest、以及 source 对该入口的 --compare：全部通过且 compare 均为 no-differences。.claude 入口即使指向 .agents 也单独执行，.codex 未用 junction 结果替代。
```

### 5. client-admission-probes

- 类型：`client-admission`
- 结果：`passed`
- 非空输出行数：`1`

#### 输入

```text
在安装副本上对客户端做 discovery、routing、constraints 三层只读行为验证。
```

#### 读取文件

- `skills/xhgj-governed-mail-distribution/tests/fixtures/real-usage-0.2.0-claude-code.json`
- `skills/xhgj-governed-mail-distribution/tests/fixtures/real-usage-0.1.0-codex.json`

#### 输出

```text
Claude Code 三层全部通过并冻结为 tests/fixtures/real-usage-0.2.0-claude-code.json，其中 constraints 层针对 0.2.0 新增的放行时序门禁与 DWS 投递禁令均 fail closed 并引用具体条款。ChatGPT Codex 在同一工作站的 0.2.0 重验未能执行：codex-cli 0.146.0 以 --sandbox read-only 运行时，Windows sandbox runner 在 SpawnChild 阶段以 CreateProcessAsUserW error 1920 失败，根因是本机 pwsh.exe 为 WindowsApps 执行别名桩且未安装 PowerShell 7，受限令牌无法解析该别名。按 Playbook 未接受更宽权限回退作为等价结果，Codex 客户端仍以 0.1.0 冻结证据为准，该缺口保留为开放项。
```

### 6. installed-copy-0-2-1-upgrade

- 类型：`maintainer-controlled-installation`
- 结果：`passed`
- 非空输出行数：`1`

#### 输入

```text
0.2.1 合入 main 后按同一 Playbook 再走一轮受控安装，消除安装副本与 canonical 的版本落差。
```

#### 读取文件

- `repo:docs/playbooks/skill-controlled-installation.md@2b54512`
- `skills/xhgj-governed-mail-distribution/contract.yaml`

#### 输出

```text
source 冻结在 0.2.1 合入后的 main commit=2b54512（非 squash 合入，保留 Ledger 锚点），Skill 目录树 hash=f663a4f015252af2cb0fae9b2c6010273bdb0d55。~/.agents 与 ~/.codex 两个物理目标串行执行 staging 三连验证后切换，旧 0.2.0 副本 Move 到各自 .skill-install-operations 下的 backup 而非删除；~/.claude 仍只做 junction 验证。切换后三个入口版本均由 0.2.0 迁移到 0.2.1，各自独立执行 --expect-version 0.2.1 与 50 项离线套件全部通过，source 对三个入口的 --compare 均为 no-differences，本机与 canonical 零落差。
```

### 7. consumer-path-controlled-delivery

- 类型：`consumer-path-delivery`
- 结果：`passed`
- 非空输出行数：`1`

#### 输入

```text
在零落差的安装副本上完成一次真实正式邮件投递，作为 Migration Ledger 的 consumer-path 证据。
```

#### 读取文件

- `repo:docs/playbooks/enterprise-mail-delivery.md@2b54512`
- `skills/xhgj-governed-mail-distribution/references/mail-plan-contract.md`
- `skills/xhgj-governed-mail-distribution/scripts/preflight.py`

#### 输出

```text
全程走安装副本而非仓内 source：先按 mail plan 契约生成 send-ready 计划并通过 preflight 门禁，再执行自发自收 selftest 投递；owner review preview 与 selftest 结果后，单独给出针对正式受众的第二次显式放行授权，plan 的放行与 owner review 字段由 owner 决定、不由执行方预置，放行时间戳晚于 selftest 与 preview 并通过 0.2.0 新增的时序门禁。正式投递经企业 SMTP over SSL 被服务端接受，拒收数为 0 并返回 RFC Message-ID，随后在收件端回读到该邮件并核对主题与正文长度一致，投递结果不依赖内部 messageId 或草稿箱命中。凭据只从运行时环境变量读取，未打印、未落盘；真实收件地址、正文、附件、回执与 RFC 标识均不进入本仓。同日更早一轮曾在 owner 仅授权自发自收的前提下直接进入正式投递，owner 指出后本轮改为 selftest 与正式放行分两次授权：Skill 的放行门禁只校验时间戳时序，不判定授权覆盖的受众范围，该边界靠执行纪律兜底并已回流。
```
