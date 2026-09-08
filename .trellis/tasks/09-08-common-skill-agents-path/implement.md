# 通用技能目录统一实施计划

## Status

- 当前处于 in_progress；最终 Brief 已确认，代码实施和完整 Check-All 已通过，待后续规格收尾与提交阶段。
- implement=inline、check=check-all-inline，均由个人 route 配置解析并写入当前 session；检查深度为 full。

## Steps

- [x] 读取相关 API、平台常量、复制语义、common 同步与独立安装器，核对官方技能目录。
- [x] 收敛 PRD 和设计，保留 source 素材目录以及已有快照替换语义。
- [x] 展示最终 Brief 并通过 Phase 1.4；进入实现路由。
- [x] 修改 `src/lib/skill-catalog.js`：canonical/legacy 映射、共享 root 检测、批次固定目标、目录迁移与改名合并、精确卸载。
- [x] 核对 builtin adapter，既有 `refreshes/removedTargets` 已覆盖事务迁移，无需改动 adapter。
- [x] 同步 `vendor/skill-garden/scripts/install.sh`，更新其 README 的平台路径和无平台默认值。
- [x] 调整 `test/js/aliyun-ops-skill.test.js` 的目标断言，并在该文件补充目录专项测试；`plugin-skill-garden.test.js` 覆盖事务迁移，无需新建测试文件。
- [x] 更新 Flower README 与 `.trellis/spec/flower-trellis/cli/enhancements-model.md`，记录新目标、历史目录迁移和回退行为。
- [x] 完成定向验证与完整 `npm test`，详见 `check-report.md`。
- [x] 经完整 Check-All 检查并记录证据；CHK=0、FBK=0。
- [ ] 按工作流推进 spec/push，不自动提交或发版。

## Validation Matrix

| 场景 | 期望 |
| --- | --- |
| 空目录，选择两个 common 技能 | 两个技能均双装，无 `.codex/skills` 或项目状态副作用 |
| `.codex` / `.agents` / `.claude` / 混合 | 符合 design 平台矩阵；无单侧误扩展 |
| 仅旧 root、仅新 root、新旧并存 | 同步后只有 canonical shared 副本，目标路径去重 |
| 旧 root 加旧名称，双别名指向一个新名 | 直接到 canonical root 的最终名称，旧路径精确清理 |
| 定向安装其它技能、更新无已安装 common | 不迁移无关技能，不自动启用 |
| 重复安装、更新、卸载 | 结果幂等，用户自建技能与配置不变 |
| 源缺 `SKILL.md` 或目标写入失败 | 不删除尚未成功替换的旧副本 |
| builtin dry-run 和真实事务 | dry-run 零写入；真实迁移的写入和删除同事务 |
| 独立安装器 | 空目录、共享目录、改名迁移、无关定向安装和配置保护一致 |

## Commands

```bash
FLOWER_NO_TELEMETRY=1 node --test test/js/aliyun-ops-skill.test.js test/js/plugin-skill-garden.test.js test/js/plugin-interactive.test.js
node --check src/lib/skill-catalog.js
bash -n vendor/skill-garden/scripts/install.sh
git diff --check
git -C vendor/skill-garden diff --check
```

- 新增目录专项测试后将其加入定向命令；若修改 builtin adapter，增加相应事务失败回归验证。
- 最终提交前按 CLI 规范运行 `npm test`；语法校验覆盖所有实际修改的 JS。未修改 Patch 或快照输入，不额外运行生成命令制造快照变化。

## Review Boundaries

- 主仓重点：`src/lib/skill-catalog.js`、测试、README、对应 spec；builtin adapter 只有确需调整时才纳入。
- 子仓重点：`scripts/install.sh`、`README.md`。未来提交时先记录子仓提交，再由主仓登记 pin，不丢弃其它工作。
- 不移动源素材或当前工作区安装副本；所有迁移行为验证在可清理临时目标进行。
