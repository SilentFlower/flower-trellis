# Design

## Architecture

新增 Flower 自有 flower_session_start.py，通过 --hook 指定已有 Codex / Claude 原生 SessionStart 文件，通过 --part state|rules|stages 选择输出。加载并复用已部署、已受管 Patch 的原生模块：state 调用 main 捕获原始 JSON，移出 trellis-workflow 块；rules / stages 只调用该平台现有工作流摘要函数，在完整三级章节边界处分割，保持所有原文与顺序。每份使用独立闭合标签，不依赖其他进程的输出或写入。

## Ownership

分段功能属于 Flower 平台集成：源码放 src/assets，Plugin 全装投影到 .trellis/scripts。平台 JSON 通过 Flower catalog 和受控 Adapter 生成，保留原生 hook 路径作为 --hook 参数，兼容工作流 bootstrap 对已注册 SessionStart 的路径识别。Skill-Garden / upstream 原生内容不复制也不重写。

## Configuration

扩展 json-hook-command 的受控声明以支持三个固定 sessionParts。迁移时按原生路径移除旧单 handler 和旧分段，生成 startup|clear|compact 三段；原单 handler 的合法 additionalContextLimit 继承给三段，已有分段的值按对应 part 优先保留。矛盾的同分段额度显式报错，不静默任选。未配置值继续使用宿主默认；Claude 不写 Codex 专属配置。

## Failure / Compatibility

沿用原生禁用标志。只有 state 执行原生 main 的会话绑定等副作用；其他两份仅读取源。原生接口或章节结构缺失时输出明确诊断和必读源路径；不静默回退到缺规则的成功结果。原生内容过长时保留完整正文并给出可见大小诊断，预算与验收失败推动修复，不靠继续抬高总预算。配置修改通过 Plugin 生命周期生成，旧 handler 的相关额度保持可迁移，无关用户变更保留。
