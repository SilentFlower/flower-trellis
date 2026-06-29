# Spec router for project SOP discovery

## Goal

让 skill-garden 0.6 提供一个通用的项目知识发现机制，使 AI 在执行流程性或高影响动作前，能主动发现并读取目标项目 `.trellis/spec/` 中的 SOP / 经验教训 / 标准流程，而不是依赖每个 SOP 都做成 Skill。

## Background

- 用户希望保留 `release-and-publishing.md` 这类 SOP 作为 spec 文档，而不是为每个 SOP 创建一个 Skill，避免 Skill 数量膨胀和入口混乱。
- 当前 Trellis 的 spec index 能让模型“读到就知道”，但问题是模型有时不知道某个 SOP 存在，因此不会主动读取。
- 目标落点不是本仓本地手改，而是 skill-garden 强化包：改 `vendor/skill-garden/.trellis/0.6` 源，通过 `npm run sync` 进入 `enhancements/0.6` 快照，再由 flower-trellis 安装 / 升级到目标项目。
- 第一版不做 hook 自动语义注入，先通过 skill-garden workflow hub / workflow-state 高频提示，让 AI 在流程性或高影响动作前运行一个通用 Python 发现器。

## Requirements

### R1. 通用发现器

- 在 skill-garden 0.6 分发一个 Python 脚本资产 `spec_router.py`，安装到目标项目 `.trellis/scripts/spec_router.py`。
- 脚本扫描目标项目 `.trellis/spec/**/*.md`，包括共享层 `.trellis/spec/guides/**/*.md`，返回与查询相关的 SOP / spec / thinking guide 候选路径、命中原因和建议动作。
- 脚本接受一个“描述意图动作的短查询”，而不是机械复制用户原话。
- 脚本必须在没有 `.trellis/spec`、没有匹配结果、文件读取失败等场景下优雅返回，不阻断外层工作流。

### R2. 文档元数据与退化检索

- Markdown 文件可选支持 YAML frontmatter，用于声明 `kind`、`triggers`、`load`、`priority` 等机器可读信息。
- 没有 frontmatter 的文件也应能通过文件名、标题、正文关键词等轻量规则参与检索。
- 第一版不引入第三方依赖，不要求完整 YAML 解析器；只支持简单列表 / 标量 frontmatter 即可。

### R3. skill-garden workflow 提示

- 在 `vendor/skill-garden/.trellis/0.6/overrides/workflow.md` 的高优先级 hub 中加入 Project Knowledge Discovery 规则。
- 规则采用用户确认过的文案：

```md
Before procedural or high-impact actions, run project knowledge discovery:

python3 ./.trellis/scripts/spec_router.py "<short query describing the intended action>"

Build the query from the current user request plus relevant immediate context:
the intended action, commands about to run, files or systems involved, package/layer,
and domain words such as release, publish, deploy, migration, config, CI, workflow,
hooks, rollback, data fix, or destructive command.

Read any matched SOP/spec files before acting; if nothing matches, continue normally.
```

- 在相关 `workflow-states/*.md` 中加入更短的 sentinel，避免模型只读 per-turn breadcrumb 时遗漏该发现步骤。

### R4. 分发与升级链路

- `npm run sync` 后，`enhancements/0.6/scripts/spec_router.py` 与 `vendor/skill-garden/.trellis/0.6/scripts/spec_router.py` 保持一致。
- `copy-scripts.js` 的脚本资产复制逻辑能把 `spec_router.py` 铺到目标项目 `.trellis/scripts/spec_router.py`。
- 如需支持 `--skills` 精细安装，必须给 `spec_router.py` 配置合理别名，避免只有全装才可获得脚本。

### R5. 非目标

- 不为每个 SOP 创建新 Skill。
- 不把项目私有 SOP 内容放进 skill-garden。
- 第一版不改 Codex / Claude hook 自动执行 `spec_router.py`。
- 第一版不做向量检索、BM25、外部索引或持久缓存。
- 第一版不修改 Trellis 上游核心脚本。

## Acceptance Criteria

- [ ] `vendor/skill-garden/.trellis/0.6/scripts/spec_router.py` 存在，并可在本仓运行：
  `python3 vendor/skill-garden/.trellis/0.6/scripts/spec_router.py "beta release publish tag changelog"`。
- [ ] 查询发版意图时能命中 `.trellis/spec/flower-trellis/cli/release-and-publishing.md`，输出路径、命中原因和“读取后再行动”的建议。
- [ ] 查询跨层、复用、经验教训或思考指南类意图时能命中 `.trellis/spec/guides/**/*.md` 中的相关文档。
- [ ] 查询无关意图时输出无匹配结果，并明确可以继续正常流程。
- [ ] `vendor/skill-garden/.trellis/0.6/overrides/workflow.md` 包含 Project Knowledge Discovery 规则，且文案不把查询写死为 user request。
- [ ] 相关 workflow-state sentinel 包含精简提示，并指向 `.trellis/scripts/spec_router.py`。
- [ ] `npm run sync` 后，`enhancements/0.6/scripts/spec_router.py` 与源文件一致，`enhancements/MANIFEST.json` 记录该脚本。
- [ ] 本仓 dogfood 副本 `.trellis/scripts/spec_router.py` 与快照一致，便于当前会话和后续任务立即使用。
- [ ] 安装 / 更新逻辑支持全装铺设 `spec_router.py`；如修改 `copy-scripts.js`，需通过 ESM 语法校验。
- [ ] 验证命令通过：Python 语法检查、`npm run sync`、必要的 `cmp -s` 同步检查、`git diff --check`。
