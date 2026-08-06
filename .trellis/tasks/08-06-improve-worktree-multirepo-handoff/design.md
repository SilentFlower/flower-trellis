# Design - Worktree 多仓基线确认与会话交接

## Overview

把现有一次性写入的 `worktree create` 拆成同一命令的两个显式阶段：

```text
create（无 --yes）
  -> 只读解析来源仓库、默认/选定 base、目标、submodule、dirty 和本地状态转移计划
  -> status=confirmation-required
  -> 用户确认或改选，记录 plan fingerprint

create --yes --plan-fingerprint <fingerprint>
  -> 重新校验同一组参数
  -> fingerprint 不同则零写返回 create-plan-changed
  -> git worktree add -b
  -> target-local readiness 和 route 偏好 allowlist 继承
  -> task.py create --no-start
  -> registry
  -> 新 workspace 会话 handoff
```

CLI 不在终端内维护隐藏的交互状态。AI Skill 持有“最新预检结果是否已被用户确认”的对话状态；脚本调用方用显式 `--yes` 表示已经完成外部确认。

## Engine Contract

### Create Selection

新增内部只读规划函数，负责：

1. 解析 `--source` 到来源根 worktree。
2. 获取仓库名称、路径、当前分支和 HEAD。
3. 将缺省 base 解析为当前分支；detached HEAD 使用 `HEAD`。
4. 验证 target 不存在、新分支不存在、base 可解析为 commit。
5. 验证选定 base 包含目标 `task.py`，尽量在写入前发现旧基线问题。
6. 从选定 commit 的 tree 读取 mode `160000` gitlink，生成 submodule 摘要。
7. 使用 Git porcelain `-z` 读取来源根仓 tracked dirty、staged、untracked 和 conflict 摘要。
8. 解析来源开发者和 route 偏好，生成严格 allowlist 的本地状态转移计划。
9. 对稳定 DTO 计算 SHA-256 fingerprint，供真实创建校验最新确认。

计划 DTO 保留现有常用顶层字段，并增加结构化身份：

```json
{
  "status": "confirmation-required",
  "changed": false,
  "requiresConfirmation": true,
  "source": {
    "repository": "srm",
    "root": "/root/project/srm",
    "branch": "feature/scp-sso-integration",
    "head": "<40-sha>",
    "workingTree": {
      "clean": false,
      "includedInBase": false,
      "entries": [{ "status": " M", "path": ".flower/plugins.json" }]
    }
  },
  "base": {
    "requested": null,
    "ref": "feature/scp-sso-integration",
    "resolvedCommit": "<40-sha>",
    "defaultedFromCurrentBranch": true
  },
  "target": {
    "root": "/root/project/srm-feature",
    "branch": "feature/example"
  },
  "repositories": [
    {
      "name": "srm",
      "path": ".",
      "kind": "root",
      "selected": true
    },
    {
      "name": "srm-server",
      "path": "srm-server",
      "kind": "submodule",
      "selected": false,
      "gitlinkCommit": "<40-sha>",
      "initialized": true,
      "branch": "hotfix/example",
      "head": "<40-sha>"
    }
  ],
  "localStateTransfer": {
    "developer": { "action": "initialized", "name": "silentflower" },
    "routePreferences": {
      "action": "inherited",
      "values": { "implement": "inline", "check": "check-all-inline" }
    },
    "initialized": ["session-runtime"],
    "notInherited": [
      "session-state",
      "auto-loop",
      "flower-local-state",
      "platform-local-settings",
      "cache-and-transaction-state"
    ]
  },
  "confirmation": {
    "flag": "--yes",
    "fingerprint": "<sha256>"
  }
}
```

### Plan Fingerprint

fingerprint 输入固定包含：来源 Git 身份、当前 branch/HEAD、选定 base commit、目标 branch/path、task 参数、submodule 摘要、来源根仓 dirty 摘要和规范化 route 偏好转移结果。JSON 使用稳定 key 排序和 UTF-8 编码。

真实 `create --yes` 必须同时接收 `--plan-fingerprint`，重新生成计划后常量时间不作要求，但必须逐字比较 fingerprint。不同返回 `create-plan-changed` 和新的只读 plan，且不得创建 branch、目标目录、task、runtime 或 registry。

### Submodule Inventory

