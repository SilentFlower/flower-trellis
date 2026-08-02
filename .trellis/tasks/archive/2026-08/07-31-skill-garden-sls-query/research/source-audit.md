# `aliyun-sls-query` 源码审计

## Source

- 当前个人 Skill：`/root/.codex/skills/aliyun-sls-query`
- 审计日期：2026-07-31
- 该目录是迁移输入；集成完成后，Skill Garden `.common` 是发布链的源码真源。

## Distributable Assets

| 路径 | SHA-256 | 目标权限 |
|---|---|---|
| `SKILL.md` | `5ddd559316f174c11665699218c1d92a408525989f3a9c49561a17e61c298238` | `0644` |
| `assets/env.example` | `57587f5d274536ff425e1a4d60748c688dbb387d669ca5a19ea0a2fcd45cd4de` | `0644` |
| `scripts/sls_get_logs.py` | `1de183cc0ab0fb6f6a5c4f67b1e32210c51d6f59c9a7ccc9b4ff63cd894f1e5f` | `0755` |

个人目录中的三个文件当前权限均为 `0777`，迁移时不得原样继承；按 Skill Garden 现有 Python Skill 约定规范化为文档/模板 `0644`、可执行脚本 `0755`。

## Exclusions

- `scripts/__pycache__/`
- `*.pyc`
- `~/.config/aliyun-sls-query/env`
- 任何真实 AK/SK、project、logstore 或本机环境数据

Skill Garden 根 `.gitignore` 已忽略 `__pycache__/`，Flower `package.json.files` 也排除 `enhancements/**/__pycache__` 与 `enhancements/**/*.pyc`；实现仍应在源目录级显式确认没有缓存文件进入版本控制。

## Runtime Contract

- `scripts/sls_get_logs.py` 使用 Python 标准库，无第三方运行时依赖。
- 配置优先级是命令参数、进程环境变量、私有 ENV 文件；默认文件为 `~/.config/aliyun-sls-query/env`。
- AK/SK 只通过环境变量名定位，不作为命令行值传入。
- 脚本实现 SLS V1 HMAC-SHA1 签名、gzip 解压、GetLogs 参数、`x-log-progress` 提示和中文 UTF-8 输出。
- 当前可执行脚本面向 logstore；`SKILL.md` 中的 metricstore 内容是查询经验，不在本任务中新增专用工具。

## Distribution Evidence

- Skill Garden common skill 双平台目录：`.common/.codex/skills/<name>`、`.common/.claude/skills/<name>`。
- Flower `scripts/sync-enhancements.mjs` 会整体复制 `.common`，并把两端名称写入 `enhancements/MANIFEST.json`。
- Flower `src/lib/skill-catalog.js` 会从快照自动发现、展示、安装、停用 common skill。
- Flower Plugin Runtime 只刷新目标项目中已经存在的 common skill；不会因 update 自动启用新 Skill。
- `vendor/skill-garden` 是独立 git submodule，发布快照的 `sourceCommit` 必须指向已提交的 Skill Garden HEAD。
