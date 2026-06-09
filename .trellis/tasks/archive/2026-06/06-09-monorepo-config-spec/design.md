# design.md — config.yaml 多仓库化与 spec 按包重组

> 配套 `prd.md`(决策见其 ADR-lite)。本文件聚焦技术边界、数据流与回滚。

## Technical Design

### 1. config.yaml packages 声明

```yaml
packages:
  flower-trellis:
    path: .
  skill-garden:
    path: vendor/skill-garden
    type: submodule
    git: true

default_package: flower-trellis
```

- **主包 `path: .`**:`get_packages_info` 读 `path="."`;因无 `git: true` / `type`,
  不进 `get_git_packages` 也不进 `get_submodule_packages`,故主仓 git 仍只由顶层 session
  context 展示一次,**不重复**。`_scan_spec_layers(spec_dir, "flower-trellis")` 扫
  `spec/flower-trellis/` 得 `['cli']`。
- **skill-garden**:`type: submodule` → PACKAGES 列表加 `(submodule)` 标签;`git: true` →
  经 `get_git_packages` → `_collect_package_git_info`,在 session context 输出
  `## GIT STATUS (skill-garden: vendor/skill-garden)` + 最近 5 条 commits。
  `_collect_package_git_info` 第 72 行 `(pkg_dir/.git).exists()` 对 submodule 的 `.git`
  **gitlink 文件**返回 True,可正常读取其分支/状态/log。
- **default_package**:`resolve_package` 在 task 无 `package` 时兜底到 `flower-trellis`,
  保证旧任务/无标注任务仍解析到主包 spec。

### 2. spec 路径重组

- 路径模型:单仓 `spec/<layer>/` → 多仓 `spec/<package>/<layer>/`(多一层)。
- 迁移:`spec/cli/`(layer,8 个 .md)整目录 → `spec/flower-trellis/cli/`。
- `git mv` 要求目标父目录已存在 → 先 `mkdir -p .trellis/spec/flower-trellis`。
- `spec/guides/` **原地不动**(`_scan_spec_layers` 显式排除 `guides`,始终共享)。
- spec 文件内部无 `spec/cli/` 自引用(实测),迁移零内容改动。

### 3. 引用同步

迁移后把硬编码 `spec/cli/` 改为 `spec/flower-trellis/cli/`(实路径)或保留 `spec/<package>/<layer>/`(泛例):
`task.py`(help 示例)、`workflow.md`、`trellis-meta/references/{task-system,spec-system,change-task-lifecycle}.md`
及 `.agents/` 同名镜像。

### 4. 兼容性

- **归档任务**:位于 `tasks/.archive/*`(或归档区),不参与 active spec 扫描;`package` 字段缺失无影响。
- **无 package 的活动任务**:`default_package` 兜底,行为与单仓等价(读主包 cli spec)。
- **guides**:共享层不变,所有任务仍读 `spec/guides/`。
- **不设 `session.spec_scope`**:`_resolve_scope_set` 返回 None → 全扫;skill-garden 无 spec,无噪音。

### 5. 数据流

```
config.packages 非空 → is_monorepo()=true
  ├─ get_packages_info → _scan_spec_layers(spec_dir,"flower-trellis")=['cli'] → PACKAGES section
  ├─ get_git_packages={skill-garden} → _collect_package_git_info → GIT STATUS(skill-garden) block
  └─ resolve_package(task.package or default_package) → spec/flower-trellis/cli 发现
trellis-before-dev:get_context --mode packages → cat spec/flower-trellis/cli/<layer>/index.md + spec/guides/index.md
```

## Rollout / Rollback

- **Rollout 顺序**:快照备份 → 改 config.yaml → `mkdir`+`git mv` → 改引用 → 全仓 grep 校验 → 实测四链路 → 提交。
- **Rollback**:对整个变更 commit `git revert`(config + `git mv` + 引用一并回退);或从迁移前快照恢复 `.trellis/spec` 与 `config.yaml`。

## 风险与对策

| 风险 | 对策 |
| --- | --- |
| `git mv` 因父目录不存在报错 | 先 `mkdir -p .trellis/spec/flower-trellis` |
| skill-garden 未检出时 `git: true` 报错 | `_collect_package_git_info` 对缺 `.git` 的包 `continue`,不报错(已实测逻辑) |
| 引用遗漏导致死链 | 提交前 `grep -rn "spec/cli"` 排除 backup/归档,确认零残留 |
| `path: .` 主包异常 | 无 `git:true`/`type`,不进 git/submodule 收集,仅参与 spec 扫描,安全 |
