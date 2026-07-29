"""验证默认 Session Context 不再使用旧 Trellis 更新 marker。"""

from __future__ import annotations

from contextlib import redirect_stdout
from io import StringIO
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_DIR = ROOT / ".trellis/scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from common import session_context


class SessionContextUpdateMarkerTest(unittest.TestCase):
    """验证文本上下文只输出项目状态，不创建更新检查 marker。"""

    def setUp(self) -> None:
        """创建隔离项目目录。"""
        self.temp = tempfile.TemporaryDirectory(prefix="flower-update-marker-")
        self.root = Path(self.temp.name)
        self.runtime = self.root / ".trellis/.runtime"

    def tearDown(self) -> None:
        """删除隔离项目目录。"""
        self.temp.cleanup()

    def test_output_text_does_not_create_update_marker(self) -> None:
        """默认文本上下文不执行旧更新检查，也不创建 marker。"""
        output = StringIO()
        with (
            mock.patch.object(
                session_context,
                "get_context_text",
                return_value="SESSION CONTEXT",
            ) as get_context_text,
            redirect_stdout(output),
        ):
            session_context.output_text(self.root)

        get_context_text.assert_called_once_with(self.root)
        self.assertEqual(output.getvalue(), "SESSION CONTEXT\n")
        self.assertFalse(self.runtime.exists())

    def test_legacy_update_helpers_are_removed(self) -> None:
        """旧 Trellis 版本提示和 marker helper 不再暴露。"""
        for name in (
            "_get_update_hint",
            "_mark_update_check_attempted",
            "_update_marker_path",
        ):
            with self.subTest(name=name):
                self.assertFalse(hasattr(session_context, name))


if __name__ == "__main__":
    unittest.main()
