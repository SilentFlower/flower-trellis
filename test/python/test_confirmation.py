"""验证确认策略、材料绑定与Git基线；不执行真实项目的业务动作。"""
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / ".trellis/scripts"))
SCRIPT = ROOT / "vendor/skill-garden/.trellis/0.6/scripts/confirmation.py"
SPEC = importlib.util.spec_from_file_location("confirmation_under_test", SCRIPT)
confirmation = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(confirmation)


class ConfirmationPolicyTests(unittest.TestCase):
    """覆盖时长边界与字符串配置的真实读取。"""

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        (self.root / ".trellis").mkdir()

    def write_config(self, text):
        (self.root / ".trellis/config.yaml").write_text(text, encoding="utf-8")

    def test_default_boundaries(self):
        policy = confirmation.read_policy(self.root)
        for length, expected in [(1000, 100), (1001, 130), (1500, 130), (1501, 160)]:
            self.assertEqual(confirmation.calculate_seconds(policy, "brief", "字" * length + "\n", []), expected)
        for ids, expected in [([], 0), (["CHK-1"], 100), (["CHK-1", "CHK-2"], 130), (["CHK-1", "CHK-1"], 100)]:
            self.assertEqual(confirmation.calculate_seconds(policy, "check", "", ids), expected)
        self.assertEqual(confirmation.calculate_seconds(policy, "push", "", []), 200)

    def test_independent_switches_and_seconds(self):
        self.write_config("confirmation_timeout:\n  brief:\n    enabled: false\n  check:\n    base_seconds: 120\n  push:\n    seconds: 240\n")
        policy = confirmation.read_policy(self.root)
        self.assertEqual(confirmation.calculate_seconds(policy, "brief", "字", []), 0)
        self.assertEqual(confirmation.calculate_seconds(policy, "check", "", ["CHK-1"]), 120)
        self.assertEqual(confirmation.calculate_seconds(policy, "push", "", []), 240)
        self.write_config("confirmation_timeout:\n  enabled: false\n")
        self.assertEqual(confirmation.calculate_seconds(confirmation.read_policy(self.root), "push", "", []), 0)

    def test_malformed_configuration_never_becomes_enabled(self):
        for text in ["broken yaml", "confirmation_timeout: false", "confirmation_timeout:\n  enabled: maybe\n",
                     "confirmation_timeout:\n  enabled false\n", "confirmation_timeout:\n\tenabled: false\n",
                     "confirmation_timeout:\n  enabled: false\n  enabled: true\n",
                     "confirmation_timeout:\n  push:\n    seconds: -1\n",
                     "confirmation_timeout:\n  typo: true\n"]:
            with self.subTest(text=text):
                self.write_config(text)
                with self.assertRaises(ValueError):
                    confirmation.read_policy(self.root)

    def task(self):
        task = self.root / ".trellis/tasks/current"
        task.mkdir(parents=True)
        (task / "task.json").write_text('{"status":"planning"}', encoding="utf-8")
        (task / "prd.md").write_text("已确认需求", encoding="utf-8")
        (task / "brief.md").write_text("完整方案", encoding="utf-8")
        sessions = self.root / ".trellis/.runtime/sessions"
        sessions.mkdir(parents=True)
        (sessions / "codex_main.json").write_text(json.dumps({"current_task": ".trellis/tasks/current"}), encoding="utf-8")
        return task

    def test_material_change_and_task_switch_invalidate_revision(self):
        task = self.task()
        spec = {"kind": "brief", "file": ".trellis/tasks/current/brief.md"}
        first = confirmation.build_snapshot(self.root, spec, "codex_main")
        (task / "brief.md").write_text("新的完整方案", encoding="utf-8")
        second = confirmation.build_snapshot(self.root, spec, "codex_main")
        self.assertNotEqual(first["revision"], second["revision"])
        with self.assertRaises(ValueError):
            confirmation.build_snapshot(self.root, spec, "codex_other")
        (task / "task.json").write_text('{"status":"in_progress"}', encoding="utf-8")
        with self.assertRaises(ValueError):
            confirmation.build_snapshot(self.root, spec, "codex_main")

    def test_terminal_controls_and_outside_files_are_rejected(self):
        task = self.task()
        spec = {"kind": "brief", "file": ".trellis/tasks/current/brief.md"}
        (task / "brief.md").write_text("危险\x1b[2J", encoding="utf-8")
        with self.assertRaises(ValueError):
            confirmation.build_snapshot(self.root, spec, "codex_main")
        with self.assertRaises(ValueError):
            confirmation.build_snapshot(self.root, {"kind": "check", "file": "../outside"}, "codex_main")
        (task / "brief.md").write_text("危险\x9b2J", encoding="utf-8")
        with self.assertRaises(ValueError):
            confirmation.build_snapshot(self.root, spec, "codex_main")

    def test_runtime_material_is_data_only_and_cannot_escape(self):
        result = confirmation.materialize(self.root, "完整报告 CHK-1\n")
        file = self.root / result["file"]
        self.assertTrue(result["file"].startswith(".trellis/.runtime/confirmations/materials/"))
        self.assertEqual(file.read_text(encoding="utf-8"), "完整报告 CHK-1\n")
        self.assertEqual(set(result), {"file"})
        with self.assertRaises(ValueError):
            confirmation.materialize(self.root, "   ")

    def test_report_items_are_unique_and_must_exist(self):
        (self.root / "report.md").write_text("CHK-1 待修复\nCHK-2 待修复", encoding="utf-8")
        spec = {"kind": "check", "file": "report.md", "problem_ids": ["CHK-1", "CHK-1", "CHK-2"]}
        self.assertEqual(confirmation.build_snapshot(self.root, spec, "codex_main")["seconds"], 130)
        with self.assertRaises(ValueError):
            confirmation.build_snapshot(self.root, {**spec, "problem_ids": ["CHK-99"]}, "codex_main")
        (self.root / "report.md").write_text("CHK-10 待修复", encoding="utf-8")
        with self.assertRaises(ValueError):
            confirmation.build_snapshot(self.root, {**spec, "problem_ids": ["CHK-1"]}, "codex_main")

    def test_git_file_content_index_and_mode_are_bound(self):
        def git(*args):
            subprocess.run(["git", *args], cwd=str(self.root), check=True, capture_output=True)
        git("init", "--quiet")
        git("config", "user.name", "确认测试")
        git("config", "user.email", "confirmation@example.invalid")
        (self.root / "code.txt").write_text("初始", encoding="utf-8")
        git("add", "code.txt")
        git("commit", "--quiet", "-m", "测试基线")
        (self.root / "plan.md").write_text("提交code.txt", encoding="utf-8")
        spec = {"kind": "push", "file": "plan.md", "git_paths": ["code.txt"], "mode": "commit-only"}
        first = confirmation.build_snapshot(self.root, spec, "codex_main")
        self.assertIn("仅本地提交", first["display"])
        (self.root / "code.txt").write_text("已修改", encoding="utf-8")
        second = confirmation.build_snapshot(self.root, spec, "codex_main")
        self.assertNotEqual(first["revision"], second["revision"])
        git("add", "code.txt")
        third = confirmation.build_snapshot(self.root, spec, "codex_main")
        self.assertNotEqual(second["revision"], third["revision"])
        fourth = confirmation.build_snapshot(self.root, {**spec, "mode": "push"}, "codex_main")
        self.assertNotEqual(third["revision"], fourth["revision"])
        git("config", "remote.origin.url", "https://example.invalid/changed.git")
        fifth = confirmation.build_snapshot(self.root, spec, "codex_main")
        self.assertNotEqual(third["revision"], fifth["revision"])
        git_path = subprocess.run(["git", "rev-parse", "--git-path", "MERGE_HEAD"], cwd=str(self.root),
                                  capture_output=True, check=True).stdout.decode().strip()
        (self.root / git_path).write_text("a" * 40 + "\n", encoding="utf-8")
        sixth = confirmation.build_snapshot(self.root, spec, "codex_main")
        self.assertNotEqual(fifth["revision"], sixth["revision"])

    def test_all_repository_scopes_are_frozen_in_order(self):
        repositories = []
        for name in ("主仓", "子仓"):
            directory = self.root / name
            directory.mkdir()
            def git(*args):
                return subprocess.run(["git", *args], cwd=str(directory), check=True, capture_output=True)
            git("init", "--quiet")
            git("config", "user.name", "确认测试")
            git("config", "user.email", "confirmation@example.invalid")
            (directory / "文件.txt").write_text("基线", encoding="utf-8")
            git("add", "文件.txt")
            git("commit", "--quiet", "-m", "测试基线")
            repositories.append({"root": name, "git_paths": ["文件.txt"]})
        (self.root / "plan.md").write_text("完整双仓计划", encoding="utf-8")
        spec = {"kind": "push", "file": "plan.md", "mode": "push", "repositories": repositories}
        first = confirmation.build_snapshot(self.root, spec, "codex_main")
        self.assertLess(first["display"].index("主仓"), first["display"].index("子仓"))
        (self.root / "子仓/文件.txt").write_text("改变子仓内容", encoding="utf-8")
        second = confirmation.build_snapshot(self.root, spec, "codex_main")
        self.assertNotEqual(first["revision"], second["revision"])
        with self.assertRaises(ValueError):
            confirmation.build_snapshot(self.root, {**spec, "repositories": [repositories[0], repositories[0]]}, "codex_main")


if __name__ == "__main__":
    unittest.main()
