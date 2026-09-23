# aliyun-ops ACK 受控写命令与 DMS 参数修复回灌

## Goal

让 Claude 与 Codex 在用户明确确认后，通过 `aliyun-ops` 的同一受控入口完成 ACK 私网集群的常见发布变更，
消除两端对 "ACK 只读" 边界的不同解读；同时修复 `ack.py` 错误路径缺陷，并把只存在于全局 Codex
副本的 DMS 工单参数修复回灌作者源，恢复作者源、快照与全局副本一致。

## Background / Confirmed Facts

- 全局 `~/.claude/skills/aliyun-ops` 与 `~/.codex/skills/aliyun-ops` 的 `SKILL.md`、`references/ack.md`、
  `scripts/ack.py` 逐字节一致；两端行为差异来自模型对同一句约束的解读，而非内容差异。
- `SKILL.md` 配置纪律与 spec `.trellis/spec/flower-trellis/cli/aliyun-ops.md` 均声明 ACK 只读、不提供
  `apply/delete/patch/scale` 与远程 shell；09-20 任务 `09-20-aliyun-ops-ack-workbench` 把写操作列为 Out of Scope。
- Claude 会话 `00249f5b`（xhgj-ai-harness）按该约束两次拒绝切镜像，用户追问后改用 `/tmp` 一次性脚本
  复用 `ack.py` 内部函数完成 `kubectl set image`；同一会话更早还用 `/tmp/wf_set_env.py` 改过 Deployment 环境变量。
- Codex 会话 `rollout-2026-09-22T17-40-23` 直接组合 `ack.py kubeconfig --internal --save` +
  `workbench upload` + `workbench exec "kubectl set image / rollout status"` 完成多个生产 Deployment 发布与回退。
- 实际出现过的写需求：切换 Deployment 容器镜像（含回退到旧 tag）、修改 Deployment 容器环境变量，
  以及发布后等待 `rollout status`。
- 缺陷 B1：`ack.py main()` 以异常对象调用 `scrub(error)`，`scrub` 对非字符串执行 `json.dumps`，
  导致所有 `AckError` 在输出时被 `TypeError: Object of type AckError is not JSON serializable` 掩盖
  （`scripts/ack.py:864`、`scripts/ack.py:61-62`）。
- 缺陷 B2：`workbench upload` 偶发失败时，错误详情只截取到进度动画帧，真实原因丢失；远端清理使用
  `unlink --`，上传未落盘时报 `No such file or directory`，产生误导性的清理失败（`scripts/ack.py:680-691`、`:720-730`）。
  同一会话重试一次即成功。
- DMS：全局 Codex 副本 `scripts/dms.py` 已把 `CreateDataCorrectOrder` 的 `Param` 字段改为大驼峰
  （`DbItemList/DbId/Logic/SqlType/ExecSQL/EstimateAffectRows/Classify/RollbackSqlType/RollbackSQL`），
  并移除顶层重复的 `EstimateAffectRows`；作者源 `vendor/skill-garden/.common/.{codex,claude}`、
  common 快照与全局 Claude 副本仍是旧的小驼峰版本。
- 分发链：先改 `vendor/skill-garden/.common/.codex|.claude/skills/aliyun-ops` 作者源，再 `npm run sync`
  生成 `enhancements/common/.common/...` 快照，最后更新全局安装副本；四处除缓存外须逐字节一致。

## Requirements

- R1 ACK 受控写入口（用户已确认范围：镜像 + 环境变量）：新增 `set-image`（切换/回退 Deployment 指定容器镜像）、
  `set-env`（设置或删除 Deployment 指定容器的指定环境变量键，不支持批量导入）与只读的 `rollout-status`
  （等待并输出滚动发布结果）；不含 `rollout-restart`。三者复用现有内网临时 KubeConfig +
  Workbench 上传/执行/清理链路；远端命令只由结构化参数生成，不接受自由格式 kubectl 参数或远程 shell。
- R2 预览与确认：写命令默认只输出变更预览（目标集群/命名空间/Deployment/容器、当前值 → 目标值），
  必须显式 `--yes` 才执行，与 DMS 工单的确认模型一致；当前值与目标值相同时不执行写入。
- R2a 可选白名单（用户已确认）：从 ENV 读取 `ALIYUN_ACK_WRITE_NAMESPACES`、`ALIYUN_ACK_IMAGE_PREFIXES`
  （逗号分隔）；配置时强制校验，未配置不限制。脚本与文档不得写死任何公司命名空间或镜像仓库地址。
- R3 B1 修复：错误输出对异常对象先转字符串再脱敏，任何 `AckError` 都以 `[ack] <消息>` 形式输出、退出码 1。
- R4 B2 修复：远端清理对不存在的文件幂等；上传失败的错误详情去除进度动画噪声并保留真实原因。
- R5 DMS 回灌：把全局 Codex 副本中的 `CreateDataCorrectOrder` 参数修复写入两份作者源并同步快照，补测试。
- R6 文档与契约：`SKILL.md`、`references/ack.md` 与 spec `aliyun-ops.md` 同步改为"只读查询 + 受控写命令"，
  明确禁止绕过受控入口直接用 `workbench exec` 执行写操作。
- R7 分发：作者源 → `npm run sync` → 全局 Claude/Codex 副本，四处一致且不含 `__pycache__`。

## Acceptance Criteria

- [ ] 写命令未带 `--yes` 时只输出预览且不调用任何 Workbench 写执行；带 `--yes` 时执行并输出结果。
- [ ] 配置白名单后，不命中的命名空间或镜像在任何网络调用前失败；未配置时不限制；预览显示白名单是否生效。
- [ ] 写命令的远端命令完全由白名单参数生成，单测断言 argv/命令字符串且覆盖非法输入在网络调用前失败。
- [ ] 写命令复用既有清理契约：成功、失败、解析失败均清理本地与远端临时 KubeConfig。
- [ ] `ack.py` 任一 `AckError` 输出为可读消息，不再出现 `TypeError`；有单测覆盖。
- [ ] 上传失败时远端清理不再报 `No such file`；错误消息不含进度动画帧；有单测覆盖。
- [ ] DMS `order` 提交参数为大驼峰字段且无顶层 `EstimateAffectRows`；有单测覆盖。
- [ ] `SKILL.md`、`references/ack.md`、spec 描述与实现一致；`npm test` 通过。
- [ ] 作者源、common 快照、全局 Claude 与 Codex 副本除缓存外逐字节一致。

## Out of Scope

- `rollout-restart`、`apply`、`delete`、`scale`、`patch` 任意字段、批量导入环境变量、`exec` 进 Pod、任意远程 shell。
- 修改 NAT/SNAT、RAM/RBAC 授权、Workbench 配置或用户 ENV 文件。
- DMS/MSE/SLS 的其它能力变更。
