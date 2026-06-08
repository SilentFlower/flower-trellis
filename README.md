# 🌸 flower-trellis

> 一键自动安装 [Trellis](https://docs.trytrellis.app/) 工程框架,并融合 **skill-garden** 的 Trellis 强化包。

## 这是什么

`flower-trellis` 是一个安装脚本,把原本要分两步做的事合并成一键完成:

1. **装 Trellis 本体** —— [trytrellis.app](https://docs.trytrellis.app/) 出品的 AI 编程工程框架,
   把 specs / tasks / memory 持久化进你的仓库,让任意 AI 编程 Agent 都遵循你的工程规范。
2. **叠加强化包** —— 自动套用 skill-garden `.trellis/` 下的 Trellis 强化补充包
   (按目标项目的 Trellis 版本智能选择 `old / 0.5 / 0.6` variant),
   内含一组 `trellis-*` 技能与 workflow override。

> 名字取自 skill-garden 的「园艺」主题:trellis 是花园里供藤蔓攀爬的棚架,
> flower-trellis 则是「开满花的棚架」—— 框架装好、强化包到位,即开即用。

## 状态

🚧 **初始化中** —— 项目骨架已建立,安装脚本开发中。

## 计划功能

- [ ] 检测 / 安装 Trellis 框架本体
- [ ] 自动识别目标项目的 Trellis 版本,选择匹配的强化包 variant
- [ ] 融合 skill-garden 强化包(复用其 `scripts/install.sh` 的安装能力)
- [ ] 支持远程一行安装(`curl -fsSL ... | bash`)
- [ ] 幂等执行:重复运行安全,可平滑升级

## 相关项目

| 项目 | 作用 |
|------|------|
| [Trellis](https://docs.trytrellis.app/) | AI 编程工程框架本体 |
| skill-garden | 提供 `.trellis/` 强化补充包与既有安装脚本 |
