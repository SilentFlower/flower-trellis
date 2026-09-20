# Brief — 为 aliyun-ops 增加 ACK Workbench 只读运维能力

## Goal

- 让 AI 在本机无法直连私网 ACK APIServer、且没有 ECS SSH 凭证时，仍能用已有阿里云凭证和 Workbench CLI 安全查询 ACK 与命名空间内的 Kubernetes 资源，并同步交付到 Skill-Garden、Flower 快照和全局 Codex/Claude Skill。

## Scope

- 在 `vendor/skill-garden/.common` 的双平台 `aliyun-ops` 作者源增加 ACK ROA V3、集群/节点/KubeConfig 查询、APIServer 直连及 Workbench 私网查询能力。
- Workbench 路径签发默认 30 分钟的内网 KubeConfig，自动或显式选择 ACK Worker，只执行白名单资源的 `kubectl get`，并清理本地与远端临时文件。
- 对 Secret 内容脱敏，保留 ConfigMap 等资源的 JSON/摘要输出，不暴露任意 shell 或集群写命令。
- 更新 Skill 元数据、ACK reference、catalog、Flower/Skill-Garden README 和 Python/JS 测试。
- 运行 `npm run sync` 刷新 `enhancements/common/.common`，验证后同步 `/root/.codex/skills/aliyun-ops` 与 `/root/.claude/skills/aliyun-ops`。
- 在当前已授权 ACK 环境以 `xhgj-ai` ConfigMap 列表完成一次只读在线冒烟。

## Non-Goals

- 不修改 Kubernetes 工作负载、ConfigMap、Secret、RBAC、节点或 ACK 集群配置。
- 不创建或扩大 RAM、ACK RBAC、ECS、Workbench 权限，不改用户 ENV 或 Workbench profile。
- 不提供通用远程 shell、任意 kubectl 参数或 `apply/delete/patch/scale`。
- 不提交、不推送、不发布 npm 包，也不改动现有 Auto-Loop 等无关未提交内容。

## Key Decisions

- `vendor/skill-garden/.common` 是唯一作者源；Flower 快照由既有 `npm run sync` 生成，全局目录只做最终安装同步。
- 保留公网/VPC 可达场景的直连路径，并以 Workbench 解决私网 APIServer 场景。
- ACK OpenAPI、集群 RBAC、Workbench/ECS 作为三个独立权限面诊断；没有 ECS SSH 密码或密钥不是阻塞条件。
- Workbench 只接收脚本生成的固定 `kubectl get -o json` 命令；namespace、name 经 shell quote，resource 来自静态白名单。
- 自动节点选择限定为运行、Ready 的阿里云 Worker，允许 `--instance-id` 显式覆盖。
- KubeConfig 使用短期凭证、随机临时路径和强制清理；Secret 的 `data` 与 `stringData` 始终脱敏。

## Key Context

- 作者源：`vendor/skill-garden/.common/.codex/skills/aliyun-ops` 与 `.claude/skills/aliyun-ops`。
- 派生快照：`enhancements/common/.common`；同步入口：`npm run sync`。
- 现有全局 Claude 副本包含一版 ACK 直连代码，可吸收回源，但尚无 Workbench 跳板；全局 Codex 尚无 ACK。
- Workbench CLI 1.0.1 已实测 `exec`/`upload` 成功；ACK 节点接口使用官方 `pageSize`/`pageNumber` 参数。
- 仓库及子仓已有无关未提交改动，所有编辑和验证必须按任务基线隔离。

## Risks / Deferred

- `npm run sync` 全量重建 `enhancements/`，必须确认未覆盖现有 Auto-Loop 快照改动。
- Workbench 查询成功但临时 KubeConfig 清理失败时整体判失败，并报告精确残留路径供人工处理。
- Workbench CLI 缺失、profile 无效、Cloud Assistant 异常或三层权限任一不足都可能阻止在线查询；脚本需给出分层诊断。

## Acceptance

- 双平台作者源、Flower 快照和两份全局 Skill 的文件、内容与权限一致，且不含 Python 缓存。
- ACK 基础查询、节点筛选、直连与 Workbench 两条 `get` 路径、成功/失败清理和 Secret 脱敏均有自动化测试。
- 不支持的资源、非法有效期、无可用 Worker 在产生敏感临时文件或远程执行前失败，输入无法构造任意 shell 或写命令。
- 定向 Python/JS 测试、Skill 校验、语法检查和 diff 检查通过。
- 在线冒烟能通过 Workbench 列出 `xhgj-ai` 的 ConfigMap 名称，不输出 ConfigMap 正文、Secret 或 KubeConfig。

## Next Step

- 启动任务后先在 Codex 作者源实现 ACK/Workbench 脚本及单元测试，再同步双平台与 Flower 快照。
