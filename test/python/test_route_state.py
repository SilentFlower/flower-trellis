"""route_state.py 历史检查 mode 兼容测试。"""

from __future__ import annotations

from importlib import util as importlib_util
from pathlib import Path
import unittest


PROJECT_ROOT = Path(__file__).resolve().parents[2]
SOURCE_HELPER = (
    PROJECT_ROOT
    / "vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-route/scripts/route_state.py"
)


class RouteStateCompatibilityTest(unittest.TestCase):
    """验证历史轻量 route 只做兼容归一化，不再绕过 Check-All。"""

    @classmethod
    def setUpClass(cls) -> None:
        """加载 route_state helper 模块。"""
        spec = importlib_util.spec_from_file_location("route_state_compat_test", SOURCE_HELPER)
        if spec is None or spec.loader is None:
            raise RuntimeError("无法加载 route_state.py")
        cls.module = importlib_util.module_from_spec(spec)
        spec.loader.exec_module(cls.module)

    def test_legacy_check_modes_normalize_to_check_all(self) -> None:
        """旧 inline/subagent check mode 必须映射到统一 Check-All 入口。"""
        self.assertEqual(
            self.module._normalize_mode("check", "check-inline"),
            "check-all-inline",
        )
        self.assertEqual(
            self.module._normalize_mode("check", "check-subagent"),
            "check-all-subagent",
        )

    def test_legacy_runtime_decision_returns_canonical_mode(self) -> None:
        """旧 runtime decision 校验成功后只暴露 canonical mode。"""
        decision = {
            "target": "check",
            "mode": "check-inline",
            "source": "trellis-route",
            "scope": "task",
            "task": ".trellis/tasks/example",
        }

        normalized = self.module._normalized_decision(
            decision,
            "check",
            ".trellis/tasks/example",
        )

        self.assertIsNotNone(normalized)
        self.assertEqual(normalized["mode"], "check-all-inline")
        self.assertEqual(decision["mode"], "check-inline")


if __name__ == "__main__":
    unittest.main()
