"""确认迁移测试的隔离项目与可控原生客户端。"""

import copy
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path
from uuid import uuid4


ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / "src/assets"
if str(ASSETS) not in sys.path:
    sys.path.insert(0, str(ASSETS))

from flower_confirmation_runtime.store import ConfirmationStore
from flower_confirmation_runtime.runtime import inspect_confirmation, render_confirmation


def write_json(file, value):
    """在隔离路径保存 JSON。

    @param file: 目标 Path。
    @param value: 可序列化材料。
    @return: None。
    """
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")


class ProjectFixture:
    """实际安装 Python 资产和策略的最小隔离项目。"""

    def __init__(self, testcase, platform="codex"):
        """创建项目并登记清理。

        @param testcase: unittest 用例。
        @param platform: 原生平台。
        @return: None。
        """
        temporary = tempfile.TemporaryDirectory(prefix="flower-python-确认 ")
        testcase.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.scripts = self.root / ".trellis/scripts"
        self.scripts.mkdir(parents=True)
        for name in ("flower_confirmation.py", "flower_confirmation_hook.py", "flower_tui_lifetime.py"):
            shutil.copy2(ASSETS / name, self.scripts / name)
        shutil.copytree(ASSETS / "flower_confirmation_runtime", self.scripts / "flower_confirmation_runtime",
                        ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
        shutil.copytree(ROOT / ".trellis/scripts/common", self.scripts / "common", ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
        shutil.copy2(ROOT / "vendor/skill-garden/.trellis/0.6/scripts/confirmation_policy.py", self.scripts / "confirmation_policy.py")
        self.session = str(uuid4())
        self.task = ".trellis/tasks/test"
        self.platform = platform
        task = self.root / self.task
        task.mkdir(parents=True)
        write_json(task / "task.json", {"name": "test", "status": "planning"})
        for name in ("prd.md", "design.md", "implement.md", "brief.md"):
            (task / name).write_text("# 确认材料\n\n完整正文。", encoding="utf-8")
        write_json(self.root / (".trellis/.runtime/sessions/" + platform + "_" + self.session + ".json"), {"current_task": self.task})
        (self.root / ".trellis/config.yaml").write_text("session_auto_commit: false\n", encoding="utf-8")
        (self.root / ".gitignore").write_text(".trellis/.runtime/\n", encoding="utf-8")
        self.input = ".trellis/.runtime/input.json"
        self.material = {"kind": "brief", "task": self.task}
        self.save()
        self.store = ConfirmationStore(self.root, self.session, platform)
        self.client = FakeClient(self.store)
        self.store.update(lambda old: {"version": 2, "sessionId": self.session, "generation": 0,
                                      "lastHumanMessageId": None, "request": None,
                                      "native": {"version": 1, "project": str(self.root), "sessionId": self.session,
                                                 "runId": self.client.run_id, "tasks": {}}})
        self.env = {key: value for key, value in os.environ.items() if key not in ("CODEX_THREAD_ID", "CLAUDE_CODE_SESSION_ID")}
        self.env.update(PYTHONDONTWRITEBYTECODE="1", FLOWER_NO_TELEMETRY="1", CODEX_HOME=str(self.root / "isolated-codex-home"))

    def save(self):
        """保存当前材料。

        @return: None。
        """
        write_json(self.root / self.input, self.material)


class FakeClient:
    """仅供状态机行为测试的可控原生边界。"""

    delivery_on_exit = True

    def __init__(self, store):
        """建立消息和回合基线。

        @param store: 隔离状态存储。
        @return: None。
        """
        self.store = store
        self.human = str(uuid4())
        self.turn = {"id": str(uuid4()), "status": "inProgress"}
        self.run_id = str(uuid4())
        self.added = []
        self.removed = []
        self.text = None
        self.window_valid = True

    def snapshot(self):
        """返回可控的精确快照。

        @return: 人工基线、回合、唤醒和运行身份。
        """
        request = (self.store.read() or {}).get("request") or {}
        return {"humanId": self.human, "turn": copy.deepcopy(self.turn), "runId": self.run_id,
                "wake": {"requestId": request.get("id"), "turnId": self.turn["id"]},
                "notification": {"requestId": request.get("id"), "taskId": "queue", "promptId": self.turn["id"]}}

    def capture_window(self, turn_id):
        """返回窗口夹具。

        @param turn_id: 当前回合。
        @return: 冻结窗口标识。
        """
        return {"version": 1, "origin": "http://127.0.0.1:1", "pid": 123}

    def verify_window(self, binding):
        """触发可控窗口失效。

        @param binding: 冻结窗口。
        @return: None。
        """
        if not self.window_valid:
            raise ValueError("原前台窗口已经失效")

    def observe_window(self, binding):
        """核对测试窗口。

        @param binding: 冻结窗口。
        @return: None。
        """
        self.verify_window(binding)

    def assistant_text(self, turn_id):
        """提供原回合展示。

        @param turn_id: 原回合。
        @return: 展示正文。
        """
        contract = self.store.read()["request"]["contract"]
        return self.text if self.text is not None else render_confirmation(
            inspect_confirmation(self.store, contract["input"], contract.get("secondsOverride")))

    def add(self, request_id):
        """记录单次投递。

        @param request_id: 请求。
        @return: 队列回执。
        """
        self.added.append(request_id)
        return {"id": "queue"}

    def remove(self, queue_id):
        """记录撤回。

        @param queue_id: 队列项。
        @return: deleted。
        """
        self.removed.append(queue_id)
        return "deleted"
