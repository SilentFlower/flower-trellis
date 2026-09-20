# 为 aliyun-ops 增加 ACK Workbench 只读运维能力

## Goal

让 AI 在本机无法直连私网 ACK APIServer、且没有 ECS SSH 凭证时，仍可复用已有阿里云 AK/SK 与 Workbench CLI，安全查询 ACK 集群、节点和命名空间内的 Kubernetes 资源，并把同一能力交付到 Skill-Garden 作者源、Flower 离线快照及当前机器的 Codex/Claude 全局 Skill。

## Background

- `vendor/skill-garden/.common` 是 common Skill 作者源，`npm run sync` 会生成 `enhancements/common/.common`；全局目录只是安装副本。
- 当前全局 Claude 副本已有未回源的 ACK OpenAPI、KubeConfig 和 APIServer 直连实现，但私网 APIServer 在本机不可达，也没有 Workbench 跳板能力；全局 Codex、作者源与 Flower 快照仍只有 DMS/SLS/MSE。
- 已实测当前 RAM 身份可以签发 30 分钟内网 KubeConfig，并可通过 Workbench CLI 1.0.1 对 ACK Worker 执行命令和传输文件；`xhgj-ai` 命名空间的 ConfigMap 列表查询成功。
- ACK OpenAPI、集群 RBAC 与 Workbench/ECS 权限是三个独立授权面，任一缺失都应给出可执行的诊断。

## Requirements

1. ACK 基础查询
   - `aliyun-ops` 增加 ACK 路由、参考文档和产品级 ENV 支持。
   - 提供集群列表、集群详情、关联云资源、节点列表和 KubeConfig 元信息查询。
   - ACK 请求使用独立的 ROA V3 签名实现，不与现有 RPC V1 或 LOG V1 签名混用。
2. Kubernetes 资源只读查询
   - 保留公网或网络可达场景下的 APIServer 直连查询。
   - 增加 Workbench 路径：签发短期内网 KubeConfig、上传至指定或自动选择的运行中 ACK Worker、执行结构化的只读 `kubectl get`、解析 JSON 后按既有规则输出。
   - 自动选节点时只从 ACK `DescribeClusterNodes` 返回的阿里云 Worker 中选择运行且 Ready 的实例；允许显式传入实例 ID 覆盖自动选择。
   - 只接受脚本内白名单资源及结构化 namespace/name 参数，不暴露任意远程 shell，也不提供 `apply`、`delete`、`patch`、`scale` 等写操作。
3. 凭证与内容保护
   - Workbench 路径固定使用 15～4320 分钟的临时 KubeConfig，默认 30 分钟；不得回显或持久保存正文。
   - 本地临时文件权限为 `600`，远端使用不可预测的 `/tmp` 文件名；成功、查询失败或解析失败时都尝试清理本地与远端文件，清理失败必须明确报错并给出精确残留路径。
   - Secret 仅输出键名，`data` 与 `stringData` 的值全部脱敏；错误输出继续清理 AccessKey 痕迹并限制长度。
   - 不创建、复制、改写或删除用户的真实 ENV 与 Workbench 配置文件。
4. 分发与说明
   - Codex 与 Claude 作者源逐文件一致，脚本保持可执行权限。
   - 运行项目既有同步命令生成 Flower common 快照，并更新 catalog 与 README 的 ACK 能力说明。
   - 将最终作者源分别同步到 `/root/.codex/skills/aliyun-ops` 与 `/root/.claude/skills/aliyun-ops`，不复制缓存文件。
   - ACK 参考文档说明命令、三层权限、Workbench 前置条件、私网链路、故障诊断和临时凭证生命周期。

## Constraints

- 不修改现有 DMS、SLS、MSE 的命令契约和安全边界。
- 不硬编码当前 ACK 集群、命名空间、ECS 实例、账号或凭证。
- 不修改当前仓库和 `vendor/skill-garden` 中与本任务无关的 Auto-Loop、spec、任务目录和其他未提交内容。
- 本任务不提交、不推送、不发布 npm 包，也不改变生产 Kubernetes 资源。

## Acceptance Criteria

- [ ] 作者源的 Codex/Claude `aliyun-ops` 均包含 ACK 脚本、参考文档和更新后的元数据，且逐文件与权限一致。
- [ ] `ack.py clusters/detail/resources/nodes/kubeconfig` 可通过 mock 契约测试；节点请求使用官方 `pageSize` / `pageNumber` 参数。
- [ ] `ack.py get` 的直连与 Workbench 两条只读路径均有测试，Workbench 测试覆盖自动选节点、上传、JSON 执行结果、Secret 脱敏以及成功/失败清理。
- [ ] 输入无法构造任意 kubectl 动词或远程 shell；不支持的资源、非法临时有效期和无可用 Worker 会在签发或上传前失败。
- [ ] `npm run sync` 后作者源与 `enhancements/common/.common` 逐文件一致，`MANIFEST.json` 和现有同步测试通过。
- [ ] catalog、Flower README 与 Skill reference 能准确说明 ACK/Workbench 能力与最小权限。
- [ ] `/root/.codex/skills/aliyun-ops` 与 `/root/.claude/skills/aliyun-ops` 同步到最终作者源且不含 `__pycache__`/`.pyc`。
- [ ] 在当前已授权环境完成一次只读在线冒烟：通过 Workbench 获取 `xhgj-ai` 命名空间 ConfigMap 列表，输出不包含 ConfigMap 正文、Secret 或 KubeConfig。

## Out of Scope

- 修改或部署 Kubernetes 工作负载、ConfigMap、Secret、RBAC、节点或 ACK 集群配置。
- 代替用户创建、扩大或持久化 RAM、ECS、Workbench、ACK RBAC 权限。
- 将 Workbench 封装成通用远程执行器，或支持 Windows ECS、非 ACK ECS 和任意 kubectl 插件。
