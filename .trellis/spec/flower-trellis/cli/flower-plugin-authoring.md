# Flower Plugin Authoring And Marketplace CI

> 本规范定义 Flower Plugin v1 作者工具、内置作者 Skill、scaffold ownership 和 rd-guide Marketplace CI 审核契约。基础 schema/hash、GitLab 来源和 capability 真源分别以 [Flower Plugin Contracts](./flower-plugin-contracts.md)、[Flower Plugin GitLab Sources](./flower-plugin-gitlab.md) 和 [Flower Plugin Capability & Patch Runtime](./flower-plugin-capabilities.md) 为准。

## 1. Scope / Trigger

以下改动必须先读本规范：

- 修改 `src/plugin/authoring/**`、`flower/flower-plugin-author`、`plugin init` 或 `plugin validate`。
- 修改作者 scaffold 文件树、ownership 覆盖语义、checkout map、Marketplace CI JSON 或 integration CODEOWNERS 门禁。
- 为外部团队新增 Plugin/Skill/Marketplace 作者流程、GitHub 公共来源、Claude Code/Codex 接入或 rd-guide 注册模板。

作者层只能组合 P1-P4 公共实现；不得复制 schema、Resolver、canonical hash、capability 或 Patch Engine。

## 2. Signatures

```text
flower-trellis plugin init --id <source/plugin> --name <name>
  [--version <semver>] [--profile standard|integration] [--patches]
  [--marketplace --project <group/project> --subdir <path>
   --ref <vX.Y.Z|40-sha> --commit <40-sha>]
  [--force] [--non-interactive] [--json]

flower-trellis plugin validate [path]
  [--subject plugin|entry|marketplace] [--source-id <id>]
  [--checkout-map <json>] [--ci] [--json]

flower-trellis plugin source add <source-id>
  --type github --repo <owner/repository> [--ref <ref>] [--subdir <path>]
```

```js
scaffoldFlowerPlugin(projectRoot, options)
  -> {ok, subject, root, digest, files, marketplaceEntry}

validateAuthorPlugin(packageRoot, options) -> AuthorValidationResult
validateAuthorMarketplaceEntry(entry, options) -> AuthorValidationResult
validateAuthorMarketplace(marketplace, options) -> AuthorValidationResult
```

内置 `flower/flower-plugin-author` 是不依赖 Trellis 或 `flower/skill-garden` 的 standard Plugin，必须通过普通 builtin Provider 和 Runtime 投影。

## 3. Contracts

### Scaffold And Ownership

- 默认输出 `.flower-plugin/plugin.json`、`skills/<plugin>/SKILL.md` 和 `tests/plugin.test.js`；manifest 的 `content.skills` 使用 `{name,path,version,description?}` 对象 entry，`name` 为目标 Skill 名称，`path` 指向 `skills/<plugin>`，`version` 默认等于本次 Plugin 版本。`--marketplace` 额外输出根目录 `marketplace-entry.json`。
- 默认 profile 为 `standard` 且无 Patch。只有 `integration --patches` 生成声明式 insert 示例；不得生成 system、hook、adapter 或 lifecycle script。
- ID、SemVer、Marketplace source/ref/commit 必须先通过公共 validator。`name` 必须是单行文本，防止破坏 Skill YAML frontmatter。
- 相同输入 changed-only；生成内容不得包含时间戳、用户名或绝对路径。
- `.flower-plugin-scaffold.json` 是确定性的 ownership 摘要账本，记录每个受管相对路径的内容摘要。`--force` 只允许覆盖或删除“当前摘要仍等于账本摘要”的受管文件；账本缺失、损坏或摘要漂移时拒绝认领。
- 用户新增的非受管 Plugin 文件必须保留，并参与计划后的 canonical tree digest。摘要必须在写盘前以“现有安全文件树 + 计划覆盖/删除”预演得到，不能写后才发现不一致。

### Validate And Checkout Boundary

