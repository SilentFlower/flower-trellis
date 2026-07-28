# Restricted Patch

外部 integration catalog 只允许声明式 `insert`，目标仅限 `.trellis/workflow.md` 和 `.trellis/spec/**/*.md`。selector 只使用 Runtime 白名单，missing 只能是 `skip|error`，marker 只能使用 HTML。

先从 scaffold 示例开始，再把 operation、selector、target 和 content 缩到最小。运行 validate 让 P4 `inspectExternalPatchCatalog()` 检查字段、路径、bundle 和 operation；不要复制 Patch Engine 或自行解释 selector。

禁止 replace、remove、hook、migration、adapter、任意目标路径、外部 policy 文件和可执行代码。
