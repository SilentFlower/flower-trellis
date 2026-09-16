# 跨平台 SessionStart 分段 Hook 修复设计

## 1. 目标与边界

修复 Flower 分段包装器在 Windows 执行 `state` 时触发的 `detach` 错误，并保持 Codex、Claude
现有 `state/rules/stages` 内容、跳过条件、诊断、副作用、额度和 Astra 行为不变。修改只落在 Flower
作者源、对应测试与持续集成；不修改 Codex、Claude、Trellis 上游 Hook，也不把全局 npm 目录或
已部署项目文件作为修复源。

根因是包装器用 `redirect_stdout(StringIO)` 在当前进程调用原生 `main()`。Windows 原生 Hook 随后
导入 `common` 并重配置标准流，`StringIO.detach()` 抛出 `UnsupportedOperation`。因此真正需要修复的
不是编码内容，而是包装器与原生 Hook 共用进程级标准流的边界。

## 2. 执行边界与数据流

`state` 改为独立 Python 子进程，`rules/stages` 保持当前只读生成路径：

| 分段 | 执行方式 | 原因 |
| --- | --- | --- |
| `state` | 以 `sys.executable -X utf8 <native-hook>` 启动子进程，通过管道发送宿主 JSON 并捕获输出 | 原生入口需要标准流重配置和会话绑定副作用，进程隔离可消除对包装器内存流的破坏 |
| `rules` | 当前进程加载原生模块，仅调用工作流摘要生成器 | 不执行原生 `main()`，无需额外进程与重复副作用 |
| `stages` | 当前进程加载原生模块，仅调用工作流摘要生成器 | 与 `rules` 相同，继续保持无状态、可并行 |

`state` 数据流固定为：

```text
宿主 JSON
  -> Flower wrapper 校验 hook/part、禁用标志、resume，并把 cwd 固定为部署项目根
  -> 原生 Hook 子进程（真实 stdin/stdout/stderr，UTF-8）
  -> 捕获标准 JSON / 转发原生 stderr / 检查退出码
  -> 移除唯一 trellis-workflow 块并保留其余原生状态
  -> 按既有规则附加可选 Astra 提示
  -> 包装为 trellis-session-part state 后交给宿主
```

父进程不再为 `state` 导入原生 Hook，因此原生模块及 `common` 对 `sys.stdin/stdout/stderr` 的调整只发生
在子进程中。文件写入、会话绑定和 `CLAUDE_ENV_FILE` 等持久副作用照常生效；子进程内临时环境变化本来就
不会传播到启动包装器的宿主，因此不改变现有有效契约。

## 3. 子进程契约

在 `src/assets/flower_session_start.py` 增加窄辅助函数
`_run_native_hook(root: Path, hook: str, hook_input: dict) -> dict | None`：

- 命令参数使用列表并保持 `shell=False`；`hook` 仍先经过固定 `HOOKS` 白名单，路径由 `root / hook`
  解析，不接受任意命令。
- 使用 `sys.executable`，避免假定 Windows 存在 `python3`；传入 `-X utf8`，stdin 以 UTF-8 bytes
  发送，stdout 按 `utf-8-sig` 严格解码，避免受 Windows 系统代码页影响。
- `cwd` 固定为目标项目根，环境从当前包装器复制，保证原生平台环境变量和禁用标志不丢失。
- stderr 用 UTF-8 容错解码并原样转发到包装器 stderr；退出码非 0、stdout 非法 JSON、缺少唯一
  workflow 块等继续进入现有可见 `trellis-injection-error` 降级。
- 原生 Hook 因自身跳过条件产生空 stdout 时返回 `None`，包装器退出 0 且不输出 JSON。
- 不增加第二层内部超时；平台注册已有 30 秒宿主超时，避免两个计时器产生不同错误语义。

`render_part()` 先按 `part` 分支：`state` 调用 `_run_native_hook()`；`rules/stages` 才调用
`_load_hook()` 与 `should_skip_injection()`。state 后处理、Astra 增强、诊断拼接、预算检查和输出结构保持原样。

## 4. 备选方案与取舍

- 不修改 `common._configure_stream()` 捕获 `detach` 异常。该做法只能绕过当前 `StringIO`，会扩大
  Trellis 共享运行时影响面，也无法阻止未来原生 Hook 或依赖再次调整全局标准流。
- 不为 `StringIO` 制作支持 `detach()` 的伪流。正确模拟 `buffer`、编码、关闭与多次重配语义复杂且脆弱。
- 不修改两份原生 Hook。故障属于 Flower 捕获方式；分别修改 Codex/Claude 会重复逻辑并偏离作者源所有权。
- 子进程只用于 `state`，避免三个分段都运行完整原生入口、重复会话绑定或引入不必要开销。

## 5. 测试与持续门禁

`test/python/test_flower_session_start.py` 使用 `sys.executable` 和显式 UTF-8 编解码，使同一测试可在
Linux、Windows 原生运行。新增一个平台无关事故夹具：伪原生 Hook 在 `main()` 中实际执行
`sys.stdout.detach()` 后重新包装 UTF-8 流；旧的同进程实现稳定失败，新子进程实现稳定成功。这样即使
只在 Linux 本地运行，也能锁定这类边界回归。

现有依赖 patch `_load_hook` 的 state 单元测试改为 patch `_run_native_hook`，继续精确覆盖 Astra
成功、失败、预算和原生诊断保留。另补空输出、非零退出码与 stderr 转发断言；Codex/Claude 实际模板
仍各执行 `state/rules/stages`，验证拼接等价、禁用、resume、并行和上下文预算。

新增独立 GitHub Actions 工作流，在 `ubuntu-latest`、`windows-latest` 上用 setup-python 后执行：

```bash
python -m unittest discover -s test/python -p "test_flower_session_start.py"
```

CI 证明两套操作系统上两份原生 Hook 模板和六个 handler 可运行；真实 Codex/Claude 宿主加载仍在已统一
版本的 Linux 与 Windows 本机完成，因为 CI 没有用户认证和真实会话环境。

## 6. 分发、上线与回退

作者源仍是 `src/assets/flower_session_start.py`。实现后通过 Flower Plugin 正常安装链把它投影到隔离项目
以及当前 dogfood 的 `.trellis/scripts/flower_session_start.py`，核对 ownership、哈希和第二次应用零变化；
不得直接把投影文件当作唯一修复点。

本次不发布 npm、不打 tag、不推送。回退时恢复作者源、测试和 CI 文件，再经同一 Plugin 安装链恢复投影；
无需迁移用户配置或回滚 Codex/Claude 版本。若子进程启动失败，现有可见注入错误会要求模型补读 workflow，
不会静默伪装成成功。
