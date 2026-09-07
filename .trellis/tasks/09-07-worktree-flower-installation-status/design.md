# 技术设计

## Goal And Boundaries

主链改为 worktree 创建和准备阶段的 Flower 安装信息继承，版本未知诊断为兜底。本版替代旧设计中 prepare 不增加写入面、不继承安装记录的决定。Plugin 持久化 schema 沿用既有版本。

skill 负责诊断、选择来源和调用；Flower CLI 与随包 engine 负责校验和落盘，不依赖助手临时复制目录。

## Entry Points

- create 默认从发起操作的 worktree 计算 Flower 继承计划，与 developer、route preferences 一起展示和确认；来源与目标必须属于同一 canonical Git common dir。
- 为 prepare 增加拟议的 --inherit-flower --source <dir>。无继承选项时保持现有本地初始化语义；--source 仅为 prepare 的显式继承提供来源，不改变 create 以调用目录为来源的契约。
- skill 检测 Flower 信息缺失后调用显式继承，即使 Trellis 已 ready-local 也执行。来源优先使用本轮发起 worktree；已进入目标的新会话通过 Git worktree 列表定位同仓主 worktree，再验证证据。不遍历不同分支拼凑记录，来源不明确时报告缺失信息。
- status 保持只读，分别展示 Trellis readiness、Flower 版本来源及安装记录完整性。
- migrate 仍只重建目标分支旧投影；完成后再按正常 prepare 流程处理缺失记录。

## Transfer Policy

| 内容 | 策略 |
| --- | --- |
| .flower/plugins.json、plugin-lock.json | 目标缺失才补，已有声明和 lock 必须与拟继承的完整安装集合兼容 |
| .flower/state.json | 源 lock/state 一致且目标受管文件、目录和 Patch 摘要全部匹配后，写入独立本地副本 |
| .flower/settings.json | 目标缺失且开发者相同时，规范化继承合法 updateCheck 用户策略，不带缓存字段 |
| .flower/.gitignore | 新建本机状态时由 ProjectStore 生成标准局部规则；不复制源自定义规则，不改根 .gitignore |
| cache、transactions、临时文件、备份 | 不继承，所需空目录可在目标初始化 |
| trellis-control、trellis-detached | 不继承；源或目标处于禁用/恢复状态时停止继承并说明 |
| 旧 .trellis/.flower-manifest.json | 只用于现有目标的版本查询兼容，不从来源复制 |

已有目标文件保留字节与权限。目标安装信息完整有效时无需读取来源；部分缺失则按整个插件集合校验，不拼接不同版本、不补出源未声明的插件。

安装记录作为一组先校验后落盘。源证据缺失报告 unavailable，冲突或损坏报告 blocked，均不写半套记录。纯 Trellis 没有 Flower 来源时保留正常准备能力，skill 明确 Flower 记录仍不可用。已知 Flower 安装存在但内容不匹配时，不把继承标为成功。

## Evidence And Validation

1. 复用 ProjectStore 和 project-files.js 的声明、lock、state schema，区分缺失与损坏；校验直接声明、lock roots/dependency 图、state 集合、平台和内容选择的对应关系。
2. 从 application-service.js 私有 assertPreservedState 中提取最小共享校验，复用版本、内容选择、文件/目录和 Patch 摘要规则，维持原 preserveIds 行为。不能直接用 replay 重建：其冻结路径要求已有 state；完整 verify 又可能依赖包缓存。
3. 分别校验源和目标的实际受管内容。摘要复用 content-hash.js，沿用忽略 Python 字节码规则；读取前校验祖先目录和末级路径，拒绝跨 worktree 软链接。
4. 本地 Plugin 来源引用在目标也须有效且位于同仓允许边界，不将配置复制等同于源私有目录可用。
5. 不要求源 HEAD 等于目标 HEAD，以锁定集合和实际内容匹配为准。源未提交的白名单记录可成为候选，但其摘要必须进入计划；其它 dirty 内容不随 base 复制。

## Ownership And Orchestration

- Flower JS 新增窄范围安装信息服务，拥有完整 schema、摘要验证和文件组落盘，复用现有存储组件。Python 不另写完整 Plugin schema。
- Python engine 继续拥有 Git、registry 锁、创建指纹和补偿链。Flower facade 将自身 Node 运行程序及随包服务入口提供给 engine，通过结构化 JSON 在生命周期内调用，不从目标分支加载该服务代码。
- 直接运行 engine 而无适配器时，原纯 Trellis 操作可用；需要 Flower 继承时明确要求使用外部 Flower CLI，不悄悄跳过。
- create 的只读计划纳入来源、候选路径、载荷摘要及 base commit；从 base 读取已有记录。完整目标摘要在 checkout 后、创建 task 前校验，预检明确标记这项待验证条件。来源记录变化使指纹失效，写入前再次核对载荷摘要。
- create 继承失败接入已有 worktree/branch/registry 回滚；prepare 在本地状态写入前完成 Flower 预检，对本轮新建文件保存清单，失败清理本轮写入，不删除预存目录或覆盖外部并发修改。
- 文件组按声明、lock、state 顺序逐文件原子写入，state 最后。适配器缺失、超时、非法输出或写入失败均明确报错，不能带着部分成功继续创建 task。

## Results

- 现有结果增加 localStateTransfer.flower：action、source、候选/已写路径及稳定原因，不输出完整安装载荷。
- 拟议 action 为 inherited、preserved、unavailable、blocked、notRequested；create 预检另标 validationPending。
- 只读 flower 诊断分开表达版本证据和记录完整性，不能把 lock 存在视为完整安装验证，也不能把 Trellis ready-local 视为 Flower 已就绪。

## Self-Check Fallback

保留原方案的局部兜底：新增 project.flowerVersionStatus=known|unknown 和 flowerVersionSource=plugin-lock|legacy-manifest|null。lock 优先，旧 manifest 回退，损坏记录沿用现有错误边界。

远端或有效缓存无新版、无已知本地差异而项目版本未知时，返回 project_unknown / project_flower_version_unknown，查询退出 0，不推荐写命令。远端新版、已知版本差异、离线、关闭/npx 的优先级保持原样，每次重算本地证据。

普通 self-update 对未知状态准确说明，显式 project-only 保持既有边界。SessionStart 仍只处理两种真实 actionable 更新；人工 update skill 将缺失记录指向 worktree prepare。

## Source And Delivery

- Flower 源：src/commands/worktree.js、新安装信息服务、最小共享状态校验、src/lib/self-check.js 及相关消费者。
- Skill-Garden 源：vendor/skill-garden/.trellis/0.6/scripts/worktree_setup.py，以及 agents/claude 的 worktree、flower-update 两项技能。
- npm run sync 生成 enhancements/0.6/；不手改根项目 dogfood 技能，不在真实根项目升级验证。
- 更新 config-and-state 的旧继承排除契约，保持分支独立、只读诊断和既有确认/回滚边界。后续 Git 阶段按子仓源提交、pin、MANIFEST 顺序处理。

## Risks And Rollback

- 旧分支、源未提交内容或用户改动可能导致摘要不匹配；报告阻断，不自动修复插件内容。
- Node/Python 新内部适配器须测试缺失、超时、非法输出和失败补偿。
- self-check 新状态可能影响自行枚举状态的消费者，需同步本仓调用方及技能。
- 没有持久化 schema 升级；回退产品代码不需要删除已经合法继承的目标记录。
