# Aliyun Ops Common Skill

> `aliyun-ops` common Skill 的生产只读查询、凭证边界、临时文件生命周期与分发契约。

---

## Scenario: ACK And Workbench Read-Only Operations

### 1. Scope / Trigger

- Trigger:common Skill 新增需要云凭证、临时连接凭据、私网跳板或生产只读查询的运维入口；当前
  实例为 `aliyun-ops` 的 ACK OpenAPI、Kubernetes APIServer 与 Workbench 查询链路。
- Scope:只覆盖可审计的读取能力、敏感临时文件生命周期、跨平台行为和 common Skill 分发；生产
  写入、任意远程 shell、用户凭证持久化与自动扩大 RAM/RBAC 权限均不属于该入口。

### 2. Signatures

```text
python3 scripts/ack.py clusters|detail|resources|nodes|kubeconfig|get [options]
load_product_env("ack", explicit_path=None) -> loaded path list
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
- ACK OpenAPI 与 APIServer 入口只发起读取请求。集群内资源必须来自 `RESOURCE_API_GROUPS` 白名单，
  namespace、资源名、实例 ID 和 Workbench profile 必须先校验；Workbench 远端命令只可由固定
  `kubectl get ... --output json` 与清理命令生成，不接受自由格式 kubectl 参数或远程 shell。
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
  Workbench Worker 选择、固定命令、合法响应与非 JSON/字段类型异常。
- 故障注入覆盖证书首个/后续临时文件写入失败、临时目录创建失败、上传失败、查询失败、结果解析失败、
  远端清理失败与本地清理失败；断言其余清理继续执行，错误包含准确残留路径。
- KubeConfig 显式保存测试覆盖原子替换、POSIX `0600` 和缺少 `os.fchmod` 的 Windows 分支；Python 3.8
  语法解析必须通过。
- JS 分发测试断言 Skill/reference/脚本清单、README 与 catalog 元数据、Codex/Claude 作者源及 common
  快照一致；发布前再校验已安装全局副本且确认无 `__pycache__` / `.pyc`。
- `.github/workflows/python-compatibility.yml` 在 Ubuntu/Windows × Python 3.8/3.12 运行
  `test/python/test_aliyun_ops.py`；本地模拟不替代合入后的原生 Windows job。
