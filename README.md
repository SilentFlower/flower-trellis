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
# 在当前项目里一键安装(默认 Claude + agents,自动叠加强化包)
npx flower-trellis init -u your-name

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

✅ **可用** —— 核心功能已实现,端到端验证通过(0.5 / 0.6 两条 variant、幂等、update、uninstall、打包)。当前捆绑 Trellis `0.6.0-beta.8`。

## 功能

- [x] `init`:调用 `trellis init` + 自动叠加强化包
- [x] `update`:调用 `trellis update` + 按新版本重新叠加
- [x] `uninstall`:透传 `trellis uninstall` + 补删强化包残留
- [x] 其它 trellis 子命令兜底透传
- [x] 自动识别 Trellis 版本,选择匹配的强化包 variant(`old / 0.5 / 0.6`)
- [x] 强化 skill 双铺到 `.claude/skills` 与 `.agents/skills`
- [x] workflow override 幂等注入(先清旧块再注入 + 备份 `.bak`)
- [x] `-v` 同时打印 flower-trellis 与捆绑 Trellis 版本
- [x] 幂等执行:重复运行安全

## 相关项目

| 项目 | 作用 |
|------|------|
| [Trellis](https://docs.trytrellis.app/)(`@mindfoldhq/trellis`) | AI 编程工程框架本体,本包作为 wrapper 调用其 `init`/`update`/`uninstall` 等 |
| skill-garden | 强化补充包的来源(`.trellis/` 下 `old/0.5/0.6` 各 variant) |
