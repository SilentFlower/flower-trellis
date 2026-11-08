import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

/** @type {RegExp} 一次确认的稳定标识。 */
export const CONFIRMATION_ID = /^[a-f0-9]{64}$/;
/** @type {RegExp} 原生宿主上报的会话、回合和工具标识。 */
export const CONFIRMATION_NATIVE_ID = /^[A-Za-z0-9_-]{1,160}$/;

/** 从原生工具的命令文本识别确认调用；@param {string} command 工具命令；@returns {string|null} 确认子命令。 */
export function confirmationOperation(command) {
  if (typeof command !== "string") return null;
  const header = command.split("\n", 1)[0];
  const matches = [...header.matchAll(/(?:^|[\s'"(|;&])(?:ftl|ft|flower-trellis)[ \t]+confirm[ \t]+(status|prepare|[a-f0-9]{64}|finish[ \t]+[a-f0-9]{64}[ \t]+(?:completed|interrupted|needs_verification))(?=$|[\s'"|;&])/g)];
  return matches.length === 1 ? matches[0][1].replace(/[ \t]+/g, " ") : null;
}

/** 规范化换行后计算展示正文的摘要；@param {string} text 原生助手正文；@returns {string} 摘要。 */
export function confirmationDigest(text) {
  return createHash("sha256").update(text.replace(/\r\n?/g, "\n").trim()).digest("hex");
}

/** 从真实命令目录寻找最近的 Trellis 项目；@param {string} cwd 命令目录；@returns {string} 项目根。 */
export function confirmationRoot(cwd) {
  let dir = fs.realpathSync(cwd);
  for (;;) {
    const marker = path.join(dir, ".trellis/scripts/confirmation.py");
    if (fs.existsSync(marker) && fs.realpathSync(marker) === marker && fs.statSync(marker).isFile()) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error("当前目录没有安装确认流程的 Trellis 项目");
    dir = parent;
  }
}

/** 逐级打开项目私有运行目录；@param {string} root 已核实的项目根；@param {string} area 用途；@param {boolean} create 是否创建；@returns {string} 目录。 */
export function confirmationDirectory(root, area, create = true) {
  let dir = root;
  for (const segment of [".trellis", ".runtime", "confirmations", area].filter(Boolean)) {
    dir = path.join(dir, segment);
    if (create && segment !== ".trellis") {
      try { fs.mkdirSync(dir, { mode: 0o700 }); } catch (error) { if (error.code !== "EEXIST") throw error; }
    }
    const stat = fs.lstatSync(dir);
    if (!stat.isDirectory() || (process.getuid && (stat.uid !== process.getuid() || (stat.mode & 0o022)))) {
      throw new Error("确认运行目录不是当前用户的真实目录");
    }
  }
  return dir;
}

/** 获取沙箱外的本机见证公钥文件；@param {string} [root] 项目根；@param {boolean} [create] 是否创建；@returns {string} 公钥文件路径。 */
export function confirmationWitnessKey(root, create = false) {
  const home = fs.realpathSync(os.homedir());
  const directory = path.join(home, ".flower-trellis", "confirmation");
  if (root && (directory === root || directory.startsWith(root + path.sep))) {
    throw new Error("见证公钥必须位于项目之外");
  }
  if (create) fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.uid !== process.getuid() || (stat.mode & 0o077)
    || fs.realpathSync(directory) !== directory) throw new Error("本机见证公钥目录无效");
  return path.join(directory, "witness.json");
}

/** 有界读取普通文件，不跟随链接或等待 FIFO；@param {string} file 路径；@param {number} limit 字节上限；@param {boolean} tail 是否只读尾部；@returns {string} UTF-8 内容。 */
export function readConfirmationFile(file, limit, tail = false) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || (process.getuid && stat.uid !== process.getuid()) || (!tail && stat.size > limit)) {
      throw new Error("确认文件类型或大小无效");
    }
    const start = tail ? Math.max(0, stat.size - limit) : 0;
    const data = Buffer.alloc(stat.size - start);
    const size = fs.readSync(fd, data, 0, data.length, start);
    return data.subarray(0, size).toString("utf8");
  } finally { fs.closeSync(fd); }
}

/** 原子发布记录；@param {string} file 路径；@param {object} value 记录；@param {boolean} exclusive 是否只允许首次写入；@returns {void} */
export function writeConfirmationFile(file, value, exclusive = false) {
  const temp = path.join(path.dirname(file), `.${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temp, JSON.stringify(value), { flag: "wx", mode: 0o600 });
    if (exclusive) fs.linkSync(temp, file);
    else fs.renameSync(temp, file);
  } finally { fs.rmSync(temp, { force: true }); }
}
