# 批量更新多个 Flower 项目：实施计划

## 实施清单

- [x] 在 CLI 参数解析与常量中支持 update-all 的重复 --root/--target；加入根帮助和命令分发。
- [x] 实现只读项目发现、真实路径去重和逐项目本地预检；复用现有 Flower 版本读取与安全检查契约。
- [x] 实现 update-all 编排：单次远端推荐、预览零写入、单次全局安装、安装后版本核对、顺序项目更新、逐项失败继续及最终结果块。
- [x] 更新 README 和命令帮助，说明组合输入、安全跳过、退出码和独立 Git 确认。
- [x] 增加 Node 内置测试并把新测试加入 update-performance 的 Ubuntu/Windows 显式清单。

## 验证与评审

- [x] 运行新增测试和现有更新检查、CLI 帮助回归。
- [x] 运行 npm test 与涉及文件的 node --check。
- [x] 在隔离临时项目执行组合输入的 --dry-run 与受控真实更新，核对写入和逐项结果。
- [x] 进入 Check-All，核对 CLI 契约、跨项目失败路径、文档与 diff；按要求更新 spec。
- [x] 提交并推送后核对 update-performance 对应 headSha 的 Ubuntu/Windows 结果。

## CI 验收

- 代码提交 `ef32c2e47dcf326c83aceb67549e3374fc68fa01` 对应的 [update-performance](https://github.com/SilentFlower/flower-trellis/actions/runs/36362919747) 已通过 Ubuntu/Windows Node 22 两项；新增 `update-all.test.js` 在两端实际执行并通过。Ubuntu 测试汇总为 156 通过、0 失败、1 跳过，Windows 为 164 通过、0 失败、3 跳过。
- 同一提交的 [Python 跨平台兼容回归](https://github.com/SilentFlower/flower-trellis/actions/runs/36362919749) 在 Ubuntu/Windows 的 Python 3.8/3.12 四项全部通过；[SessionStart 跨平台回归](https://github.com/SilentFlower/flower-trellis/actions/runs/36362919760) 在 Ubuntu/Windows 两项全部通过。

## 风险与回退点

- 参数解析可能影响既有单项目 --target：先保留原字段语义，再加入 update-all 专用目标集合，并用回归测试锁定。
- 全局安装会改变后续子进程使用的 CLI：安装结果和新进程版本校验都通过后才更新项目。
- 项目更新只委托现有 update 补偿链；某项目失败不撤销先前项目，汇总精确标出恢复对象。
