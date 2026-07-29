# Flower Plugin 跨模块集成、打包与端到端验收技术设计

## 1. 集成测试层级

```text
unit/contract tests (P1-P6)
          |
module integration tests
          |
real CLI subprocess scenarios
          |
npm pack installed-copy smoke
          |
manual private GitLab smoke
```

P7 的主要新增价值是后两层和跨模块契约扫描，不复制单元测试。

## 2. Fixture 结构

```text
test/fixtures/plugin/
├── marketplace/
├── plugins/
│   ├── standard/
│   ├── integration/
│   ├── dependencies/
│   └── invalid/
├── legacy-projects/
└── gitlab-responses/
```

fixture 只使用虚构 token 和仓库数据；敏感扫描对源码、fixture 和命令输出执行 deny-list 与高熵检查。

## 3. CLI Harness

统一 harness 使用 `process.execPath` 启动 `bin/flower-trellis.js`，捕获 stdout/stderr/exit code、目标文件树和 mock 请求。环境变量显式隔离 XDG config、cache、keyring adapter 和 HOME 等用户态路径，避免读取真实凭据。

## 4. GitLab Mock

本地 server 模拟 OAuth authorize/token、projects、repository tree/files/archive。测试 clock 控制 expiry、polling 和 retry。每个场景记录请求 method/path/header 的脱敏摘要，用于断言零网络、scope 和 Bearer header，不保存 token 值。

## 5. npm Pack Smoke

从 `npm pack --json` 读取 tarball 文件清单，在临时目录安装/解包后运行 CLI help、builtin source、local Plugin 和 author Plugin smoke。optional keyring 缺失场景必须成功加载 memory adapter。

## 6. Evidence Matrix

维护测试内的机器可读父需求映射，至少记录 requirement/acceptance ID、测试文件或人工步骤。P7 最终检查映射完整性，防止只增加测试但遗漏父需求。

## 7. 回滚

- 集成失败不发布，保持现有 beta 包不变。
- 缺陷回到所有权子任务修复；P7 只保留 help、README、pack 和共享 fixture/harness 变更。

## 8. 交互式 Plugin 管理器

### 8.1 入口与兼容边界

`flower-trellis plugin` 只有在没有 Plugin 子参数且 stdin/stdout 均为 TTY 时进入交互管理器。非 TTY、`--json`、`--help` 和全部显式子命令继续走现有 parser 与命令执行路径，保证 CI、脚本和旧用法不被 prompt 阻塞。

交互管理器使用仓库既有 `@inquirer/prompts` 或同一 `@inquirer/core` 体系内的轻量自定义 prompt，不引入 React/Ink 全屏渲染栈。信息架构借鉴 Claude Code `/plugin`，采用 `发现 / 已安装 / 来源 / 问题` 四页签；页签、列表、详情和操作都属于同一持续管理上下文。显式“退出”返回 0，Ctrl+C 继续由顶层映射为 130。

顶层 `flower-trellis --help` 只把 `flower-trellis plugin` 描述为统一的 Plugin 管理入口，不再展示 lifecycle、authoring、source/auth/search 三行命令。底层命令继续作为稳定执行原语保留，由交互管理器直接调用；需要脚本化时通过 `flower-trellis plugin --help` 查阅，不把高级参数暴露为普通用户的首屏认知负担。

### 8.2 模块边界

新增 `src/commands/plugin-interactive.js` 作为薄编排层：

- 读取 `ProjectStore` 展示直接声明、lock 解析版本和 state 应用平台。
- 读取 `UserSourceStore` 展示 source 启停状态；认证、搜索和生命周期操作必须调用现有公共执行入口。
- 通过注入的 `runCommand(args)` 复用 `plugin add/update/remove/verify/init/validate/source/auth`，不得复制 Resolver、Application Service、OAuth、Keyring、capability 或 writer。
- 远程搜索补充一个返回结构化结果的公共 helper；现有人类输出和 `--json` wrapper 继续消费同一个结果，避免 UI 解析 stdout 文本。
- prompt adapter、TTY 判定、输出和命令 runner 可注入，测试不操作真实终端、HOME、Keyring 或 GitLab。

### 8.3 页签、列表与详情

```text
Flower Plugin
[发现] [已安装] [来源] [问题]

搜索 Plugin...
> code-review      rd-guide      代码评审规范
  java-guide       rd-guide      Java 开发规范
  internal-tool    team-guide    内部研发工具
```

`发现` 合并所有已启用 Marketplace 的结构化搜索结果，用来源标签解决同名歧义；单来源时跳过来源选择。进入或显式刷新时更新索引，新 Plugin 和版本无需升级 Flower 即可出现；来源刷新失败时保留旧缓存并显示 stale/error 状态。

Enter 打开 Plugin 详情，详情展示来源、描述、版本、依赖、capability、目标平台和更新时间，再进入安装动作。安装保持现有单 Plugin 原子事务：选择版本和平台，执行 `plugin add --dry-run` 展示依赖、capability 和目标变化，用户确认后执行真实 add。选择未授权来源或其中 Plugin 时直接启动 Device Flow，立即展示授权地址与授权码，并在授权成功后恢复原详情、搜索词和选中位置；PKCE 只保留在高级认证入口。取消授权、预览或最终确认均零写入。

`已安装` 从直接声明、lock 和 state 组合列表，把错误、待处理项、可更新项和普通项稳定分组，再从详情执行 verify、update 或 remove。update/remove 先执行 dry-run 并确认；更新全部复用现有生命周期命令，不创造新的安装事务语义。`来源` 复用 source add/update/enable/disable/remove 和 auth login/logout/status；内置来源删除仅恢复默认 descriptor 的既有语义。`问题` 汇总认证、source 刷新、依赖、完整性、capability、目标漂移和加载诊断，并提供返回对应来源或 Plugin 的动作。

页签切换、详情返回和命令执行完成后保留 `activeTab`、`query`、`sourceFilter`、`selectedPluginId` 与列表游标；状态只存在当前进程，不写入项目文件。

作者入口复用现有 `plugin init` 交互和 `plugin validate`，不在管理器内维护第二套 scaffold 表单或 validator。

### 8.4 错误与恢复

子流程中的可预期取消返回当前菜单，不打印错误。命令返回非零时显示现有中文诊断并返回首页，由用户决定重试或退出；任何 prompt 之前的摘要读取失败仍使用现有稳定错误码，不把损坏 state 当作空项目。

远程搜索只在用户进入浏览流程且选择远程来源后联网。首页、已安装管理和 source 列表不得隐式登录或访问 GitLab。

### 8.5 测试策略

- 纯交互状态机测试使用脚本化 prompt adapter，覆盖首页导航、单选安装、dry-run 取消、安装确认、已安装 verify/update/remove、来源认证和作者入口。
- 真实 CLI PTY/伪 TTY smoke 验证裸 `plugin` 打开首页；普通子进程验证非 TTY 裸命令仍输出 list 且不阻塞。
- 显式子命令和 `--json` 回归断言不出现 prompt 文案，stdout 仍是单 JSON 文档。
- GitLab mock 继续验证认证后返回搜索流程、零网络边界和敏感信息扫描。
