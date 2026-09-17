/** Flower 管理的 update 子进程入口；只影响本进程，不改安装目录或全局环境。 */
import { pathToFileURL } from "node:url";
import { withoutTrellisUpdateNotice } from "./trellis-update-fetch.js";

const [bin, ...args] = process.argv.slice(2);
if (!bin || args[0] !== "update") throw new Error("Flower 上游更新入口只接受 update");
// Commander 需要原始 CLI argv，不能使用 eval 入口或让额外的引导文件成为子命令。
process.argv = [process.execPath, bin, ...args];
globalThis.fetch = withoutTrellisUpdateNotice(globalThis.fetch);
await import(pathToFileURL(bin).href);
