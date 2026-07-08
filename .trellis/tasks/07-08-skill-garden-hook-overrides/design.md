# 支持 skill-garden hook override 设计

## Overview

本任务把 hook override 作为 flower-trellis 强化包叠加链路的一等能力。目录源头放在
skill-garden,同步进 `enhancements/`,再由 `applyEnhancements()` 全装路径应用到目标项目
已有平台 hook 文件。

首个 override 是 shared `inject-workflow-state.py`:当 Codex 项目已注册主
`SessionStart` hook 时,no_task 场景不再注入 `<trellis-bootstrap>`;未注册时保留旧兜底。

## Source / Snapshot Layout

源目录:

```text
vendor/skill-garden/.trellis/0.6/overrides/hooks/shared/inject-workflow-state.py
```

快照目录:

```text
enhancements/0.6/overrides/hooks/shared/inject-workflow-state.py
```

`scripts/sync-enhancements.mjs` 当前已递归复制整个 `overrides/` 目录,因此文件同步路径天然可用。
需要补充的是 manifest 统计字段,让人工核对时能看到 hook override 数量和文件列表。

## Runtime Injection

新增模块:

```text
src/lib/hook-override-inject.js
```

职责:

- 读取 `variantDir/overrides/hooks/shared/` 下的 override 文件。
- 将 shared hook override 应用到目标项目已有平台 hook 文件。
- 首批支持:
  - `inject-workflow-state.py` -> `.codex/hooks/inject-workflow-state.py`
  - `inject-workflow-state.py` -> `.claude/hooks/inject-workflow-state.py`
- 目标文件不存在时跳过,不创建平台目录或 hook 文件。
- 写入前调用 `preserveFirstBackup(target, targetFile)`。
- 内容一致时不写盘,也不刷新备份。

`applyEnhancements()` 在全装且没有 `--skills` 过滤时调用 hook override 注入。带 `--skills`
的精细安装不应用 hook override,避免用户只安装某个 skill 时意外覆盖平台 hook。

## Codex Bootstrap Condition

在 override 版 `inject-workflow-state.py` 中新增函数:

```python
def _codex_has_trellis_session_start(root: Path) -> bool:
    ...
```

判断规则:

- 读取 `root / ".codex" / "hooks.json"`。
- `hooks.SessionStart` 必须是列表。
- 任意 hook command 包含 `.codex/hooks/session-start.py`。
- `root / ".codex" / "hooks" / "session-start.py"` 必须存在。
- 读取失败、JSON 损坏、字段类型不符均返回 `False`。

注入逻辑:

```python
if platform == "codex":
    parts = []
    if task is None and not _codex_has_trellis_session_start(root):
        parts.append(CODEX_NO_TASK_BOOTSTRAP_NOTICE)
    parts.append(_codex_mode_banner(config))
    parts.append(breadcrumb)
    breadcrumb = "\n\n".join(parts)
```

这样纯上游 Codex 项目仍有 `trellis-start` 兜底;flower-managed Codex 项目由主
`SessionStart` hook 负责启动上下文,不会每轮重复提示。

## Data Flow

```text
vendor/skill-garden/.trellis/0.6/overrides/hooks/shared/*.py
  -> npm run sync
enhancements/0.6/overrides/hooks/shared/*.py
  -> flower-trellis init/update 全装
src/lib/hook-override-inject.js
  -> .codex/hooks/*.py / .claude/hooks/*.py
```

## Compatibility

- 不修改 `node_modules/@mindfoldhq/trellis`。
- 不删除 `trellis-start` skill。
- 不改变 `.codex/hooks.json` 的 SessionStart 合并逻辑;仍由 `codex-tweaks.js` 负责。
- 不改变 `.claude/settings.json` 的 startup 更新检查 hook 合并逻辑;仍由 `claude-tweaks.js` 负责。
- 不把 hook override 路径写入 `.trellis/.flower-manifest.json` 的 `paths`,避免升级清理误删
  Trellis 上游原生 hook 文件。hook override 是覆盖已有文件,不是 flower 自有资产。

## Validation Strategy

- `node --check` 覆盖新增 JS 模块和改动模块。
- `python3 -m py_compile` 覆盖 override 源、快照和 dogfood hook 副本。
- 构造临时目标:
  - 有 Codex 主 SessionStart:运行 no_task hook,断言无 `<trellis-bootstrap>`。
  - 无 Codex 主 SessionStart:运行 no_task hook,断言有 `<trellis-bootstrap>`。
- 重复运行 hook override 注入,确认第二次 unchanged,不重复备份。
- `git diff --check`。

## Risks

- shared hook override 复制到多个平台后,未来 Trellis 上游 shared hook 改动可能被整文件覆盖。
  缓解:该机制只在 skill-garden 明确提供 override 文件时启用,且 PRD 限定首批场景。
- 判断 hook 注册不等于证明当前会话已运行 SessionStart。此处接受该弱判断,因为目标只是避免
  每轮重复提示,不是安全门禁。
