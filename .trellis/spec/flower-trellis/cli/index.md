# CLI Development Guidelines

> flower-trellis 是一个 Node.js (ESM) 命令行工具:一键安装/升级 Trellis 并叠加
> skill-garden 强化包。本目录是写 `src/` / `bin/` / `scripts/` / `enhancements/`
> 代码前必须先读的工程约定。

---

## Applies To

| 路径 | 角色 |
|------|------|
| `bin/flower-trellis.js` | 极薄入口,仅动态加载 `src/cli.js` |
| `src/cli.js` | argv 解析 + 子命令分发 + 顶层错误处理 |
| `src/constants.js` | 全局名单常量(与上游对齐) |
| `src/commands/*.js` | 子命令编排层(init / update / uninstall) |
| `src/lib/*.js` | 单一职责的工具/逻辑模块 |
| `scripts/sync-enhancements.mjs` | 开发期脚本(打快照,最终用户不运行) |
| `scripts/check-snapshot.mjs` / `extract-changelog.mjs` | 发布期脚本(快照一致性断言 / CHANGELOG 抽段) |
| `vendor/skill-garden` | 强化包同步源(git submodule,不进 npm 包) |
| `.github/workflows/release.yml` | tag 触发的发布工作流(OIDC + provenance) |
| `enhancements/<variant>/` | 随包发布的 skill-garden 强化包快照 |

> 本项目**没有** React / 组件 / Hook / 前端状态 / TypeScript。任何来自前端模板的
> 概念都不适用,请勿引入。

---

## Pre-Development Checklist

动手写代码前:

1. **读上下文**:先读 `src/constants.js` 与目标改动涉及的 `src/lib/*.js`,确认已有
   函数签名、导出名、返回结构,**不臆测**(零臆测原则)。
2. **分层归位**:面向用户的编排放 `src/commands/`,可复用逻辑放 `src/lib/`,
   名单/常量放 `src/constants.js`。不要把逻辑堆进 `cli.js`。
3. **上游对齐**:涉及 `constants.js` 名单、`variant.js` 规则、`fs-utils.copyPath`、
   `legacy-blocks.js`、workflow 注入正则的改动,必须与 skill-garden `install.sh` /
   Trellis 上游保持一致(代码里有「移植 install.sh」注释标注来源)。
4. **幂等优先**:叠加/写盘类操作必须可重复执行而结果一致(见
   [enhancements-model](./enhancements-model.md))。

---

## Quality Check

提交前先跑零依赖自动测试，再做语法校验与 dogfood：

```bash
# 1. Node/Python 内置测试 + 默认上下文预算告警
npm test

# 2. ESM 语法校验(逐个或整体)
node --check src/cli.js && for f in src/lib/*.js src/commands/*.js; do node --check "$f"; done

# 3. dogfood 手测:对临时目标跑全流程,观察输出与产物
flower-trellis init   --target ./test-target -y
flower-trellis update --target ./test-target -y --dry-run
flower-trellis uninstall --target ./test-target --dry-run
```

> `test-target/`、`.trellis-tmp/` 已被 `.gitignore` 忽略,可放心做本地目标。

---

## Guidelines Index

| 指南 | 内容 |
|------|------|
| [Directory Structure](./directory-structure.md) | 目录分层与命名 |
| [Module Guidelines](./module-guidelines.md) | ESM 模块/导出/JSDoc 约定 |
| [CLI Output](./cli-output.md) | 横幅、进度行、错误与退出码 |
| [Config & State](./config-and-state.md) | 常量、路径、版本、manifest 状态 |
| [Enhancements Model](./enhancements-model.md) | 强化包快照与叠加流水线 |
| [Trellis Patch Engine](./trellis-patch-engine.md) | Skill-Garden/Flower 对 workflow、skill、hook、平台配置的统一 Patch、Bundle、迁移与 provenance 协议 |
| [Flower Plugin Contracts](./flower-plugin-contracts.md) | Plugin/Marketplace schema、共享 DTO、canonical hash 与 `.flower/` Project Store 契约 |
| [Flower Plugin Runtime And Lifecycle](./flower-plugin-runtime.md) | Source Registry、依赖解析、多平台投影、InstallPlan、事务恢复与项目级 Plugin 生命周期 CLI 契约 |
| [Flower Plugin Remote Sources](./flower-plugin-gitlab.md) | GitLab/GitHub 来源、OAuth/匿名 REST、外部格式探测、安全 archive、不可变缓存与远程 CLI 契约 |
| [Flower Plugin Capability Policy](./flower-plugin-capabilities.md) | standard/integration/system 授权交集、批准摘要、内置信任根与受限 Patch Planner 契约 |
| [Flower Plugin Authoring And Marketplace CI](./flower-plugin-authoring.md) | 作者 Plugin/Skill、确定性 scaffold、ownership、validate、rd-guide CI 与 CODEOWNERS 契约 |
| [AI Context Budget](./ai-context-budget.md) | 最终 workflow/state/skill、Phase summary、SessionStart 与控制面总量的告警预算 |
| [Release & Publishing](./release-and-publishing.md) | 发版流程、CI 发布(OIDC)、CHANGELOG 约定 |
| [Quality Guidelines](./quality-guidelines.md) | 必守模式、禁用模式、评审清单 |

---

**Language**: 章节标题保留英文,正文用中文。
