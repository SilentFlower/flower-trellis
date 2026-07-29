const WIN32_INPUT_MODE_DISABLE = "\x1b[?9001l";

/**
 * 关闭 Windows Terminal 的 Win32 输入模式，恢复宿主 CLI 的普通键盘输入。
 *
 * ConPTY 子进程会通过 CSI ? 9001 h 请求 Windows Terminal 把按键编码成
 * Win32 Input Mode 记录。Flower 透传子进程终端输出时必须在边界处关闭该模式，
 * 否则后续 Inquirer 会收到形如 `CSI Vk;Sc;Uc;Kd;Cs;Rc _` 的残留输入。
 *
 * @param {{platform?:string,output?:{isTTY?:boolean,write:(value:string)=>unknown}}} [options] 平台与输出流测试注入
 * @returns {boolean} 是否写出了终端恢复序列
 */
export function disableWindowsTerminalWin32InputMode(options = {}) {
  const platform = options.platform ?? process.platform;
  const output = options.output ?? process.stdout;
  if (platform !== "win32" || !output?.isTTY || typeof output.write !== "function") {
    return false;
  }
  try {
    output.write(WIN32_INPUT_MODE_DISABLE);
    return true;
  } catch {
    // 终端恢复属于退出期兜底，输出流已关闭时不能覆盖原命令结果。
    return false;
  }
}

/**
 * 在 CLI 启动时恢复一次 Windows 终端输入，并在进程退出时再次兜底恢复。
 *
 * @param {{platform?:string,output?:{isTTY?:boolean,write:(value:string)=>unknown},processEvents?:{once:(event:string,listener:()=>void)=>unknown,off:(event:string,listener:()=>void)=>unknown}}} [options] 平台、输出流与进程事件测试注入
 * @returns {()=>void} 移除退出期恢复监听的清理函数
 */
export function installWindowsTerminalInputRecovery(options = {}) {
  const processEvents = options.processEvents ?? process;
  const restore = () => disableWindowsTerminalWin32InputMode(options);
  restore();
  processEvents.once("exit", restore);
  return () => processEvents.off("exit", restore);
}
