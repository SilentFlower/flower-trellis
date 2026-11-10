"""Python 状态锁的多进程竞争、权限重试和空状态生命周期。"""

import errno
import json
import os
import subprocess
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

from confirmation_fixture import ProjectFixture, write_json
from flower_confirmation_runtime import store as storage


class ConfirmationStoreTest(unittest.TestCase):
    """保留原 store 的跨平台锁与原子转换行为。"""

    def test_empty_query_and_cancel_leave_missing_directories_absent(self):
        """新会话查询和项目取消保持零写入。"""
        f = ProjectFixture(self)
        session = str(uuid4())
        store = storage.ConfirmationStore(f.root, session, "claude")
        self.assertIsNone(store.read())
        self.assertIsNone(store.change(str(uuid4()), lambda request, state: None))
        self.assertFalse(store.directory.exists())

    def test_real_processes_preserve_every_generation_update(self):
        """多个真实 Python 进程争锁，所有增量均保留。"""
        f = ProjectFixture(self)
        program = (
            "import sys; sys.path.insert(0, sys.argv[1]); "
            "from flower_confirmation_runtime.store import ConfirmationStore; "
            "store = ConfirmationStore(sys.argv[2], sys.argv[3], 'codex'); "
            "[(store.update(lambda value: dict(value, generation=value['generation'] + 1))) for unused in range(12)]")
        children = [subprocess.Popen([sys.executable, "-X", "utf8", "-c", program, str(f.scripts), str(f.root), f.session],
                                     env=f.env, stdout=subprocess.PIPE, stderr=subprocess.PIPE) for unused in range(4)]
        for child in children:
            stdout, stderr = child.communicate(timeout=20)
            self.assertEqual(child.returncode, 0, stderr.decode("utf-8"))
        self.assertEqual(f.store.read()["generation"], 48)
        self.assertFalse(f.store.file.with_name(f.store.file.name + ".lock").exists())

    def test_dead_owner_lock_is_reaped_without_stealing_live_lock(self):
        """退出进程的锁可回收，活锁沿用有限等待。"""
        f = ProjectFixture(self)
        child = subprocess.Popen([sys.executable, "-c", "pass"], env=f.env)
        child.wait(5)
        lock = f.store.file.with_name(f.store.file.name + ".lock")
        lock.mkdir()
        write_json(lock / "owner.json", {"pid": child.pid, "token": str(uuid4())})
        f.store.update(lambda value: {**value, "generation": 1})
        self.assertEqual(f.store.read()["generation"], 1)
        lock.mkdir()
        write_json(lock / "owner.json", {"pid": os.getpid(), "token": str(uuid4())})
        with patch.object(storage, "_pid_alive", return_value=True), self.assertRaisesRegex(ValueError, "锁繁忙"):
            f.store.update(lambda value: {**value, "generation": 2})
        self.assertEqual(f.store.read()["generation"], 1)

    def test_windows_transient_create_denial_runs_callback_once(self):
        """模拟 Windows 目录删除竞争，取得锁前始终保持只读。"""
        f = ProjectFixture(self)
        original = Path.mkdir
        attempts, callbacks = [], []
        lock = f.store.file.with_name(f.store.file.name + ".lock")
        def mkdir(path, *args, **kwargs):
            if path == lock:
                attempts.append(True)
                if len(attempts) < 3:
                    raise PermissionError(errno.EACCES, "短暂拒绝")
            return original(path, *args, **kwargs)
        def mutate(value):
            callbacks.append(True)
            return {**value, "generation": 1}
        with patch.object(storage.sys, "platform", "win32"), patch.object(Path, "mkdir", mkdir):
            f.store.update(mutate)
        self.assertEqual(len(callbacks), 1)
        self.assertEqual(len(attempts), 3)

    def test_windows_persistent_denial_preserves_permission_error(self):
        """持续拒绝时保留原权限错误，回调保持零次。"""
        f = ProjectFixture(self)
        original = Path.mkdir
        lock = f.store.file.with_name(f.store.file.name + ".lock")
        callbacks = []
        def mkdir(path, *args, **kwargs):
            if path == lock:
                raise PermissionError(errno.EPERM, "持续拒绝")
            return original(path, *args, **kwargs)
        with patch.object(storage.sys, "platform", "win32"), patch.object(Path, "mkdir", mkdir), \
                patch.object(storage.time, "monotonic", side_effect=(0, 2)), self.assertRaises(PermissionError):
            f.store.update(lambda value: callbacks.append(True))
        self.assertEqual(callbacks, [])

    def test_windows_shared_files_retry_without_replaying_callback(self):
        """原子替换和锁释放遇到短暂共享占用，状态转换各执行一次。"""
        for operation in ("replace", "release"):
            with self.subTest(operation=operation):
                f = ProjectFixture(self)
                lock = f.store.file.with_name(f.store.file.name + ".lock")
                module, name = (storage.os, "replace") if operation == "replace" else (storage.shutil, "rmtree")
                original = getattr(module, name)
                attempts, callbacks = [], []
                def apply(*args, **kwargs):
                    target = Path(args[-1] if operation == "replace" else args[0])
                    if target == (f.store.file if operation == "replace" else lock):
                        attempts.append(True)
                        if len(attempts) < 3:
                            raise PermissionError(errno.EACCES, "共享占用")
                    return original(*args, **kwargs)
                def mutate(value):
                    callbacks.append(True)
                    return {**value, "generation": 1}
                with patch.object(storage.sys, "platform", "win32"), patch.object(module, name, side_effect=apply):
                    f.store.update(mutate)
                self.assertEqual(len(attempts), 3)
                self.assertEqual(len(callbacks), 1)
                self.assertEqual(f.store.read()["generation"], 1)
                self.assertFalse(lock.exists())

    def test_persistent_shared_file_denial_preserves_error_and_execution_fact(self):
        """持续拒绝保留原错误，写入事实与回调次数保持真实。"""
        for operation in ("replace", "release"):
            with self.subTest(operation=operation):
                f = ProjectFixture(self)
                lock = f.store.file.with_name(f.store.file.name + ".lock")
                module, name = (storage.os, "replace") if operation == "replace" else (storage.shutil, "rmtree")
                original = getattr(module, name)
                callbacks = []
                error = PermissionError(errno.EACCES, "持续共享占用")
                def apply(*args, **kwargs):
                    target = Path(args[-1] if operation == "replace" else args[0])
                    if target == (f.store.file if operation == "replace" else lock):
                        raise error
                    return original(*args, **kwargs)
                def mutate(value):
                    callbacks.append(True)
                    return {**value, "generation": 1}
                with patch.object(storage.sys, "platform", "win32"), patch.object(module, name, side_effect=apply), \
                        patch.object(storage.time, "monotonic", side_effect=range(0, 100, 2)), self.assertRaises(PermissionError) as caught:
                    f.store.update(mutate)
                self.assertIs(caught.exception, error)
                self.assertEqual(len(callbacks), 1)
                self.assertEqual(f.store.read()["generation"], 0 if operation == "replace" else 1)
                self.assertEqual(lock.exists(), operation == "release")


if __name__ == "__main__":
    unittest.main()
