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
