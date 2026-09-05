import { flushTelemetryQueue } from "./telemetry-queue.js";

// 只执行一次请求，即使 DNS/TLS 或子依赖未正常释放资源也必须结束后台进程。
const deadline = setTimeout(() => process.exit(0), 15000);
try { await flushTelemetryQueue(); }
catch { /* 遥测不得污染宿主终端。 */ }
finally { clearTimeout(deadline); process.exit(0); }
