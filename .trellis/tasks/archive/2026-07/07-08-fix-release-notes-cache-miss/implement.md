# 修复 flower-update release notes 缓存缺失 - 实施计划

## Checklist

1. 在 `src/lib/self-check.js` 增加一个小的内部 helper,封装“缓存摘要缺失时主动补拉 npm metadata 生成 release notes”的逻辑。
2. 只在缓存新鲜且最终会返回 `project_out_of_sync` 的分支调用 helper。
3. helper 成功时写回 `updateCheck.lastReleaseNotes`;失败或 unavailable 时给本次结果返回结构化 unavailable 摘要,但不改远程缓存状态。
4. 保持已有 JSDoc 中文注释和显式 import 风格。
5. 用临时项目或 Node 脚本验证以下路径:缓存摘要缺失补拉成功、补拉失败返回 unavailable 摘要和推荐命令、已有摘要不联网、普通 interval skip 不联网。

## Validation

- `git diff --check`
- `node --check src/lib/self-check.js`
- 视实现方式补充最小行为验证命令,优先使用临时目录和 mock/stub registry metadata,避免依赖真实 npm 网络状态。

## Rollback

本任务只应触及 `src/lib/self-check.js` 和任务规划产物。若验证失败,回退该文件中新增 helper 和缓存分支调用点即可恢复原行为。
