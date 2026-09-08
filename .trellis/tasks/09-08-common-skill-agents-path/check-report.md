# 通用技能目录统一检查记录

## Result

- 结论：通过，CHK=0、FBK=0；三个维度均通过。
- 画像：interactive，requested=auto，effective=full，confidence=high。
- 深度依据：改变历史目录迁移契约，涉及 Flower 与独立安装器两条行为边界。
- 审查基线：主仓 HEAD `690f1b4e87d4bffdb02800e576acf882382de566`；子仓 HEAD `3e08ded44107ae8d3e1c04e5f1cdb3014655f038`。
- 实际范围：主仓 5 个产品/测试/规范文件，子仓 2 个文件，以及本任务记录。既有两份未跟踪 GitLab 技能和 telemetry 任务不属于本次修改。

## Acceptance Mapping

| 条目 | 实现和证据 | 结果 |
| --- | --- | --- |
| R1/R2、AC1/AC2 | `COMMON_SKILL_DIRS` 使用共享目标；`activeCommonTargets()` 检测 `.codex/.agents/.claude`；整批安装固定目标。空目录和单/双平台测试覆盖双技能及重复启停 | 通过 |
| R3、AC3 | `describeInstalledCommonSkillSync()` 将历史根归一并按新目标去重；安装精确清理选定技能和旧别名；同名迁移、新旧并存、改名、无关定向安装与重复同步测试 | 通过 |
| R4、AC4 | catalog/卸载识别三个精确根；来源缺失和复制失败测试保留旧目录；用户技能与 ENV 内容、权限和时间不变测试 | 通过 |
| R5、AC5 | builtin adapter 无需修改，消费相同计划；dry-run 目标 hash 不变；注入 lock 写入失败验证完整回滚；真实迁移记录 shared 且 Plugin 卸载保留 | 通过 |
| R5、AC5 | 独立 common 安装器检测共享目录、空目录双装、按选择迁移；临时 Git 源集成测试 | 通过 |
| AC6 | Flower/Skill Garden README、迁移规范同步；源素材和快照 schema 不变；完整测试和语法校验 | 通过 |

## Assumptions

- API 返回字段未变；技能菜单入口仍复用 `installCommonSkills()` 与 `removeCommonSkills()`。
- common 更新由 builtin 内容 adapter 消费无写入描述，在同一事务登记新文件与旧目录删除，不把源码读取当成已写入证据。
- 全装重算 state 中 common 的 shared 路径，partial 模式保留既有逻辑；普通 Plugin 平台 detector 未修改。
- 同名技能按快照替换，不合并自定义文件；源 `.common/.codex/skills` 保留，分发快照无需重建。
- 适用假设维度：API 返回契约、历史文件布局、菜单到文件系统与事务的数据流。无前端组件状态改动。

## Verification

| 验证 | 结果 |
| --- | --- |
| `FLOWER_NO_TELEMETRY=1 node --test test/js/aliyun-ops-skill.test.js test/js/plugin-skill-garden.test.js test/js/plugin-interactive.test.js` | 71/71 通过，退出 0 |
| `npm test` | 退出 0；JS 564 通过、1 个 Windows 专属测试跳过；Python 343 通过 |
| 完整测试内的 Patch 冲突检查 | 50 Patch、146 operation，warning=0 |
| 完整测试内的 compiled targets 检查 | 839 个文件无漂移 |
| 完整测试内的上下文预算/输出模板检查 | 默认门禁通过；状态文本预算有下述既有告警；29 个技能模板无折叠风险 |
| `node --check` | `src/lib/skill-catalog.js` 和两个修改的测试文件均通过 |
| `bash -n vendor/skill-garden/scripts/install.sh` | 通过 |
| 主仓和子仓 `git diff --check` | 通过 |

完整测试输出位于当前机器 `/tmp/flower-common-skill-tests.log`。总计 8 个独立验证命令通过，完整测试内分项不另计独立命令数。

## Fact Updates

- DOC-001：`implement.md` 原 planning 状态与未完成实施条目已更新为真实结果；`brief.md` 下一步从待确认改为规格收尾。依据任务已启动、最终 diff、定向测试与完整测试结果；未改变验收语义。

## Remaining Scope

- 当前 Linux 环境未执行 Windows 原生进程测试；测试框架按平台自动跳过，与本轮目录迁移逻辑无关。
- 未修改的工作流 `states-total` 为 13119 B，高于 12288 B 目标、低于 14336 B review 阈值；默认预算检查通过，没有为本任务调高阈值。
- 尚未提交、推送或发版；任务保持 in_progress，等待进入后续规格收尾阶段。
