# craft-slides 内置精选主题升级

## Goal

让 `craft-slides` skill 产出的演示「开箱即好看」:内置 3-5 套精选 Slidev 主题,并在 skill 被触发、开始做演示时**主动询问用户选用哪种风格**;用户参考的 trellis-lake(seriph 深色极简)必须作为其中一个可选主题。

## 用户价值

- 现状:模板写死 `theme: default` + 居中纯文字标题 + 朴素列表,产出平淡,用户需自行查主题/调样式。
- 目标:用户说"做一套 PPT"时,skill 给出一份精选主题清单让其挑选,挑完即得到专业、协调的观感,无需懂 Slidev 主题生态。

## Confirmed Facts(已通过代码/资料核实)

- 参考风格 `trellis-lake.vercel.app` = Slidev 官方 **seriph 主题(深色模式)**:近黑底、衬线标题(低饱和石板蓝)、浅灰无衬线正文、大留白、左对齐、极简装饰。
- `scripts/slidev.sh` 已具备底座能力:
  - `_theme_pkg()` 把主题短名映射为 npm 包(default/seriph/apple-basic/shibainu/bricks 已列举;`@scope/x` 原样;其余按 `slidev-theme-<name>` 惯例;`none` 不装)。
  - `new <dir> [--theme <name>]` 脚手架时把 headmatter `theme` 行替换为所选主题,并把对应包写进 `package.json`。
  - `dev`/`export` 前 `_ensure_theme()` 按 headmatter 自动预装主题包(后台 nohup 无法交互安装,缺包会启动即退出)。
- skill 共有两份同源副本需同步:`vendor/skill-garden/.common/.claude/skills/craft-slides` 与 `.../.codex/skills/craft-slides`;全局安装版 `~/.claude/skills/craft-slides` 与之完全一致(同步副本)。源头是 `skill-garden` 子模块。
- 候选主题气质(已看预览图):
  - **seriph**(参考风,衬线·深色极简)
  - **apple-basic**(仿 Keynote·极简黑白)
  - **Vercel/Geist**(`slidev-theme-geist`,白底·Geist 无衬线·现代科技)
  - **Nord**(`slidev-theme-nord`,冷色石板灰·柔和红蓝)
  - **Dracula**(`slidev-theme-dracula`,深色·紫色强调·经典开发风)
- 演示内容主要为中文 → 字体需考虑中日韩(CJK)渲染,衬线主题尤其要确认中文衬线字体回退。

## Requirements(草拟,待逐项确认)

- R1 精选阵容已锁定为 5 套:**seriph(参考风·深色衬线)、Vercel/Geist(亮色现代)、Nord(冷色深色)、Apple Basic(极简黑白)、Dracula(深色紫·开发风)**。
- R2 skill 触发后、开始写 `slides.md` 前,主动向用户呈现主题清单并询问选用哪套(用户已指定则跳过询问)。
- R3 选定主题后用 `slidev.sh new --theme <name>` 脚手架,确保 headmatter + package.json + 自动装包一致。
- R4 模板/样式要让每套主题都"开箱协调"(避免一套通用模板套到不同主题里布局错位/难看)。
- R5 中文演示的字体观感要可接受(CJK 字体回退)。
- R6 `.claude` 与 `.codex` 两份副本同步;文档(SKILL.md / syntax.md)与排错同步更新。

## Acceptance Criteria(草拟)

- [ ] 用户请求做演示时,skill 输出含 3-5 套主题的选择清单并等待选择(用户已指明风格则直接采用)。
- [ ] 阵容含 seriph 且其深色观感与参考(trellis-lake)一致或接近。
- [ ] 对每套主题:`new --theme` → `npm install` → `dev` 能起预览且首页观感专业、无明显排版错位。
- [ ] 中文标题/正文在所选主题下渲染正常(无豆腐块、衬线主题中文不突兀)。
- [ ] 两份副本(.claude/.codex)内容一致;SKILL.md 记录新的选主题交互约定与主题清单。

## Out of Scope(暂定)

- 自研全新的 npm 主题包(本次走"精选现成主题 + 必要的模板/样式打磨")。
- 非 Slidev 的 PPT/Keynote 二进制编辑。

## 决策记录(brainstorm 已确认)

- Q1 ✅ 阵容:seriph + Vercel/Geist + Nord + Apple Basic + Dracula(5 套)。
- Q2 ✅ seriph 保真度:**stock seriph + 中文微调**(不做像素级自研 CSS)。
- Q3 ✅ 选主题交互:**每次做演示都先列 5 套清单让用户选**(不预设默认、不省略)。
- Q4 ✅ 模板策略:**每主题一份适配模板**(`templates/slides.<theme>.md`)。
- Q5 ✅ 中文字体:**系统字回退,不强配 webfont**(与 trellis-lake 一致,导出无网络依赖)。

## 主题登记表(menu 标签 → 短名 → npm 包 → 配色)

| 菜单标签 | `--theme` 短名 | npm 包 | colorSchema | 气质 |
|----------|---------------|--------|-------------|------|
| Seriph(参考风) | `seriph` | `@slidev/theme-seriph` | dark | 衬线·深色极简 |
| Vercel / Geist | `geist` | `slidev-theme-geist` | light | 白底·现代科技 |
| Nord | `nord` | `slidev-theme-nord` | dark | 冷色石板灰 |
| Apple Basic | `apple-basic` | `@slidev/theme-apple-basic` | 写模板时定 | 仿 Keynote 极简 |
| Dracula | `dracula` | `slidev-theme-dracula` | dark | 深色·紫色开发风 |
