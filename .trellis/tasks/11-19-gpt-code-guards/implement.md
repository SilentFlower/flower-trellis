# 实施与验收计划

## Implementation

- [x] 完成三件套与 Brief review，取得 policy_timeout 的 claim 和 started 回执后激活任务，进入 inline 路由并完成该 Brief 动作记账。
- [x] 按 `trellis-before-dev` 读取作者源、测试与相关规范，修改所有 GPT 共用的英文正文；根据用户追问强化禁止推测性保护及最小范围表述。
- [x] 更新已审阅文本校验及必要的语义断言，复用模型、开关、来源/分段与失败诊断测试。
- [x] 整理六类真实案例与行为评分标准，分别记录工程证据和后续行为评估。
- [x] 更新 README，经 Flower Plugin 生命周期同步项目投影及 lock；首次变更 1 项，重复更新变更 0 项，ownership 与作者源一致。

## Validation

- [x] `node scripts/run-python-tests.mjs test/python/test_flower_session_start.py`：35 项通过。
- [x] `node --test test/js/ai-context-budget.test.js`：2 项通过。
- [x] `node scripts/check-ai-context-budget.mjs --strict`：退出 0，当前分段及完整提示保持在既有 review ceiling 内。
- [x] `npm run patch:targets:check`：937 个文件无漂移，Skill-Garden 源未产生改动。
- [x] `node scripts/check-patch-conflicts.mjs`：全平台门禁通过，warning 0。
- [x] `node scripts/check-output-templates.mjs`：36 个 Skill 文档通过。
- [x] 对照源码、真实 Hook 输出及当前项目投影，核对共享正文、完整块大小、次数和 ownership；Codex state 最大 7987 字符，模型完整块最大 1676 B，strict 预算通过。
- [x] 业务提交 `0d6747337bb7218c00b57e1844d592681fb61deb` 的 CI [44436703095](https://github.com/SilentFlower/flower-trellis/actions/runs/44436703095) 全部通过；规则与产物及原生 Ubuntu/Windows × Python 3.8/3.12 的完整 Python 套件、Node 到 Python 入口均成功。

## Review And Completion

- [x] 通过 `trellis-route(target=check)` 完成 inline / full Check-All：CHK 0、FBK 0、DOC 0，9/9 验证分组通过。
- [x] 通过 `trellis-update-spec` 最小同步共用提示合同，反向核对源码、断言及写入边界，`git diff --check -- .trellis/spec` 通过。
- [x] 由 `trellis-push` 完整展示精确计划；policy_timeout claim 与 started 记账成功后，按 6 个业务文件、8 个任务记录文件的范围执行。
- [x] 业务提交 CI 通过后，`task_progress.py write --complete` 返回 `taskStatus=completed`、`closeResult=closed`；任务记录随已确认的独立提交同步。

## Rollback

保持业务源码与投影的一致版本；恢复时采用本次精确文件集合并走原 Plugin 生命周期，保留其他任务的既有工作区变化。
