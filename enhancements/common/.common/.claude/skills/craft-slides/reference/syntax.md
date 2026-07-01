# Slidev 语法速查（写 slides.md 时查）

> 给 AI 把大纲转成规范 `slides.md` 用。命令 / 字段以本仓库 `packages/slidev` 源码与 `npx slidev <cmd> --help` 为准,勿凭记忆扩写。

## 1. 文件结构与分页

- 一个 `slides.md` = 整份演示;用 `---` 单独成行分隔相邻幻灯片。
- 分隔符 `---` **前后要有空行**,否则会被当成普通 Markdown 水平线或 frontmatter 边界。
- 第一段 frontmatter 是 **headmatter**(全局配置);其后每页顶部的 frontmatter 是 **该页配置**。

```md
---
theme: default      # ← headmatter(全局)
title: 我的演示
---

# 第 1 页

内容

---
layout: center      # ← 第 2 页的 per-slide frontmatter
---

# 第 2 页
```

## 2. Headmatter 常用字段（仅第一页）

| 字段 | 说明 | 示例 |
|------|------|------|
| `theme` | 主题包;v52 起 **含 default 都是独立 npm 包**,需安装(脚本 `dev`/`export` 前会按此自动预装) | `default` / `seriph` |
| `colorSchema` | 强制主题亮/暗(不写则跟随主题默认 / 系统) | `dark` / `light` / `all` |
| `title` | 标题(标签页 + 导出文件名) | `我的演示` |
| `info` | 简介(支持 Markdown) | `多行用 \|` |
| `transition` | 全局切页动画 | `slide-left` / `fade` / `slide-up` |
| `class` | 给每页根元素加的 class | `text-center` |
| `mdc` | 启用 MDC 语法。⚠️ 慎开:开后 `:Word`(ASCII 冒号紧跟单词)会被当内联组件,吞掉文字 | 默认不开 |
| `lineNumbers` | 代码块显示行号 | `true` |
| `drawings` | 画笔/批注持久化配置 | `{ persist: false }` |

## 3. Per-slide frontmatter（每页可选）

| 字段 | 说明 |
|------|------|
| `layout` | 该页布局(见下) |
| `class` | 该页 UnoCSS 类 |
| `transition` | 覆盖该页切页动画 |
| `background` | 背景图 URL |
| `clicks` | 手动指定点击次数 |
| `hide` | `true` 跳过该页 |

## 4. 内置 Layout（`packages/client/layouts/` 实测）

`cover`（封面）、`intro`（开场）、`section`（分节）、`center`（居中）、`default`（默认）、
`statement`（断言大字）、`fact`（数据强调）、`quote`（引用）、`end`（结尾）、`full`（全幅）、
`image`（整图）、`image-left` / `image-right`（图文左右,图侧用 `image:` 字段）、
`iframe` / `iframe-left` / `iframe-right`（嵌网页,用 `url:` 字段）、
`two-cols` / `two-cols-header`（两栏,用 `::right::` / `::left::` / `::default::` 分隔）、`none`（无样式）。

```md
---
layout: image-right
image: /photo.png
---

# 左侧文字，右侧大图
```

## 5. 点击动画（渐进展示）

| 写法 | 效果 |
|------|------|
| `<v-click>…</v-click>` | 包裹的块在下一次点击出现 |
| `<v-clicks>` 包列表 | 列表逐项出现 |
| `<v-clicks depth="2">` | 嵌套列表按层级出现 |
| `<v-after>` | 与前一个 click 同步出现 |
| `v-click` 作为属性 | `<div v-click>…</div>` |
| `.click` 指令(MDC) | `内容 {.text-red v-click}` |

代码块逐行聚焦:```` ```ts {1|2-3|all} ```` —— 点击在 第1行 → 2-3行 → 全部 间切换。

## 6. 代码块

- 行高亮:```` ```ts {2,4-6} ````（静态）/ ```` {1|2|3} ````（随点击）
- Magic Move(逐帧变形,基于 `@shikijs/magic-move`):

````md
```````md
````md magic-move
```ts
const a = 1
```
```ts
const a = 1
const b = 2
```
````
```````
````

