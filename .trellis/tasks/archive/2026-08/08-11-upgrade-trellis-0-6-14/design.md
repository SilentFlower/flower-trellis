# Trellis 0.6.14 升级设计

## 1. Design Summary

本次采用“上游能力优先、Flower 差异局部合并”的升级方式：先以官方 `0.6.14` 全平台模板作为新 canonical baseline，再重放 Flower 的窄 Patch。直接冲突按两个根因修复，所有未发生 selector 冲突但与 Flower owner 相邻的上游改动通过最终产物断言保护。

不采用整文件覆盖，也不为 `0.6.12` 保留第二套新版 Patch。正常升级链负责先把项目迁到精确 `0.6.14`，required preflight 负责拒绝错误混用。

## 2. Ownership Boundaries

### 2.1 Upstream Trellis owns

- 平台模板、agent、command、Hook 基础实现和 configurator。
- shell-ticket 与环境会话身份解析。
- CodeBuddy/Qoder/Trae/ZCode 等平台检测、matcher 和 cwd fallback。
- `trellis mem` 的存储读取、压缩 turn 恢复和 Grok session parser。
- `<first-reply-notice>` 的基础组装与 SessionStart 输出机制。

### 2.2 Flower owns

- Flower update/self-update 提示、确认和升级后 Plugin 重放。
- Skill-Garden Patch compatibility、required preflight、conflict policy 和 provenance。
- Active Task 损坏状态保护、原子写入、明确 clear/fallback 结果。
- `trellis-route`、audit-only Check-All、auto-loop、untracked flow 和完成链。
- Task Brief 最终批准点、任务生命周期和 spec/push/finish-work owner。
- managed canonical、snapshot、compiled targets 与 dogfood 一致性。

## 3. Upstream Delta Map

| Upstream delta | Flower overlap | Merge strategy |
|---|---|---|
| `0.6.13` 将 shell ticket 扩到 Gemini、Qoder、CodeBuddy、Droid、Trae、ZCode | `active_task.py` 存在 Flower 状态完整性 Patch | 保留上游会话查找区域，只重放现有独立完整性 Patch，并增加组合测试 |
| SessionStart 新增 `get_update_hint()` relay 和 `<first-reply-notice>` | Flower 独占更新入口 | 删除 update hint relay，保留 notice 与其它 SessionStart 逻辑 |
| 平台 configurator 改为 `collect<Platform>Templates()` 单一来源 | Flower 覆盖 `trellis-meta` 平台 root 章节 | 重写管理内容并更新 baseline，不改 configurator 运行时 |
| `0.6.14` 调整 CodeBuddy/ZCode/Trae 检测优先级和 CodeBuddy cwd | shared Hook 相邻区域存在 Flower Patch | 不修改上游区域，增加最终产物与行为测试 |
| PreToolUse matcher 更新 | Flower 不直接拥有对应 settings | 自然继承并做 fixture 断言 |
| `trellis mem` 恢复压缩 turn，新增 Grok | Flower 投影 session-insight Skill | 继承 runtime，补齐 managed Skill 文档和 smoke test |

## 4. Patch Design

### 4.1 Session Context update boundary

当前 `scripts/session-context-update-boundary` 继续拥有 `.trellis/scripts/common/session_context.py` 的更新检查剥离，但 selector 改为匹配 `0.6.14` 的公开 `get_update_hint(repo_root, context_key)` 结构。

最终 `session_context.py` 必须：

- 不再暴露 Trellis 原生 update hint API。
- 保留 Git timeout、polyrepo 限制、上下文读取和本轮上游修复。
- 继续被 conflict policy 断言为 Flower update hook owner。

### 4.2 Shared SessionStart update relay

新增独立、局部 required Patch，覆盖上游实际安装的 9 份共享 SessionStart 副本：Claude、CodeBuddy、Cursor、Factory、Gemini、Kiro、Qoder、Trae、ZCode。

该 Patch 只移除：

- 对 `get_update_hint` 的导入或延迟解析。
- `_resolve_update_hint()` 等仅用于更新提示的 helper。
- 把上游更新文案传入 first-reply notice 的参数或分支。

该 Patch 必须保留：

- `<first-reply-notice>` 本体与其它 notice 内容。
- 平台检测、cwd fallback、session identity、workflow-state 和 pre-check 等相邻行为。
- 既有 Flower 的 Codex/Claude 独立 SessionStart Patch；多个 operation 通过明确顺序与 final hash 合并。

