# Trellis 0.6.12 升级实施计划

## 执行状态

- 已完成：依赖固定、Python 控制面重基线、workflow-state 局部 Patch、Codex `auto`、Phase 2 / Brief 合并、新平台与 Pi 迁移、compatibility / conflicts、canonical / snapshot / compiled target / dogfood 同步。
- 已验证：当前仓库从 `0.6.5` 真实升级到 `0.6.12` 成功；`npm test`、Patch target 检查、strict context budget、npm pack dry-run、post-upgrade update dry-run 和两仓 `diff --check` 通过。
- Check-All 修复完成：跨版本普通 dry-run 会延后 Skill-Garden 重放，已用真实 `0.6.5` 升级备份验证退出码为 `0`；README 已声明 tested `0.6.12` 并补充 OMP / Grok / Kimi / Snow；`trellis-meta` 通过三个受管 Patch operation 补全平台 root 与共享 `.agents/skills/` 消费者，source、snapshot、compiled target 和 dogfood 最终产物一致。
- 未进入：Phase 3.3 `trellis-update-spec`、Phase 3.4 `trellis-push`。

## 前置门禁

- [ ] 最终 `brief.md` 已生成、完整展示，并在后续消息得到用户明确批准。
- [ ] `task.py start` 成功，任务状态为 `in_progress`。
- [ ] 通过 `trellis-route(target=implement)` 选择本轮执行模式。
- [ ] 记录父仓与 `vendor/skill-garden` 的初始 Git 状态，不覆盖无关改动。
- [ ] 保存官方 `0.6.5`、`0.6.12` npm 包和当前 61 条 preflight 失败清单作为审计证据。

## 1. 固定依赖与 0.6.12 Fixture

- [ ] 把 `package.json` 的 `@mindfoldhq/trellis` 精确版本从 `0.6.5` 改为 `0.6.12`。
- [ ] 更新 `package-lock.json`，确认 Trellis 和 Trellis Core 均解析到 `0.6.12`。
- [ ] 确认 `trellisVersion()`、bundled bin 和 `syncGlobalTrellis()` 使用包内精确版本。
- [ ] 用官方 `0.6.12` 初始化覆盖全部受支持平台的临时 fixture。
- [ ] 重新运行 Patch preflight，保存 operation 级失败清单，确保总数和已归类的 61 条一致或能解释差异。

## 2. Python 控制面与状态完整性

### 2.1 Active-task

- [ ] 以上游 `0.6.12` `active_task.py` 为基线重写 `runtime-state-integrity` 局部 replacement。
- [ ] 保留上游新增函数参数、环境/单 session fallback 开关和平台 context key。
- [ ] 合并 `missing/corrupt/io_error`、原子 flush/fsync、`ClearActiveTaskResult` 和显式删除失败。
- [ ] 合并 fallback `previous.context_key` 清理修复。
- [ ] 更新 `workflow-state-missing-task`，确保 corrupt/io_error 不进入 missing/no-task 路径。

### 2.2 Task store

- [ ] 退役 `task-create-active-warning` operation，保留上游 `--no-start` 和分阶段激活诊断。
- [ ] 验证初始 task 写失败清理逻辑继续生效。
- [ ] 验证 parent/child 双文件快照、补偿和人工恢复诊断继续生效。
- [ ] 保留 archive、set-branch、set-base-branch、set-scope 写失败返回非零。
- [ ] 为上游新增 `set-meta` 增加同等写失败 Patch 与测试。
- [ ] 验证 decision log 损坏仍 fail closed。

### 2.3 Session Context 更新边界

- [ ] 重基线 imports selector/content，删除更新提示专用 import，但保留上游新增 `sys`。
- [ ] 把 helpers selector 更新为匹配 `run trellis update` 后继续 remove。
- [ ] 保留 constants/output remove/replace 语义和 `session-context-no-legacy-update-check` 断言。
- [ ] 验证最终文件保留 polyrepo 上限与 Git timeout 修复。

## 3. Workflow、Route 与 Brief

### 3.1 workflow-state 局部化

- [ ] 退役 489 行 whole-file replacement。
- [ ] 分别建立 missing-task、untracked helper/import、breadcrumb、main 分支的局部 required Patch。
- [ ] 为 operation 声明稳定顺序或依赖，保持 required/zero-write。
- [ ] 验证最终 hook 保留 ZCode、`no-trellis`、Codex `auto`、上游异常边界和新平台识别。
- [ ] 扩展现有多平台 targets，缺失平台保持 `missing-target`，不得创建未启用目录。

### 3.2 Codex 能力基线

- [ ] 把 Flower 管理配置输出从 `sub-agent` 改为 `auto`。
- [ ] 对已有显式 `inline` 做 Flower managed normalization，避免关闭 JSONL seed/readiness。
- [ ] 保留旧 `sub-agent` 作为兼容读取输入，不再写出。
- [ ] 更新配置、hook、task readiness 和 route 测试，证明实际模式只由 `trellis-route` 决定。

### 3.3 Phase 2 所有权

- [ ] 重基线 Active Task Routing、Phase 2.1 和 Phase 2.2 sections。
- [ ] Workflow 只保留 Flower policy owner 和 `trellis-route`/Check-All 指向。
- [ ] 为 OMP、Grok、Kimi、Snow、Pi 等平台补准确 dispatch recipe。
- [ ] 保证上游 workspace-write `trellis-check` 不会作为 Flower Check-All 替代。
- [ ] 对不支持只读 subagent Check-All 的平台明确要求 inline。

