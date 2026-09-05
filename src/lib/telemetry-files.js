import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { flowerConfigDirectory } from "../plugin/sources/user-source-store.js";

/** 检查目录链，拒绝经由软链接访问遥测状态。
 * @param {string} directory 目录
 * @param {boolean} create 是否创建
 * @returns {void}
 */
export function telemetryDirectory(directory, create = true) {
  const parent = path.dirname(directory);
  if (parent !== directory) telemetryDirectory(parent, false);
  try {
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("遥测目录必须是普通目录");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    if (!create) return;
    telemetryDirectory(parent);
    try { fs.mkdirSync(directory, { mode: 0o700 }); }
    catch (failure) { if (failure.code !== "EEXIST") throw failure; telemetryDirectory(directory, false); }
  }
}

/** 读取有界普通 JSON 文件；损坏文件保留原状。
 * @param {string} file 文件
 * @param {unknown} fallback 缺失值
 * @param {number} limit 最大字节数
 * @returns {unknown} JSON
 */
export function readTelemetryJson(file, fallback = null, limit = 16384) {
  telemetryDirectory(path.dirname(file), false);
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > limit) throw new Error("遥测状态必须是有界普通文件");
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) { if (error.code === "ENOENT") return fallback; throw error; }
}

/** 同目录原子替换，避免读到半份状态。
 * @param {string} file 文件
 * @param {unknown} value JSON
 * @returns {void}
 */
export function writeTelemetryJson(file, value) {
  telemetryDirectory(path.dirname(file));
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("遥测状态必须是普通文件");
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(descriptor, JSON.stringify(value));
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporary, file);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    fs.rmSync(temporary, { force: true });
  }
}

/** 获取新旧遥测共用的进程锁；锁内回调必须同步且不联网。
 * @param {Function} callback 同步临界区
 * @param {object} options 环境
 * @returns {unknown} 回调结果
 */
export function withTelemetryLock(callback, options = {}) {
  const directory = flowerConfigDirectory(options.env || process.env);
  telemetryDirectory(directory);
  try { fs.chmodSync(directory, 0o700); } catch { /* Windows 由用户目录权限保护。 */ }
  const lock = path.join(directory, "telemetry.lock");
  const token = crypto.randomUUID();
  const deadline = Date.now() + 500;
  for (;;) {
    if (Date.now() >= deadline) throw new Error("遥测锁繁忙");
    try {
      fs.mkdirSync(lock, { mode: 0o700 });
      writeTelemetryJson(path.join(lock, "owner.json"), { pid: process.pid, token });
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      let stat;
      try { stat = fs.lstatSync(lock); }
      catch (failure) { if (failure.code === "ENOENT" && Date.now() < deadline) continue; throw failure; }
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("遥测锁无效");
      const owner = readTelemetryJson(path.join(lock, "owner.json"));
      let dead = false;
      if (Number.isSafeInteger(owner?.pid) && owner.pid > 0) {
        try { process.kill(owner.pid, 0); } catch (failure) { dead = failure.code === "ESRCH"; }
      }
      if (dead || (!owner && Date.now() - stat.mtimeMs > 30000)) {
        // 多个竞争者不能同时清理旧锁，否则第二位可能移走下一位刚创建的新锁。
        const reaper = `${lock}.reap`;
        let claimed = false;
        try {
          fs.mkdirSync(reaper, { mode: 0o700 });
          claimed = true;
          const current = readTelemetryJson(path.join(lock, "owner.json"));
          if (current?.token === owner?.token) {
            const stale = `${lock}.${token}.stale`;
            fs.renameSync(lock, stale);
            fs.rmSync(stale, { recursive: true, force: true });
          }
        } catch { /* 下一轮重试，保留非普通或损坏状态。 */ }
        finally { if (claimed) fs.rmdirSync(reaper); }
        continue;
      }
      if (Date.now() >= deadline) throw new Error("遥测锁繁忙");
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  try { return callback(); }
  finally {
    if (readTelemetryJson(path.join(lock, "owner.json"))?.token === token) fs.rmSync(lock, { recursive: true });
  }
}

/** 返回独立的 v2 目录，不创建文件。
 * @param {object} env 环境
 * @returns {string} 路径
 */
export function telemetryQueueDirectory(env = process.env) {
  return path.join(flowerConfigDirectory(env), "telemetry-v2");
}

/** 停用时只清理已知普通状态文件，拒绝遍历软链接。
 * @param {object} env 环境
 * @returns {void}
 */
export function clearTelemetryQueue(env = process.env) {
  const directory = telemetryQueueDirectory(env);
  telemetryDirectory(directory, false);
  if (!fs.existsSync(directory)) return;
  for (const name of fs.readdirSync(directory)) {
    const file = path.join(directory, name);
    const stat = fs.lstatSync(file);
    if (stat.isFile() && !stat.isSymbolicLink() && (name.endsWith(".json") || name.endsWith(".tmp"))) fs.unlinkSync(file);
  }
}
