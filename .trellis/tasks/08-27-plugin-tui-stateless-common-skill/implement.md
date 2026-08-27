# Plugin TUI 无状态管理 common skill - Implement

## Checklist

1. 调整 common skill catalog 加载
   - [ ] 在 `src/lib/skill-catalog.js` 中拆出无 Trellis 可用的 common skill 清单路径。
   - [ ] 让 `listSkillCatalog()` 在缺 `.trellis/` 时返回 common skill 清单和空 `enhancementSkills`。
   - [ ] 让 `removeCommonSkills()` 删除 common skill 时不强制解析 Trellis 快照。

2. 调整 Plugin TUI 内置入口
   - [ ] 在 `src/commands/plugin-interactive.js` 中保留现有 `skill-manager` action。
   - [ ] 无 `.trellis/` 时仍展示内置入口，但不调用 `SkillGardenBuiltinProvider.listCandidates()`。
   - [ ] 确保无 Trellis common-only 路径不创建 `.flower/`、不写问题页签中的 `.trellis` 缺失错误。

3. 保持 skill 菜单交互不变
   - [ ] 复用 `src/commands/skill.js` 现有 checkbox 菜单。
   - [ ] 无 `.trellis/` 时页头和空强化列表输出保持简洁，不新增用户需要理解的模式选择。

4. 补测试
   - [ ] 在 `test/js/aliyun-ops-skill.test.js` 或邻近文件覆盖无 `.trellis` 的 `listSkillCatalog()`、安装、停用和 no `.flower` 断言。
   - [ ] 在 `test/js/plugin-interactive.test.js` 覆盖无 `.trellis` Plugin TUI 展示内置入口并调用 `openSkillManager()`。
   - [ ] 保留已有 Trellis 项目 `flower/skill-garden` Runtime 回归。

## Validation

```bash
node --test test/js/aliyun-ops-skill.test.js
node --test test/js/plugin-interactive.test.js
node --test test/js/plugin-skill-garden.test.js
node --check src/lib/skill-catalog.js
node --check src/commands/skill.js
node --check src/commands/plugin-interactive.js
git diff --check
```

最终提交前按风险决定是否补跑：

```bash
npm test
npm pack --dry-run --json
```

## Risky Files

- `src/lib/skill-catalog.js`：既服务直接 `flower-trellis skill`，也被 builtin `skill-garden` 内容 adapter 用于 shared common refresh。
- `src/commands/plugin-interactive.js`：TUI 主循环、发现页和问题页签共用状态，避免新增动作类型造成状态漂移。
- `src/builtin-plugins/skill-garden/provider.js`：本任务原则上不改；如果必须改，必须重新确认正式 Plugin Runtime digest 与 Trellis 快照解析语义。

## Handoff Notes

- 实现前重新读取 `src/lib/skill-catalog.js`、`src/commands/skill.js`、`src/commands/plugin-interactive.js` 的完整相关函数，禁止猜测函数签名。
- 如果实现中发现需要改变 Plugin TUI 的用户可见分区或文案，应回到 planning 更新 PRD，不能直接扩大范围。
