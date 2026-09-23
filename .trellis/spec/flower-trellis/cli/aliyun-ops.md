# Aliyun Ops Common Skill

> `aliyun-ops` common Skill 的生产只读查询、ACK 受控 Deployment 变更、凭证边界、临时文件生命周期与分发契约。

---

## Scenario: ACK And Workbench Read-Only Operations

### 1. Scope / Trigger

- Trigger:common Skill 新增需要云凭证、临时连接凭据、私网跳板或生产只读查询的运维入口；当前
  实例为 `aliyun-ops` 的 ACK OpenAPI、Kubernetes APIServer 与 Workbench 查询链路。
- Scope:只覆盖可审计的读取能力、敏感临时文件生命周期、跨平台行为和 common Skill 分发；生产
  写入只允许下方「ACK Controlled Deployment Writes」场景的受控命令，任意远程 shell、用户凭证持久化
  与自动扩大 RAM/RBAC 权限均不属于该入口。

### 2. Signatures

```text
python3 scripts/ack.py clusters|detail|resources|nodes|kubeconfig|get [options]
load_product_env("ack", explicit_path=None) -> loaded path list
workbench_kubectl_session(args) -> context manager yielding WorkbenchSession
WorkbenchSession.run(kubectl_args, operation, timeout=None) -> Workbench JSON payload
get_via_workbench(args) -> Kubernetes response object
k8s_request(server, ca_data, cert_data, key_data, path, timeout=30) -> (status, body)
RESOURCE_API_GROUPS: resource name -> Kubernetes API group prefix
```

分发链固定为：

```text
vendor/skill-garden/.common/.codex|.claude/skills/aliyun-ops
  -> npm run sync
  -> enhancements/common/.common/.codex|.claude/skills/aliyun-ops
  -> 用户显式安装的全局 Codex/Claude Skill
```

### 3. Contracts

- ACK 配置按 `--env-file`、`ALIYUN_ACK_ENV_FILE`、`ALIYUN_OPS_ENV_FILE`、统一配置和兼容旧配置的
  既定优先级加载。显式配置源缺失必须失败；POSIX 下组或其它用户可读写的凭证文件必须拒绝。
  Skill 源、发布快照、全局安装副本和测试夹具均不得保存真实 AK/SK、KubeConfig 或客户端私钥。
- ACK OpenAPI 与 APIServer 查询入口只发起读取请求。集群内资源必须来自 `RESOURCE_API_GROUPS` 白名单，
  namespace、资源名、实例 ID 和 Workbench profile 必须先校验；Workbench 远端命令只可由
  `WorkbenchSession.run` 以 `chmod 600 -- <path> && env KUBECONFIG=<path> kubectl <已校验 argv>`
  形式经 `shlex.join` 生成，远端清理固定为幂等的 `rm -f -- <path>`；不接受自由格式 kubectl 参数或远程 shell。
- Workbench 上传失败最多尝试 `UPLOAD_ATTEMPTS=2` 次（`--force` 覆盖，天然幂等）；CLI 失败详情经
  `summarize_cli_output` 去除 ANSI 与盲文进度帧后保留尾部 500 字符。`scrub` 必须接受异常对象与任意对象，
  `main()` 对任何 `AckError` 输出 `[ack] <消息>` 并返回 1，不得被序列化 `TypeError` 掩盖。
- KubeConfig 默认不回显正文，临时有效期默认 30 分钟且限制在 15~4320 分钟。Secret 的 `data` 与
  `stringData` 值在输出或保存前统一替换为 `<REDACTED>`；操作流程先用摘要列出 ConfigMap 名称和键，
  用户明确指定对象后再读取正文。
- Workbench 未显式传实例时，只能从集群节点中稳定选择运行中、Ready 的阿里云 Worker。CLI 成功
  响应必须是 JSON 对象，`exit_code` 必须为非布尔整数，已有的 stdout/stderr/output 字段必须是字符串；
  结构异常与非零远端退出码均按查询失败处理，并继续执行清理。
- 本地 KubeConfig 使用目标同目录的 `mkstemp`、写完关闭和 `os.replace` 原子落盘；POSIX 可用时调用
  `fchmod(0600)`，Windows 缺少 `fchmod` 时仍须完成保存。直连证书路径必须在写入前登记，Workbench
  临时目录必须在 `try/finally` 清理域内创建，确保 setup、上传、查询、JSON 解析任一步失败都清理
  已创建的本地文件、证书文件与已尝试上传的远端文件。
- 清理不能掩盖原查询错误，也不能静默成功：有主错误时追加清理错误；查询成功但清理失败时命令
  整体失败。诊断必须列出精确残留路径且先脱敏 AK 痕迹，便于人工清除而不泄露凭证。
