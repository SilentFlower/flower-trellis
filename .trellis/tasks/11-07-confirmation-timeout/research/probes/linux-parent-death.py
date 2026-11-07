"""仅供 Linux 研究探针使用：前台控制器死亡时终止其直接管理的 CLI。"""

import ctypes
import os
import signal
import sys


def main():
    """绑定父进程死亡信号并替换为 CLI；参数为父 PID、程序及其参数。"""
    owner = int(sys.argv[1])
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(1, signal.SIGKILL, 0, 0, 0) != 0:
        raise OSError(ctypes.get_errno(), "无法绑定父进程退出信号")
    # 先建立内核绑定再复核父 PID，避免绑定之前父进程退出的窗口。
    if os.getppid() != owner:
        os.kill(os.getpid(), signal.SIGKILL)
    os.execv(sys.argv[2], sys.argv[2:])


if __name__ == "__main__":
    main()
