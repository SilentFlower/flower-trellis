# Trellis Push 输出模板分层设计

## 1. 设计结论

采用一个 `references/output-templates.md`，只承载用户可见的计划、结果模板和展示规则。`SKILL.md` 仍是唯一执行契约，负责回答“何时输出、是否确认、能否提交、如何恢复”；reference 只回答“确认需要展示时长什么样”。

不把计划和结果拆成两个 reference。两者共享字段行格式、文件展开阈值、dirty/risk 展示等规则，放在一个文件内更容易保持视觉一致，也避免主 Skill 需要管理多个展示依赖。

## 2. 分层边界

```text
trellis-push/SKILL.md
  -> 模式与职责边界
  -> Step 0-2 完成链证据、仓库发现、文件归属
  -> Step 3 确认门与输出时机
       -> 输出前读取 references/output-templates.md#计划
  -> Step 4-5 精确 Git 动作与任务进度
  -> Step 6 结果语义与输出时机
       -> 输出前读取 references/output-templates.md#结果

references/output-templates.md
  -> 计划 Markdown 模板
  -> 计划/结果共用展示规则
  -> 结果 Markdown 模板
  -> untracked 的展示替换规则
```

主 Skill 保留以下不可下沉内容：

- 确认前禁止副作用、普通多仓只确认一次。
- planned / retained / risk 的归属语义和重新规划条件。
- auto-loop 内部 `commit-only` 的预授权、逐仓数据、自修复和失败关闭边界。
- exact commit、push、任务进度和 completed 激活协议。
- reference 缺失时的失败关闭行为。

## 3. 交互路径

### 3.1 普通 Push / 用户 Commit-Only

```text
预检与归属完成
  -> 即时读取 output-templates.md 的计划部分
  -> 渲染 Trellis Push 计划
  -> 等待一次确认
  -> 执行 exact commit/push
  -> 即时读取 output-templates.md 的结果部分
  -> 渲染 Trellis Push 结果
```

“即时读取”是输出事件级要求，不是 Skill 初始化要求。计划和结果属于两个不同输出事件，因此结果阶段再次读取，不依赖先前上下文仍然保留模板。

### 3.2 Auto-Loop 内部 Commit-Only

```text
runner commit_only action + 既有预授权
  -> trellis-push 主 Skill 形成逐仓执行数据
  -> exact commit / generate / commit
  -> 返回 commits、files、retained、message、失败位置
  -> trellis-auto-loop 执行 record + next
```

该路径没有交互式计划或结果渲染，因此不为了执行而读取输出模板，也不会出现“确认执行请回复 `确认`”。逐仓执行数据是安全与恢复输入，继续由主 Skill 定义；runner 的 `record` 载荷继续由 `trellis-auto-loop` 定义。

这意味着本次分层对 Auto-Loop 的运行时影响应为零：不增加 reference I/O，不改变 action，不改变提交链，不改变失败类型。唯一需要的是静态回归断言，防止未来把“输出模板”误解释成内部模式也必须展示的 UI。

## 4. 文件范围

### Skill Garden Canonical

- `vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-push/SKILL.md`
- `vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-push/references/output-templates.md`
- `vendor/skill-garden/.trellis/0.6/.claude/skills/trellis-push/SKILL.md`
- `vendor/skill-garden/.trellis/0.6/.claude/skills/trellis-push/references/output-templates.md`

### Flower 同步产物

- `enhancements/0.6/.agents/skills/trellis-push/**`
- `enhancements/0.6/.claude/skills/trellis-push/**`
- `.agents/skills/trellis-push/**`
- `.claude/skills/trellis-push/**`
- `enhancements/MANIFEST.json`
- `vendor/skill-garden` gitlink

### 测试

- `test/js/update-spec-auto-decision.test.js`：把模板字段断言转到新 reference，并校验即时读取契约。
- `test/js/workflow-gate-ownership.test.js`：继续校验主 Skill 的 Auto-Loop 语义；增加“不渲染交互模板/不再次确认”的分层断言。
- `scripts/check-output-templates.mjs` 现有递归 Markdown 扫描可直接覆盖 reference，预计无需修改。

若实现时发现其它测试直接从 `SKILL.md` 读取已迁移模板字段，只调整测试的数据源，不迁移或复制模板回主 Skill。

## 5. 同步与提交顺序

Skill Garden 是 durable source，Flower 的 `enhancements/0.6` 是发布快照，项目 `.agents` / `.claude` 是 dogfood 输出。实现后的确定性顺序为：

```text
Flower: switch beta -> merge --ff-only main
  -> Skill Garden: 保持现有 beta
修改并验证 Skill Garden canonical
  -> 提交 Skill Garden
  -> 在 Flower 运行 npm run sync
  -> 更新 enhancements/MANIFEST.json.sourceCommit
  -> 同步/验证当前 dogfood 副本
  -> 提交 Flower 父仓与 submodule pin
```

父仓现有 `beta` 指向 `558a7bd`，任务确认时的 `main` 指向 `f5f4894`；`main...beta` 为 `3/0`，说明 `beta` 没有独有提交，可安全 fast-forward。若执行前该关系发生变化，停止分支更新并重新确认，禁止强制移动分支。

最终提交仍由 `trellis-push` 生成精确多仓计划并经用户确认，本任务不在实现阶段裸提交或推送。

## 6. 失败行为

- 输出前无法读取 reference：停止并报告阻塞，不生成近似计划或结果。
- reference 存在但缺少对应模板段：视为契约损坏，同样阻塞。
- 同步后四份 reference 不一致：验证失败，不进入提交阶段。
- Auto-Loop 回归断言发现交互提示进入内部模式：验证失败，修复分层措辞，不修改 runner 来适配错误展示层。

## 7. 预期效果

- 主 `SKILL.md` 预计从约 350 行降到约 260 至 280 行，入口读取时减少大段固定 Markdown 模板。
- 真正生成计划或结果时才加载约百行 reference，模型在输出点附近获得 canonical 格式。
- Auto-Loop 继续只读取并执行主 Skill 的提交语义，不为不可见模板增加上下文或交互步骤。
