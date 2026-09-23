# Implement: aliyun-ops ACK 受控写命令与 DMS 参数修复回灌

## 前置

- [x] 确认 `vendor/skill-garden` 在 `main` 且工作区干净；基线 `python3 -m unittest test/python/test_aliyun_ops.py` 通过。
- [x] 以全局 Codex 副本 `dms.py` 与作者源 diff 为准，确认 DMS 修复只有 `cmd_order` 一处差异。

## 执行清单（作者源 `.codex` 先改，完成后复制到 `.claude`）

1. [x] B1：修改 `scrub` 兼容异常与任意对象；新增单测：`main()` 遇 `AckError` 输出 `[ack] ...`、退出码 1。
2. [x] B2：新增 CLI 输出摘要函数；上传失败重试 1 次；远端清理改 `rm -f --`；更新/新增单测（进度帧被剔除、
       重试成功路径、清理命令字符串）。
3. [x] 抽取 `workbench_kubectl_session`，`get_via_workbench` 改为复用；既有 Workbench 测试全部保持通过。
4. [x] 新增参数校验、白名单读取、Deployment 容器解析与预览渲染。
5. [x] 新增 `set-image`、`set-env`、`rollout-status` 子命令与 `--wait`；单测覆盖：
       - 未带 `--yes` 只执行 `kubectl get`，不执行 `set`；
       - 带 `--yes` 的固定远端命令字符串；无变化不写入；
       - 多容器未指定 `--container` 失败；`valueFrom` 键拒绝；
       - 非法镜像/键/值、白名单不命中在任何网络调用前失败；
       - 写入成功但清理失败的错误消息包含"写入已生效"与残留路径。
6. [x] DMS 回灌 `cmd_order` 参数；新增单测断言 `Param` 字段与 RPC 顶层参数。
7. [x] 更新 `SKILL.md`、`references/ack.md`、`assets/env.example`；按需更新 `test/js/aliyun-ops-skill.test.js` 的文案断言。
8. [x] 复制 `.codex` 作者源到 `.claude`，`diff -r` 一致；`npm run sync` 生成快照。
9. [ ] 更新 spec `.trellis/spec/flower-trellis/cli/aliyun-ops.md`（Phase 3.3 执行）。

## 验证

```bash
python3 -m unittest test/python/test_aliyun_ops.py
node --test test/js/aliyun-ops-skill.test.js
python3 -c "import ast,sys; [ast.parse(open(p).read(), feature_version=(3,8)) for p in sys.argv[1:]]" vendor/skill-garden/.common/.codex/skills/aliyun-ops/scripts/*.py
npm test
diff -r vendor/skill-garden/.common/.codex/skills/aliyun-ops enhancements/common/.common/.codex/skills/aliyun-ops
```

在线冒烟（需用户在场确认，生产只做只读与预览）：
- `ack.py get ... --via-workbench --format summary` 回归正常；
- `ack.py set-image ...`（不带 `--yes`）输出正确预览，不产生变更；
- `ack.py rollout-status ...` 返回当前滚动状态。
带 `--yes` 的真实写入不在本任务验证范围，由用户在下次实际发布时首次使用。

## 分发（已按用户要求在实现阶段完成）

- [x] 全局 Codex/Claude 副本用最终作者源覆盖，清除 `__pycache__`，`diff -r` 与作者源一致。

## 风险与回滚点

- `get_via_workbench` 重构是回归风险最高处：步骤 3 完成后先跑全部既有测试再继续。
- submodule 需单独提交并推送后，主仓再提交快照与 submodule 指针。
- 仓库根目录未跟踪的 `.claude/skills/aliyun-ops`、`.agents/skills/aliyun-ops` 不在本任务范围。
