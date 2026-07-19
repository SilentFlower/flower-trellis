# 当前注入机制盘点

## 1. 权威源与生成链

- skill-garden 0.6 真实源：`vendor/skill-garden/.trellis/0.6/`。
- `npm run sync` 递归复制 `.agents`、`.claude`、`overrides`、`scripts` 到 `enhancements/0.6`。
- flower-trellis 运行时从随包 `enhancements/0.6` 离线应用。
- 独立 skill-garden 安装器直接读取 vendor 仓内 `.trellis/0.6`。
- 当前 dogfood 目标为项目根 `.trellis`、`.agents`、`.claude`、`.codex`。

## 2. 当前 Flower 执行路径

`src/lib/apply-enhancements.js` 当前顺序：

1. `prepareEnhancementTransforms()` / `applyPreparedTransforms()`。
2. 复制 Skill、Script、Flower 自有资产。
3. 同步 common skill 和清理 manifest stale paths。
4. `injectWorkflow()`。
5. `injectSkillOverrides()`。
6. `injectHookOverrides()`。
7. `applyCodexTweaks()` / `applyClaudeTweaks()`。
8. 写 `.flower-manifest.json`。

现有 transform 预检只覆盖第一步；后续 required 注入没有统一 preflight。

## 3. 当前声明式 Transform

- JS：`src/lib/enhancement-transform.js`，422 行。
- Python：`vendor/skill-garden/scripts/apply-trellis-transforms.py`，476 行。
- 源：`overrides/transforms/intent-routing.json`，包含 13 个 operation。
- 能力：literal selector、`insert/replace/remove`、HTML/hash/slash marker、required/optional、首次备份、并发复核、路径安全。
- 限制：只支持字面文本；target kind 只用于 marker 默认值，没有 Markdown/JSON/YAML/TOML 结构语义；声明、matches、content 分散在三个位置。

## 4. 当前 Workflow 注入

- JS：`src/lib/workflow-inject.js`，188 行。
- 独立安装：`install.sh` 中约 200 行内嵌 Python。
- Hub 插在 `## Phase Index` 后；先按旧 section/sentinel 名称清理。
- `replaceState()` 实际是 `新 guard + 上游原 body`，不是 body replacement。
- 当前最终 `in_progress` 同时含 Skill-Garden post-check/Push 门禁和上游 `Flow -> finish-work` 文案，需要额外写“下方无效”。
- 0.6 有四个 additive state 源；`no_task` 已由 transform 替换。目标方案统一为五个结构化 state body Patch。

## 5. 当前 Skill Override

- JS：`src/lib/skill-override-inject.js`，158 行。
- 独立安装：`install.sh` 内嵌 Python。
- 源：`overrides/skills/trellis-update-spec.md`、`trellis-finish-work.md`。
- 通过 frontmatter 或 H1 后插入高优先级 managed block，保留上游全文。
- Update-Spec 最终 `.agents` Skill 约 14.1 KB；原始备份约 10.1 KB。旧 `Interactive Mode` 仍存在，只被顶部规则压制。
- Finish-Work 最终 `.agents` Skill 约 8.2 KB；原始备份约 3.7 KB。新 6 步 exact bookkeeping 与旧 Step 1-4 并列。
- 目标方案：Update-Spec 保留上游模板，替换冲突章节；Finish-Work 保留 frontmatter，替换 document body。

## 6. 当前 Hook 与平台修改

- `hook-override-inject.js` 将 shared `inject-workflow-state.py` 整文件覆盖到已有 Codex/Claude Hook，不创建平台目录。
- `codex-tweaks.js`：
  - 注释旧 TOML `[features.multi_agent_v2]` section。
  - 合并 `.codex/hooks.json` 的 Trellis SessionStart 和 Flower update Hook。
  - 将命令归位到 matcher，timeout 归一为 30。
  - 强制 `.trellis/config.yaml` 的 `codex.dispatch_mode=sub-agent`。
- `claude-tweaks.js`：将 Flower update Hook 只保留在 `startup` matcher，timeout 归一为 30。
- 当前 JSON 损坏时使用空壳重建，可能覆盖未知用户内容；新 Patch 方案改为失败保护。
- Flower update Hook 引用 Flower 自有 `.trellis/scripts/flower_update_hook.py`，因此 Flower 平台 Patch 不可由独立 skill-garden consumer 自动启用。

## 7. 独立安装器差异

- 当前独立 `install.sh` 在资产复制前运行 transform runner。
- 0.6 Workflow 与 Skill override 由两段内嵌 Python在资产复制后运行。
- 当前独立安装器没有执行 Flower 的 Codex/Claude 平台 tweak；shared Hook override 也没有独立入口。
- 新方案：独立安装器一次调用 Skill-Garden Patch runner；Flower catalog 仍只由 flower-trellis 加载。

## 8. Manifest 与快照

- `.flower-manifest.json` 当前记录 `flowerVersion`、Trellis `version`、variant、skills、paths 和 updateCheck policy。
- manifest 只在全装成功后写；`--skills` 不写 manifest、不清 stale。
- 新方案在全装 manifest 中增加 Patch catalogHash 和 applied provenance；精细安装继续依靠 marker/结构化身份与本次结果。
- `sync-enhancements.mjs` 当前记录 workflowStates、skillOverrides、hookOverrides、transformFiles；目录迁移后改为 bundles/patchFiles。

## 9. 上下文预算基线

- 当前完整 workflow：约 59.7 KB。
- Hub：约 12.2 KB。
- 四个 additive state 源合计：约 7.8 KB，但最终 state 还包含上游 body。
- Phase summary：约 20.3 KB。
- SessionStart fixture：约 19.7 KB。
- Update-Spec 最终 Skill：约 14.1 KB。
- Finish-Work 最终 Skill：约 8.2 KB。
- 现有 checker 没有测最终 Skill，也从旧源目录读取 state；新方案必须改测 Patch 后有效产物。

## 10. 关键风险

- workflow-state 完整 body 替换可能遗漏上游仍有效的一跳动作，必须与 Trellis 0.6.5 模板做正反向断言。
- 统一 preflight 必须覆盖 Skill-Garden 与 Flower 两个 catalog，但它们的 consumer/资产所有权不同。
- JSON Hook 需要基于 command identity 归位，不能按数组位置或整文件覆盖。
- YAML/TOML 不应引入任意脚本或无边界正则；无法唯一解析时失败。
- 新 marker 无法被旧执行器完整逆向恢复；自动降级必须失败保护，回滚使用首次备份。
- JS/Python 是两个正式 consumer，schema 和行为修改必须共享 fixture 并同步验证。
- 任务创建前 `vendor/skill-garden/.trellis/0.6/overrides/transforms/content/workflow-request-triage.md` 已有 dirty baseline：文件末尾多一个孤立 `?`。迁移时先从已提交正文和实际 diff 复核有效规则，再随旧 `transforms/` 删除；不得把该字符带入新 content，也不得在迁移前单独回退用户工作区。
