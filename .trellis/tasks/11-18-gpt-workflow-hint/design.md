# 技术设计

## 机制与边界

作者源为 `src/assets/flower_session_start.py`，沿用 Flower 资产投影链。在原 Codex state 分支完整匹配 `gpt-[A-Za-z0-9][A-Za-z0-9._-]*`，保留原始输入，避免将未经校验的模型值插入 XML。

旧三个型号继续生成原标签和正文，保留既有最终常量及哈希契约。其余 GPT 型号使用 `trellis-gpt-workflow-hint`，模型属性和正文适用声明采用已校验的事件模型。共享 `MODEL_WORKFLOW_HINT_BODY`，每个完整块检查 2048 UTF-8 字节预算。

## 配置兼容

新增 `codex.gpt_workflow_hint`，缺省 true，作为 GPT 总开关。既有三个型号还受各自旧开关控制，其余型号只受总开关控制。沿用配置读取器及布尔/true、false 字符串校验，正常升级保留已有用户字段。

## 失败与回退

保持可选增强异常处理和诊断追加。原生 state 继续输出。总开关可关闭后续新增提示；代码回退恢复作者源并走既有部署链。

## 验证影响

扩展 Python 模型/配置/平台/来源矩阵与异常回归。预算脚本增加通用 GPT、总开关关闭场景和独立块测量，同步 JS 断言。核对现有 CI 影响分流及 Ubuntu/Windows Python 矩阵覆盖。
