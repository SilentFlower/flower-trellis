# 🌸 flower-trellis

> 一条命令装好 [Trellis](https://docs.trytrellis.app/) 工程框架,并自动融合 **skill-garden** 的强化包。

## 这是什么

`flower-trellis` 是一个 Node CLI(npm 包),把原本要分两步做的事合并成一键完成:

1. **装/升级 Trellis 本体** —— [trytrellis.app](https://docs.trytrellis.app/) 出品的 AI 编程工程框架,
   把 specs / tasks / memory 持久化进你的仓库,让任意 AI 编程 Agent 都遵循你的工程规范。
   底层调用官方 `@mindfoldhq/trellis` 的 `init` / `update`。
2. **叠加强化包** —— 自动套用 skill-garden 的强化补充包
   (按目标项目的 Trellis 版本智能选择 `old / 0.5 / 0.6` variant),
   内含一组 `trellis-*` 技能与 workflow override。强化包随本包发布,安装零网络。

> **命名由来**:取自 skill-garden 的「园艺」主题 —— trellis 是花园里供藤蔓攀爬的棚架,
> `flower-trellis` 即「开满花的棚架」:框架装好、强化包到位,即开即用。

## 用法

```bash
# 一键安装(交互选平台 + 自动叠加强化包)
npx flower-trellis init -u your-name

# 非交互安装(-y 跳过所有提示;未指定平台时默认 codex + claude)
npx flower-trellis init -u your-name -y

# 指定平台(透传给 trellis),例如只装 claude
npx flower-trellis init -u your-name --claude

# 升级 Trellis 并按新版本重新套用强化包
npx flower-trellis update

# 卸载:移除 Trellis 本体并清理强化包残留
npx flower-trellis uninstall

# 只装 Trellis 不叠加强化包 / 已有项目只重叠加
npx flower-trellis init --no-enhance
npx flower-trellis init --enhance-only

# 其它 trellis 子命令一律透传(面向未来,零维护)
npx flower-trellis <任意 trellis 命令>

# 查看版本(flower-trellis 自身 + 捆绑的 Trellis)
npx flower-trellis -v
```

## 状态

✅ **可用** —— 核心功能已实现,端到端验证通过(0.5 / 0.6 两条 variant、跟随平台、幂等、update、uninstall、打包)。当前捆绑 Trellis `0.6.0-beta.8`。

## 功能

- [x] `init`:调用 `trellis init` + 自动叠加强化包
- [x] `update`:调用 `trellis update` + 按新版本重新叠加
- [x] `uninstall`:透传 `trellis uninstall` + 补删强化包残留
- [x] 其它 trellis 子命令兜底透传
- [x] 自动识别 Trellis 版本,选择匹配的强化包 variant(`old / 0.5 / 0.6`)
- [x] 平台自己选:交互时弹 Trellis 原生多选菜单;`-y` 非交互时默认 codex + claude
- [x] 强化 skill 跟随平台铺设(claude→`.claude/skills`,codex/gemini 等→`.agents/skills`)
- [x] codex 后处理:注释 `config.toml` 的 `[features.multi_agent_v2]`、补全 `hooks.json` 的 `SessionStart`
- [x] workflow override 幂等注入(先清旧块再注入 + 备份 `.bak`)
- [x] 升级时清理过期强化项(`0.5`/`old` → `0.6` 自动删除淘汰的 skill/command,基于 flower manifest,只删自己铺过的)
- [x] `-v` 同时打印 flower-trellis 与捆绑 Trellis 版本
- [x] 幂等执行:重复运行安全

## 强化包与更新机制

强化包以**快照**形式打包在本仓库 `enhancements/`(由 `npm run sync` 从 skill-garden 同步),随 npm 发布,安装零网络。因此:

- **Trellis 本体**:`update` 实时升级(trellis 自己拉最新)。
- **强化包**:用当前安装的 flower-trellis 版本里的那份快照。要跟上 skill-garden 后续迭代,流程为:
  `skill-garden 改动 → npm run sync + 发新版 → npm i -g flower-trellis@latest → flower-trellis update`。

**重复安装 / 升级的正确性**(已实测,不会出现重复块或残留):

1. **skill 文件**:覆盖式铺设 + `.trellis/.flower-manifest.json` 记录上次铺过的路径,删除本次不再包含的项。
2. **`workflow.md`**:每次注入前先 strip 掉所有旧的 skill-garden 块(按 `BEGIN/END` 标记整段删),再重注入 —— 块数恒定、绝不翻倍;首次注入前备份 `.bak`。
3. **升级清理**:跨 variant / 跨快照版本删除淘汰的 skill / command。

> ⚠️ **维护约束**:`workflow.md` 的 strip 依赖 `src/lib/workflow-inject.js` 里硬编码的 sentinel 名单。改现有块的**内容**无需动名单;但 skill-garden **新增一种 workflow 块类型**(新的 `BEGIN/END` 名)时,必须同步更新该名单,否则旧块清不掉。

## 相关项目

| 项目 | 作用 |
|------|------|
| [Trellis](https://docs.trytrellis.app/)(`@mindfoldhq/trellis`) | AI 编程工程框架本体,本包作为 wrapper 调用其 `init`/`update`/`uninstall` 等 |
| skill-garden | 强化补充包的来源(`.trellis/` 下 `old/0.5/0.6` 各 variant) |
