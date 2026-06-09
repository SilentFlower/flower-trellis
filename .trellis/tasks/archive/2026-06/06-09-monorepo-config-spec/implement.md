# implement.md — 实施清单与验证

> 配套 `prd.md` / `design.md`。按序执行,`[required]` 不可跳过。

## Implementation Checklist

1. [ ] **快照备份**(回滚锚点):对 `.trellis/spec/` 与 `.trellis/config.yaml` 做一次快照
   (沿用 `.trellis/.backup-<ts>/` 习惯,或确保改动均在单一 commit 内便于 `git revert`)。
2. [ ] **改 config.yaml**:新增 `packages`(`flower-trellis: {path: .}`、
   `skill-garden: {path: vendor/skill-garden, type: submodule, git: true}`)+ `default_package: flower-trellis`。
3. [ ] **建目录 + 迁移**:`mkdir -p .trellis/spec/flower-trellis` 后
   `git mv .trellis/spec/cli .trellis/spec/flower-trellis/cli`。
4. [ ] **核对引用(预期无需改)**:`grep -rn "spec/cli" .` 排除 `.backup`/`.git`/`tasks/`/`workspace/`;
   确认命中项均为通用示例 / 指向本仓不存在的 `backend|unit-test` 子层的模板引用(已复核),
   不指向被迁移的真实 8 文件 → **不改动**。仅当发现指向真实迁移文件的引用才需修改。
5. [ ] **迁移完整性校验**:`spec/cli/` 已不存在,`spec/flower-trellis/cli/` 含全部 8 个 .md(`git mv` 保历史)。
6. [ ] **(可选)本任务 task.json 标 `package: flower-trellis`**(按需,非强制;default 已兜底)。

## Validation

```bash
# 1) 多仓识别:主包 cli layer + skill-garden(submodule + git repo)
python3 ./.trellis/scripts/get_context.py --mode packages

# 2) git-context:出现 skill-garden 独立 GIT STATUS + 最近 commits
python3 ./.trellis/scripts/get_context.py | grep -A6 "skill-garden"

# 3) spec 可达性
cat .trellis/spec/flower-trellis/cli/index.md     # 迁移后主包 spec 可读
cat .trellis/spec/guides/index.md                 # 共享层未受影响
test ! -d .trellis/spec/cli && echo "old spec/cli removed OK"

# 4) is_monorepo 行为
python3 -c "import sys; sys.path.insert(0,'.trellis/scripts'); from common.config import is_monorepo, get_default_package; print('monorepo=', is_monorepo(), 'default=', get_default_package())"
```

- 触发 `trellis-before-dev`:确认按 `spec/flower-trellis/cli/.../index.md` 读到 spec。
- 触发 `trellis-check` 与路由:确认 monorepo 下无报错。

## Review Gates

- **start 前**:三件套(`prd.md` / `design.md` / `implement.md`)经用户 review。
- **提交前**:Validation 四项全过 + grep 零残留;再走 `trellis-push`(commit gate 生效)。
