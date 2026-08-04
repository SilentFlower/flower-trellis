# SRM Forest Trace Pairing Evidence

来源：`trellis mem extract 019fcc5b-3f6 --grep "同一 trace" --cwd /root/project/srm` 与 `--grep "404"`。

关键事实：

- SLS 查询链路本身有效：能列出 project/logstore，定位正式 `xhgj-zysys/srm-api-supplier`，并拿到 traceid。
- 误判来自分析纪律：先接受截图里的“前两个是 404”表述，没有先强制配对同一 trace 下的 `[Forest] Request` 与 `Response: Status = ...` / `调用接口异常`。
- 第二个偏差是 project/logstore 选择纪律：不能因为 cn-hangzhou 下有生产相关 project，或 `xhxhgjmall` 看起来更像线上业务，就先把它当主入口。SRM/supplier/API 的系统线索应先锚定 `xhgj-zysys`，再在该 project 内找 logstore 和服务标记。
- 同一 trace 链路里可能同时出现多个外部请求，状态码可以不同；某个 trace 中存在 `HTTP 404` 不等于用户关心的目标接口本身 404。
- SRM 例子中，`feeType/byIdsAndCodes` 和 `auth/getAccessToken` 接口本身成功，真正的易快报 `HTTP 404` 落在后续“更新易快报收款账户”请求。

应沉淀到 `aliyun-sls-query` 的通用守则：

> 对 Java Forest/HTTP 日志排障时，不能用“某条 trace 链路里出现 404”反推“命中的接口本身 404”。必须按 trace 回查完整链路，把 `[Forest] Request`、`Response: Status = ...`、`调用接口异常` 按时间配对；同一 trace 里多个外部请求可能状态码不同。

> 选择 SLS project/logstore 时，不能靠 project 名称相似或“看起来生产”猜主入口。必须先用用户给出的系统线索、服务名或已知前缀锚定 project（SRM/supplier/API 场景应优先核对 `xhgj-zysys`），再用 logstore 名、service/app 标记、traceid 或 Request URL 反查确认；未验证的 project 只能列为候选。
