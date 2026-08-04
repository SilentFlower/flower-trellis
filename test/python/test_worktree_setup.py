"""worktree_setup.py linked worktree 入口投影测试。"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "vendor/skill-garden/.trellis/0.6/scripts/worktree_setup.py"


class WorktreeSetupTest(unittest.TestCase):
    """验证 linked worktree 的 Trellis 入口准备。"""

    def setUp(self) -> None:
        """创建带 linked worktree 的隔离 Git 仓库。"""
        self.temp = tempfile.TemporaryDirectory(prefix="flower-worktree-")
        self.base = Path(self.temp.name)
        self.main = self.base / "main"
        self.linked = self.base / "linked"
        self.main.mkdir()
        self._git(self.main, "init")
        self._git(self.main, "config", "user.email", "test@example.invalid")
        self._git(self.main, "config", "user.name", "Test User")
        (self.main / "README.md").write_text("main\n", encoding="utf-8")
        self._git(self.main, "add", "README.md")
        self._git(self.main, "commit", "-m", "init")
        self._git(self.main, "worktree", "add", "--detach", str(self.linked), "HEAD")
        self._install_trellis_entries()

    def tearDown(self) -> None:
        """删除隔离仓库。"""
        self.temp.cleanup()

    def _git(self, cwd: Path, *args: str) -> subprocess.CompletedProcess[str]:
        """运行 Git 命令。"""
        return subprocess.run(
            ["git", "-C", str(cwd), *args],
            text=True,
            capture_output=True,
            check=True,
        )

    def _install_trellis_entries(self) -> None:
        """在主 worktree 创建未追踪的 Trellis / 平台入口。"""
        scripts = self.main / ".trellis/scripts"
        scripts.mkdir(parents=True)
        shutil.copy2(SOURCE, scripts / "worktree_setup.py")
        (self.main / ".agents/skills/example").mkdir(parents=True)
        (self.main / ".agents/skills/example/SKILL.md").write_text(
            "---\nname: example\ndescription: example\n---\n",
            encoding="utf-8",
        )
        (self.main / ".codex").mkdir()
        (self.main / ".codex/hooks.json").write_text("{}\n", encoding="utf-8")
        (self.main / ".claude").mkdir()
        (self.main / ".claude/settings.json").write_text("{}\n", encoding="utf-8")

    def _helper(
        self,
        command: str,
        *,
        target: Path | None = None,
        check: bool = True,
    ) -> tuple[subprocess.CompletedProcess[str], dict]:
        """运行 worktree_setup helper 并解析 JSON。"""
        result = subprocess.run(
            [
                sys.executable,
                str(self.main / ".trellis/scripts/worktree_setup.py"),
                command,
                "--target",
                str(target or self.linked),
                "--json",
            ],
            cwd=self.main,
            text=True,
            capture_output=True,
            check=False,
        )
        payload = json.loads(result.stdout)
        if check and result.returncode != 0:
            self.fail(f"helper failed: {payload}\n{result.stderr}")
        return result, payload

    def test_prepare_projects_missing_entries_and_is_idempotent(self) -> None:
        """缺失入口会被 symlink 投影，重复 prepare 不再写盘。"""
        _, status = self._helper("status")
        self.assertEqual(status["status"], "needs-prepare")
        self.assertEqual(
            {item["path"] for item in status["actions"]},
            {".trellis", ".agents", ".codex", ".claude"},
        )

        _, prepared = self._helper("prepare")
        self.assertEqual(prepared["status"], "prepared")
        self.assertTrue(prepared["changed"])
        self.assertEqual(
            set(prepared["changedLinks"]),
            {".trellis", ".agents", ".codex", ".claude"},
        )
        for rel_path in (".trellis", ".agents", ".codex", ".claude"):
            target = self.linked / rel_path
            self.assertTrue(target.is_symlink(), rel_path)
            self.assertEqual(target.resolve(), (self.main / rel_path).resolve())

        manifest = json.loads((self.linked / ".trellis-worktree.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest["schemaVersion"], 1)
        self.assertEqual(manifest["sourceRoot"], str(self.main.resolve()))
        self.assertEqual(manifest["targetRoot"], str(self.linked.resolve()))

        _, ready = self._helper("prepare")
        self.assertEqual(ready["status"], "ready")
        self.assertFalse(ready["changed"])
        self.assertFalse(ready["changedLinks"])
        self.assertFalse(ready["manifestWritten"])

    def test_existing_user_platform_dir_blocks_prepare(self) -> None:
        """已有用户平台目录时拒绝覆盖且不做部分写入。"""
        (self.linked / ".codex").mkdir()

        _, status = self._helper("status")
        self.assertEqual(status["status"], "blocked")
        self.assertEqual(status["conflicts"][0]["path"], ".codex")

        result, payload = self._helper("prepare", check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(payload["reason"], "projection-conflict")
        self.assertFalse((self.linked / ".trellis").exists())
        self.assertFalse((self.linked / ".agents").exists())
        self.assertFalse((self.linked / ".claude").exists())

    def test_non_git_target_reports_error(self) -> None:
        """非 Git worktree 不被误判为可准备。"""
        other = self.base / "plain"
        other.mkdir()

        result, payload = self._helper("status", target=other, check=False)

        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(payload["reason"], "not-git-worktree")

    def test_main_worktree_is_ready_without_projection(self) -> None:
        """主 worktree 自身已有 .trellis 时不创建 manifest。"""
        _, payload = self._helper("prepare", target=self.main)

        self.assertEqual(payload["status"], "ready")
        self.assertFalse(payload["changed"])
        self.assertFalse((self.main / ".trellis-worktree.json").exists())


if __name__ == "__main__":
    unittest.main()
