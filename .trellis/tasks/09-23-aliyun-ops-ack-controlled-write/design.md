# Design: aliyun-ops ACK 受控写命令与 DMS 参数修复回灌

## 1. 边界

- 作者源：`vendor/skill-garden/.common/.codex/skills/aliyun-ops` 与 `.claude/skills/aliyun-ops`（submodule，
  两份逐字节一致）。所有改动先落作者源，再 `npm run sync` 生成 `enhancements/common/.common/...` 快照。
- skill-garden 对外分发：脚本、文档、测试中不得出现公司命名空间、ACR 地址、集群 ID 等环境数据；
  白名单只从用户 ENV 读取。
- 写命令只走 Workbench 路径（生产 APIServer 仅内网可达，直连 `k8s_request` 只实现 GET）；
  写命令不提供 `--via-workbench` 开关，隐式使用 Workbench。直连写入不在本期。

## 2. CLI 契约

```text
ack.py set-image      --cluster C --namespace N --deployment D [--container X] --image IMG      [--wait] [--yes]
ack.py set-env        --cluster C --namespace N --deployment D [--container X]
                      (--set KEY=VALUE)... (--unset KEY)...                                   [--wait] [--yes]
ack.py rollout-status --cluster C --namespace N --deployment D [--timeout 300]
共用：[--instance-id] [--workbench-profile] [--workbench-timeout] [--minutes]
```

- `--container` 省略时：Deployment 只有一个容器则自动选中；多个容器则失败并列出容器名。
- `set-env` 的 `--set` / `--unset` 均可重复，至少一项；同一键不能同时出现在两者中。
- `--wait` 在同一 Workbench 会话内追加 `kubectl rollout status`，避免二次上传临时 KubeConfig。
- `rollout-status` 只读，`--timeout` 限定 10~570 秒，Workbench exec 超时 = timeout + 30（≤ 600）。

## 3. 校验（全部在节点查询、KubeConfig 签发、Workbench 调用前完成）

| 输入 | 规则 |
| --- | --- |
| namespace / deployment / container | 复用 `validate_path_segment` |
| image | `^[A-Za-z0-9][A-Za-z0-9._/:@-]{0,511}$`，且必须含 `:tag` 或 `@sha256:` |
| env 键 | `^[A-Za-z_][A-Za-z0-9_]*$` |
| env 值 | 任意字符串，不允许换行与 NUL |
| `ALIYUN_ACK_WRITE_NAMESPACES` | 逗号分隔；非空时 namespace 必须精确命中 |
| `ALIYUN_ACK_IMAGE_PREFIXES` | 逗号分隔；非空时 image 必须以其一为前缀（仅 `set-image`） |

白名单通过既有 `load_product_env("ack")` 从 ENV 文件补齐进程环境，未配置即不限制；预览中显示
白名单是否生效，便于用户确认护栏状态。

## 4. 执行流程

```text
校验参数 + 白名单
  └─ workbench_kubectl_session(args, label)   # 抽取自 get_via_workbench
       ├─ 选 Worker → 签发内网临时 KubeConfig → 本地 600 落盘 → upload（失败重试 1 次）
       ├─ kubectl get deployment D -o json      → 解析容器、当前镜像/环境变量
       ├─ 生成预览：集群/命名空间/Deployment/容器、当前值 → 目标值、白名单状态
       ├─ 无变化 → 输出"无需变更"，不执行写入
       ├─ 未带 --yes → 输出预览 + "确认后加 --yes"，退出码 0
       ├─ 带 --yes → kubectl set image|set env（固定 argv，shlex.join）
       └─ --wait → kubectl rollout status --timeout
  finally: 远端 rm -f -- <path>；本地 shred/unlink；删除临时目录
```

- 抽取 `workbench_kubectl_session` 为上下文管理器：负责实例选择、KubeConfig 生命周期、上传与清理，
  向调用方提供 `run(kubectl_argv, operation)`。`get_via_workbench` 改为复用它，现有错误语义保持：
  主错误 + "同时清理失败"；主流程成功但清理失败时整体失败并列出残留路径。
  写命令成功但清理失败时消息写明"写入已生效"，避免用户误以为未生效而重复执行。
- `set-env` 若目标键当前使用 `valueFrom`（Secret/ConfigMap 引用），拒绝覆盖或删除，防止破坏密钥引用。
- 预览只列出被修改的环境变量键的新旧值，不回显该容器的其它环境变量。
- 远端命令统一形如 `chmod 600 -- P && env KUBECONFIG=P kubectl <argv> --request-timeout 20s`，
  argv 仅由已校验参数构造，不拼接用户原文。

## 5. 缺陷修复

- B1 `scrub`：异常对象先 `str()`；其它非字符串对象 `json.dumps(..., default=str)`，保证永不抛出。
- B2 上传：新增输出摘要函数，去除 ANSI 转义、`\r` 覆盖帧与盲文进度符（U+2800–U+28FF）行，
  取末尾 500 字符（真实原因在末尾）。上传失败自动重试 1 次（`--force` 覆盖，天然幂等）。
  远端清理由 `unlink --` 改为 `rm -f --`，文件不存在不再视为清理失败。

## 6. DMS 回灌

把全局 Codex 副本 `dms.py` 的 `CreateDataCorrectOrder` 参数修复原样写入两份作者源：
`Param` 使用大驼峰字段，`Classify` 仅在传入时设置，移除 RPC 顶层 `EstimateAffectRows`。

## 7. 文档与契约

- `SKILL.md`：能力路由 ACK 行加入受控写命令；配置纪律改为"ACK 查询只读；写入只能通过
  `set-image` / `set-env`，默认预览、`--yes` 执行；禁止直接用 `workbench exec` 或临时脚本执行写操作"。
  frontmatter description 增加"受控切换镜像与环境变量"以便发布类请求命中。
- `references/ack.md`：新增"受控写命令"章节（命令、白名单 ENV、RBAC 需 `patch deployments`、
  回退=用旧 tag 再次 `set-image`）。
- `assets/env.example`：追加两个白名单键（空值 + 注释）。
- spec `aliyun-ops.md`：Scope 从"生产写入不属于该入口"改为受控写入契约，并补测试要求。

## 8. 兼容与回滚

- 只读子命令 CLI 与输出不变；`get_via_workbench` 重构由既有测试兜底。
- 回滚：revert submodule 提交与主仓快照/指针提交，并把全局副本恢复为上一版快照。
