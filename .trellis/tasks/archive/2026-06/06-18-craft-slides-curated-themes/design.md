# Design — craft-slides 内置精选主题升级

## 架构与边界

craft-slides skill 的资产构成不变,本次只在四个面上增强:

```
craft-slides/
├── SKILL.md              # ① 行为契约:新增「做演示前必列 5 套主题清单让用户选」+ 主题登记表
├── scripts/slidev.sh     # ② 生命周期:_theme_pkg 补显式分支;cmd_new 改为按 --theme 选模板
├── templates/
│   ├── slides.md         #   保留:默认/兜底骨架(无匹配主题模板时用)
│   ├── slides.seriph.md      # ③ 新增:5 份每主题适配模板
│   ├── slides.geist.md       # ③
│   ├── slides.nord.md        # ③
│   ├── slides.apple-basic.md # ③
│   └── slides.dracula.md     # ③
└── reference/syntax.md   # ④ 同步:补主题清单/选主题约定的速查(必要时)
```

边界:**不自研 npm 主题包**,只挑现成主题 + 写每主题模板。不引入构建步骤、不改运行时状态目录约定(`.slidev-craft/`)。

## 主题登记表(单一事实来源)

| 菜单标签 | `--theme` 短名 | npm 包 | colorSchema | 气质 / 适用 |
|----------|---------------|--------|-------------|-------------|
| Seriph(参考风) | `seriph` | `@slidev/theme-seriph` | `dark` | 衬线·深色极简 / 正式分享、理念阐述 |
| Vercel / Geist | `geist` | `slidev-theme-geist` | `light` | 白底·现代科技 / 产品技术发布 |
| Nord | `nord` | `slidev-theme-nord` | `dark` | 冷色石板灰 / 长篇技术讲解 |
| Apple Basic | `apple-basic` | `@slidev/theme-apple-basic` | `light`(取 Basic White,对比清爽) | 仿 Keynote 极简 / 通用 |
| Dracula | `dracula` | `slidev-theme-dracula` | `dark` | 紫色开发风 / 开发者向、代码多 |

> Apple Basic 的 light/dark 在实现时以预览实测为准择优(优先 light)。

## 数据流 / 契约

### 选主题交互(SKILL.md 行为契约,AI 驱动)
1. 用户表达「做一套关于 X 的演示」→ AI **先**输出 5 套主题清单(名称 + 一句气质 + 适用),请用户选。
2. 用户回复(编号 / 名称 / 「你定」)→ 映射到 `--theme` 短名;「你定」回退 `seriph`。
3. AI 执行 `slidev.sh new <dir> --theme <短名>` → `cd <dir> && npm install` → `slidev.sh dev`。
- 约束:**每次都问**,不预设默认、不因「急/小」省略;呈现可用 AskUserQuestion 或编号清单,二者皆可。

### `_theme_pkg()`(脚本)
- 现状已能解析 5 套:seriph / apple-basic 显式映射;geist / nord / dracula 走 `slidev-theme-<name>` 惯例命中。
- 改动:为 geist / nord / dracula **补显式 case**(自文档化 + 防社区改名),逻辑等价,无行为回归。

### `cmd_new()`(脚本)— 模板选择
- 当前:固定 `cp templates/slides.md`,再按 `--theme` sed 替换 headmatter 的 theme 行。
- 改为:
  1. 若存在 `templates/slides.<theme>.md` → 直接 `cp` 之(其 headmatter 已含 `theme` + `colorSchema` + 中文友好配置,**不再 sed 替换**)。
  2. 否则沿用 `templates/slides.md` + 原 sed 替换逻辑(兜底,兼容任意社区主题短名)。
- `package.json` 依赖写入逻辑不变(`_theme_pkg` 决定包名)。

### 每主题模板内容骨架(5 份统一结构,差异只在封面/配色/强调用法)
- 封面页(标题 + 副标题 + 出处)
- 议程 / section 分隔页(`layout: section`)
- 要点页(`<v-clicks>` 渐进列表)
- 代码页(```ts {行高亮}```)
- 两栏页(`layout: two-cols`:Mermaid + 公式)
- 结尾页(`layout: end`)
- 仅用**核心通用布局**(default/section/center/two-cols/end),避免依赖某主题独有布局导致换主题报错。
- 中文:headmatter **不配 `fonts`**,中文走系统 CJK 回退;西文由主题自带字体决定。

## 兼容 / 同步 / 迁移

- **源头**:`vendor/skill-garden/.common/.claude/skills/craft-slides` 与 `.../.codex/skills/craft-slides` 两份,需保持字节一致(当前一致)。
- **生效路径**:改源 → `scripts/install.sh --scope common <target>` 复制到目标 `.claude/.codex`;全局 `~/.claude/skills/craft-slides` 为副本,需重装同步。
- **提交**:skill-garden 子模块内提交 → flower-trellis 更新子模块指针;按本仓库既有 skill-garden 发布流程(见近期 release ledger)走版本/记账。
- 向后兼容:旧 `slides.md` 模板保留;`new`(不带 `--theme`)行为不变;已有 Slidev 项目不受影响。

## 取舍

- 每主题模板 = 5×2 平台 = 10 文件,改公共骨架需同步;换来「开箱即协调」,符合既定目标。
- 不配 CJK webfont:牺牲 seriph 中文衬线统一感,换导出稳定/离线可用;与参考 trellis-lake 行为一致。
- 显式 case vs 纯惯例:多几行代码换可读性与抗社区改名,低成本。

## 回滚

- 纯文件级改动,无数据/状态迁移。回滚 = 还原 skill-garden 子模块该次提交 + 重跑 install.sh。
- 风险点:社区主题包名/版本(geist/nord/dracula)安装失败 → `_ensure_theme` 已有失败兜底提示;实现期逐套实测预览确认。