- `AuthorValidationResult` 稳定包含 `ok/subject/digest/issues/dependencies/capabilities/review`；issues 按 `path/code` 排序，且不得泄漏 checkout 绝对根或凭据。
- Plugin 校验复用 manifest、package reader、Resolver、capability policy 和外部 Patch catalog validator。
- Marketplace CI 的 checkout map key 为 `<source>/<plugin>@<version>`，value 为 `{"path":"checkouts/...","commit":"<40-sha>"}`。
- checkout path 只允许 CI `baseDir` 内 POSIX 相对路径；拒绝绝对路径、反斜杠、`.`/`..` 逃逸和父目录软链逃逸。
- ref 只允许 `v<version>`、`refs/tags/v<version>` 或完整 commit。ref 为完整 commit 时必须与 entry `commit` 相等；GitLab checkout map 的实际 commit 也必须与 entry 相等。
- `--ci` 禁止占位 commit、缺失 checkout 和隐式交互/授权；validator 本身不读取开发者 keyring、不访问网络。

### Integration Review Gate

- `review.required=true` 时，rd-guide CI 必须运行 `verify-integration-review.mjs`。
- `.flower-plugin/integration-review.json` 固定为：

```json
{
  "schemaVersion": 1,
  "profile": "integration",
  "marketplaceDigest": "sha256:<64-hex>"
}
```

- `marketplaceDigest` 必须等于本轮 validation JSON 的 digest。Marketplace 内容变化后必须同步更新 companion 文件。
- CODEOWNERS 保护 companion 路径，GitLab protected approval rule 要求 integration owner 批准；普通作者仅修改 entry 不能绕过该门禁。

### External Format And GitHub Guidance

- 内置 `flower-plugin-author` Skill 必须把 Flower 原生格式作为唯一 scaffold 输出；`plugin init` 不生成或反向导出 Claude Code/Codex manifest。
- `references/external-formats.md` 负责 Flower、Claude Code、Codex、skill-only 的检测入口、被动内容兼容矩阵、歧义选择和主动组件限制；`references/github-release.md` 负责公开仓库、默认/显式 ref、固定 commit、兼容预览和来源登记。
- Claude/Codex 已有仓库通过 `plugin source add --type github` 接入，必须先展示 `detectedFormat/entryPath/resolvedCommit/compatibility` 再持久化；多个入口要求显式选择，不能要求作者预先声明平台格式。
- 外部 Skill 及其辅助文件必须保持在声明的普通目录和来源根内。hooks、MCP、LSP、bin、settings、apps 和安装脚本不得因兼容导入而执行或获得 Patch 权限。
- rd-guide 的 GitLab Marketplace、CI、MR、CODEOWNERS 与受限 integration Patch Engine 继续沿用原有 reference；GitHub 外部格式默认 standard，不能借作者指南绕过审批。

## 4. Validation & Error Matrix

| 条件 | 错误 / 结果 |
| --- | --- |
| `name` 含换行/NUL，profile/ref/commit/source 非法 | usage/schema 错误，scaffold 零写入 |
| standard 请求 `--patches`，或外部申请 system | `PLUGIN_CAPABILITY_DENIED` 或 usage 错误 |
| 受管文件摘要与 ownership 账本不一致 | `PLUGIN_CONTENT_CONFLICT`，`--force` 也不覆盖 |
| ownership 账本损坏或非 canonical JSON | `PLUGIN_CONTENT_CONFLICT`，保留全部现有文件 |
| checkout path 为绝对路径、`..` 或软链逃逸 | `PLUGIN_UNSAFE_PATH` |
| ref 可变，或完整 ref 与 commit 不一致 | `marketplace.mutable-ref` / `marketplace.ref-commit-mismatch` |
| checkout commit、manifest version 或 digest 不一致 | `marketplace.commit-mismatch` / `marketplace.version-mismatch` / `PLUGIN_INTEGRITY_MISMATCH` |
| CI 缺 checkout 或使用零 commit | `marketplace.checkout-missing` / `marketplace.placeholder-commit` |
| integration 缺 companion 或 digest 过期 | review gate 非零退出，MR 不得合并 |
| GitHub 仓库格式歧义 | `PLUGIN_SOURCE_AMBIGUOUS`，作者选择固定 entryPath 后重新预览 |
| 外部 Skill 路径逃逸来源根，或没有可安全导入内容 | `PLUGIN_UNSAFE_PATH` / `PLUGIN_FORMAT_UNSUPPORTED`，不登记来源 |
| 外部 manifest 声明 hooks/MCP/bin | compatibility 标记 omitted；scaffold、安装计划和 Patch catalog 均不生成对应执行能力 |

