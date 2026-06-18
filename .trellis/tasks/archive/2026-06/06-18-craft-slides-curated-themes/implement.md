# Implement — craft-slides 内置精选主题升级

## 实施清单(有序)

> 所有源码改动落在 skill-garden 子模块的两份源:
> `vendor/skill-garden/.common/.claude/skills/craft-slides`(CLAUDE 份)
> `vendor/skill-garden/.common/.codex/skills/craft-slides`(CODEX 份)
> 每步两份同步,保持字节一致。

1. **slidev.sh — `_theme_pkg()`**:为 `geist` / `nord` / `dracula` 补显式 case(返回 `slidev-theme-geist|nord|dracula`)。逻辑等价,自文档化。
2. **slidev.sh — `cmd_new()`**:模板解析改为「优先 `templates/slides.<theme>.md`,存在则原样 cp 且跳过 theme 行 sed;否则兜底 `slides.md` + sed」。
3. **slidev.sh — usage 文案**:`new` 说明里列出 5 套精选短名(seriph/geist/nord/apple-basic/dracula)。
4. **新增 5 份每主题模板**(每份含:正确 headmatter `theme`+`colorSchema`+`title`/`info`;封面/section/要点/代码/两栏/结尾骨架;中文示例文案;不配 fonts):
   - `templates/slides.seriph.md`(colorSchema: dark,贴近 trellis-lake)
   - `templates/slides.geist.md`(light)
   - `templates/slides.nord.md`(dark)
   - `templates/slides.apple-basic.md`(light,实测择优)
   - `templates/slides.dracula.md`(dark)
5. **SKILL.md**:
   - 新增「精选主题清单」小节(主题登记表:标签/短名/气质/适用)。
   - 「端到端工作流 Step 1」与「AI 行为约定」表:写明**做演示前必先列 5 套清单让用户选**,选定后 `new --theme <短名>`。
   - 反模式补一条:不要跳过选主题直接 new。
6. **reference/syntax.md**:必要时补「换主题 = 改 headmatter theme + colorSchema」一句(轻量)。
7. **同步两份**:确认 `.claude` 与 `.codex` 两份逐文件 `diff` 一致。

## 验证命令

逐套主题脚手架 + 起预览 + 截图自检(用编辑后的源直接测,避免依赖旧全局副本):

```bash
SRC=/root/project/flower-trellis/vendor/skill-garden/.common/.claude/skills/craft-slides
cd /tmp && rm -rf t-seriph t-geist t-nord t-apple t-dracula
for t in seriph geist nord apple-basic dracula; do
  d="t-${t%%-*}"
  bash "$SRC/scripts/slidev.sh" new "$d" --theme "$t"
  ( cd "$d" && npm install >/dev/null 2>&1 \
    && bash "$SRC/scripts/slidev.sh" dev --port 0 )   # 取日志真实 URL
done
```

- 对每套:浏览器访问真实 URL 的封面 + 一个内容页,截图确认:**无找不到主题报错、无中文豆腐块、封面/正文排版协调、不超屏被裁**。
- seriph 深色观感与参考 trellis-lake 对比,确认接近。
- 关键校验点:
  - [ ] 5 套 `npm install` 均成功(社区包 geist/nord/dracula 可拉到)。
  - [ ] 5 套 `dev` 均能起且首页观感专业。
  - [ ] 中文标题/正文正常。
  - [ ] `.claude` / `.codex` 两份 `diff -r` 为空差异。
  - [ ] 不带 `--theme` 的 `new` 仍走默认 `slides.md`(回归)。

## 风险文件 / 回滚点

- `scripts/slidev.sh`:`cmd_new` 模板解析是行为分支改动,最易回归 —— 必测「带/不带 --theme」两条路径。
- 社区主题包(geist/nord/dracula)安装/渲染失败:`_ensure_theme` 有失败提示兜底;若某套实测起不来,记录并在清单中标注或临时降级。
- 回滚:还原 skill-garden 子模块该次提交即可,无状态迁移。

## start 前置检查 / 收尾

- 走 trellis-route(implement) 进入实现(本仓库 skill-garden override 要求)。
- 实现并自检通过后:同步全局副本 `scripts/install.sh --scope common`;按 skill-garden 发布流程提交子模块 + 更新 flower-trellis 子模块指针 + release ledger。

## 验证结果(2026-06-18 实测)

- 脚手架逻辑:5 套 `new --theme` 均套用对应 `slides.<theme>.md`(theme + colorSchema + 专属布局正确);无主题→default;未知社区主题(penguin)→兜底通用模板 + sed 改 theme 行 + 正确依赖。✓
- `npm install`:seriph / geist / nord / apple-basic / dracula 五套主题包均成功安装。✓
- `dev` 预览截图自检(中文均正常无豆腐块、内容不超屏):
  - seriph:封面 + 代码页 ✓,深色衬线观感与参考 trellis-lake 一致。
  - geist:封面 ✓;**首发现 statement 页左对齐顶边裁字 → 改用 `layout: center`+`text-center` 修复** ✓。
  - nord:**首发现默认 cover 布局空白(Nord 不提供 layouts)→ headmatter 改 `layout: center`+`text-center`(对齐 Nord 官方 example)修复** ✓;section / quote / 内容页正常。
  - apple-basic:封面 + fact 数字页 ✓。
  - dracula:封面 ✓(紫色强调)。
- 一致性:`.common/.claude`、`.common/.codex`、全局 `~/.claude/skills/craft-slides` 三处 `diff -r` 无差异。✓
- 子模块改动 = 3 改(SKILL.md / syntax.md / slidev.sh)+ 5 新模板,两平台齐。