- Monaco 实时编辑:代码块加 `{monaco}`;运行:`{monaco-run}`。
- TwoSlash 类型提示:`twoslash`。

## 7. LaTeX / 图表 / 媒体

- 行内公式 `$E=mc^2$`;块级:
  ```md
  $$
  \int_0^1 x^2 \,dx
  $$
  ```
- Mermaid:```` ```mermaid ````(`graph` / `sequenceDiagram` / `gantt` …),可加 `{scale: 0.8}`。
- PlantUML:```` ```plantuml ````。
- 图片:`![alt](/path.png)` 或 `<img src="/path.png" class="w-40 rounded" />`(放 `public/` 下用 `/` 引用)。

## 8. 演讲者备注

每页**最后一个** HTML 注释即该页备注,仅演讲者模式可见:

```md
# 这一页

正文

<!--
讲稿:这里写要点提示、过渡话术。
-->
```

## 9. 样式与组件

- UnoCSS 原子类直接用:`<div class="mt-4 text-blue-500">`。
- 局部样式:页内写 `<style> h1 { color: teal } </style>`(只作用当前页)。
- 可直接写 Vue 组件 / 引入 `components/` 下的 `.vue`;内置 `<Tweet>` `<Youtube>` `<Toc>` 等。

## 10. CLI 命令（源码核实）

| 命令 | 作用 | 关键参数 |
|------|------|----------|
| `slidev [entry]` | 起 dev server | `-p/--port`(默认 3030)、`-o/--open`、entry 默认 `slides.md` |
| `slidev build [entry]` | 构建静态 SPA | `-o/--out`(默认 `dist`)、`--base`、`--download`、`--without-notes` |
| `slidev export [entry]` | 导出 | `-f/--format pdf\|png\|pptx\|md`(默认 pdf)、`-o/--output`、`--range "1,4-5"`、`--dark`、`--with-clicks`、`--per-slide`、`--scale`、`--timeout` |
| `slidev export-notes` | 导备注 PDF | `--output`、`--timeout` |
| `slidev format [entry]` | 格式化 md | — |
| `slidev theme eject` | 释出当前主题到本地 | `--dir`(默认 `theme`) |

- 导出依赖 `playwright-chromium`(npm 包,非仅浏览器二进制):缺包报 `please install it via npm i -D playwright-chromium`;缺浏览器再 `npx playwright install chromium`。`slidev.sh export` 两者都会幂等装。
- `pptx` 默认 `--with-clicks`(把点击动画展开成多页)。

## 11. 实测易踩的坑(写之前过一遍)

| 坑 | 现象 | 规避 |
|----|------|------|
| 主题包未装 | 后台起 dev 启动即退出,日志 `theme "…" was not found and cannot prompt for installation` | headmatter 的 `theme` 对应包要装;脚本 `dev`/`export` 会自动预装。官方短名 → `@slidev/theme-<name>`,社区主题 → `slidev-theme-<name>` |
| 导出缺 npm 包 | `export` 报 `npm i -D playwright-chromium` | 用 `slidev.sh export`(已幂等装);别只 `npx playwright install chromium` |
| MDC 吞文字 | `mdc: true` 下 `分布:POST` → `Failed to resolve component: POST`,文字消失 | 不用 MDC 行内语法就别开 `mdc`;中文冒号用全角 `:`,英文冒号后加空格 |
| 单页超屏被裁 | 内容下半截不见,且无提示(Slidev 页面不滚动) | 一页一主题;拆页 / 调小字号 / 局部 `<style>` 压缩行高;截图自检 |
| 深层 Mermaid 超高 | `flowchart TD` 多级决策树底部被裁 | 改 HTML 卡片布局,或 `flowchart LR` / 调小 ```` ```mermaid {scale: 0.5} ```` |
| emoji 豆腐块 | 预览 / 导出里 emoji 全是 □ | 系统装 `fonts-noto-color-emoji`;装不了就别用 emoji |
| v-clicks 误判 | 截图首屏 `<v-clicks>` 内容"空白" | 正常,渐进动画未点击时隐藏;PDF 导出会展开所有点击态 |

- 局部 `<style>`:slidev 中**每页的 `<style>` 自动作用于当前页**(无需 `scoped`),适合单页压缩表格行高 / 字号而不影响其他页。
