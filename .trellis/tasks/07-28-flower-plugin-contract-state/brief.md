# Brief — Flower Plugin 契约与 Project Store

## Goal

- 为 Flower Plugin Runtime 冻结首个可执行、可版本化的 schema、身份、摘要和 `.flower/` Project Store 契约，作为 P2、P3、P4 的共同前置能力。

## Scope

- 定义并校验 Plugin Manifest v1、Marketplace Manifest v1、`.flower/plugins.json`、`.flower/plugin-lock.json` 和 `.flower/state.json`。
- 定义跨子任务共享的 JSDoc DTO、canonical Plugin ID、SemVer、稳定错误码和 JSON path issue 结构。
- 实现稳定 JSON 序列化和 canonical tree SHA-256，拒绝软链、特殊文件与路径逃逸。
- 实现独立于 `.trellis/` 的 `.flower/` Project Store、局部 `.gitignore`、schema 读写、changed-only 写入和原子单文件替换。
- 增加 `ajv` 与 `semver` 直接运行时依赖，并保持新增模块可被 npm 包发布。

## Non-Goals

- 不实现 Plugin 生命周期 CLI、依赖求解、Source Registry、GitLab/OAuth、Capability negotiation、内容投影或 Patch 应用。
- 不实现 plugins、lock、state 的跨文件事务。
- 不迁移、删除或改写旧 `.trellis/.flower-manifest.json`。
- 不修改现有 selector、Patch 变换或 enhancement 成功链路。

## Key Context

- 项目使用 Node.js ESM，最低 Node.js 版本为 `18.17.0`，公共类、工厂和 public function 必须补齐中文 JSDoc。
- 现有 `src/lib/manifest.js` 仍服务旧 `.trellis/` 状态；P5 才负责只读迁移。
- `src/lib/fs-utils.js#copyPath()` 会删除并覆盖目标，Project Store 禁止调用它。
- 现有 Patch Engine 已提供 POSIX 路径、软链逃逸和 SHA-256 经验；P1 只提取无业务语义的通用能力，不能复制 selector 或改变错误语义。
- stable JSON 递归排序对象键、保留数组顺序、使用两个空格和结尾换行；非法 JSON 值必须明确失败。
- canonical tree hash 覆盖 Plugin 根目录全部普通文件，按 UTF-8 POSIX 路径字节排序，并使用固定宽度长度边界编码。
- Project Store 只把 `ENOENT` 当作缺失；损坏 JSON、未知 schema、权限或 I/O 错误不得静默重置。
- 单文件写采用同目录临时文件与 rename；内容不变时不重写。P2 在更高层实现多 mutation 事务。
- P1 完成并冻结契约前，P2、P3、P4 不应启动实现。

## Acceptance

- Plugin、Marketplace、plugins/lock/state schema 具有有效、无效和安全边界 fixture，覆盖未知字段、ID、SemVer/range、路径、重复版本、commit、digest 与 schema version。
- 共享 DTO 和公共运行时入口具备完整中文 JSDoc，后续子任务直接导入，不重复定义近似对象。
- stable JSON 对对象插入顺序不敏感、对数组顺序敏感，重复输出字节一致。
- canonical tree hash 跨根目录和创建顺序稳定，路径或内容变化会改变摘要，并拒绝软链和特殊文件。
- 无 `.trellis/` 项目可初始化 `.flower/`；局部 `.gitignore` 忽略本机状态、缓存、事务与临时文件且保持幂等。
- 损坏状态不会被自动覆盖；模拟写入或 rename 失败后原文件字节不变且无临时文件残留。
- 相同数据重复写入不改变内容或 mtime。
- P1 定向测试、现有 Patch Engine 测试、完整 `npm test`、`npm pack --dry-run --json` 和 `git diff --check` 通过。

## Next Step

- 用户确认本 brief 后，运行 `task.py start 07-28-flower-plugin-contract-state`，再通过 `trellis-route(target=implement)` 进入 P1 实现；P1 验收完成后开放 P2、P3、P4。
