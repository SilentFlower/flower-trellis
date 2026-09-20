# 设计：ACK Workbench 只读运维

## 架构边界

作者源继续位于 `vendor/skill-garden/.common/.codex/skills/aliyun-ops` 与 `.claude/skills/aliyun-ops`。两个平台使用相同文件树，Flower 只通过 `npm run sync` 生成 `enhancements/common/.common`，全局 Codex/Claude 在作者源与快照验证通过后再刷新。

ACK 能力由两个脚本组成：

- `ack_roa_v3.py`：只负责 ACS3-HMAC-SHA256 签名、ACK OpenAPI 请求和网络可达时的 Kubernetes GET。
- `ack.py`：负责 CLI、ACK 资源解析、安全输出以及 Workbench 编排。

## 查询链路

### 直连

`get` 获取 KubeConfig，提取 APIServer 与客户端证书，通过标准库 HTTPS 执行固定的 GET 路径。该路径保持现有行为，适用于公网端点或本机位于 VPC 内的环境。

### Workbench

1. 校验资源白名单、namespace/name、有效期与 Workbench CLI 可用性。
2. 未传 `--instance-id` 时调用 `GET /clusters/{cluster}/nodes?pageSize=100&pageNumber=1&state=running`，从 `is_aliyun_node=true`、`instance_role=Worker`、`instance_status=Running`、`node_status=Ready` 的节点中稳定选择第一个 instance ID。
3. 调用 `GET /k8s/{cluster}/user_config`，固定 `PrivateIpAddress=true` 并传短期 `TemporaryDurationMinutes`。
4. 在权限为 `600` 的本地临时目录写入随机文件名，通过 `workbench upload <file> /tmp/` 上传。
5. 由白名单资源和经过 shell quote 的标识符构造唯一远程命令：`KUBECONFIG=<path> kubectl get ... -o json`。Workbench 使用 JSON 输出，脚本同时校验本地进程退出码、返回 JSON 结构与远端 `exit_code`。
6. 解析 kubectl JSON，统一移除噪音字段并对 Secret 脱敏，再按 `summary` 或 `json` 输出。
7. `finally` 中通过 Workbench `unlink -- <path>` 清理远端文件，本地优先调用参数数组形式的 `shred -u -- <path>`，不可用时回退 `unlink`。清理失败会覆盖成功状态并给出精确残留路径。

## 安全契约

- CLI 不接受自由格式 kubectl 参数或 shell 字符串。resource 必须命中静态 API 组映射，namespace/name 作为独立参数经 shell quote 后拼入固定命令。
- Workbench 用户、认证类型和远端目录不开放为自由参数；使用 Workbench 默认的免密 root 会话与 `/tmp`。
- Workbench profile 可显式选择，默认 `aliyun-ops`；Skill 不创建或修改 profile。
- KubeConfig 不进入 stdout/stderr、命令行或 Workbench command 字符串，只作为文件传输。
- Secret 的 `data` 和 `stringData` 都替换为 `<REDACTED>`；列表与单对象走同一清理函数。

## 错误模型

- ACK HTTP 非 200：返回脱敏并截断的服务端错误。
- 无可用 Worker：在签发 KubeConfig 前失败，并提示显式 `--instance-id`。
- Workbench 缺失、profile 不存在、RAM 权限不足、云助手不可用、上传失败、kubectl/RBAC 失败分别保留 CLI 可诊断文本，但不回显凭证。
- 查询阶段错误与清理错误同时发生时，查询错误保留为主错误，并追加清理失败信息；查询成功但清理失败时整体失败。

## 兼容与回滚

- 现有 DMS/SLS/MSE 文件仅修改公共产品枚举和说明，不改变命令参数。
- ACK 旧实现从全局 Claude 副本吸收到作者源，并补充 Workbench；全局 Codex 从统一源获得相同能力。
- 回滚时删除新增 ACK 文件并恢复公共枚举、Skill 元数据、测试和说明，重新运行 `npm run sync`；用户 ENV 与 Workbench 配置始终不在回滚范围内。
