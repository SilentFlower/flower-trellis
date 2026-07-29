const WIN32_INPUT_MODE_DISABLE = "\x1b[?9001l";
const CURSOR_SHOW = "\x1b[?25h";

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

/**
 * 在 Windows 交互完成页选择“退出”后恢复终端，并显式结束 CLI 进程。
 *
 * node-pty 的 Windows ConPTY worker 在子进程自然退出后仍可能持有 MessagePort / Socket，
 * 因此不能只依赖 Node 事件循环自然清空。这里仅在用户已经选择退出时执行，并把实际退出
 * 延后到下一轮事件循环，让 Inquirer 完成当前输出清理。
 *
 * @param {{platform?:string,input?:{isTTY?:boolean,isRaw?:boolean,setRawMode?:(value:boolean)=>unknown,pause?:()=>unknown},output?:{isTTY?:boolean,write:(value:string)=>unknown},schedule?:(callback:()=>void)=>unknown,exitProcess?:(code:number)=>unknown}} [options] 终端、调度器与退出函数测试注入
 * @returns {boolean} 是否安排了 Windows CLI 显式退出
 */
export function scheduleWindowsTerminalExit(options = {}) {
  const platform = options.platform ?? process.platform;
  if (platform !== "win32") return false;

  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  try {
    if (input?.isTTY && input.isRaw && typeof input.setRawMode === "function") {
      input.setRawMode(false);
    }
    if (typeof input?.pause === "function") input.pause();
  } catch {
    // 退出前终端恢复是 best-effort，不能把成功命令改成失败。
  }
  try {
    if (output?.isTTY && typeof output.write === "function") output.write(CURSOR_SHOW);
  } catch {
    // 输出流关闭时继续执行 Win32 输入模式恢复与退出。
  }
  disableWindowsTerminalWin32InputMode({ platform, output });

  const schedule = options.schedule ?? ((callback) => setTimeout(callback, 0));
  const exitProcess = options.exitProcess ?? ((code) => process.exit(code));
  schedule(() => exitProcess(0));
  return true;
}