冲突断言同时检查“Flower 更新入口存在”和“上游原生 update relay 不存在”，避免 selector 成功但出现双提示或无提示。

### 4.3 Trellis Meta platform roots

更新 `trellis-meta-managed-platform-skill-roots` 的 baseline 和 content：

- 以 `collect<Platform>Templates()` 与 `writeTemplateMap` 描述当前 configurator 架构。
- 保留全 21 平台 root、共享 `.agents/skills` 的物理/逻辑平台区别和 Flower managed ownership。
- canonical 只维护一份内容，由 Patch 投影到所有适用平台；禁止逐平台手工漂移。

### 4.4 Active Task and platform hooks

不因版本升级重写 `active_task.py` 或 shared Hook 的整块内容。现有 selector 若仍命中，只增加组合测试；若 selector 因相邻上游代码变化失配，则以最小函数/语句块重定基线。

测试必须同时证明：

- 新 shell-ticket/env session identity 能找到当前上下文。
- corrupt/io_error 不会被降级为 missing。
- fallback 清理仍尊重上游新的 context key。
- CodeBuddy/ZCode/Trae 先按真实 vendor 平台识别，再考虑 `CLAUDE_PROJECT_DIR` 兼容别名。

### 4.5 Trellis memory

`@mindfoldhq/trellis-core` 的 memory 实现不做 Flower fork。通过精确依赖升级直接继承压缩恢复和 Grok reader；Flower 只在 managed `trellis-session-insight` 文档/平台清单处补齐 Grok，并用 smoke test 验证 CLI 可发现相关平台。OpenCode 保持未支持状态。

## 5. Version And Artifact Flow

```text
package.json/package-lock 0.6.14
  -> official all-platform fixture
  -> Skill-Garden required Patch preflight
  -> compiled-targets/0.6.14/full
  -> vendor canonical sync
  -> enhancements/0.6 snapshot
  -> Flower update dry-run / real replay
  -> current dogfood outputs
```

- `compatibility.json.testedVersions` 只在完整 fixture、Patch 和回归验证通过后保留 `0.6.14`。
- `compiled-targets/0.6.12` 由生成器替换，不手工保留双 baseline。
- `enhancements/MANIFEST.json` 继续记录 Skill-Garden source commit；发布快照必须与 submodule pin 一致。

## 6. Update And Rollback

### 6.1 Dry-run

普通跨版本 dry-run 使用最小 `0.6.12` 项目，在项目外沙箱执行真实 Trellis update 后运行 Plugin replay dry-run。来源项目的受管文件、`.flower` state、权限和哈希必须不变。

### 6.2 Real update failure

若 Trellis update 已完成而 Plugin replay、Patch conflict 或后处理失败，沿用现有受管快照补偿：恢复旧受管内容，删除本轮新增的受管路径，保留诊断和上游 backup。补偿不完整时返回非零并列出人工恢复路径。

### 6.3 Implementation rollback point

最小可回滚单位是“依赖/fixture + Skill-Garden canonical + Flower snapshot”三者整体。不得只回退 package 版本或只回退 snapshot，否则会形成 Patch baseline 与运行时版本分裂。

## 7. Validation Strategy

- 机械门禁：dependency tree、Patch targets、required preflight、conflict audit、compiled target check、snapshot check。
- 语义门禁：唯一更新入口、first-reply notice、active-task/session identity、平台 matcher/configurator、memory/Grok。
- 事务门禁：跨版本 dry-run 零写入、真实失败补偿、重复 Plugin replay 幂等。
- 全量门禁：Node/Python tests、ESM syntax、strict context budget、output templates、npm pack、双仓 diff check、dogfood canonical comparison。

## 8. Risks

- 最高风险是 SessionStart 更新提示重构：只修 `session_context.py` 会留下死代码或双更新入口。
- 中风险是 Active Task 相邻区域：Patch 可以机械命中，但仍可能遮蔽上游新 session identity。
- 中风险是多平台最终产物：同一根因会被 9 或 18 个平台副本放大，必须以 canonical 生成和集合断言控制。
- 低风险是 configurator API：隔离验证显示 Flower 使用的导出保持兼容，但仍需由 dependency/runtime tests 锁定。
