# Flower Plugin 改造现状研究

## 当前入口

- `src/cli.js` 显式处理 `init/update/self-check/self-update/update-check/skill/uninstall`，未知命令透传 Trellis。新增 `plugin` 必须先于透传接管。
- `src/lib/cli-args.js` 当前只解析一层命令和 Flower 全局参数，Plugin 多级子命令需要独立 parser，不能继续向单一 switch 堆叠全部语义。
- `src/commands/init.js` 和 `update.js` 在 Trellis 成功后调用 `applyEnhancements()`；这是未来兼容 facade 的接入点。

## 当前增强链

- `src/lib/apply-enhancements.js` 同时承担变体解析、两个 Patch catalog、内容复制、旧路径清理、平台后处理和 manifest 写入，职责需要拆到 Plugin Runtime。
- `src/lib/enhancement-catalog.js` 强制目标存在 `.trellis/`，不适合无 Trellis Plugin 模式。
- `src/lib/copy-skills.js` 已使用 `ENHANCEMENT_SKILL_TARGETS` 实现多平台投影，但无平台时回退 Claude；普通 Plugin 模式应改为选择/显式平台，不静默创建 Claude 根。
- `src/lib/fs-utils.js#copyPath()` 会删除并整体覆盖目标，不能作为多 Plugin 事务写盘实现。
- `src/commands/uninstall.js` 根据当前快照猜测名称清理，必须迁移为 state 所有权驱动。

## 当前 Patch Engine

- `src/lib/patch-engine.js` 已支持多 catalog、qualified operation ID、跨 catalog 顺序关系、全量内存 preflight、before/after hash、路径与软链边界、provenance v2。
- 内置 `skill-garden` 和 `flower` 保留 legacy marker；其它 catalog 自动使用 qualified marker，适合外部 Plugin 隔离。
- `preparePatchPlan()` 是 Plugin Runtime 的复用边界；外部能力裁剪应发生在调用前，不能复制 selector/adapter 实现。
- `applyPatchPlan()` 当前直接逐文件写入，普通文件系统异常不承诺跨文件事务。Plugin Runtime 需要统一 mutation/transaction 层并保持 state 最后写。

## 当前状态

- `src/lib/manifest.js` 把安装 provenance、Flower 版本、Trellis 版本和 update-check 策略放在 `.trellis/.flower-manifest.json`。
- update-check 运行缓存已拆到 `.trellis/.flower-update-check.tmp` 并由局部 `.trellis/.gitignore` 忽略。
- 新设计应保留这种“可提交策略与本机缓存分离”思想，但把 Plugin 项目状态迁移到独立 `.flower/`。

## 当前多平台与 Skill

- `src/constants.js#ENHANCEMENT_SKILL_TARGETS` 覆盖 Claude、共享 agents、Cursor、OpenCode、Kilo、Kiro、Antigravity、Devin、Qoder、CodeBuddy、Copilot、Droid、Pi、Trae、Reasonix。
- Codex、Gemini、ZCode 共用 `.agents/skills`，投影计划必须物理去重。
- `trellis-meta` 说明 Trellis bundled skill 会被整目录复制到各平台；Flower 的 `flower-plugin-author` 应采用同样的“一份 canonical、多平台投影”思想，但由 Flower 内置 Plugin 提供，不能依赖上游 Trellis bundled-skill 源码。

## GitLab 与凭据

- GitLab 官方 OAuth API支持 Authorization Code + PKCE；Device Authorization Grant 在 17.9 起 GA，目标 GitLab 18.10.1 可用。
- PKCE 公共客户端不需要 Application Secret；Device Flow 使用 `/oauth/authorize_device` 与 `/oauth/token`。
- OAuth token 可通过 Bearer header 访问 REST API，并支持 refresh token。
- 真实 GitLab 18.10.1 验证表明：仅 `read_repository` 时 Git-over-HTTP 返回 200，但 `repository/tree` 返回 403；重新授权 `read_repository read_api` 后 token-info、Git-over-HTTP 和 `repository/tree` 均返回 200。
- Plugin Runtime 因此默认申请 `read_repository read_api`，不需要完整读写 `api` scope。
- `@napi-rs/keyring` 当前提供 macOS Keychain、Windows Credential Manager 和 Linux Secret Service 的 Node 绑定，可作为 optional adapter；设计禁止明文文件 fallback。

参考：

- <https://docs.gitlab.com/api/oauth2/>
- <https://docs.gitlab.com/api/rest/authentication/>
- <https://www.npmjs.com/package/@napi-rs/keyring>

## 设计结论

1. 不重写 Patch Engine，在外层增加来源、解析、授权、统一计划和事务。
2. 首期不搬迁 `enhancements/` 大量快照，由 builtin provider 适配为 `flower/skill-garden`。
3. `applyEnhancements()` 最终只保留兼容 facade，不能继续写第二份成功状态。
4. 外部 Plugin 只允许声明式内容和受限 Patch；`scripts/` 被动分发，v1 无 lifecycle hook。
5. 子任务必须先冻结 schema/DTO，再并行 Runtime、GitLab 和 Patch capability。
