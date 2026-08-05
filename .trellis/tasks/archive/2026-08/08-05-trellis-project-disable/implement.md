# Implementation Plan

## 1. Control State Contracts

- [x] 在 Plugin project-file schema 层新增 Trellis control state / detached manifest validator 和稳定错误码。
- [x] 扩展 `ProjectStore`，支持只读、原子写和删除 `.flower/trellis-control.json`，并更新 `.flower/.gitignore` 规则。
- [x] 定义 POSIX 相对路径、hash、mode、owner、mutation kind 和备份引用 DTO；拒绝软链、特殊文件和项目外逃逸。

## 2. Target Discovery And Planning

- [x] 新增 Trellis integration target discovery，复用 `getConfiguredPlatforms()`、`collectPlatformTemplates()`、template hashes 和 Plugin state。
- [x] 对共享 root/多平台重复路径稳定去重，并保留平台与 owner provenance。
- [x] 实现 exclusive file、AGENTS managed block 和 shared JSON fragment 三类 planner。
- [x] 实现 conflict、force、dry-run 和最终 disabled verification。

## 3. Transaction And Recovery

- [x] 新增独立 control transaction，使用 staging/backup/manifest/completed journal，写前复核 before hash，失败逆序恢复。
- [x] 实现 disable 的 changed-only/幂等语义和 repair-required 证据保留。
- [x] 实现 enable 的全量 preflight、共享文件合并、当前 disabled 现场快照和失败回滚。
- [x] 仅在完整成功后清除 control state；清理失败保留证据并输出 warning。

## 4. CLI Surface

- [x] 在 `src/cli.js` 注册 `trellis` Flower 子命令并更新帮助。
- [x] 新增 `src/commands/trellis.js`，解析 `disable|enable|status`、`--dry-run`、`--force`，拒绝平台级参数。
- [x] 输出 enabled/disabled/drifted/repair-required/not-initialized 状态和重启提示；保持别名与 `--target` 行为。

## 5. Update And Plugin Lifecycle

- [x] 在 `flower-trellis update` / self-update 项目更新链加入 disabled 上下文，更新完成后重新 detach 并验证最终状态。
- [x] 把 control transaction 纳入现有 update compensation，任一失败恢复调用前 disabled 现场。
- [x] 在 Plugin mutating lifecycle 后执行 disabled reconciliation，仅 detach Trellis-owned 路径，保留外部 Plugin 内容。
- [x] 明确直接上游 `trellis update` 的 drifted 检测，不尝试拦截或移动整个 `.trellis`。

## 6. Documentation And Specs

- [x] 更新 README CLI 帮助、关闭/恢复语义、重启要求、直接上游 update 边界和冲突处理说明。
- [x] 更新 `.trellis/spec/flower-trellis/cli/config-and-state.md`、`flower-plugin-runtime.md` 和相关索引契约。
- [x] 控制面实现完全位于 Flower CLI/runtime，完整 snapshot/compiled-target 检查通过，无需修改 vendor/enhancements。

## 7. Tests

- [x] 新增状态 schema、路径安全、目标发现、共享 root 去重和 drift detection 单测。
- [x] 覆盖 AGENTS 管理块、共享 JSON 用户配置保留、TOML 修改冲突、force 备份和结构化恢复。
- [x] 故障注入覆盖 disable/enable 每个写入阶段、回滚成功、回滚不完整和 repair evidence。
- [x] CLI 覆盖 status、dry-run、重复操作、usage/conflict/failed 退出码和 `--target`。
- [x] update/plugin 集成覆盖 disabled 最终闭包、失败补偿和外部 Plugin 内容保留。
- [x] 直接模拟上游 update 重建入口后，断言 status=`drifted`。
- [x] 临时项目 dogfood：Claude + Codex 初始化、disable、新会话可发现路径检查、enable、update dry-run、uninstall dry-run。

## Validation Commands

```bash
node --test test/js/trellis-control*.test.js
node --test test/js/update-backups.test.js test/js/plugin-*.test.js
node --check src/cli.js
for f in src/lib/*.js src/commands/*.js src/plugin/**/*.js; do node --check "$f"; done
npm test
git diff --check
```

## Risk And Rollback Points

- Control state/schema 写入前必须完成全部目标 preflight；不能用成功 state 掩盖部分写入。
- 共享文件恢复冲突默认阻断全量 enable，不允许按平台部分成功。
- update/plugin 嵌套事务需要故障注入证明回滚终态，不以 happy-path dogfood 代替。
- 不在当前 dogfood 项目执行真实 disable；所有 destructive 场景使用隔离临时目标。
