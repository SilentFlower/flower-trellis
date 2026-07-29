# Brief — Flower Plugin 体系改造

## Goal

- 将 flower-trellis 从固定 `enhancements/` 增强安装器演进为 Flower 原生 Plugin Runtime，统一支持内置 `skill-garden`、无 Trellis 的纯 Plugin 分发、私有 GitLab Marketplace、受限 Patch、可复现锁定和作者工具。

## Scope

- 定义版本化的 Flower Plugin、Marketplace、项目声明、lockfile 和本机 state 契约。
- 引入独立 `.flower/` 项目边界；`plugins.json` 与 `plugin-lock.json` 可提交，`state.json`、cache 和事务状态仅本机保存。
- `flower-trellis init` 保持完整 Trellis 模式并默认安装 `flower/skill-garden`；`plugin add` 可在无 Trellis 项目中只安装目标 Plugin 及显式依赖。
- 支持直接/传递依赖、SemVer、不可变 commit、完整性摘要、共享依赖和 orphan 清理。
- `rd-guide` 作为随包预注册、惰性访问的 GitLab Marketplace，支持共仓内容和引用其他 GitLab 仓库。
- GitLab 使用实例级 OAuth Application、PKCE 和 Device Flow，申请 `read_repository read_api`；不使用 Application Secret，token 只持久化到系统 keyring。
- 复用现有 Patch Engine，增加 `standard`、`integration`、`system` 能力档位及请求、来源上限、Runtime 硬限制、项目确认四层授权。
- 外部 `scripts/` 仅作为 Skill 资源分发，v1 生命周期不执行第三方 hook；未来通过版本化 capability 扩展。
- 提供 `flower/flower-plugin-author` 内置 Plugin，以及 `plugin init`、`plugin validate` 和 `rd-guide` MR/CI 注册契约。
- 将旧 `.trellis/.flower-manifest.json`、init/update/uninstall 和 update-check 行为迁移到统一 Runtime，并保留回滚证据。

## Non-Goals

- 不实现 Codex Plugin 或其他平台 Plugin 格式兼容。
- 不建设公共互联网 Marketplace、计费、评分或运营审核系统。
- v1 不开放第三方 lifecycle hook、自定义 JavaScript adapter 或 `system` 权限。
- 不负责 GitLab HTTPS、证书和网络基础设施改造。
- 首期不搬迁 `enhancements/<variant>` 大量快照，由内置 provider 适配现有内容。

## Key Context

- 当前 `src/cli.js` 对未知命令透传 Trellis，新增 `plugin` 必须显式接管。
- 当前 `applyEnhancements()` 同时承担变体、Patch、复制、清理和 manifest 写入；它必须收敛为新 Runtime 的兼容 facade，不能形成双状态链。
- `src/lib/patch-engine.js` 已具备多 catalog、qualified ID、稳定排序、路径安全、全量 preflight 和 provenance v2；新 Runtime 在其外增加来源、依赖、能力裁剪和事务，不重写 selector。
- 当前 `copyPath()` 无条件删除覆盖，不可用于多 Plugin 事务写盘。
- 多平台投影复用 `ENHANCEMENT_SKILL_TARGETS`，Codex/Gemini/ZCode 共用 `.agents/skills`，本机平台结果不进入 lockfile。
- Marketplace 信任链为 GitLab 保护分支、MR、CI 和 CODEOWNERS；lockfile 仍绑定 index commit、Plugin commit、内容摘要和批准 capability 摘要。
- 系统 keyring 首选 `@napi-rs/keyring` optional adapter；无 keyring 时只保留当前进程 token，不回退明文文件。
- 父任务不直接承担大段实现，按七个子任务交付：契约状态、Runtime 生命周期、GitLab/OAuth、Patch capability、skill-garden 迁移、作者生态、最终集成。

## Acceptance

- 无 Trellis 项目可以安装、更新、验证和卸载不依赖 Trellis/skill-garden 的 Plugin，且不生成 `.trellis/`。
- 完整 Trellis init 默认安装 `skill-garden`，旧项目可幂等迁移，现有 CLI 行为和最终 Patch 结果无错误回归。
- 提交声明与 lockfile 后，另一台机器可解析同一依赖版本；本机 state/cache 不产生仓库 diff。
- GitLab Marketplace 支持 OAuth、私有仓库、共仓/外部仓库来源、固定 commit 和完整性校验；`read_repository read_api` 可读取 Git、tree 和 archive，未使用 `rd-guide` 时零网络访问。
- token、refresh token 和 Application Secret 不进入项目文件、日志、fixture 或 JSON 输出。
- 多 Plugin 统一 preflight，required/依赖/路径/权限冲突失败时零写入；进程内写盘失败可根据事务清单恢复。
- `integration` 首次确认后可复用未变化的 capability 摘要，任何版本、内容或能力变化都要求重新确认；外部 Plugin 永远不能获得 `system`。
- 作者工具能 scaffold、validate 并生成可提交 `rd-guide` MR 的 Plugin；CI 拒绝可变引用、摘要错误、依赖不闭合和越权能力。
- 全量单元、集成、迁移、Patch conflict、npm pack 和幂等测试通过。

## Next Step

- 审阅并确认父任务 `prd.md`、`design.md`、`implement.md` 与本 brief。
- 确认后创建 Wave 1 子任务 `flower-plugin-contract-state`，为其补齐三件套和上下文，再启动该子任务；父任务不直接进入主要实现。
