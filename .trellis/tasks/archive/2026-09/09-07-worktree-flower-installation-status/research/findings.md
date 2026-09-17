# 调研证据

## Reproduction

2026-09-07 在 `/root/.local/bin/wsl-safe-run` 下复用 `test/python/test_worktree_setup.py` 的隔离 Git fixture，执行真实 worktree `prepare/status`，再调用 `buildSelfCheck`。检查设置 `writeCache:false`、`forceRemote:true`，注入与本机 Flower 同版的远端 metadata，不访问 npm，不发送遥测。

```json
{
  "worktreeStatus": "ready-local",
  "flowerEntry": {"configured": false, "path": ".flower", "state": "missing"},
  "lockExists": false,
  "manifestExists": false,
  "selfCheck": {
    "status": "up_to_date",
    "project": {"flowerVersion": null, "trellisVersion": "0.6.14", "outOfSync": false}
  }
}
```

fixture 已清理；此次复现没有修改产品源码或真实 worktree。该证据证明通用逻辑问题，不证明用户未提供路径的具体项目忽略规则。

## Implementation Evidence

- `src/lib/self-check.js:574`：读取 lock 中 `flower/skill-garden` 版本，然后回退到旧 manifest 的字符串 `flowerVersion`。
- `src/lib/self-check.js:578`：只有非空版本才比较差异；`:741` 在远端无更新且未发现本地差异时返回远端 `up_to_date`。
- `src/commands/self-update.js:201`：非 actionable 的通用更新路径会输出“无需执行 self-update”，需要让未知状态有准确的专用说明。
- `src/assets/flower_update_hook.py:19`：只接受 `update_available` 和 `project_out_of_sync`；新未知状态应保持非 actionable，增加行为测试即可，不必扩大启动注入。
- `src/lib/manifest.js:362`：旧 manifest 容错读取；`:377` 已有 `readLegacyManifestStatus()` 可以区分缺失和损坏，按实际实现需要复用。
- `src/plugin/state/project-store.js`：`readLock()` 缺失返回 null，损坏或不合法 schema 抛错误；不得以本任务掩盖错误。
- `vendor/skill-garden/.trellis/0.6/scripts/worktree_setup.py:382`：按 template hashes 和当前实际目录识别入口，未出现的 `.flower` 可以被视为未启用。
- 同文件 `:497` 的 `_analyze()` 只读诊断，`:575` 定义 readiness，`:718` 的 `_prepare_local()` 仅写身份、运行态和 registry。
- Python `_read_json()` 不能单独证明安全读取边界；新增证据读取前必须拒绝 `.trellis` / `.flower` 父目录和记录文件的软链接，避免跟随 legacy 投影。
- `src/commands/worktree.js:204` 起的人类输出由 `printWorktreeResult()` 管理；JSON 直接输出 engine payload。

## Ownership And Distribution

- Skill-Garden canonical 源为 `vendor/skill-garden/.trellis/0.6/`，当前子仓 HEAD 为 `ad64c8ab30cb14184895aa31d672cf1b846e5726`，创建任务时 clean。
- 目标包含源 `scripts/worktree_setup.py`，以及 `.agents/skills`、`.claude/skills` 下的 `trellis-worktree`、`trellis-flower-update`。
- `.flower/state.json` 已确认四份本地技能和 `.trellis/scripts/worktree_setup.py` 都归 `flower/skill-garden` 独占管理。
- `enhancements/0.6/` 由 `npm run sync` 生成。项目 `.agents/`、`.claude/` 和 `.trellis/scripts/` 是 dogfood 安装结果，不是手改源。
- `scripts/sync-enhancements.mjs` 会重建快照并刷新 `enhancements/MANIFEST.json`；开发期源未提交时 `sourceCommit` 仍为旧 HEAD，不代表内容已发布。后续提交阶段必须先提交源，再按当时确认的多仓计划同步 pin 和快照。
- 本任务不修改 Patch catalog；若实现没有涉及 Patch 源，不应主动生成无关 compiled targets 变更。

## Governing Contracts

- `.trellis/spec/flower-trellis/cli/config-and-state.md` 的 Branch-Local Trellis Worktree：只读 status、分支本地内容、prepare 不继承安装状态、legacy 不读取其它分支。
- 同文件的 Startup Self-Update Check：本地版本证据与远端探测分别计算，远端新版优先，离线缓存不伪造新鲜证据，提示抑制与远端节流分离。
- `.trellis/spec/flower-trellis/cli/flower-plugin-contracts.md` 的 Project Files：plugins/lock 可提交，state/cache/transactions 是本机状态；损坏 lock 不能当缺失覆盖。
- JS 使用 ESM、Node 内置模块显式 import、中文 JSDoc；Python 使用标准库、结构化 JSON API。技能载荷继承原文件语言。
- 所有测试、构建和同步经 `/root/.local/bin/wsl-safe-run` 串行执行；75 表示已有重任务，等待后重试；内存失败先缩小范围。

## Existing User Changes

创建任务时记录了 19 个已有 dirty 文件：两个 `.flower` 配置、两平台 GitLab 协作技能及 telemetry-roadmap。用户此前明确暂不纳入两个 `.flower` 文件。当前任务不覆盖、不提交这些变更，也不在真实项目上运行会刷新安装记录的升级来验证本修复。

## Scope Correction And Transfer Evidence

- 用户最新纠正以 worktree skill 同步相关 `.flower` 为核心，类比 route 偏好继承。旧“不复制安装记录”决定已被本版三件套替代；现有 spec/skill 的排除条款属于本次拟修改契约。
- canonical skill 明确排除 state；engine 的 localStateTransfer 目前仅处理身份和 route 偏好。create 已有只读计划/指纹及 task 创建前的补偿边界，可接入继承，不应在返回 created 后额外复制。
- ProjectStore 有现成声明、lock、state schema 校验及原子读写；state 记录插件版本、平台、内容选择及相对受管路径/Patch 的摘要，不含源 worktree 绝对根。transactionVersion 固定为 1，并非递增事务号。
- application-service.js:116 的 assertPreservedState 已校验 lock/state 版本、内容选择和目标摘要，目前为私有函数，计划最小提取复用。verify 依赖锁定包；replay 的 preserveIds 要求原有 state，不能直接作为缺失 state 重建命令。
- content-hash.js 的文件/目录摘要逻辑可复用，并忽略易变 Python 字节码；继承前仍须额外校验祖先路径，防止末级 lstat 漏过父目录软链。
- manifest.js 已分离 settings 用户策略和 tmp 缓存；仅策略适合规范化继承。trellis-control 与 detached 保存禁用/恢复现场，缺少恢复材料时不能声称继承等价。
