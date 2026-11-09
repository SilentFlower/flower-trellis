"""验证窗口绑定、能力不足与实际进程退出，禁止以 PID 存活代替出生身份。"""

from __future__ import annotations

import json
import os
import select
import subprocess
import sys
import unittest
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "src/assets/flower_tui_lifetime.py"
SPEC = spec_from_file_location("flower_tui_lifetime", SCRIPT)
LIFETIME = module_from_spec(SPEC)
SPEC.loader.exec_module(LIFETIME)
HAS_PIDFD = sys.platform == "linux" and callable(getattr(os, "pidfd_open", None))


class TuiLifetimeTest(unittest.TestCase):
    """覆盖公共校验及本机可用时的内核退出行为。"""

    def test_origin_rejects_non_local_or_credential_addresses(self):
        """远程 URL、凭据及路径不能扩大本机观测范围。"""
        for origin in ["https://127.0.0.1:123", "http://localhost:123", "http://127.0.0.1:0",
                       "http://user@127.0.0.1:123", "http://127.0.0.1:123/mcp",
                       "http://127.0.0.1:123?token=secret", "http://127.0.0.1:70000"]:
            with self.subTest(origin=origin), self.assertRaises(ValueError):
                LIFETIME.parse_origin(origin)
        self.assertEqual(LIFETIME.parse_origin("http://127.0.0.1:123"), ("127.0.0.1", 123))
        self.assertEqual(LIFETIME.parse_origin("http://[::1]:123"), ("::1", 123))

    def test_missing_kernel_api_keeps_manual(self):
        """Python 3.8 或其他平台加载成功，缺能力时明确拒绝自动路径。"""
        with patch.object(LIFETIME.os, "pidfd_open", None, create=True):
            with self.assertRaisesRegex(ValueError, "退出观测能力"):
                LIFETIME.open_binding({})

    @unittest.skipUnless(HAS_PIDFD, "仅 Linux 核对真实监听归属")
    def test_extra_frontend_without_thread_origin_keeps_manual(self):
        """额外窗口没出现在任何会话配置中时，不能借用另一窗口继续。"""
        child, binding = self.listener()
        original_readlink = LIFETIME.os.readlink
        def frontend_link(file):
            """只把本测试监听者标记为前台，不影响其他本机进程。"""
            if str(file) == "/proc/{}/exe".format(child.pid):
                return "/test/codex"
            value = original_readlink(file)
            if Path(file).name == "exe" and Path(value).name == "codex":
                return "/test/other-program"
            return value
        with patch.object(LIFETIME.os, "readlink", side_effect=frontend_link):
            with self.assertRaisesRegex(ValueError, "未对应"):
                LIFETIME.check_frontend_coverage(["http://127.0.0.1:1"])
            LIFETIME.check_frontend_coverage([binding["origin"]])

    @unittest.skipUnless(HAS_PIDFD, "仅 Linux 具备 pidfd 时验证真实退出")
    def test_pid_reuse_and_socket_loss_are_rejected(self):
        """PID 出生标识改变或监听者消失时必须拒绝旧绑定。"""
        child, binding = self.listener()
        LIFETIME.check_binding(binding)
        with self.assertRaisesRegex(ValueError, "出生身份"):
            LIFETIME.check_binding({**binding, "startTicks": "0"})
        child.terminate()
        child.wait(5)
        with self.assertRaises((OSError, ValueError)):
            LIFETIME.open_binding(binding)

    @unittest.skipUnless(HAS_PIDFD, "仅 Linux 具备 pidfd 时验证真实退出")
    def test_exit_wakes_pidfd_without_affecting_other_process(self):
        """两个同目录监听进程独立，退出其中一个只唤醒对应句柄。"""
        first, binding = self.listener()
        second, other = self.listener()
        fd = LIFETIME.open_binding(binding)
        other_fd = LIFETIME.open_binding(other)
        try:
            poll = select.poll()
            poll.register(fd, select.POLLIN)
            poll.register(other_fd, select.POLLIN)
            self.assertFalse(poll.poll(0))
            first.terminate()
            events = poll.poll(3000)
            self.assertTrue(any(current == fd for current, unused in events))
            self.assertFalse(any(current == other_fd for current, unused in events))
            self.assertIsNone(second.poll())
        finally:
            os.close(fd)
            os.close(other_fd)

    @unittest.skipUnless(HAS_PIDFD, "仅 Linux 具备 pidfd 时验证真实退出")
    def test_watch_exits_when_worker_stdin_closes(self):
        """确认 worker 退出后辅助观察进程不常驻。"""
        unused, binding = self.listener()
        watcher = subprocess.Popen([sys.executable, "-X", "utf8", str(SCRIPT), "watch"],
                                   stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                   text=True, encoding="utf-8")
        self.addCleanup(self.close_child, watcher)
        watcher.stdin.write(json.dumps(binding) + "\n")
        watcher.stdin.flush()
        self.assertEqual(json.loads(watcher.stdout.readline())["event"], "watching")
        watcher.stdin.close()
        watcher.wait(5)
        self.assertEqual(watcher.returncode, 0)

    def listener(self):
        """创建属于本测试的监听进程并构造内核观察夹具。

        @return: 进程及冻结身份。
        """
        code = "import socket,json,time; s=socket.socket(); s.bind(('127.0.0.1',0)); s.listen(); print(json.dumps(s.getsockname()),flush=True); time.sleep(60)"
        child = subprocess.Popen([sys.executable, "-X", "utf8", "-c", code], stdout=subprocess.PIPE,
                                 stderr=subprocess.PIPE, text=True, encoding="utf-8", cwd=ROOT)
        self.addCleanup(self.close_child, child)
        host, port = json.loads(child.stdout.readline())
        origin = "http://{}:{}".format(host, port)
        binding = {"version": 1, "origin": origin, **LIFETIME.process_identity(child.pid),
                   "socketInodes": sorted(LIFETIME.listening_inodes(origin))}
        return child, binding

    @staticmethod
    def close_child(child):
        """只回收当前测试拥有的子进程与管道。

        @param child: 测试创建的进程。
        @return: None。
        """
        if child.poll() is None:
            child.terminate()
        child.wait(5)
        for stream in [child.stdin, child.stdout, child.stderr]:
            if stream and not stream.closed:
                stream.close()


if __name__ == "__main__":
    unittest.main()
