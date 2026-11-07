#!/usr/bin/env python3
"""把当前CLI或材料检查及其子进程绑定到统一前台入口；不执行默认业务动作。"""

import ctypes
import importlib.util
import json
import os
import signal
import socket
import subprocess
import sys
import threading


def _windows_job():
    """建立Kill-On-Close Job并纳入自身；返回结束整个自有进程树的函数。"""
    from ctypes import wintypes

    class BasicLimits(ctypes.Structure):
        """与Win32 JOBOBJECT_BASIC_LIMIT_INFORMATION逐字段对应。"""
        _fields_ = [("PerProcessUserTimeLimit", ctypes.c_longlong), ("PerJobUserTimeLimit", ctypes.c_longlong),
                    ("LimitFlags", wintypes.DWORD), ("MinimumWorkingSetSize", ctypes.c_size_t),
                    ("MaximumWorkingSetSize", ctypes.c_size_t), ("ActiveProcessLimit", wintypes.DWORD),
                    ("Affinity", ctypes.c_size_t), ("PriorityClass", wintypes.DWORD), ("SchedulingClass", wintypes.DWORD)]

    class IoCounters(ctypes.Structure):
        """与Win32 IO_COUNTERS的六个64位计数对应。"""
        _fields_ = [(name, ctypes.c_ulonglong) for name in
                    ("ReadOperationCount", "WriteOperationCount", "OtherOperationCount",
                     "ReadTransferCount", "WriteTransferCount", "OtherTransferCount")]

    class ExtendedLimits(ctypes.Structure):
        """与Win32 JOBOBJECT_EXTENDED_LIMIT_INFORMATION对应。"""
        _fields_ = [("BasicLimitInformation", BasicLimits), ("IoInfo", IoCounters),
                    ("ProcessMemoryLimit", ctypes.c_size_t), ("JobMemoryLimit", ctypes.c_size_t),
                    ("PeakProcessMemoryUsed", ctypes.c_size_t), ("PeakJobMemoryUsed", ctypes.c_size_t)]

    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
    kernel.CreateJobObjectW.restype = wintypes.HANDLE
    kernel.GetCurrentProcess.restype = wintypes.HANDLE
    kernel.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
    kernel.SetInformationJobObject.restype = wintypes.BOOL
    kernel.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
    kernel.AssignProcessToJobObject.restype = wintypes.BOOL
    kernel.TerminateJobObject.argtypes = [wintypes.HANDLE, wintypes.UINT]
    kernel.TerminateJobObject.restype = wintypes.BOOL
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    job = kernel.CreateJobObjectW(None, None)
    if not job:
        raise OSError(ctypes.get_last_error(), "无法创建会话Job")
    limits = ExtendedLimits()
    limits.BasicLimitInformation.LimitFlags = 0x00002000
    if not kernel.SetInformationJobObject(job, 9, ctypes.byref(limits), ctypes.sizeof(limits)):
        kernel.CloseHandle(job)
        raise OSError(ctypes.get_last_error(), "无法设置会话Job")
    if not kernel.AssignProcessToJobObject(job, kernel.GetCurrentProcess()):
        kernel.CloseHandle(job)
        raise OSError(ctypes.get_last_error(), "无法绑定会话Job")
    # 句柄不传给CLI；本守护器退出或被强杀时，内核自动关闭最后一个句柄并结束后代。
    return lambda: kernel.TerminateJobObject(job, 130)


def _linux_group(owner_pid):
    """绑定父进程死亡信号；返回只终止当前自有进程组的函数。"""
    if os.getpgrp() != os.getpid():
        raise ValueError("确认守护器必须独占自己的进程组")
    group = os.getpgrp()

    def stop():
        os.killpg(group, signal.SIGKILL)

    signal.signal(signal.SIGTERM, lambda *_: stop())
    signal.signal(signal.SIGHUP, lambda *_: stop())
    signal.signal(signal.SIGINT, lambda *_: stop())
    libc = ctypes.CDLL(None, use_errno=True)
    # 使用可处理的父死亡信号，让守护器把整组后代一起结束，而非只杀CLI主进程。
    if libc.prctl(1, signal.SIGTERM, 0, 0, 0) != 0:
        raise OSError(ctypes.get_errno(), "无法绑定前台进程生命周期")
    if os.getppid() != owner_pid:
        stop()
    return stop


def main():
    """建立生命连接后运行子程序；helper路径后可加--inspect区分材料检查。"""
    inspecting = sys.argv[2] == "--inspect"
    module_spec = importlib.util.spec_from_file_location("flower_confirmation_client", sys.argv[1])
    client = importlib.util.module_from_spec(module_spec)
    module_spec.loader.exec_module(client)
    descriptor = client.session_descriptor()
    if sys.platform == "win32":
        stop = _windows_job()
    elif sys.platform.startswith("linux"):
        # execFile使用管道而不是PTY，检查守护器必须自行隔离，避免结束前台控制器的进程组。
        if inspecting and os.getpgrp() != os.getpid():
            os.setsid()
        stop = _linux_group(descriptor["owner_pid"])
    else:
        raise ValueError("当前平台的进程生命周期尚未验证")
    connection = socket.create_connection(("127.0.0.1", descriptor["port"]), timeout=10)
    connection.sendall((json.dumps({"method": "guard", "token": descriptor["token"],
                                    "instance_id": descriptor["instance_id"]}) + "\n").encode("utf-8"))
    reader = connection.makefile("rb")
    if json.loads(reader.readline().decode("utf-8")) != {"ready": True}:
        raise ValueError("前台生命连接未就绪")
    connection.settimeout(None)
    finished = threading.Event()

    def watch():
        try:
            while reader.read(1):
                pass
        except OSError:
            pass
        finally:
            if not finished.is_set():
                stop()

    watcher = threading.Thread(target=watch, daemon=True)
    watcher.start()
    try:
        code = subprocess.call(sys.argv[3:] if inspecting else sys.argv[2:])
        code = min(255, code if code >= 0 else 128 - code)
        if inspecting:
            # 检查正常结束必须保留stdout和退出码，不能覆盖原生CLI的最终退出结果。
            finished.set()
            connection.shutdown(socket.SHUT_RDWR)
            watcher.join(timeout=1)
            reader.close()
            connection.close()
            return code
        # 在结束自身进程组之前交回真实退出码；PTY退出信号本身不能表达CLI原退出码。
        client.session_request({"method": "exit", "code": code})
    finally:
        if not finished.is_set():
            stop()
    return code


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        print("统一确认入口的进程约束未能启动，请使用原命令并保持人工确认。", file=sys.stderr)
        sys.exit(2)
