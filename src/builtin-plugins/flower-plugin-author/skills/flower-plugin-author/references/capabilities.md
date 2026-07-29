# Capability Profiles

- `standard`：被动分发 skills、specs、assets、scripts、tests。
- `integration`：在 standard 基础上可请求受限 `patch.insert`，需要 Marketplace `maxProfile=integration` 和项目批准。
- `system`：只属于 Flower 进程内 builtin 信任根，外部 Plugin 禁止申请。

required capability 被拒绝会使 validate 失败；optional capability 被拒绝只产生诊断。不要通过 entry 字段、Provider JSON 或自定义脚本模拟信任标记。

默认 scaffold 使用 standard 且不生成 Patch。只有明确需要宿主 Markdown 插入时，才使用 `--profile integration --patches`。
