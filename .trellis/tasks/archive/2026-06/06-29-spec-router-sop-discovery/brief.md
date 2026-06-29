# Brief — Spec router for project SOP discovery

## Goal

- 让 skill-garden 0.6 分发一个通用项目知识发现机制，使 AI 在流程性或高影响动作前主动发现并读取目标项目 `.trellis/spec/` 中的 SOP / 经验 / 标准流程。

## Scope

- 新增 `vendor/skill-garden/.trellis/0.6/scripts/spec_router.py`，扫描 `.trellis/spec/**/*.md`，包括共享层 `.trellis/spec/guides/**/*.md`，并按短查询返回相关 SOP/spec/thinking guide 候选。
- 更新 skill-garden 0.6 的 `overrides/workflow.md`，加入 Project Knowledge Discovery 规则，使用用户确认的 `<short query describing the intended action>` 文案。
- 更新 0.6 的 workflow-state sentinel，让只读 per-turn breadcrumb 的模型也能看到精简提示。
- 通过 `npm run sync` 同步到 `enhancements/0.6`，并同步当前 dogfood 副本 `.trellis/scripts/spec_router.py` / `.trellis/workflow.md`。
- 必要时更新 `src/lib/copy-scripts.js`，让 `spec_router.py` 在全装和合理的 `--skills` 精细安装场景下可铺设。

## Non-Goals

- 不为每个 SOP 创建新 Skill。
- 不把项目私有 SOP 内容放进 skill-garden。
- 第一版不改 Codex / Claude hook 自动执行 `spec_router.py`。
- 第一版不做向量检索、BM25、外部索引或持久缓存。
- 第一版不修改 Trellis 上游核心脚本。

## Key Context

- 真实修改源头是 `vendor/skill-garden/.trellis/0.6/`，不能只改 `enhancements/0.6/` 或当前项目 dogfood 副本。
- `scripts/sync-enhancements.mjs` 会同步 `.agents`、`.claude`、`overrides`、`scripts` 到 `enhancements/`。
- `copy-scripts.js` 只复制变体 `scripts/` 下的直接文件到目标 `.trellis/scripts/`。
- Workflow 长规则放 `overrides/workflow.md` hub，workflow-state 只放短提示，避免高频上下文膨胀。
- 查询应由当前用户请求、即将执行的命令、涉及文件/系统、package/layer 和领域词共同构造，不应写死为原始 user request。

## Acceptance

- `spec_router.py` 源、快照、dogfood 副本可通过 Python 语法检查。
- 查询 `"beta release publish tag changelog"` 能命中 `.trellis/spec/flower-trellis/cli/release-and-publishing.md`。
- 查询 `"cross layer reuse thinking guide"` 能命中 `.trellis/spec/guides/**/*.md` 中的相关文档。
- 无关查询能返回无匹配，并说明可继续正常流程。
- Workflow hub 和 workflow-state sentinel 均包含项目知识发现提示。
- `npm run sync` 后源与 `enhancements/0.6` 一致，`MANIFEST.json` 记录 `spec_router.py`。
- 必要同步检查和 `git diff --check` 通过。

## Next Step

- 进入 Phase 1.4：用户确认 planning artifacts 和本 brief 后，运行 `python3 ./.trellis/scripts/task.py start .trellis/tasks/06-29-spec-router-sop-discovery`，随后进入 Phase 2.1 implement route。
