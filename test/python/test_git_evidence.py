"""多仓 Git 证据失败边界测试。"""

from __future__ import annotations

import importlib.util
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "vendor/skill-garden/.trellis/0.6/scripts/git_evidence.py"
COMMON_SCRIPTS = ROOT / ".trellis/scripts"


def _load_module():
    """加载真实 Git evidence helper。

    Returns:
        已加载的 helper 模块。
    """
    spec = importlib.util.spec_from_file_location("git_evidence_failure_test", SOURCE)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.path.insert(0, str(COMMON_SCRIPTS))
    try:
        spec.loader.exec_module(module)
    finally:
        sys.path.remove(str(COMMON_SCRIPTS))
    return module


class GitEvidenceFailureTest(unittest.TestCase):
    """验证仓库集合读取不完整时 fail closed。"""

    def setUp(self) -> None:
        """创建最小 Trellis Git 仓库。"""
        self.temp = tempfile.TemporaryDirectory(prefix="flower-git-evidence-")
        self.root = Path(self.temp.name)
        (self.root / ".trellis").mkdir()
        subprocess.run(["git", "init", "-q"], cwd=self.root, check=True)
        self.module = _load_module()

    def tearDown(self) -> None:
        """删除临时仓库。"""
        self.temp.cleanup()

    def test_submodule_discovery_failure_blocks_repository_set(self) -> None:
        """递归 submodule 查询失败时不得静默退化为根仓。"""
        original = self.module._run_git

        def run_git(repo: Path, args: list[str]):
            if args[:2] == ["submodule", "foreach"]:
                return subprocess.CompletedProcess(["git", *args], 1, b"", b"submodule failed")
            return original(repo, args)

        with mock.patch.object(self.module, "_run_git", side_effect=run_git):
            with self.assertRaises(self.module.GitEvidenceError) as raised:
                self.module.discover_git_repositories(self.root)

        self.assertEqual(raised.exception.reason, "git-submodule-unreadable")

    def test_configured_package_must_be_independent_repository_root(self) -> None:
        """git:true package 解析到父仓时必须拒绝。"""
        package = self.root / "packages/api"
        package.mkdir(parents=True)
        (self.root / ".trellis/config.yaml").write_text(
            "packages:\n  api:\n    path: packages/api\n    git: true\n",
            encoding="utf-8",
        )

        with self.assertRaises(self.module.GitEvidenceError) as raised:
            self.module.discover_git_repositories(self.root)

        self.assertEqual(raised.exception.reason, "git-package-unreadable")

    def test_integration_state_read_failure_blocks_evidence(self) -> None:
        """Git 目录不可读时不得把集成状态当作 clean。"""
        failed = subprocess.CompletedProcess(["git"], 1, b"", b"git dir failed")
        with mock.patch.object(self.module, "_run_git", return_value=failed):
            with self.assertRaises(self.module.GitEvidenceError) as raised:
                self.module.integration_in_progress(self.root)

        self.assertEqual(raised.exception.reason, "git-integration-state-unreadable")


if __name__ == "__main__":
    unittest.main()
