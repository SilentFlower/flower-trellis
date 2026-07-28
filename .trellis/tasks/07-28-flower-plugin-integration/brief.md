# Brief — Flower Plugin 跨模块集成、打包与端到端验收

## Goal

- 把 P1-P6 收敛为一致、可发布的 Flower Plugin 产品面，并通过真实 CLI、临时项目、GitLab mock 和 npm pack 验证父任务全部验收。

## Scope

- 统一 CLI help、退出码、dry-run、JSON 和 README。
- 复核 package files、直接/optional dependencies 和 tarball 内容。
- 建立真实子进程场景矩阵，覆盖无 Trellis、新旧项目、多平台、多 Plugin、OAuth、capability、作者工具和卸载。
- 验证零网络、敏感扫描、preflight 零写入、故障恢复和二次应用幂等。
- 建立父需求 evidence matrix 与跨模块契约漂移检查。

## Non-Goals

- 不发布、push、merge、release、部署，不修改真实 rd-guide 或新增协议。

## Key Context

- 测试必须隔离 HOME/XDG/keyring，不能读取真实凭据。
- optional keyring 缺失时可用内存 adapter，但不能生成明文 fallback。
- 集成缺陷回到 P1-P6 所有权模块修复，不能放宽 schema、digest、capability 或 required 语义。
- npm tarball 必须包含全部 builtin Plugin/Marketplace/Skill/template，排除 runtime、cache 和秘密。

## Acceptance

- 全部 Plugin 命令和文档契约一致。
- 场景矩阵、零网络、OAuth、安全、恢复和幂等测试通过。
- 父任务每条验收有自动化或人工证据映射，共享 DTO/错误码/schema 无漂移。
- sync、snapshot、Patch、compiled targets、strict context budget、完整测试和 npm pack 通过。

## Next Step

- P3-P6 检查通过后实施 CLI/pack 集成和场景矩阵，最终执行父任务一致性审查。
