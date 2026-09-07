"""验证项目版本未知不会触发阻塞式更新提示。"""

import importlib.util
import io
import json
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock


class FlowerUpdateHookTest(unittest.TestCase):
    """使用真实 hook 主函数和隔离查询结果验证输出。"""

    def test_unknown_is_silent_and_real_updates_remain_actionable(self) -> None:
        """未知保持静默，真实全局和项目更新继续输出上下文。"""
        script = Path(__file__).resolve().parents[2] / "src/assets/flower_update_hook.py"
        spec = importlib.util.spec_from_file_location("flower_update_hook_test", script)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        for status in ("project_unknown", "update_available", "project_out_of_sync"):
            with self.subTest(status=status):
                output = io.StringIO()
                with mock.patch.object(module, "_run_self_check", return_value={"status": status}), mock.patch("sys.stdin", io.StringIO("{}")), redirect_stdout(output):
                    module.main()
                if status == "project_unknown":
                    self.assertEqual(output.getvalue(), "")
                else:
                    self.assertIn("<flower-update>", json.loads(output.getvalue())["hookSpecificOutput"]["additionalContext"])