选定 base 的 gitlink 是未来 worktree 实际检出的真相，因此用 `git ls-tree -r -z <resolvedCommit>` 读取 mode `160000` 条目，而不是只读取当前工作目录 `.gitmodules`。

对来源工作区已初始化的同路径 submodule，再读取其当前 branch/HEAD，并比较是否等于 gitlink commit。该信息只用于说明，不参与根 worktree 创建，也不推断子仓目标 base。

配置的独立 Git package 由 Skill 通过 `get_context.py --mode packages` 补充展示；engine 不复制 Trellis package 配置解析逻辑。

### Local State Transfer

route 偏好只处理 `.trellis/.route-prefs.tmp` 的两个稳定字段：

- `implement`: `inline` / `subagent`。
- `check`: `check-all-inline` / `check-all-subagent`。

读取时拒绝 symlink 和非普通文件，忽略未知行与非法值；写入时只按固定字段顺序生成规范化文本，不复制来源原字节。`create` 只有在解析后的目标开发者与来源 `.developer` 相同时才标记 `inherited`，否则标记 `notInherited` 并给出稳定 reason。

`prepare` 新增显式 `--inherit-route-prefs`。Flower facade 仅在该 flag 出现时把当前控制 worktree 作为 Python engine 的 `--source`；engine 要求来源与目标 canonical `gitCommonDir` 相同、开发者一致。目标 `.route-prefs.tmp` 已存在时保留并返回 `preserved`；来源缺失或无合法值时正常完成 prepare，但报告 `notInherited`。

session runtime、current task、untracked flow、pre-check、auto-loop、Ralph、agent 临时态、`.flower/state.json`、`.claude/settings.local.json`、cache、transaction 和 backup 都不读取、不复制。目标 session 目录仍为空创建；Flower ownership state 后续由目标自己的 Flower 生命周期重建。

## CLI Facade

- `--yes` 加入 worktree boolean options，只允许 `create`。
- `--plan-fingerprint` 加入 create value options，并在 `--yes` 时必填。
- `--inherit-route-prefs` 只允许 `prepare`；facade 为该路径注入当前控制 worktree `--source`。
- 人类输出按“来源仓库 -> 基线 -> 目标 -> 子仓 -> 下一步”展示。
- 人类输出在目标后展示来源 dirty 不会进入目标，以及 route 偏好继承/跳过和其它不继承类别。
- `confirmation-required` 正常返回退出码 0，因为预检成功且未发生错误。
- JSON 原样输出稳定 DTO，供 AI Skill 和自动化读取。
- 顶层 help 标明 `create` 默认预检、`--yes` 才写入。

## Skill Workflow

新建并行任务时：

1. 获取来源根仓库和 Trellis package context。
2. 运行不带 `--yes` 的 `worktree create ... --json`。
3. 明确展示根仓库名称/路径、当前分支、默认或改选 base、解析 commit、新分支和目标路径。
4. harness 模式下把根仓与受影响子仓分开列出，并声明根创建不会操作子仓分支。
5. 只问一个选择：确认当前计划、提供其他 base/ref，或取消。
6. 改选后重新预检；确认后使用最新 fingerprint 追加 `--yes --plan-fingerprint`。
7. 若返回 `create-plan-changed`，展示新计划并重新确认。
8. 创建成功后停止旧会话的任务规划，引导用户在目标 workspace root/cwd 启动新会话。

## Handoff Semantics

`handoff` 增加：

- `cwd`: 目标目录。
- `workspaceRoot`: 同一目标目录。
- `requiresNewSession`: `true`。
- `reason`: SessionStart、Trellis runtime、Git root 和平台入口需要重新绑定。

这里的“新会话”是上下文重初始化要求，不是强制用户在 shell 手动 `cd`。客户端如果能打开目标目录并重新执行 SessionStart，也视为完成 handoff。

## Compatibility And Rollback

- 真实创建仍复用现有锁、回滚和 registry 流程，避免重写成熟事务逻辑。
- 新增 plan 函数后，真实 `_create` 先调用同一 plan，防止预检和写路径使用不同校验。
- route 偏好写入位于新 worktree local readiness 之后、task 创建之前；后续失败沿用整 worktree 回滚，不留下目标文件。
- 回滚时移除本轮 branch/worktree/task/registry 的规则保持不变。
- 若该安全收紧需要回滚，可恢复“无 `--yes` 直接写入”；DTO 扩展字段本身可以保留，不影响旧消费者。