### 3.4 Planning consent 与 Brief

- [ ] 合并上游 Brainstorm Planning Contract、decision tracking 和 convergence gate。
- [ ] 删除额外 final summary approval，最终只通过 `trellis-task-brief` handoff。
- [ ] 扩展 Brief 模板：新增 Key Decisions，保留独立 Non-Goals 和一跳 Next Step，Risks/Deferred 按需生成。
- [ ] 展示时动态生成 Artifact Status，不持久化。
- [ ] 保留窄预授权和 `task.py start` missing/stale brief 硬门禁。
- [ ] 增加规划实质变化后必须刷新/重新批准的回归测试。

## 4. 新平台与 Pi 迁移

- [ ] `PLATFORM_FLAGS` 增加 `--omp`、`--grok`、`--kimi`、`--snow`。
- [ ] 平台选择 UI/帮助文案与上游名称保持一致。
- [ ] 把 Pi 强化 Skill target 从 `.pi/skills` 迁到 `.agents/skills`。
- [ ] 共享 `.agents/skills` target 的 platforms 增加 Pi/Kimi，确保 neutral 内容逐字节一致。
- [ ] 新增 OMP `.omp/skills`、Grok `.grok/skills`、Snow `.snow/skills` target。
- [ ] Kimi 私有 `.kimi-code/skills` 继续由上游 entry/agent role 模板拥有，Flower 不重复投影。
- [ ] 更新 stale path 清理，只有 hash/ownership 证明为旧 Trellis/Flower 产物时才移除 `.pi/skills`。
- [ ] 扩展 Patch fixture、平台检测、目录投影和更新幂等测试。
- [ ] Grok/Kimi 不创建项目 hook；OMP/Snow/Pi 按上游真实机制验证上下文与 dispatch。

## 5. Compatibility、Conflict 与最终产物

- [ ] 把 `overrides/compatibility.json.testedVersions` 更新为仅 `0.6.12`。
- [ ] 保留 `compatibleLine=0.6`、同线未测试 warning 和 required preflight fail-closed。
- [ ] 更新 conflicts：移除已退役 operation 引用，新增 `set-meta` 和局部 workflow-state 最终产物断言。
- [ ] 确认所有 conflict `whenOperations` 都存在且确实修改目标。
- [ ] 确认 61 条失败均映射到已确认的设计合并或机械重基线，不留未解释 skip。
- [ ] 生成 `vendor/skill-garden/compiled-targets/0.6.12/full`，删除旧精确版本目录由生成器负责。

## 6. 同步 canonical、快照与 dogfood

- [ ] 所有 Skill-Garden 改动先落在 `vendor/skill-garden/.trellis/0.6/`。
- [ ] Flower 平台配置 Patch 只落在 `src/patches/` 与现有 adapter/target owner。
- [ ] 运行 `npm run sync`，刷新 `enhancements/0.6` 和 `enhancements/MANIFEST.json`。
- [ ] 运行 Flower update 刷新当前 dogfood 输出，保留项目本地 config、用户 hook 和无关文件。
- [ ] 比较 vendor canonical、enhancements、compiled targets 与 dogfood 的关键最终语义。
- [ ] 检查 package `files` 白名单，确保发布包包含更新后的 `src` 与 `enhancements`，不包含 vendor。

## 7. 定向测试

- [ ] Active-task：missing/corrupt/io_error、原子 replace 失败、clear 失败、fallback 清理和新平台 session key。
- [ ] Task store：初始写、pair compensation、rollback incomplete、archive/set-*、set-meta 和 decision log。
- [ ] Session Context：无原生 update hint，保留 polyrepo/Git timeout。
- [ ] workflow-state：Flower 分支唯一，上游新增能力仍存在，9+ 平台 target 行为正确。
- [ ] Codex：`auto` 输出、legacy 输入、inline preference、JSONL readiness、SubagentStart。
- [ ] Brief：栏目、动态 Artifact Status、freshness、一次批准和变更后重批。
- [ ] 平台：OMP/Grok/Kimi/Snow/Pi 的 flags、Skill roots、hooks、agent/route 配方与 stale cleanup。
- [ ] Patch Engine：JS/Python parity、required zero-write、conflict policy、provenance 和幂等。

## 8. 全量门禁

按仓库脚本的实际可用命令执行并记录结果，至少覆盖：

```bash
npm test
npm run sync
npm run patch:targets
npm run patch:targets:check
node scripts/check-ai-context-budget.mjs
node scripts/check-ai-context-budget.mjs --strict
node bin/flower-trellis.js -v
node bin/flower-trellis.js update --dry-run --no-update-check
npm pack --dry-run --json
git diff --check
git -C vendor/skill-garden diff --check
```

- [ ] `node bin/flower-trellis.js -v` 显示 bundled Trellis `0.6.12`。
- [ ] 0.6.12 full fixture required preflight 和 conflict 审计无 error。
- [ ] `testedVersions` 只在完整验证通过后最终保留 `0.6.12`。
- [ ] context budget 不通过提高阈值掩盖重复规则。
- [ ] npm tarball 包含正确快照且不包含 vendor/临时 fixture。

## 9. 收尾前检查

- [ ] 对照 `prd.md` 与 `design.md` 逐项复核 acceptance。
- [ ] 使用 `trellis-check-all` 执行最终 full-scope 检查。
- [ ] 如形成长期契约，使用 `trellis-update-spec` 更新对应 spec。
- [ ] 提交与推送必须通过 `trellis-push`，不得手写 Git 收尾替代。
