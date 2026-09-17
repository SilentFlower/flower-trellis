# Implementation — 升级链路性能诊断与优化

## Planning Readiness

- [x] 分析当前 self-update/update/init/self-check、postinstall、runner、Plugin 与事务定义。
- [x] 在项目外副本测量本地阶段、npm 公开查询与上游隔离 A/B；证据见 research/baseline.md。
- [x] 明确以网络/进程成本和阶段可观测性为首轮，延后本地事务/摘要重构。
- [x] 从最终三件套生成并展示 Brief，等待用户评审确认。
- [x] 确认后 task.py start，再按 trellis-route(target=implement) 的决定执行。

## Ordered Work

1. [x] 加载 trellis-before-dev、三件套、JSONL specs/research；检查最新 git 与目标类/方法定义。
2. [x] 将研究基线固化为可重跑的隔离脚本/测试夹具，保留基线版本记录；明确冷/热缓存、网络模拟、全局安装替身和清理。
3. [x] 实现轻量本地阶段计时，接入 self-update/update 和全局同步；必要的 init/self-check 检查边界复用，保持 help/JSON 契约。
4. [x] 统一远程缓存有效性，真实 dist-tags 轻量读取、按需 notes 与单轮网络预算；补离线、过期、force、通道和摘要回归。
5. [x] 实现只作用于 Flower update 的上游 ESM 引导，串起普通 spawn/PTY/沙箱；补真实 bin、非目标请求、argv 和终端退出回归。
6. [x] 实现可证明的全局版本 metadata 快路径及兼容回退；禁止扩大自动安装和跳过必要同步。
7. [x] 更新 README 诊断用法和 CLI specs；不改模板快照，除非实际变更触及生成资产，触及时遵守作者源/快照同步规范。
8. [x] 补受影响 CLI 的 Ubuntu/Windows Actions workflow（触发覆盖 src/lib、src/commands、入口、scripts、tests、package、workflow）；真实执行目标行为，不靠 skip 达标。
9. [x] 五轮以上前后对照；报告阶段与总时长、样本离散、请求/子进程数、失败和未测环境；检查 Plugin 本地成本未被显著放大。
10. [ ] 通过 trellis-route(target=check) 进入 Check-All；完成规范更新后按 trellis-push 展示精确提交范围等待确认。最终提交的必需 CI job 成功前不标记任务完成。

## Validation Plan

### 定向行为测试

实施时以实际新增文件名补齐命令，不假定未存在测试：

```bash
node --test test/js/update-check.test.js test/js/flower-update-contract.test.js test/js/flower-update-windows.test.js test/js/update-backups.test.js
node --test test/js/plugin-skill-garden.test.js test/js/plugin-transaction-writer.test.js test/js/trellis-control.test.js
```

新增用例必须断言：

- 计时关闭无噪声、开启记录成功/失败、嵌套包含关系；帮助不写 stderr、JSON stdout 可解析。
- 新鲜缓存零网络，过期/force 查询，notes 缺失正确补拉；离线不续期，deadline 包含慢响应体。
- 实际子进程执行原捆绑 Trellis 完成 dry-run/update，上游 latest 请求零发送，其它请求不受影响。
- 全局标准安装不启动 trellis --version；损坏/自定义启动器回退；版本不符按精确版本安装；npx 边界不变。
- 配置和失败恢复按原有证据断言，不能只检查退出码或日志。

### 完整本地验证

```bash
npm test
node --check src/cli.js
```

所有改动/新增 JS 文件分别 `node --check`。临时目标执行 init、update、重复 update、update --dry-run 与 uninstall --dry-run；环境禁用遥测，使用隔离 prefix/测试替身保护全局包，既有 dry-run 的全局同步行为本轮不擅自改变。

### 性能证据

- 自检新鲜/失效缓存、无新版/有新版/项目追平、0/200/1000ms 受控网络延迟、挂起响应。
- 上游普通/PTY、同版本及跨版本沙箱；收集阶段计时和父子包含关系。
- 全局同步同版本、不同版本的替身安装、安装失败；真实公共 npm 下载仅作为另列观测，不进入易抖动的硬耗时断言。
- 固定 fixture 下优化前后至少五轮，比较中位数与范围；稳定工作量要求比单次秒数更有说服力。

### 原生 CI

按 quality-guidelines.md 的跨平台门禁，Ubuntu/Windows 真实 CLI 回归均执行；保留现有 Python 3.8/3.12 验证链。记录 run URL、headSha、job 结果与合理 skip 原因。需提交/推送后才能得到最终 SHA 证据，当前规划阶段不声称已通过。

## Risks And Rollback Points

- metadata 拆分可能增加新版路径请求次数：共享 deadline，命中 notes 缓存则复用；不得因优化丢摘要。
- 上游引导影响 argv/PTY/Node 兼容：真实文件入口、实际 bin 回归、最小声明 Node 运行时核验；不改 node_modules。
- 全局 metadata 可能与实际入口不一致：只接受有归属证据的快路径，异常走原探测。
- 每块优化可独立撤回；快照、事务、权限、配置保护不可作为回退代价。
- 用户真实 npm 安装慢仍待诊断日志；如证实需要改依赖、代理或安装策略，更新范围并再次评审。

## 当前验证事实

首轮实现、Check-All、规范复核与业务推送已完成，证据见 research/results.md。Windows CI 发现非交互 CLI 退出挂起和四个权限断言的平台假设问题，已完成本地补修；待补充提交与新 SHA 原生 CI 验收，任务保持 in_progress。
