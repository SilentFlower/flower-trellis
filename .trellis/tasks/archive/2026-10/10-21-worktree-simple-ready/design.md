# 技术设计

## Direction

创建的必要条件仅限 Git 路径、分支、基线和 registry 安全。Git 成功后按目标目录尝试本地准备及显式请求的任务；普通准备失败保留目录。默认安装准备只走目标自己的固定包重放，不继承来源记录。

## Creation Flow

1. 只读展示仓库、目标、基线、可选任务、规范化个人偏好和本地准备边界；不调用 Plugin 安装计划，不创建整仓临时镜像。
2. 指纹绑定 common-dir、目标/分支、解析后的 base commit、developer、可选任务和实际偏好值；请求任务时还绑定写入 base_branch 的实际基线名称。无关 dirty、子仓现场及源安装状态不参与。
3. 取得既有 registry 锁，复核路径/分支，建立 Git 工作区并登记原有机器映射字段。
4. 调用同一 prepare 路径补本地 identity/runtime 和目标安装；可选任务仅在本次 create 尝试一次。
5. 就绪返回 created；普通待办返回 created-needs-prepare；真实 registry/恢复错误返回非零并标明 worktreeCreated。保留已创建目录与文件，交接一次新会话。

## Target Preparation

- 默认仅读取目标声明、lock、state；完整有效则保留，无安装证据则 notRequested，缺少固定版本依据则 pending。
- 能在本地取得 version/integrity 完全一致的 builtin/local 包时，通过既有 PluginApplicationService.replay 和 TransactionWriter 一次完成。包不可用则 pending，不联网或升级。
- 使用现有 writer 扩展点检查同一事务：只允许本地 state、缺失且未入库的忽略平台配置，以及缺失的局部 Flower 忽略文件。现有内容、tracked 文件、声明/lock 身份、目录归属和授权均不能擅自变更。
- 既有声明/lock 内容相等时保留原字节；不整理根 .gitignore。遗留事务与回滚失败保持明确错误。
- 显式 --inherit-flower --source 继续复用原严格继承与回执；它与默认路径互斥，不充当失败回退。

## Task Boundary

- title/slug 成对可选；create 依目标帮助识别 --no-start/--base-branch，旧接口通过 set-branch/set-base-branch 补齐。
- 任务子进程使用当前解释器和 UTF-8，清除来源会话变量、禁止字节码；不调用 start，不修改目标脚本。
- 创建前拒绝同 slug 已有目录；创建或设置命令超时、无法启动或非零退出时，保留已落盘任务，返回真实路径和未成功的设置命令。用户在目标新会话补齐。
- prepare 不创建或恢复任务；不保存 setupRequest、原始任务请求、来源安装或路由偏好副本。registry 维持原 schema v1 字段。

## Result And Compatibility

setup 只表达当前就绪情况与问题/下一步，不保存执行进度；status 根据现有文件重新计算本地和 Flower 状态。create 返回的任务结果仅描述本次尝试，不能把任务异常隐藏为工具全部就绪。自动化需检查 setup.status。

公开旧参数与严格继承保留，remove/migrate 的安全和补偿语义不变。根仓/子仓各自基线明确，旧授权继续写入交接。

## Shared Validation And Distribution

保留普通路径/Patch 的共享只读摘要诊断，不手工改 hash；安装写入仍由统一 Plugin 事务负责。Skill-Garden 作者源通过 npm run sync 分发至快照，部署副本不作为作者源。

## Validation

覆盖截图中的源过期摘要、源/目标版本不同、缺失忽略配置、旧任务参数及根仓选择。额外断言默认准备不访问来源、不写 setupRequest、不重跑任务；无关 dirty 不触发重确认，实际 base 变化仍拒绝旧指纹，现有文件与恢复证据受保护。
