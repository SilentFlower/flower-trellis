# SessionStart 额度丢失复现证据

记录日期：2026-09-05。检查环境：本项目 `main`，本地 Codex CLI 为 `0.153.4`。

## 已执行的最小复现

在仓库根目录执行以下命令。只读取现有配置并调用真实 Adapter 生成内存结果，不写入 `.codex/hooks.json`，也不执行 Hook 或升级操作。

```bash
node --input-type=module - <<'JS'
import fs from 'node:fs';
import { flowerPatchAdapters } from './src/lib/platform-patch-adapters.js';

const original = fs.readFileSync('.codex/hooks.json', 'utf8');
const patch = JSON.parse(fs.readFileSync('src/patches/platforms/codex/session-start-hooks/patch.json', 'utf8'));
const source = patch.operations.find(item => item.id === 'flower-codex-trellis-session-start');
const operation = { ...source, content: source.content.value };
const result = flowerPatchAdapters()['json-hook-command']({ value: original, operation });
if (result.error) throw new Error(result.error);

const find = value => JSON.parse(value).hooks.SessionStart
  .flatMap(group => group.hooks)
  .find(hook => hook.command.includes('.codex/hooks/session-start.py'));

console.log(JSON.stringify({ before: find(original), after: find(result.value) }, null, 2));
JS
```

记录时 `.codex/hooks.json` 已有用户本地修改。如果后续复现环境没有该字段，应在隔离 fixture 中配置它，不要覆盖用户实际项目。

实测关键结果：

```json
{
  "before": {
    "type": "command",
    "command": "python3 -X utf8 .codex/hooks/session-start.py",
    "additionalContextLimit": 5000,
    "timeout": 30
  },
  "after": {
    "type": "command",
    "command": "python3 -X utf8 .codex/hooks/session-start.py",
    "timeout": 30
  }
}
```

## 原因与维护位置

1. `src/patches/platforms/codex/session-start-hooks/patch.json` 声明该 handler 的匹配事件、超时和命令解析器。
2. `src/lib/platform-patch-adapters.js` 的 `applyJsonHookCommand` 移除匹配旧 handler，然后只用三个字段重建新 handler，未携带已有额度。
3. `.codex/hooks.json` 是当前运行配置；耐久修复属于 Flower 的 Patch / Adapter 源码，不属于仅修改 dogfood 文件。
4. `test/js/platform-patches.test.js` 已具备临时项目、`preparePatchPlan`、`applyPatchPlan` 和第二次应用幂等检查，可在既有行为覆盖上增加额度回归。

## 证据边界

- 上述复现直接调用生产 Adapter；没有实际执行 Flower 更新或重应用整个 Plugin，因此不把它描述成已完成完整升级路径复现。
- 当前会话可见的 SessionStart 上下文完整；历史溢出文件不作为本任务的唯一回归判据，也不证明本缺陷造成全部工作流异常。
- Hook 输出单位来自 [Codex 官方 Hook 文档](https://learn.chatgpt.com/docs/hooks#large-hook-output)：`additionalContextLimit` 是近似 token 阈值，缺省约 2,500，正整数指定阈值，`0` 表示不在此层限制。
- 创建任务时已有无关 `.flower` 和技能目录修改，后续实现应按实际任务范围处理，不能把这些改动一并作为本任务产物。
