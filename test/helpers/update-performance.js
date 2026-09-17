import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

/**
 * 构造 npm cmd-shim 的 Node 启动器；夹具采用 npm 10 的标准模板。
 * @param {string} relative prefix 内 bin 相对路径
 * @returns {string} CMD 文本
 */
export function npmNodeShim(relative) {
  return `@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n\r\nIF EXIST "%dp0%\\node.exe" (\r\n  SET "_prog=%dp0%\\node.exe"\r\n) ELSE (\r\n  SET "_prog=node"\r\n  SET PATHEXT=%PATHEXT:;.JS;=;%\r\n)\r\n\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\${relative}" %*\r\n`;
}

/**
 * 创建隔离全局布局，复用只读捆绑依赖，绝不执行全局安装。
 * @param {string} prefix 临时 prefix
 * @returns {string} 启动器路径
 */
export function isolatedGlobalTrellis(prefix) {
  const require = createRequire(import.meta.url);
  const source = path.dirname(require.resolve("@mindfoldhq/trellis/package.json"));
  const pkg = JSON.parse(fs.readFileSync(path.join(source, "package.json")));
  const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin.trellis;
  const root = path.join(prefix, ...(process.platform === "win32" ? [] : ["lib"]), "node_modules", "@mindfoldhq", "trellis");
  fs.mkdirSync(path.dirname(root), { recursive: true });
  fs.symlinkSync(source, root, process.platform === "win32" ? "junction" : "dir");
  const command = path.join(prefix, ...(process.platform === "win32" ? ["trellis.cmd"] : ["bin", "trellis"]));
  fs.mkdirSync(path.dirname(command), { recursive: true });
  if (process.platform === "win32") {
    fs.writeFileSync(command, npmNodeShim(path.relative(prefix, path.join(root, bin)).split(path.sep).join("\\")));
  } else {
    fs.symlinkSync(path.join(root, bin), command);
  }
  return command;
}
