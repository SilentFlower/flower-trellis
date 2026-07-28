# Flower Plugin 作者工具、作者 Skill 与 rd-guide 注册契约技术设计

## 1. 组成

```text
flower/flower-plugin-author (standard builtin Plugin)
├── skills/flower-plugin-author/SKILL.md
└── skills/flower-plugin-author/references/*.md

plugin init ---- deterministic templates
plugin validate ---- P1/P2/P3/P4 real validators
                         |
                  local author / rd-guide CI
```

Skill 负责编排与解释；CLI 负责确定性创建和校验。

## 2. Skill 结构

```text
skills/flower-plugin-author/
├── SKILL.md
└── references/
    ├── manifest.md
    ├── capabilities.md
    ├── patches.md
    ├── marketplace.md
    ├── gitlab-release.md
    └── ci-and-review.md
```

`SKILL.md` 使用命令式步骤并保持 500 行以内；references 一层直达，不互相深链。实现时使用 skill-creator 的 `init_skill.py` 初始化 canonical Skill，再删除不需要的占位资源，并运行 `quick_validate.py`。

## 3. Scaffold

模板作为 `src/plugin/authoring/templates/` 中的静态资产，由结构化参数渲染。变量只允许经过 ID/name/version/profile validator 的值；路径由固定模板决定，不接受任意输出路径片段。

默认树：

```text
.flower-plugin/plugin.json
skills/<plugin-id>/SKILL.md
tests/plugin.test.js
marketplace-entry.json
```

integration 模板额外生成声明式 patches 示例，但仍由 P4 validator 决定合法性。

## 4. Validate Pipeline

1. 加载 Plugin/Marketplace schema。
2. 安全遍历目录并计算 canonical tree hash。
3. 通过 Provider/Resolver 校验依赖闭包。
4. 通过 capability policy 校验请求与 entry 上限。
5. 在 Marketplace 模式核对 ref、commit、version、digest 和 source/subdir。
6. 输出稳定 issues，按 path/code 排序。

CI 命令采用同一个 `plugin validate` 入口，通过 flags 选择 subject 和 non-interactive/frozen 行为，不创建独立校验实现。

## 5. rd-guide 契约

本仓交付示例 `.gitlab-ci.yml` job 片段、CODEOWNERS 路径规则和 JSON 输出说明，作为 `rd-guide` 可消费模板；不直接写远端仓库。CI 以 MR diff 判断新增/扩大 integration，并输出机器可识别的 review requirement。

## 6. Forward-test

实现完成后在临时目录运行两个独立场景。传递给 agent 的只有作者 Skill、原始请求和临时目录，不能给出预期 manifest 或已知错误。检查生成 artifact、validate 输出和是否错误申请权限。

## 7. 回滚

- author Plugin 未被默认安装，失败时可从 builtin registry 移除而不影响 Runtime。
- CLI scaffold/validate 与 Runtime 分层，模板问题不改变 schema；validator 问题回到所属 P1-P4 修正。