## 5. Good / Base / Bad Cases

### Good

- 空目录用 non-interactive init 创建 standard Plugin，补充 Skill 后 validate；输出无本机信息。
- integration Plugin 只请求 `content.skills/patch.insert`，固定 tag、commit 和 digest；CI checkout 位于工作区内，companion 绑定当前 Marketplace digest。
- `--force` 更新未修改的模板文件和 Marketplace 草稿，同时保留用户新增 assets，并用最终完整树更新 digest。

### Base

- 不带 `--marketplace` 时不生成 entry；零 commit 只允许作为本地草稿，CI 必须拒绝。
- 普通项目没有 `.trellis/`：仍可安装 `flower/flower-plugin-author` 并投影 Skill。
- 公开 GitHub skill-only 仓库省略 ref：来源流程解析默认分支和固定 commit，预览 compatible 后再保存来源。

### Bad

- 从当前 manifest 反推“旧模板”并据此覆盖；用户的有效手改会被误认作 scaffold 原始内容。
- checkout map 指向 `/tmp/plugin`、`../plugin` 或工作区内指向外部的软链。
- 只输出 `review.required=true`，但不强制更新 CODEOWNERS 保护的 digest companion。
- 在作者 Skill 中建议直接运行 `claude plugin install`/`codex plugin install`，或把外部 hooks 转成 Flower integration Patch。

## 6. Tests Required

- `plugin-authoring-init.test.js`：参数解析、standard/integration、幂等、frontmatter 输入、ownership 摘要、Marketplace 草稿更新、用户文件保留、无 Trellis builtin 安装。
- `plugin-authoring-validate.test.js`：P1/P2/P4 真源、稳定 digest、依赖闭包、system/capability 拒绝、绝对路径脱敏。
- `plugin-marketplace-ci.test.js`：不可变 ref、ref/commit、checkout commit、工作区/软链边界、version/digest、依赖闭包和 integration companion/CODEOWNERS。
- 作者 Skill 必须运行 `quick_validate.py`，并至少用两个隔离临时目录 forward-test 新建 standard 与修复越权 integration。
- 外部格式指南必须覆盖 Claude/Codex 接入、GitHub skill-only 发布、格式歧义和主动组件 omitted；相关 CLI/provider tests 断言预览在持久化前完成。
- 修改本契约后运行完整 `npm test`、受影响文件 `node --check`、`npm pack --dry-run --json` 和 `git diff --check`。

## 7. Wrong vs Correct

### Wrong

```js
const packageRoot = path.resolve(baseDir, checkout.path);
if (force) fs.writeFileSync(target, rendered);
```

这会允许 checkout 逃逸 CI 工作区，并在无法证明原字节属于 scaffold 时覆盖用户内容。

### Correct

```js
const packageRoot = resolveCheckoutRoot(baseDir, checkout.path, checkoutKey);
if (state.files[relative] !== contentDigest(current)) {
  throw new PluginRuntimeError("已修改的文件拒绝覆盖", {
    code: PLUGIN_RUNTIME_ERROR_CODES.CONTENT_CONFLICT,
    path: relative,
  });
}
```

路径先做词法与真实路径边界校验；覆盖只接受 ownership 账本中与当前字节完全一致的摘要，最终 digest 在全部写入前预演。

外部格式的正确作者流程是保留上游仓库结构，通过 GitHub source 检测和兼容预览导入被动内容；需要 Flower 原生发布或 integration Patch 时，再显式维护 Flower manifest、Marketplace 与现有审批材料，不能把两条信任路径混为一体。