- 先修改 vendor 中 Codex/Claude 作者源，再运行 `npm run sync`；作者源、common 快照及对应全局安装
  副本除缓存外应逐字节一致。`__pycache__`、`.pyc` 和任何运行期敏感文件都不得进入发布树。

### 4. Validation & Error Matrix

| 条件 | 预期行为 |
| --- | --- |
| 本机可访问 APIServer | 使用短期 KubeConfig 客户端证书执行固定 GET，并清理全部证书临时文件 |
| APIServer 仅私网可达且启用 Workbench | 选择合法 Worker、上传随机 KubeConfig、执行固定 `kubectl get`、清理两端文件 |
| resource、namespace、实例 ID、profile 或有效期非法 | 在节点、KubeConfig、Workbench 和网络查询前失败 |
| Workbench 返回非 JSON、根节点/字段类型异常或非零退出码 | 返回可诊断错误，同时继续本地与远端清理 |
| setup、上传、查询或结果 JSON 解析失败 | 保留主错误；所有已创建或已上传的临时资源仍进入清理 |
| 任一清理步骤失败 | 继续尝试其余清理，最终失败并报告每个精确残留路径 |
| 上传首次失败、重试成功 | 查询继续；两次都失败时报告去噪后的真实原因，远端 `rm -f` 不误报清理失败 |
| 查询 Secret 列表或单个对象 | 只保留键名，`data` / `stringData` 的值始终为 `<REDACTED>` |
| Windows 没有 `os.fchmod` | 显式保存仍成功，临时文件原子替换契约不变 |
| 作者源、快照或全局副本不一致 | 分发校验失败；不得把任一副本单独视为已完成实现 |

### 5. Scenarios and Examples

- Normal:用户明确指定 namespace 与 ConfigMap 名称；直连可用时通过 APIServer GET 返回脱噪 JSON，
  私网环境则经 Workbench 使用随机短期 KubeConfig 返回相同资源语义，远端 `/tmp` 与本地临时目录为空。
- Base:用户先运行 `clusters`、`nodes` 和资源摘要，确认集群、Worker 与对象名；这些命令只展示控制面
  元信息或对象摘要，不回显 KubeConfig、Secret 值和 AccessKey。
- Incorrect use:把用户文本拼进 `workbench exec --command`，或开放 `apply/delete/patch/scale`。应只让
  argparse 白名单参数进入固定 `kubectl get` argv，再用安全 shell quoting 生成单条远端命令。
- Incorrect use:在上传完成后才进入 `try/finally`，或遇到远端清理响应异常就提前退出。应在创建第一项
  临时资源前进入清理域，并以嵌套清理保证远端失败后仍删除本地敏感文件。

### 6. Tests Required

- Python 单元测试覆盖 ACS3 签名与错误脱敏、资源白名单和路径校验、Secret 两种字段脱敏、直连 GET、
  Workbench Worker 选择、固定命令、合法响应与非 JSON/字段类型异常、`main()` 输出 `AckError` 不抛
  `TypeError`、进度帧去噪、上传重试与 `rm -f` 清理断言。
- 故障注入覆盖证书首个/后续临时文件写入失败、临时目录创建失败、上传失败、查询失败、结果解析失败、
  远端清理失败与本地清理失败；断言其余清理继续执行，错误包含准确残留路径。
- KubeConfig 显式保存测试覆盖原子替换、POSIX `0600` 和缺少 `os.fchmod` 的 Windows 分支；Python 3.8
  语法解析必须通过。
- JS 分发测试断言 Skill/reference/脚本清单、README 与 catalog 元数据、Codex/Claude 作者源及 common
  快照一致；发布前再校验已安装全局副本且确认无 `__pycache__` / `.pyc`。
- `.github/workflows/python-compatibility.yml` 在 Ubuntu/Windows × Python 3.8/3.12 运行
  `test/python/test_aliyun_ops.py`；本地模拟不替代合入后的原生 Windows job。

---

## Scenario: ACK Controlled Deployment Writes

### 1. Scope / Trigger

- Trigger:用户明确要求切换/回退 Deployment 镜像、设置/删除容器环境变量或等待发布结果。Claude 与
  Codex 必须走同一受控入口，不得各自用 `workbench exec`、手工 KubeConfig 或临时脚本执行写操作。
- Scope:仅 Deployment 单容器的 `image` 与指定 `env` 键，以及只读 `rollout status`；不含重启、扩缩容、
  删除、任意 `patch`、批量导入环境变量、`exec` 进 Pod 或直连 APIServer 写入。

### 2. Signatures

