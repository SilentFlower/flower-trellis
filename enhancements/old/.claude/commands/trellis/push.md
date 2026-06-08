# Push — 提交并推送（可选合并到目标分支）

一键完成 commit → push → 可选 merge 到目标分支（通常是测试线）→ push 目标分支 → 切回。

支持多仓库（frontend / backend），merge 目标分支记录在 `.trellis/config.yaml` 的 `packages.<name>.merge_target` 中。

---

## 配置

目标分支存储在 `.trellis/config.yaml` 的 packages 配置中：

```yaml
packages:
  frontend:
    path: iqs-front-human
    git: true
    merge_target: test      # 首次 push 时询问后自动写入
  backend:
    path: iqs
    git: true
    merge_target: test
```

> 首次运行时如果 `merge_target` 不存在，会在 merge 步骤询问目标分支并回写到 `config.yaml`。
> 如需修改，直接编辑 `config.yaml` 或使用 `/trellis:push --reconfigure`。

---

## 执行步骤

### Step 0: 读取配置

读取 `.trellis/config.yaml` 中的 `packages` 配置，识别所有 `git: true` 的仓库及其 `merge_target`（如果已配置）。

### Step 1: 检测变更

读取 `.trellis/config.yaml` 中的 `packages` 配置，对每个 git 仓库检测变更：

```bash
# 对每个 package
cd <package_path>
git status --short
```

列出有变更的仓库。如果所有仓库都没有变更，提示用户并终止。

如果只有部分仓库有变更，只处理有变更的仓库。

### Step 2: 逐仓库处理

对每个有变更的仓库，依次执行以下操作：

#### 2.1 展示变更摘要

```bash
cd <package_path>
git diff --stat
git diff --name-only
```

#### 2.2 暂存文件

展示要暂存的文件列表，**获得用户确认后**再暂存。

```bash
git add <具体文件列表>
```

> **[!] 禁止使用 `git add -A` 或 `git add .`**
> 必须明确列出文件，避免误提交敏感文件（.env、credentials 等）。

#### 2.3 生成 commit message 并提交

分析变更内容，生成符合项目风格的 commit message：
- 读取最近 5 条 commit 参考风格
- 类型前缀：`feat` / `fix` / `chore` / `refactor` 等
- 简短描述变更内容
- 使用中文描述

```bash
git commit -m "<type>(<scope>): <description>"
```

#### 2.4 Push 当前分支

```bash
git push origin <current_branch>
```

如果远程没有该分支，使用 `-u` 建立跟踪：

```bash
git push -u origin <current_branch>
```

#### 2.5 询问是否 Merge 到目标分支（可选）

Push 完成后，检查该 package 是否已配置 `merge_target`：

**已配置 `merge_target`**：

```markdown
<package> 已推送到 <current_branch>。是否合并到 <merge_target>？

1. 是，合并到 <merge_target>
2. 否，跳过
```

**未配置 `merge_target`（首次）**：

```markdown
<package> 已推送到 <current_branch>。是否需要合并到其他分支（如测试线）？

1. 是，请输入目标分支名
2. 否，跳过
```

如果用户输入了目标分支名，**将其回写到 `.trellis/config.yaml`** 对应 package 的 `merge_target` 字段，下次自动使用。

**如果用户选择合并**：

```bash
# 切换到目标分支并拉取最新
git checkout <target_branch>
git pull origin <target_branch>

# 合并当前开发分支
git merge <current_branch> --no-edit

# Push 目标分支
git push origin <target_branch>

# 切回开发分支
git checkout <current_branch>
```

> **[!] 如果 merge 出现冲突：**
> 1. 立即停止，展示冲突文件列表
> 2. 询问用户：手动解决 / 中止 merge
> 3. **绝对不能** `git merge --abort` 后静默跳过

**如果用户选择跳过**：直接进入下一个仓库或输出结果。

### Step 3: 输出结果

```markdown
## Push 结果

| 仓库 | 分支 | 目标 | commit | 状态 |
|------|------|------|--------|------|
| frontend | v1.3 | test | abc1234 feat(...): ... | ✅ 已合并 |
| backend | v1.3 | test | def5678 fix(...): ... | ⏭️ 跳过合并 |

所有变更已推送到目标分支。
```

---

## 参数

| 参数 | 说明 | 示例 |
|------|------|------|
| （无参数） | 自动检测所有有变更的仓库并处理 | `/trellis:push` |
| `--only <package>` | 只处理指定仓库 | `/trellis:push --only frontend` |
| `--reconfigure` | 重新配置目标分支 | `/trellis:push --reconfigure` |
| `--target <branch>` | 临时指定目标分支（不修改配置） | `/trellis:push --target hotfix` |

---

## 安全机制

1. **暂存确认** — 每个仓库暂存前展示文件列表，用户确认
2. **commit message 确认** — 展示生成的 message，用户可修改
3. **merge 冲突处理** — 冲突时暂停，不静默跳过
4. **不碰主分支** — 如果目标分支是 `master` / `main`，额外警告确认
5. **不使用 force push** — 始终使用普通 push

---

## 反模式（避免）

- ❌ `git add -A`（可能误提交敏感文件）
- ❌ merge 冲突后静默 abort（用户需要知道）
- ❌ 未经确认直接 commit（必须让用户看到 message）
- ❌ force push 到目标分支
- ❌ 在目标分支上直接开发（只 merge，不在目标分支上改代码）
