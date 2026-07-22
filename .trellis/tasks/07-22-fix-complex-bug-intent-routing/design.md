# 技术设计

## 设计目标

在不引入新的确定性分类器、不扩大高频上下文预算的前提下，增强模型对 BUG 修复意图的两阶段判断：先判断是否授权修改，再判断是否需要任务规划。

## 规则归属

- workflow hub：保存完整且权威的意图判定语义，包括两维判断、inspect 后重分类、复杂实现信号和显式流程切换边界。
- Request Triage：保留 Phase 1 入口需要执行的简短判断，引用 hub 的复杂度口径，避免形成第二份完整规则。
- `workflow-state:no_task`：只保留当前状态的一跳动作，不复制复杂信号清单。
- `task_intent.py`：继续只负责已判定为 `task_plan` 后的任务创建和安全 discard，不承担自然语言分类。

## 判定流程

```text
用户请求
  -> 是否仅要求诊断？
       -> 是：inspect，禁止编辑
       -> 否：是否授权修复？
            -> 否：discuss / inspect
            -> 是：范围是否已经明确？
                 -> 否：先 inspect，得到范围后重新分类
                 -> 是：按 scope / risk / side effects 判断
                      -> 局部、低风险、可逆：direct_edit
                      -> 复杂实现信号：task_plan
```

“改一下”“修第 1 个”属于修复对象或方案确认，不能自动进入 `direct_edit`。明确的“直接做”“不要任务”仍可覆盖自动任务规划，但该覆盖必须来自当前请求中的清晰流程指令，不能由模型从普通修复措辞中推断。

## 复杂实现信号

- 权限、认证、数据范围或安全边界。
- 共享服务、公共契约或多个消费者。
- 跨包、跨层、多个入口或统计/导出一致性。
- 数据库、迁移、配置、发布或外部系统影响。
- 历史回归分析或需要系统性回归测试。
- 范围仍不确定，无法证明属于局部低风险修改。

这些信号用于语义判断，不实现机械文件数阈值；文件数量只能作为已经查明后的辅助证据。

## 发布与同步

1. 修改 `vendor/skill-garden/.trellis/0.6/overrides/patches/` 下的源文件。
2. 运行 `npm run sync` 生成 `enhancements/0.6` 快照。
3. 将同一规则同步到当前 dogfood `.trellis/workflow.md`，确保本项目后续会话立即使用。
4. 验证 vendor、snapshot 和最终 dogfood 产物无漂移。

## 测试设计

- JS apply 测试断言最终 workflow 包含两维授权、inspect 后重分类和复杂信号。
- 精细安装测试继续验证 `task-intent` / `intent-routing` Bundle 完整、二次应用幂等。
- Python catalog preflight 继续验证真实 catalog 可完整应用。
- 运行默认与 strict AI context budget，审阅 workflow control 和 state 增量。

## 兼容性与回滚

- 不改变 task JSON schema、helper CLI 或现有任务生命周期，兼容风险集中在 prompt 语义。
- 回滚时恢复对应 Patch 源文本、重新 sync 并同步 dogfood；不需要迁移用户数据。
