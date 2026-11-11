"""在真实 Python 解释器中验证确认 helper 的跨平台契约。"""

import json
import hashlib
import os
import runpy
import shutil
import subprocess
import sys
import tempfile
import unittest
import uuid
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "vendor/skill-garden/.trellis/0.6/scripts/confirmation_policy.py"


class ConfirmationPolicyTest(unittest.TestCase):
    """用隔离会话运行发布 helper，避免模块缓存影响其他套件。"""

    def setUp(self):
        """创建支持中文路径的最小项目、材料和两端会话指针。"""
        self.temporary = tempfile.TemporaryDirectory(prefix="flower-confirm-中文-")
        self.root = Path(self.temporary.name)
        scripts = self.root / ".trellis/scripts"
        scripts.mkdir(parents=True)
        shutil.copytree(ROOT / ".trellis/scripts/common", scripts / "common")
        shutil.copy2(SOURCE, scripts / "confirmation_policy.py")
        self.session = str(uuid.uuid4())
        self.task = ".trellis/tasks/test"
        task = self.root / self.task
        task.mkdir(parents=True)
        (task / "task.json").write_text(json.dumps({"name": "test", "status": "planning"}), encoding="utf-8")
        (task / "brief.md").write_text("😀" * 1001, encoding="utf-8")
        sessions = self.root / ".trellis/.runtime/sessions"
        sessions.mkdir(parents=True)
        for platform in ("codex", "claude"):
            (sessions / (platform + "_" + self.session + ".json")).write_text(json.dumps({"current_task": self.task}), encoding="utf-8")
        self.material = {"kind": "brief", "task": self.task}

    def tearDown(self):
        """清理本测试拥有的隔离项目。"""
        self.temporary.cleanup()

    def invoke(self, platform="codex", session=None):
        """执行当前真实解释器下的 helper。

        Args:
            platform: 原生平台标识。
            session: 可选的其它会话，用于拒绝越界测试。
        Returns:
            退出码与 JSON 输出。
        """
        (self.root / "input.json").write_text(json.dumps(self.material, ensure_ascii=False), encoding="utf-8")
        process = subprocess.run([sys.executable, "-X", "utf8", str(self.root / ".trellis/scripts/confirmation_policy.py"),
                                  "--project", str(self.root), "--input", "input.json", "--platform", platform,
                                  "--session", session or self.session], cwd=str(self.root), env=dict(os.environ),
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8", timeout=15)
        self.assertEqual(process.stderr, "")
        return process.returncode, json.loads(process.stdout)

    def test_both_platforms_use_unicode_and_exact_session(self):
        """两端共享 Unicode 计数；其它会话不能借用唯一任务。"""
        for platform in ("codex", "claude"):
            code, result = self.invoke(platform)
            self.assertEqual(code, 0)
            self.assertEqual(result["seconds"], 130)
            self.assertEqual(result["action"], "implement")
            code, result = self.invoke(platform, str(uuid.uuid4()))
            self.assertEqual(code, 1)
            self.assertFalse(result["enabled"])

    def test_current_development_task_keeps_manual_confirmation(self):
        """本机制自身的任务显式禁用超时，仍保持完整策略返回契约。"""
        task = self.root / self.task / "task.json"
        task.write_text(json.dumps({"name": "test", "status": "in_progress",
                                    "meta": {"confirmationTimeoutDisabled": True}}), encoding="utf-8")
        for platform in ("codex", "claude"):
            code, result = self.invoke(platform)
            self.assertEqual(code, 0)
            self.assertFalse(result["enabled"])
            self.assertEqual(result["reason"], "task_manual_only")
            self.assertEqual(result["action"], "implement")
            self.assertEqual(result["seconds"], 130)

    def test_invalid_policy_and_conflicting_dispositions_fail_closed(self):
        """重复策略字段及同 ID 的矛盾处置不能形成默认决定。"""
        config = self.root / ".trellis/config.yaml"
        config.write_text("confirmation_timeout:\n  enabled: false\n  enabled: true\n", encoding="utf-8")
        code, result = self.invoke()
        self.assertEqual(code, 1)
        self.assertFalse(result["enabled"])
        config.unlink()
        self.material.update({"kind": "check", "body": "完整报告", "reportVersion": "1", "dispositionVersion": "1",
                              "findings": [{"id": "CHK-001", "status": "pending"}, {"id": "CHK-001", "status": "accepted"}]})
        code, result = self.invoke()
        self.assertEqual(code, 1)
        self.assertFalse(result["enabled"])

    def test_missing_optional_artifact_and_new_file_change_snapshot(self):
        """原来缺失的设计文件一旦出现，旧材料摘要必须失效。"""
        code, before = self.invoke()
        self.assertEqual(code, 0)
        (self.root / self.task / "design.md").write_text("新设计", encoding="utf-8")
        code, after = self.invoke()
        self.assertEqual(code, 0)
        self.assertNotEqual(before["materialHash"], after["materialHash"])

    def test_large_staged_diff_and_planned_file_preserve_git_snapshot(self):
        """超过旧门槛的 Git 输出和普通文件仍核验实际内容与状态。"""
        def git(*args):
            return subprocess.check_output(["git", "-C", str(self.root), *args], stderr=subprocess.PIPE, timeout=10)

        git("init", "-q")
        planned = self.root / "plan.txt"
        planned.write_bytes(b"large line\n" * 500000)
        git("add", "--", planned.name)
        self.material.update(kind="push", body="精确 Push 计划", mode="commit-only",
                             evidence={"check": "focused", "spec": "no-op", "unresolvedRisks": 0},
                             repositories=[{"root": ".", "branch": git("symbolic-ref", "--short", "HEAD").decode().strip(),
                                            "head": None, "upstream": None, "files": [planned.name], "message": "测试计划"}])
        staged = git("diff", "--cached", "--binary")
        self.assertGreater(len(staged), 4 * 1024 * 1024)
        code, original = self.invoke()
        self.assertEqual(code, 0, original)
        facts = original["facts"]["repositories"][0]
        self.assertEqual(facts["stagedHash"], hashlib.sha256(('"' + staged.hex() + '"').encode()).hexdigest())
        self.assertEqual(facts["files"][planned.name]["sha256"], hashlib.sha256(planned.read_bytes()).hexdigest())
        (self.root / "outside-plan.txt").write_text("计划外状态", encoding="utf-8")
        code, dirty = self.invoke()
        self.assertEqual(code, 0, dirty)
        self.assertNotEqual(original["materialHash"], dirty["materialHash"])
        with planned.open("ab") as stream:
            stream.write(b"changed\n")
        code, changed = self.invoke()
        self.assertEqual(code, 0, changed)
        self.assertNotEqual(dirty["materialHash"], changed["materialHash"])

    def test_git_hash_timeout_reaps_process_and_identifies_command(self):
        """Git 读取卡住时跨平台回收进程并指出快照命令。"""
        with patch.object(sys, "path", [str(self.root / ".trellis/scripts"), *sys.path]):
            git_hash = runpy.run_path(str(SOURCE))["_git_hash"]
        processes = []
        original = subprocess.Popen

        def delayed(command, **kwargs):
            process = original([sys.executable, "-c", "import time; time.sleep(10)"], **kwargs)
            processes.append(process)
            return process

        with patch.object(subprocess, "Popen", delayed), patch.dict(git_hash.__globals__, GIT_TIMEOUT=0.2):
            with self.assertRaisesRegex(ValueError, "超时.+git ls-files"):
                git_hash(self.root, "ls-files", "--stage", "-z")
        self.assertIsNotNone(processes[0].poll())

    def test_windows_path_handle_ctime_mismatch_still_checks_identity_and_changes(self):
        """Windows 跨来源 ctime 差异可接受，文件替换和同句柄变化仍会拒绝。"""
        with patch.object(sys, "path", [str(self.root / ".trellis/scripts"), *sys.path]):
            policy = runpy.run_path(str(SOURCE))
        material = self.root / "state.json"
        data = b"{}"
        material.write_bytes(data)
        info = material.lstat()
        fields = ("st_dev", "st_ino", "st_mode", "st_size", "st_mtime_ns", "st_ctime_ns")
        values = {field: getattr(info, field) for field in fields}
        opened = SimpleNamespace(**{**values, "st_ctime_ns": info.st_ctime_ns + 1})
        replaced = SimpleNamespace(**{**vars(opened), "st_ino": info.st_ino + 1})
        changed = SimpleNamespace(**{**vars(opened), "st_ctime_ns": opened.st_ctime_ns + 1})

        for read, expected in ((policy["_bytes"], data), (policy["_fingerprint"], hashlib.sha256(data).hexdigest())):
            with self.subTest(read=read.__name__), patch.object(sys, "platform", "win32"):
                with patch.object(os, "fstat", return_value=opened):
                    self.assertEqual(read(material), expected)
                with patch.object(os, "fstat", return_value=replaced):
                    with self.assertRaisesRegex(ValueError, "打开时已变化"):
                        read(material)
                with patch.object(os, "fstat", side_effect=[opened, changed]):
                    with self.assertRaisesRegex(ValueError, "读取期间已变化"):
                        read(material)


if __name__ == "__main__":
    unittest.main()
