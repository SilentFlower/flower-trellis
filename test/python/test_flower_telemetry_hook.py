"""验证静默活动 hook、跨日提示和 Python/Node 配置目录一致性。"""

import io
import json
import os
import subprocess
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
SPEC = spec_from_file_location("flower_telemetry", ROOT / "src/assets/flower_telemetry_hook.py")
HOOK = module_from_spec(SPEC)
SPEC.loader.exec_module(HOOK)


class TelemetryHookTest(unittest.TestCase):
    """输入内容始终留在宿主，只有固定平台和本地路径进入采集命令。"""

    def setUp(self):
        """准备隔离配置。"""
        temporary = tempfile.TemporaryDirectory(prefix="flower-activity-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.env = {"XDG_CONFIG_HOME": str(self.root / "config")}

    def run_hook(self, event="SessionStart", platform="codex", env=None):
        """用受控 subprocess 验证入口参数与静默输出。"""
        with patch.dict(os.environ, env or self.env, clear=True), \
             patch.object(HOOK.sys, "argv", ["hook", "--platform", platform]), \
             patch.object(HOOK.sys, "stdin", io.StringIO(json.dumps({"hook_event_name": event, "cwd": str(self.root), "prompt": "private content", "session_id": "private id"}))), \
             patch.object(HOOK.sys, "stdout", io.StringIO()) as stdout, \
             patch.object(HOOK.sys, "stderr", io.StringIO()) as stderr, \
             patch.object(HOOK.shutil, "which", return_value="/fixture/flower-trellis"), \
             patch.object(HOOK.subprocess, "run") as run:
            HOOK.main()
            self.assertEqual(stdout.getvalue(), "")
            self.assertEqual(stderr.getvalue(), "")
            return run

    def test_events_and_disable(self):
        """明确平台和支持事件才调用 Node，开关与非交互保持零调用。"""
        for platform in ["claude", "codex"]:
            for event in ["SessionStart", "UserPromptSubmit"]:
                run = self.run_hook(event, platform)
                self.assertEqual(run.call_args.args[0], ["/fixture/flower-trellis", "telemetry", "record-activity", platform, "--target", str(self.root)])
                self.assertEqual(run.call_args.kwargs["stdin"], subprocess.DEVNULL)
        self.run_hook("Stop").assert_not_called()
        self.run_hook(platform="cursor").assert_not_called()
        for key, value in [("FLOWER_NO_TELEMETRY", "1"), ("TRELLIS_HOOKS", "0"), ("TRELLIS_DISABLE_HOOKS", "1"), ("CODEX_NON_INTERACTIVE", "1")]:
            self.run_hook(env={**self.env, key: value}).assert_not_called()
        self.assertFalse((self.root / "config").exists())

    def test_daily_hint_retry_and_corruption(self):
        """同日到期 pending 仍可唤醒；跨日和损坏提示不阻止 Node 校验。"""
        directory = self.root / "config/flower-trellis"
        queue = directory / "telemetry-v2"
        queue.mkdir(parents=True)
        (directory / "telemetry.json").write_text('{"enabled":true}', encoding="utf-8")
        now = datetime.now(timezone.utc)
        key = now.date().isoformat() + ":codex"
        meta = {"hints": {key: {"event_id": "fixture"}}, "pending": 1, "nextRetryAt": (now + timedelta(minutes=5)).isoformat()}
        file = queue / "meta.json"
        file.write_text(json.dumps(meta), encoding="utf-8")
        self.run_hook().assert_not_called()
        meta["nextRetryAt"] = (now - timedelta(minutes=1)).isoformat()
        file.write_text(json.dumps(meta), encoding="utf-8")
        self.run_hook().assert_called_once()
        meta["hints"] = {(now - timedelta(days=1)).date().isoformat() + ":codex": {"event_id": "fixture"}}
        meta["pending"] = 0
        file.write_text(json.dumps(meta), encoding="utf-8")
        self.run_hook().assert_called_once()
        file.write_text("{broken", encoding="utf-8")
        self.run_hook().assert_called_once()
        self.assertEqual(file.read_text(), "{broken")

    def test_config_directory_contract(self):
        """真实 Node 目录函数对照 XDG 优先级、Windows APPDATA 与默认 home。"""
        module = (ROOT / "src/plugin/sources/user-source-store.js").as_uri()
        for environment in [self.env, {}]:
            script = f'import {{flowerConfigDirectory}} from {json.dumps(module)}; console.log(flowerConfigDirectory({json.dumps(environment)}));'
            result = subprocess.run(["node", "--input-type=module", "-e", script], capture_output=True, text=True, check=True)
            self.assertEqual(str(HOOK.config_directory(environment, HOOK.sys.platform, Path.home())), result.stdout.strip())
        self.assertEqual(HOOK.config_directory({"APPDATA": "C:/Users/test/AppData/Roaming"}, "win32", Path("C:/Users/test")), Path("C:/Users/test/AppData/Roaming/flower-trellis"))
        self.assertEqual(HOOK.config_directory({**self.env, "APPDATA": "ignored"}, "win32", self.root), self.root / "config/flower-trellis")


if __name__ == "__main__":
    unittest.main()
