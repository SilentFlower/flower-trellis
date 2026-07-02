# 优化 Flower Trellis Skill 管理 - Implement

## Checklist

1. 扩展 catalog 能力
   - 从 `enhancements/common/.common` 快照读取 skill 名称、安装状态和 description。
   - 识别历史路径中的 common skill（如旧 `.agents/skills/humanize-writing`），用于默认勾选与精确卸载。
   - 过滤掉基础 Trellis skill 与 `trellis-*` 工作流强化项。
   - 读取失败按空列表或空简介降级，避免装饰性信息阻断主流程。

2. 增加 common skill 安装/停用能力
   - 只允许处理 common 清单中存在的名称。
   - 安装 `.common` skill 时按目标平台复制到 `.codex/skills/<name>` 或 `.claude/skills/<name>`。
   - 删除 `.codex/skills/<name>`、`.claude/skills/<name>` 与历史 `.agents/skills/<name>` 的精确路径。
   - 清理因此变空的技能目录，不能泛删 `.agents` 或 `.claude` 下用户内容。

3. 重写 `src/commands/skill.js`
   - `flower-trellis skill` 裸命令进入交互菜单。
   - 菜单可勾选项只展示 common skill；skill-garden/Trellis 工作流强化项只读展示，不允许勾选。
   - 未安装项排在前面，已安装项默认勾选。
   - 菜单主行短文案，简介用灰色短摘要展示。
   - 确认后按最终勾选状态安装/卸载 common skill。
   - 非 TTY 抛中文错误，不等待输入。
   - 移除 `list/install` 子命令帮助和分发。

4. 更新文档与帮助
   - 更新 `src/cli.js` 顶层帮助。
   - 更新 README 用法与命令表。
   - 更新 `scripts/sync-enhancements.mjs`，随包生成 common skill 快照。

5. 验证
   - `node --check src/cli.js && for f in src/lib/*.js src/commands/*.js; do node --check "$f"; done`
   - 使用临时 Trellis 项目验证 `flower-trellis skill` 的 TTY 菜单可打开。
   - 验证停用只删除 common skill，不删除基础 Trellis skill。
   - 验证非 TTY 调用不阻塞并报错。

## Risk Points

- `@mindfoldhq/trellis` 模板路径来自捆绑依赖，定位应使用 `createRequire(import.meta.url)`，不要硬编码当前仓库的 `node_modules` 相对路径。
- 后端同步逻辑必须再次过滤非 common 项，防止未来调用绕过菜单误删 Trellis 工作流强化项。
- common skill 安装只复制 `.common` 快照中的精确 skill 目录；工作流强化包继续由 `init` / `update` 的 `applyEnhancements` 自动维护。
