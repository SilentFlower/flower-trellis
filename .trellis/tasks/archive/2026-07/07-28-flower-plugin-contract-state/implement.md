# Flower Plugin 契约与 Project Store 实施计划

## 1. 实施顺序

### A. 冻结契约与错误模型

- [ ] 新增 `src/plugin/errors.js`，定义稳定错误码、schema issue 和 I/O 包装边界。
- [ ] 新增 `src/plugin/contracts.js`，补齐父任务列出的共享 JSDoc DTO。
- [ ] 在 `src/plugin/schemas/shared.js` 定义 schema version、ID、canonical ID、路径、commit、digest 和 SemVer 公共规则。
- [ ] 在 `package.json`、lockfile 中显式加入 `ajv` 与 `semver` 运行时依赖。
- [ ] 先提交 schema fixture 表，冻结有效、无效和边界样例，再实现 validator。

### B. 实现 Plugin 与 Marketplace schema

- [ ] 实现 Plugin Manifest v1 JSON Schema 和语义校验。
- [ ] 实现 Marketplace Manifest v1 JSON Schema和条目唯一性校验。
- [ ] 统一 Ajv 错误到 `PluginSchemaError`，不向调用方泄漏 Ajv 内部格式。
- [ ] 覆盖未知字段、非法路径、非法 SemVer、重复版本、可变/非法 commit 和 digest 格式。

### C. 实现项目文件 schema

- [ ] 实现 `.flower/plugins.json` v1 schema。
- [ ] 实现 `.flower/plugin-lock.json` v1 schema。
- [ ] 实现 `.flower/state.json` v1 schema。
- [ ] 断言 lockfile 不接受平台检测结果、token、绝对路径或用户身份字段。
- [ ] 为后续 P2/P4 预留明确的 resolved graph、capability grant 和 provenance 字段，但不写未定义的宽泛扩展对象。

### D. 实现完整性基础能力

- [ ] 实现 `stringifyCanonicalJson()` 和非法值诊断。
- [ ] 实现 canonical tree 遍历、路径字节排序、长度边界编码和 SHA-256。
- [ ] 拒绝软链与非普通文件，覆盖不同根目录、不同创建顺序和内容变化测试。
- [ ] 评估是否提取 Patch Engine 的通用路径 helper；只有不改变现有错误与测试时才复用。

### E. 实现 Project Store

- [ ] 实现 `.flower/` 固定路径和软链边界校验。
- [ ] 实现幂等 `.flower/.gitignore` 合并，保留用户自定义规则。
- [ ] 实现 plugins、lock、state 的缺失、读取、校验与 changed-only 写入。
- [ ] 实现同目录独占临时文件和原子 rename。
- [ ] 通过可注入 I/O 或测试替身模拟写入、关闭、rename 失败，验证原文件与临时文件清理。
- [ ] 不调用 `copyPath()`，不修改根 `.gitignore`，不创建 `.trellis/`。

### F. 回归与契约交接

- [ ] 运行 P1 定向测试和完整 `npm test`。
- [ ] 使用 `npm pack --dry-run --json` 确认 `src/plugin/**` 会进入 tarball。
- [ ] 输出 P1 冻结的 schema、DTO、错误码和 tree hash research 交接文档，供 P2/P3/P4 JSONL 引用。
- [ ] 更新父任务中的 Wave 1 状态；P1 检查通过后再允许 P2、P3、P4 启动。

## 2. 文件所有权

- `src/plugin/errors.js`
- `src/plugin/contracts.js`
- `src/plugin/schemas/**`
- `src/plugin/integrity/**`
- `src/plugin/state/project-store.js`
- `package.json`、`package-lock.json` 中仅 `ajv`、`semver` 的直接依赖声明
- `test/js/plugin-*-schema.test.js`
- `test/js/plugin-integrity.test.js`
- `test/js/plugin-project-store.test.js`

除非提取无业务语义的路径 helper，P1 不修改 `src/lib/patch-engine.js`、`src/lib/manifest.js` 或现有增强链。

## 3. 验证命令

```bash
node --test test/js/plugin-manifest-schema.test.js
node --test test/js/plugin-marketplace-schema.test.js
node --test test/js/plugin-project-files-schema.test.js
node --test test/js/plugin-integrity.test.js
node --test test/js/plugin-project-store.test.js
node --test test/js/patch-engine.test.js
npm test
npm pack --dry-run --json
git diff --check
```

## 4. 高风险检查点

- [ ] schema 不能把 Runtime 默认值、当前平台或本机路径注入 lockfile。
- [ ] Marketplace manifest 不能通过 `maxProfile` 获得 `system`。
- [ ] canonical tree hash 不能依赖目录遍历顺序、mtime、权限位、绝对路径或压缩包字节。
- [ ] Project Store 不能把损坏 JSON 当成空状态后覆盖。
- [ ] 临时文件必须与目标同目录，失败后不得残留或破坏旧文件。
- [ ] `.flower/` 或其父路径经软链逃逸时必须在写入前失败。
- [ ] P1 不得提前实现 Resolver、Provider、Capability Policy 或跨文件事务。

## 5. 回滚点

- schema/DTO 未被后续任务消费前，可整体删除 `src/plugin/**` 新模块和依赖声明。
- 若公共 helper 提取导致 Patch Engine 回归，恢复 Patch Engine 原实现，保留 Plugin 命名空间内的窄 helper。
- Project Store 未接入 CLI 前不迁移旧 manifest，不存在用户数据回滚步骤。

## 6. 启动前门禁

- [ ] `prd.md`、`design.md`、`implement.md` 经用户审阅。
- [ ] `implement.jsonl` 与 `check.jsonl` 均包含真实 spec/research 条目。
- [ ] `brief.md` 已由 `trellis-task-brief` 刷新并完整展示。
- [ ] 用户在 brief 展示后明确确认启动 P1。
