# 阿里云 ACK 查询与受控变更

用于查询 ACK 控制面信息，以及在本机无法访问私网 APIServer 时，通过 ACK Worker 和 Workbench CLI 查询 Kubernetes 对象。查询入口全部只读；变更只提供 Deployment 切镜像与改环境变量两个受控命令，默认预览、显式 `--yes` 才执行。

## 查询顺序

1. 先列集群并核对集群 ID、名称、地域和环境。
2. 用 `detail` 判断 APIServer 是否只有内网端点。
3. 用 `nodes` 核对可用 Worker；Workbench 路径未传实例 ID 时会自动选择运行且 Ready 的阿里云 Worker。
4. 先用 `get --format summary` 列名称和键，再按用户明确指定的资源名读取 JSON。
5. 本机能连 APIServer 时使用直连；私网端点使用 `--via-workbench`。

## ACK OpenAPI

```bash
python3 scripts/ack.py clusters
python3 scripts/ack.py detail --cluster <cluster-id>
python3 scripts/ack.py resources --cluster <cluster-id>
python3 scripts/ack.py nodes --cluster <cluster-id> --state running
```

KubeConfig 默认只输出 APIServer、过期时间和正文长度，不回显证书私钥：

```bash
python3 scripts/ack.py kubeconfig --cluster <cluster-id> --minutes 30
python3 scripts/ack.py kubeconfig --cluster <cluster-id> --internal --minutes 30
```

只有用户明确要求保存时才传 `--save`。保存文件固定为 `600`，使用结束后及时删除。

## Kubernetes 资源查询

网络可达时直接访问 APIServer：

```bash
python3 scripts/ack.py get --cluster <cluster-id> --namespace <namespace> \
  --resource configmaps --format summary

python3 scripts/ack.py get --cluster <cluster-id> --namespace <namespace> \
  --resource configmaps --name <configmap-name> --format json
```

APIServer 只有私网端点时，经 Workbench 在 ACK Worker 上执行固定的只读 `kubectl get`：

```bash
python3 scripts/ack.py get --cluster <cluster-id> --namespace <namespace> \
  --resource configmaps --format summary --via-workbench

python3 scripts/ack.py get --cluster <cluster-id> --namespace <namespace> \
  --resource deployments --name <deployment-name> --format json \
  --via-workbench --instance-id <ecs-instance-id>
```

Workbench 路径固定签发内网临时 KubeConfig，默认有效期 30 分钟；可用 `--minutes 15~4320` 缩短或延长。脚本使用随机 `/tmp` 文件名，并在成功、查询失败或 JSON 解析失败时清理本地与远端文件。清理失败会让命令整体失败并报告精确残留路径。

支持的资源以 `ack.py get --help` 为准，包括 Pod、Service、ConfigMap、Secret、Deployment、StatefulSet、DaemonSet、Ingress、Job 等常见命名空间资源。接口不接受自由格式 kubectl 参数或远程 shell。

Secret 的 `data` 和 `stringData` 值始终输出 `<REDACTED>`，只保留键名。ConfigMap 可在用户明确指定名称后输出正文；列表摘要只显示名称和键。

## 受控写命令

只在用户明确要求变更时使用。先不带 `--yes` 运行预览，把集群、命名空间、Deployment、容器、当前值 → 目标值和白名单状态展示给用户，获得确认后原样加 `--yes` 重跑。

```bash
# 切换或回退镜像（回退 = 用旧 tag 再执行一次）
python3 scripts/ack.py set-image --cluster <cluster-id> --namespace <namespace> \
  --deployment <deployment> [--container <container>] --image <registry/repo:tag>

# 设置或删除指定环境变量键（均可重复）
python3 scripts/ack.py set-env --cluster <cluster-id> --namespace <namespace> \
  --deployment <deployment> [--container <container>] --set KEY=VALUE --unset OLD_KEY

# 确认后执行并在同一会话等待发布完成
python3 scripts/ack.py set-image ... --yes --wait --timeout 300

# 只读等待或查看发布状态
python3 scripts/ack.py rollout-status --cluster <cluster-id> --namespace <namespace> \
  --deployment <deployment> --timeout 300
```

