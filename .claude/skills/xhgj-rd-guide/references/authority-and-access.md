# Authority 与访问边界

仅在请求涉及权威、来源、访问、披露、事实截止或冲突时读取本文件。

## 判断顺序

1. 从冲突来源的 frontmatter 或 `catalog/sources.yaml` 取得双方的 `authority`、`owner`、`scope`、`role`、`reference_mode`、locator 和版本锚点。
2. 在 `governance/authority-registry.yaml` 核对双方 authority、负责人、权威范围和 feedback locator。
3. 对同一 `authority + scope` 检查是否只有一个 `canonical`。
4. 判断当前任务是否依赖来源详情，以及来源是否可达、获准披露并满足事实截止。
5. 判断登记入口是否可达、现有 issue 是否明确承接当前冲突范围，再按下表继续或停止；不自行比较“更新”“更易访问”来替责任方裁决。

| 情况 | 动作 |
| --- | --- |
| `catalog-only` | 使用审核摘要；详情不是当前动作的必要输入 |
| `optional-detail` 不可达 | 有限继续，明确列出未读取详情和结论边界 |
| `required-source` 不可达 | 停止依赖该来源的动作，给出访问申请方式、维护负责人和反馈入口 |
| authority 声明冲突 | 停止，按下方“冲突反馈路由”处理双方负责人、适用范围和反馈入口 |
| 双 canonical | 停止，不自行选版本，按下方“冲突反馈路由”处理 |
| 事实截止不足 | 正确性依赖最新事实时重新读取或停止；否则标明采用版本 |
| 无权限但目录允许摘要 | 只使用 `restricted-summary` 中获准内容，不反推受限事实 |

## 冲突反馈路由

1. 解析双方规则 locator、负责人、权威范围、事实截止和 feedback locator。
2. 若存在明确、可达且范围匹配的现有 issue，路由到该 issue。只有 Registry 明确解析到 `issue:1` 且 rd-guide 控制面范围确实匹配时，才输出 `issue:1`。
3. 若双方入口不同，同时列出双方负责人和反馈入口，请双方共同校准，不擅自选择其中一方。
4. 若没有合适 issue、入口不可达，或现有 issue 不承接当前冲突，先建议通过双方可用的线下沟通、群聊、单聊或其它轻量方式完成初步校准。无法达成一致或结论需要正式留痕时，再建议在承担最终决定的仓库创建专门 issue。
5. 专门 issue 至少记录双方规则 locator、各自适用范围、事实截止、冲突内容、参与负责人和待裁决问题。
6. Skill 只提供路由与建议，不发送消息、不创建 issue，也不执行其它 GitLab 动作。
7. 若问题是 `xhgj-rd-guide` 自身错误或路由缺口，使用 `contract.yaml` 登记的 Skill feedback 入口 `issue:3`，不混入内容 authority 冲突入口。

## Locator 输出完整性

- authority 冲突或双 canonical：读取并在“路由结果”明确列出 `catalog/sources.yaml` 与 `governance/authority-registry.yaml`；未拿到具体条目时说明缺失，不用抽象结论替代 locator。
- `catalog-only`：在“路由结果”回显 Source Catalog 实际采用的稳定 locator，并明确该 projection 不能成为唯一执行依据。
- `optional-detail`：用户明确要求详情时读取钉定详情；若当前执行边界只允许定位而不能读取，必须在“未读取边界”和“下一步”中分别说明，不能写成详情已验证。

## 面向用户的表达

先写中文职责含义，只有定位机器字段确有帮助时才括号保留术语：

| 机器术语 | 用户表达 |
| --- | --- |
| `authority` | 对该规则范围承担最终解释责任的负责人或团队 |
| `owner` | 日常维护负责人或负责团队 |
| `feedback` | 反馈入口 |
| `scope` | 规则适用范围 |
| `canonical` | 当前唯一有效版本或正式真源 |
| `required-source` | 完成本次动作所必需的原始资料 |

## 项目局部规则

- `.trellis/spec/` 的 authority 属于当前业务仓的局部规则维护者，不因被本 Skill 路由而转移到 rd-guide。
- 只读取当前 checkout 中与任务直接相关的 spec；不扫描或同步外部业务系统。
- 局部规则与组织级 active `must` 冲突时停止，列出双方规则地址，并按双方登记的负责人和反馈入口完成校准。
