# Flower Plugin Capability Policy 与 Patch Engine 集成技术设计

## 1. 处理顺序

```text
Plugin manifest request
        ∩ Marketplace maxProfile
        ∩ Runtime hard limits
        ∩ Project approval
                |
          CapabilityGrant
                |
 external catalog subset validation
                |
 normalize qualified identity
                |
 preparePatchPlan(all catalogs once)
                |
 PatchMutation[] + ContentMutation[]
                |
 P2 InstallPlan + transaction writer
```

Capability Policy 在 Patch Engine 之前，事务在 Patch Engine 计划之后。任何层都不能边校验边写盘。

## 2. 建议文件布局

```text
src/plugin/
├── capabilities/
│   ├── profiles.js
│   ├── policy-engine.js
│   └── approval-digest.js
└── install/
    └── patch-planner.js
```

必要时只对 `src/lib/patch-engine.js` 增加稳定 plan/mutation 读取接口；不得复制 selector 实现或改变 legacy apply 路径。

## 3. 信任根

builtin provider 在进程内附加私有 symbol/闭包标记。Policy Engine 只有在 provider 实例来自 Flower 内置注册表且标记匹配时才考虑 system；序列化后的 descriptor、缓存、lock 和 Marketplace 数据不携带该标记。

## 4. Integration 子协议

- profile 只映射到固定 capability set，不接受任意字符串。
- operation 为 insert。
- selector 为 literal、workflow-hub、markdown-section。
- target kind 为 workflow 或 markdown，最终路径匹配 `.trellis/workflow.md` 或 `.trellis/spec/**/*.md`。
- target 必须存在，`missing=create` 永远拒绝。
- adapter registry 为空；外部 catalog descriptor 不接受 adapter 字段。

任何扩大 target/selector/operation 的需求都视为协议变更，需要新的测试与安全评审。

## 5. Approval Digest

对以下 canonical JSON 计算 SHA-256：Plugin canonical ID、version、content digest、source/index commit、requested capabilities、Marketplace max profile、Runtime policy version、规范化 operation/selector/target 列表。摘要不包含本机平台、绝对路径或交互时间。

## 6. Patch Planner

1. 为每个 Plugin 校验 grant 和 catalog 子协议。
2. Runtime 生成不可伪造 catalog ID 与 marker namespace。
3. 合并内置和外部 descriptor，一次调用 `preparePatchPlan()`。
4. 执行现有 compatibility/conflict report。
5. 从 plan.files 的 before/next/hash/provenance 构造 `PatchMutation[]`。
6. 与 P2 `ContentMutation[]` 按目标路径合并检查。

Plugin Runtime 不调用 `applyPatchPlan()`；P2 writer 负责真正写盘。legacy enhancement 继续使用原 API。

## 7. 回滚

- P4 失败时 Runtime 只允许 standard 内容分发，外部 Patch 返回不可用。
- 不通过放宽 allowlist、摘要或 required 语义恢复功能。
- 对 Patch Engine 的任何扩展都必须保持现有 API 和测试兼容，可独立回滚。
