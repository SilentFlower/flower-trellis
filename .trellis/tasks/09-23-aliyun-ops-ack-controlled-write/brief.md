# Brief — aliyun-ops ACK 受控写命令与 DMS 参数修复回灌

## Goal

- 为 ACK 增加一个两端通用的受控写入口，Claude 和 Codex 在用户确认后都走这一个入口改生产 Deployment，不再各自解读 skill。同时修复 `ack.py` 错误路径的缺陷，并把只存在于全局 Codex 副本里的 DMS 工单修复写回作者源。

## Scope

- 新增 `ack.py set-image`：切换或回退 Deployment 的容器镜像。
- 新增 `ack.py set-env`：设置或删除 Deployment 容器上指定的环境变量键。
- 新增 `ack.py rollout-status`：只读，等待并输出滚动发布结果。`set-image` 和 `set-env` 可加 `--wait`，在同一个会话里接着等发布完成。
- 写命令默认只预览，显式加 `--yes` 才执行；目标值和当前值相同时不执行写入。
- 在 ENV 里支持两个可选白名单：`ALIYUN_ACK_WRITE_NAMESPACES` 和 `ALIYUN_ACK_IMAGE_PREFIXES`。配置了就强制校验，没配置就不限制。
- 修复 B1：`scrub(异常对象)` 抛出 `TypeError`，把真实报错盖住了。
- 修复 B2：上传失败时报错里只剩进度动画；远端 `unlink` 找不到文件时又误报一条清理失败。改为：上传失败自动重试 1 次，远端清理改用 `rm -f`。
- 抽取 `workbench_kubectl_session`，让现有的 `get --via-workbench` 和新增的写命令共用。
- DMS：把 `CreateDataCorrectOrder` 改成大驼峰参数的修复写回两份作者源。
- 同步更新 `SKILL.md`、`references/ack.md`、`assets/env.example`、spec `aliyun-ops.md` 和相关测试。
- 分发：修改作者源 → `npm run sync` → 覆盖全局 Claude/Codex 副本。

## Non-Goals

- 不做：`rollout-restart`、`apply`、`delete`、`scale`、任意字段的 `patch`、批量导入环境变量、`exec` 进 Pod、任意远程 shell。
- 写操作不支持直连 APIServer，只走 Workbench。
- 不改 NAT/SNAT、RAM/RBAC、Workbench 配置或用户的 ENV 文件；不改 DMS/MSE/SLS 的其它能力。
- 仓库根目录下未跟踪的 `.claude/skills/aliyun-ops` 和 `.agents/skills/aliyun-ops` 不处理。

## Key Decisions

- 写操作范围：镜像 + 环境变量 + `rollout-status`，不含重启（用户已确认）。
- 安全护栏：预览 + `--yes`，再加 ENV 里的可选白名单；脚本里不写死任何公司的命名空间或 ACR 地址（用户已确认）。
- 写命令隐式走 Workbench。`--container` 省略时，只有一个容器就自动选中，有多个容器则报错。
- `set-env` 遇到用 `valueFrom`（Secret/ConfigMap 引用）定义的键直接拒绝；预览只显示被修改键的新旧值。
- 写入成功但临时文件清理失败时，命令整体失败，但报错里会写明"写入已生效"，并列出残留文件路径。
- 文档里写明：禁止绕过受控入口，直接用 `workbench exec` 或临时脚本执行写操作。

## Key Context

- 作者源：`vendor/skill-garden/.common/.{codex,claude}/skills/aliyun-ops`（git submodule，两份须逐字节一致）。
- 快照：`enhancements/common/.common/...`，由 `npm run sync` 生成。
- 核心文件：`scripts/ack.py`（`scrub` :55、`get_via_workbench` :649、`main` :848）、`scripts/dms.py` 中的 `cmd_order`。
- 测试：`test/python/test_aliyun_ops.py`（`AckCliTest`，以作者源 `.codex` 为测试对象）、`test/js/aliyun-ops-skill.test.js`。
- Spec：`.trellis/spec/flower-trellis/cli/aliyun-ops.md` 原先把"生产写入"排除在外，这次要改为受控写入契约。

## Risks / Deferred

- 重构 `get_via_workbench` 是回归风险最高的一步，完成后要先跑全部既有 Workbench 测试再继续。
- 在线冒烟只做只读和预览（不带 `--yes`）。第一次真正写生产，留到你下次实际发布时。
- 需要先提交并推送 submodule，再在主仓提交快照和 submodule 指针。

## Acceptance

- 不带 `--yes` 时只执行 `kubectl get` 并输出预览；带 `--yes` 时执行固定命令。无变化时不写入。
- 配置白名单后，不命中的命名空间或镜像在任何网络调用之前就失败；预览会显示白名单是否生效。
- 非法镜像、键或值在网络调用之前失败；成功、失败、解析失败三种情况下，本地和远端的临时 KubeConfig 都会被清理。
- 任何 `AckError` 都输出为 `[ack] <消息>`，退出码 1，不再出现 `TypeError`。
- 上传失败时，报错里没有进度动画帧，也不再误报 `No such file`。
- DMS 工单参数为大驼峰字段，RPC 顶层没有 `EstimateAffectRows`。
- `npm test` 通过；作者源、快照、全局 Claude 与 Codex 副本逐字节一致，且不含 `__pycache__`。

## Next Step

- 运行 `task.py start` 后进入 `trellis-route(target=implement)`，先修 B1 和 B2 并补测试。