```text
ack.py set-image      --cluster C --namespace N --deployment D [--container X] --image IMG     [--wait] [--timeout S] [--yes]
ack.py set-env        --cluster C --namespace N --deployment D [--container X]
                      [--set KEY=VALUE]... [--unset KEY]...                                 [--wait] [--timeout S] [--yes]
ack.py rollout-status --cluster C --namespace N --deployment D [--timeout S]
共用 Workbench 参数：[--minutes] [--instance-id] [--workbench-profile] [--workbench-timeout]
apply_deployment_change(args, plan, verb_args) -> None
plan_image_change(container, image) / plan_env_changes(container, changes)
  -> [(label, current, target, kubectl_token)]
```

### 3. Contracts

- 写命令隐式使用 `workbench_kubectl_session`，同一会话内依次执行 `kubectl get deployment D -o json`、
  可选的 `kubectl set image|env ... --namespace N --request-timeout 20s` 与可选的 `rollout status`。
- 未带 `--yes` 只输出预览（集群、命名空间、Deployment、容器、白名单状态、变更键的 当前值 → 目标值）
  并返回 0；变更列表为空时即使带 `--yes` 也不执行写入。
- 可选 ENV 白名单：`ALIYUN_ACK_WRITE_NAMESPACES`、`ALIYUN_ACK_IMAGE_PREFIXES`，逗号分隔，经
  `load_product_env("ack")` 从私有 ENV 补齐；非空时强制精确命中命名空间 / 前缀匹配镜像，空值不限制。
  脚本、文档和测试不得写死任何真实命名空间、镜像仓库或集群 ID。
- `--container` 省略时仅单容器 Deployment 可自动选择；容器名来自集群数据，仍须经 `validate_path_segment`。
- `set-env` 只提交有变化的键（`KEY=VALUE` / `KEY-`），并以 `--containers <name>` 固定目标容器。
- `rollout status` 不得附加 `--request-timeout`（会中断 watch）；Workbench exec 超时 = `timeout + 30`。
- 写入执行后 `session.outcome` 改为 `写入已生效`；此后等待失败或清理失败的错误都必须包含该前缀，
  防止用户误判未生效而重复执行。

### 4. Validation & Error Matrix

| 条件 | 预期行为 |
| --- | --- |
| 镜像不匹配 `SAFE_IMAGE` 或缺少 `:tag` / `@sha256:` | 任何节点、KubeConfig、Workbench 调用前失败 |
| env 键不匹配 `^[A-Za-z_][A-Za-z0-9_]*$`、值含 `\r`/`\n`/NUL、键重复或 set/unset 为空 | 同上，调用前失败 |
| namespace / deployment / container 非法，或 `--timeout` 不在 10~570 | 同上，调用前失败 |
| 白名单已配置且命名空间或镜像未命中 | 同上，错误列出白名单内容 |
| 多容器 Deployment 未指定 `--container` | 读取后失败并列出容器名，不写入，照常清理 |
| 目标键当前使用 `valueFrom` | 拒绝修改，不写入，照常清理 |
| 写入成功但 `--wait` 或清理失败 | 整体失败，消息以 `写入已生效` 开头并保留原因/残留路径 |

### 5. Scenarios and Examples

- Normal:先 `set-image ... --image repo/app:v2` 预览，用户确认后原样加 `--yes --wait` 重跑；回退即对旧 tag
  再执行一次 `set-image`。
- Base:`set-env --set MODE=new --unset OLD` 中 `OLD` 本就不存在，只提交 `MODE=new`；全部无变化时不执行写入。
- Incorrect use:skill 只读能力不满足需求时，用 `ack.py kubeconfig --save` + `workbench exec "kubectl set image ..."`
  自行拼命令。应改用 `set-image` / `set-env`；需求超出两者时向用户说明，不自行变通。
- Incorrect use:在测试中依赖开发者 shell 未导出白名单变量。应在 `AckCliTest.setUp` 用
  `mock.patch.dict(os.environ)` 移除两个白名单键，需要白名单的用例显式注入。

### 6. Tests Required

- 预览不执行 `kubectl set`，且预览包含 当前值 → 目标值 与白名单状态。
- `--yes` 的远端命令尾部精确等于 `kubectl set image deployment/<d> <c>=<img> --namespace <n> --request-timeout 20s`；
  `set-env` 断言 `--containers` 与只含变化键的 token（含 `shlex` 引号）。
- 无变化、带 `--yes` 时不写入；多容器与 `valueFrom` 拒绝且清理仍执行。
- 非法输入与白名单不命中时 `select_workbench_instance`、`fetch_kubeconfig`、`run_process` 均未被调用。
- `--wait` 的 `rollout status` 不含 `--request-timeout`，exec 超时为 `timeout + 30`；`rollout-status` 只执行一条 kubectl。
- 写入后清理失败的错误包含 `写入已生效，但临时 KubeConfig 清理失败`。
- 导出 `ALIYUN_ACK_WRITE_NAMESPACES` 等变量时 `test_aliyun_ops.py` 仍全部通过。