- 写命令固定经 Workbench 执行，复用临时内网 KubeConfig 与两端清理流程，无需 `--via-workbench`。
- Deployment 只有一个容器时可省略 `--container`；多个容器必须显式指定。
- 镜像必须带 `:tag` 或 `@sha256:` digest；当前值与目标值一致时不执行写入。
- `set-env` 只修改指定键，拒绝修改通过 `valueFrom` 引用 Secret/ConfigMap 的键；不支持批量导入。
- `--timeout` 为 10~570 秒。写入成功但等待或清理失败时，错误会注明"写入已生效"，不要重复执行写命令，先用 `rollout-status` 或 `get` 核对。
- 在私有 ENV 中配置 `ALIYUN_ACK_WRITE_NAMESPACES`、`ALIYUN_ACK_IMAGE_PREFIXES`（逗号分隔）后，未命中的命名空间或镜像在任何云调用前失败；留空表示不限制。
- 不提供重启、扩缩容、删除、任意 `patch` 或远程 shell。需求超出以上命令时向用户说明，禁止改用 `workbench exec` 或临时脚本自行执行写操作。

## Workbench 前置条件

- 本机已安装官方 `workbench` CLI，`workbench version` 可执行。
- 已配置可用 profile；脚本默认使用 `aliyun-ops`，其它名称通过 `--workbench-profile` 指定。
- 目标 ECS 为 Linux、处于 Running，且云助手 Agent 正常。
- 本机能访问阿里云 OpenAPI 与 Workbench WebSocket；上传还要求目标实例能访问本地域 OSS 内网端点。
- Skill 不创建、修改或删除 `~/.workbench/config.json`，也不把 AK/SK 写入命令行。

推荐 Workbench 使用 `CredentialsCmd`、`RamRoleArn` 或 `CredentialsURI` 获取可刷新凭证。静态 AK 也可使用，但必须由用户自行配置并保护。

## 三层权限

### ACK OpenAPI RAM

按实际子命令授予最小 Action：

| 能力 | RAM Action |
| --- | --- |
| 列集群 | `cs:GetClusters` |
| 集群详情 | `cs:DescribeClusterDetail` |
| 关联云资源 | `cs:DescribeClusterResources` |
| 节点列表与 Workbench 自动选节点 | `cs:DescribeClusterNodes` |
| KubeConfig、`get`、受控写命令与 `rollout-status` | `cs:DescribeClusterUserKubeconfig` |

临时 KubeConfig 有效期还可通过 `cs:KubeConfigDurationMinutes` 条件收敛。

### ACK 集群 RBAC

KubeConfig 只代表当前 RAM 身份。该身份还必须在目标集群与命名空间内拥有对应资源的 `get`、列表场景的 `list` 权限；受控写命令还需要 `deployments` 的 `patch` 权限，`--wait` / `rollout-status` 需要 `deployments`、`replicasets` 的 `get`/`list`/`watch`。OpenAPI 成功不代表 Kubernetes RBAC 已授权。

### Workbench / ECS RAM

`exec` 与 `upload` 的最小常用权限：

- `ecs-workbench:LoginECSInstance`
- `ecs-workbench:EndSessions`
- `ecs:DescribeInstances`
- `ecs:DescribeCloudAssistantStatus`
- `ecs:StartTerminalSession`

首次使用且账号尚无 Workbench 服务关联角色时，可能还需要限定服务名的 `ram:CreateServiceLinkedRole`。本 Skill 不使用 Workbench 会话内 `/agent`，无需 `ecs-workbench:ChatMessages`。

## 常见错误

- `无法连通 APIServer`：先看 `detail`。只有内网端点时改用 `--via-workbench`，不建议为了查询临时开放生产公网端点。
- `Forbidden`：检查 ACK 集群 RBAC；这与 `cs:*` RAM 权限无关。
- `profile not found`：运行 `workbench config list` 核对 profile，并通过 `--workbench-profile` 指定。
- Workbench 上传偶发失败：脚本会自动重试一次；仍失败时错误只保留去掉进度动画后的真实原因。
- Workbench 登录或上传 403：逐项核对 Workbench/ECS RAM Action、实例范围和服务关联角色。
- 无可自动选择 Worker：运行 `nodes` 查看状态，确认存在 Running/Ready 的阿里云 Worker，或显式传 `--instance-id`。
- 远端没有 `kubectl`：更换 ACK Worker 或修复节点工具环境；脚本不会自动安装软件。
