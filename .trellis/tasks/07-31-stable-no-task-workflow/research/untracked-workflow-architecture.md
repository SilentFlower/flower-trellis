# Untracked 工作流架构调研

## 现有所有权

- Request Triage 和 workflow state 负责识别 `direct_edit`，但当前 `[workflow-state:no_task]` 只覆盖入口，没有完成链阶段。
- `.trellis/.runtime/sessions/<context-key>.json` 已由活动任务、route、auto-loop 和 pre-check 共同使用；`pre_check_state.py` 证明了 session 隔离、保留未知字段和原子替换的可行模式。
- `route_state.py` 的个人偏好 `.trellis/.route-prefs.tmp` 与 task-scoped `route_decisions` 已分层实现。偏好解析和写入本身不依赖 task，现有 `resolve` 才依赖 current task。
- `task_intent.py` 已拥有 planning task 创建、Git baseline、session 指针和失败补偿逻辑，适合继续拥有 untracked -> task 的接管事务。
- Check-All、Update-Spec 和 Push 的完整规则分别属于现有 Skill；无任务状态只应提供阶段和一跳动作，不复制这些 owner 的协议。

## 状态持久化

建议新增 `.trellis/scripts/untracked_flow.py`，在当前 session runtime 的 `untracked_flow` 字段保存版本化对象：

```json
{
  "version": 1,
  "id": "<session-local-work-id>",
  "mode": "direct_edit",
  "source": "inferred | user-explicit",
  "summary": "<事项摘要>",
  "stage": "inspect | implement | check | spec | push",
  "baseline": null,
  "scope": [],
  "evidence": {},
  "created_at": "<UTC>",
  "updated_at": "<UTC>"
}
```

- 路由确定时创建 `inspect` 状态；首次写文件前通过 helper 捕获 baseline 并进入 `implement`。
- 一个 session 只允许一个活跃对象。无关只读请求不改状态；新的无关写请求由 workflow guard 阻止。
- 原始 baseline 一经捕获不覆盖。范围扩大只更新 `scope` 和当前 workspace fingerprint，避免把已有修改重新定义成“开始前状态”。
- 下游证据必须绑定 workspace fingerprint；发生新修改时清除 Check-All/Update-Spec 证据并退回 `implement`。
- Push 成功、用户明确放弃、成功纳管、工作区恢复 baseline 或状态确认失效时清理字段；不保留长期 `done` 状态。

## 多仓 Baseline

- 根仓 `git status` 只会把 dirty submodule 表示为指针变化，无法描述子仓内部文件，因此不能作为完整 baseline。
- `auto_loop.py::_git_repositories()` 已覆盖主仓和已初始化递归 submodule，`common.config.get_git_packages()` 返回 `.trellis/config.yaml` 中声明 `git: true` 的独立 package 名称到路径映射，可补充其余仓库。
- 每个仓库至少记录仓库相对路径、HEAD、porcelain entries 和相关内容指纹。只记录 status 不足以区分“开始前已 dirty”与“同一 dirty 文件后来再次修改”。
- 已 staged 内容也属于需要保留的 baseline 证据，本身不因无任务模式被重置或覆盖；冲突、未完成 Git 集成和无法读取完整证据才阻止首次写入，最终提交继续交给 Push 的 Git 安全门禁。
- 仓库发现、porcelain 解析和 fingerprint 计算应提取到可复用 helper，供 auto-loop、task intent 和 untracked flow 调用，避免三份略有差异的 Git 安全实现。

## Route 偏好

- 无任务 implement/check 不读取或写入 session `route_decisions`，也不创建 `scope=untracked` 的 route decision。
- `route_state.py` 增加纯偏好命令，例如 `read-pref --target`、`write-pref --target --mode` 和 `clear-pref --target`；这些命令复用现有合法值、mode 归一化和 `.route-prefs.tmp` 原子写入。
- 命中偏好后直接得到 inline/sub-agent；没有偏好时由现有交互提供“仅本次”或“保存默认”。仅本次选择不持久化。
- task 工作流的 runtime -> prefs -> auto-loop 解析顺序保持不变。

## Workflow 与 Hook

- 新增 `[workflow-state:untracked]` 作为无活动 task 但存在合法 untracked 状态时的首选 breadcrumb；没有合法状态时继续使用 `no_task`。
- breadcrumb 只注入 work id、stage、事项摘要和下一跳，不复制 Check-All、Update-Spec、Push 的 owner 规则。
- Codex/Claude SessionStart 各追加一条紧凑恢复提示，compact/resume 后仍能识别当前事项和阶段。
- runtime contract、Request Triage、Phase 2、相关 Skill 和 agent 提示需要同步承认 task 与 untracked 两种执行上下文，但 planning/Brief/task start 门禁保持 task 专属。

## Sub-Agent 上下文

- untracked dispatch 首行使用 `Untracked work: <id>`，不得伪造 `Active task:`。
- prompt 显式携带用户请求摘要、范围、原始 baseline 摘要、当前 workspace fingerprint、阶段、验证证据和相关 spec 路径。
- implement/check agent 接受 task artifacts 或 untracked prompt context 二选一；untracked 模式不得要求不存在的 `prd.md`、`implement.jsonl` 或 `check.jsonl`。
- 平台不支持所选 sub-agent 模式时沿用现有 fallback/阻断契约，不得静默切换 inline。

## Pre-Check 与证据

- `pre_check_state.py` 从只绑定 task 扩展为绑定结构化 subject：`task:<path>` 或 `untracked:<id>`。
- 读取时必须同时校验 context key 和 subject；旧版 task hold 继续兼容，非法或陈旧 hold 按 miss 处理。
- Check-All、Update-Spec 和 Push 仍由现有 Skill 记录和判断结果；untracked helper 只保存最小证据摘要、时间和 workspace fingerprint，供阶段恢复与失效判断。

## 纳管事务

- `task_intent.py` 新增 `adopt` 子命令，校验当前 session 的 untracked 状态和 workspace fingerprint 后调用现有 task 创建路径。
- 新 task 的 `meta.intentRouting` 记录 `adoptedUntracked`、work id、原始多仓 baseline、接管阶段、证据以及 `implementationStarted`。
- 事务顺序为：创建 planning task -> 写 task meta -> 确认 session current task -> 清理 untracked 状态。任一步失败都补偿新建 task 和 session 指针，原 untracked 状态必须保留。
- 接管后仍补齐规划材料、展示 Brief 并等待确认，再运行 `task.py start`。已完成修改或检查的事实可以作为上下文继承，但不能跳过规划与启动门禁。

## 分发与验证

- 真实源位于 `vendor/skill-garden/.trellis/0.6/`；新增 helper 要加入 `src/lib/copy-scripts.js` 和 builtin content adapter 的 alias 映射。
- intent-routing Bundle 需要覆盖 workflow、hook、skills、agents 和 helper 分发；随后执行 `npm run sync` 生成 `enhancements/0.6`。
- Patch 变更需要刷新 Skill-Garden compiled targets，并验证第二次 dogfood 应用修改数为 0。
- 测试应覆盖 helper 状态机、多仓 baseline、单活跃事项、偏好 miss/hit、pre-check subject、纳管补偿、hook breadcrumb、SessionStart、Bundle 精细安装、fresh install、upgrade 和完整 `npm test`。
