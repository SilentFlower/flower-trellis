import fs from "node:fs";
import path from "node:path";

/**
 * 验证npm标准Node启动器全文，允许直接用Node保留参数而不经过CMD展开。
 * @param {string} command .cmd启动器路径。
 * @param {string} target 已核实的package.json bin目标。
 * @returns {boolean} 是否为现有全局同步逻辑认可的标准启动器。
 */
export function isStandardNpmNodeShim(command, target) {
  const relative = path.relative(path.dirname(command), target).split(path.sep).join("\\");
  const expected = [
    "@ECHO off", "GOTO start", ":find_dp0", "SET dp0=%~dp0", "EXIT /b", ":start",
    "SETLOCAL", "CALL :find_dp0", "", 'IF EXIST "%dp0%\\node.exe" (',
    '  SET "_prog=%dp0%\\node.exe"', ') ELSE (', '  SET "_prog=node"',
    '  SET PATHEXT=%PATHEXT:;.JS;=;%', ')', '',
    `endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\${relative}" %*`, "",
  ].join("\n");
  try { return fs.readFileSync(command, "utf8").replaceAll("\r\n", "\n") === expected; }
  catch { return false; }
}

/**
 * 验证npm为无shebang原生程序生成的启动器，不经过CMD执行用户路径。
 * @param {string} command .cmd启动器路径。
 * @param {string} target 已核实的原生bin路径。
 * @returns {boolean} 是否逐字匹配npm cmd-shim的无解释器分支。
 */
export function isStandardNpmNativeShim(command, target) {
  const relative = path.relative(path.dirname(command), target).split(path.sep).join("\\");
  // 对齐npm cmd-shim/lib/index.js的head及无prog分支，保留两处参数空格。
  const expected = ["@ECHO off", "GOTO start", ":find_dp0", "SET dp0=%~dp0", "EXIT /b", ":start",
    "SETLOCAL", "CALL :find_dp0", `"%dp0%\\${relative}"   %*`, ""].join("\n");
  try { return fs.readFileSync(command, "utf8").replaceAll("\r\n", "\n") === expected; }
  catch { return false; }
}
