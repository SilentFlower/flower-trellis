# 同步全局 Trellis 到 flower-trellis 捆绑版本

## Goal

安装或更新 flower-trellis 时,本机全局 `trellis` 命令应同步到 flower-trellis 当前捆绑的 `@mindfoldhq/trellis` 版本,避免用户在项目已升级后直接运行 `trellis ...` 仍命中旧版本 CLI。

用户价值:用户只需要安装 / 更新 flower-trellis,不需要额外记住再手动运行 `npm install -g @mindfoldhq/trellis`。

## Confirmed Facts

- 当前 `package.json` 依赖固定为 `@mindfoldhq/trellis: "0.6.0"`。
- `src/lib/trellis-runner.js#resolveTrellisBin()` 会解析 flower-trellis 捆绑依赖里的 Trellis bin,所以 `flower-trellis init/update` 自身能使用捆绑 Trellis。
- npm 安装依赖包时不会把依赖包的 bin 自动链接成全局 `trellis` 命令;用户终端直接运行 `trellis` 时仍会命中 PATH 上已有的全局 `@mindfoldhq/trellis`。
- 当前 `checkForUpdate()` 只检测 flower-trellis 自身新版本,且自动升级失败时继续主流程;它不负责同步全局 Trellis。

## Requirements

- R1. `npm install -g flower-trellis` 或 `npm update -g flower-trellis` 完成安装 flower-trellis 后,必须尝试把全局 `@mindfoldhq/trellis` 同步到 flower-trellis 当前捆绑版本。
- R2. 同步目标版本必须来自本包已安装依赖的 `@mindfoldhq/trellis/package.json`,而不是硬编码版本字符串。
- R3. 同步命令应安装精确版本,形式为 `npm install -g @mindfoldhq/trellis@<bundledVersion>`,确保全局 `trellis --version` 与捆绑版本一致。
- R4. `flower-trellis update` 主流程也应保证同样的一致性:在执行项目 Trellis update 前,若全局 Trellis 低于或不等于捆绑版本,应同步到捆绑版本。
- R5. 同步失败必须给出清楚的中文错误 / 提示,包含可手动执行的命令;不能只静默跳过。
- R6. 同步逻辑必须避免 npm 生命周期递归或重复触发自身安装;只安装 `@mindfoldhq/trellis`,不反向安装 flower-trellis。
- R7. `flower-trellis -v` 保持显示捆绑 Trellis 版本;如后续增加全局版本显示,必须明确区分 `trellis (bundled)` 与 `trellis (global)`。
- R8. README 需要说明 flower-trellis 会同步全局 Trellis,以及权限失败时的手动修复命令。
- R9. `npx flower-trellis ...` 是临时免安装入口,不应改写本机全局 `trellis`。
- R10. 仓库内普通 `npm install` / 作为普通依赖安装 flower-trellis 时不应改写全局 `trellis`;只有全局安装 / 更新和运行 `flower-trellis update` 时强同步。

## Out of Scope

- 不改变 `flower-trellis` 的 bin 名称,不把 `trellis` bin 包装成 flower-trellis 自己的转发命令。
- 不支持 pnpm/yarn 全局安装器的自动选择;MVP 使用 npm global,与当前 README 安装方式保持一致。
- 不改变 Trellis 上游包发布方式。
- 不处理多个 Node 版本管理器环境下 PATH 指向不同全局目录的问题;失败或不一致时输出诊断信息。
- 不把 `npx flower-trellis ...` 视为“安装 flower-trellis”;npx 场景跳过全局同步,保持免安装语义。
- 不把开发者本地 `npm install` 视为“全局安装 flower-trellis”;本地依赖安装不修改全局环境。

## Acceptance Criteria

- [ ] 新增安装后同步入口后,本地 `npm install -g <flower-trellis包>` 会触发 `@mindfoldhq/trellis@<bundledVersion>` 的全局安装。
- [ ] 安装完成后在同一 Node/npm 全局环境里运行 `trellis --version`,显示版本与 `flower-trellis -v` 中的 `trellis (bundled)` 一致。
- [ ] 当全局 Trellis 已是捆绑版本时,同步逻辑可快速跳过或幂等安装,不会改变项目文件。
- [ ] 当 npm 全局安装失败时,输出中文错误和手动命令 `npm install -g @mindfoldhq/trellis@<bundledVersion>`。
- [ ] `flower-trellis update` 在执行项目 update 前会同步全局 Trellis;同步失败时不会留下“项目 update 已执行但全局 Trellis 未同步”的半同步状态。
- [ ] `node --check` 覆盖新增 / 修改的脚本和源码文件。
- [ ] README 更新安装说明,明确安装 / 更新 flower-trellis 会同步全局 Trellis。
- [ ] `npx flower-trellis ...` 场景跳过全局 Trellis 同步。
- [ ] 普通本地 `npm install` 场景的 `postinstall` 跳过全局同步。

## Notes

- 这个任务涉及 npm 生命周期脚本和全局环境副作用,按复杂任务处理,需要 `design.md` 与 `implement.md`。
