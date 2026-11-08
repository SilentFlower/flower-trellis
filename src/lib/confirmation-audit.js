import fs from "node:fs";
import path from "node:path";
import { CONFIRMATION_NATIVE_ID, confirmationDirectory } from "./confirmation-files.js";

/**
 * 向项目内的当前实例审计追加最小事件，失败交由状态机撤销未领取许可。
 * @param {string} root 当前项目根目录。
 * @returns {Function} 同步记录单条审计事件的回调。
 */
export function createConfirmationAudit(root) {
  const directory = confirmationDirectory(root);
  let file;
  return event => {
    if (!file) {
      if (typeof event.instance_id !== "string" || !CONFIRMATION_NATIVE_ID.test(event.instance_id)) {
        throw new Error("确认审计实例无效");
      }
      file = path.join(directory, `${event.instance_id}.jsonl`);
    }
    const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT
      | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK, 0o600);
    try {
      if (!fs.fstatSync(fd).isFile()) throw new Error("确认审计不是普通文件");
      fs.appendFileSync(fd, `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`);
    } finally { fs.closeSync(fd); }
  };
}
