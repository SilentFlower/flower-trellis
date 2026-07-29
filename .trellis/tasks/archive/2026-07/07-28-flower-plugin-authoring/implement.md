# Flower Plugin 作者工具、作者 Skill 与 rd-guide 注册契约实施计划

## 1. 前置门禁

- [ ] P1 schema/hash、P2 Resolver、P3 Marketplace DTO 和 P4 capability validator 已稳定。

## 2. 实施步骤

### A. Author Plugin 与 Skill

- [ ] 使用 skill-creator `init_skill.py` 初始化 `flower-plugin-author` canonical Skill。
- [ ] 编写精简 SKILL.md、frontmatter description 和一层 references。
- [ ] 新增 standard builtin Plugin manifest，不依赖 skill-garden。
- [ ] 运行 quick_validate 和平台投影测试。

### B. Scaffold

- [ ] 实现确定性模板和结构化参数校验。
- [ ] 实现交互/非交互 init、standard/integration 和已有文件保护。
- [ ] 生成 Plugin、Skill、测试和 Marketplace entry 草稿。

### C. Validate

- [ ] 组合 P1-P4 真实 validator，不复制规则。
- [ ] 实现 Plugin/entry/Marketplace、frozen CI 和稳定 JSON issues。
- [ ] 覆盖 digest、依赖闭包、commit/ref、compatibility 和 capability。

### D. rd-guide 模板

- [ ] 提供 CI job、命令、JSON 结果和 CODEOWNERS/protected approval 契约模板。
- [ ] 提供共仓与外部仓库 fixture、合法和拒绝案例。

### E. 验证

- [ ] 从空目录 scaffold -> validate 全流程。
- [ ] 运行两个隔离 forward-test，并修正 Skill 触发或 references 路由问题。
- [ ] 运行完整测试和 npm pack。

## 3. 文件所有权

- `src/builtin-plugins/flower-plugin-author/**`
- `src/plugin/authoring/**`
- `src/commands/plugin.js` 的 init/validate 部分
- Marketplace/CI/CODEOWNERS 示例与 fixture
- 对应 `test/js/plugin-authoring-*.test.js`

## 4. 验证命令

```bash
node --test test/js/plugin-authoring-init.test.js
node --test test/js/plugin-authoring-validate.test.js
node --test test/js/plugin-marketplace-ci.test.js
python3 /root/.codex/skills/.system/skill-creator/scripts/quick_validate.py src/builtin-plugins/flower-plugin-author/skills/flower-plugin-author
npm test
npm pack --dry-run --json
git diff --check
```

## 5. 高风险检查点

- [ ] 作者 Skill 不得复制 schema/Resolver/capability 实现。
- [ ] 默认 scaffold 不生成 Patch；integration 示例不代表授权。
- [ ] 不生成 system、hook 或 JavaScript adapter。
- [ ] CI 不读取开发者本机 keyring，不把凭据写入 issues。
- [ ] Skill 不包含 README/quick reference/changelog 等冗余文件。
- [ ] forward-test 不接触真实 rd-guide 或生产系统。

## 6. 回滚点

- author Plugin 可独立从 builtin registry 移除。
- 模板错误只回滚 authoring 模块，不修改 Runtime schema。
- validate 发现底层契约缺陷时回到 P1-P4 修复，不在 P6 打补丁复制规则。
