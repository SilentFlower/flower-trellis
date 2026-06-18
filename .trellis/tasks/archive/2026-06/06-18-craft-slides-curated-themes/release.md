# Release Operations

## Conclusion
Release operations exist.(仅"传播/同步"类,无数据库/配置/外部系统风险)

## SQL Changes
None

## Configuration Changes
None

## Batch / Deployment Scripts / Data Repair
- 改动已提交并推送:skill-garden 子模块 `ab389b3`、flower-trellis 父仓指针 `11f1b20`(均 origin/main)。
- 本机全局安装已同步:`~/.claude/skills/craft-slides` 与 `~/.codex/skills/craft-slides`(diff 无差异)。
- 下游传播:其它 vendored 了 craft-slides 的项目,需重跑 `bash vendor/skill-garden/scripts/install.sh --scope common <target>`(或对应安装方式)以获取 5 套新模板与脚本/SKILL 更新。

## External Systems / Dependent Platforms
None

## Release Order
1. 子模块提交推送 → 2. 父仓指针提交推送 → 3. 全局/下游 install.sh 同步。(已完成 1-2 与本机全局)

## Rollback Notes
- 纯文件级改动,无数据迁移。回滚 = 还原 skill-garden 子模块 `ab389b3`(`git revert` 或退回 `9538934`)+ 父仓指针,重跑 install.sh 同步。

## Post-release Verification
- 任一项目 `slidev.sh new <dir> --theme <seriph|geist|nord|apple-basic|dracula>` → `npm install` → `dev` 可起预览,封面/正文排版协调、中文无豆腐块(本任务已逐套实测通过)。
