"""Claude 原生事件、精确后台任务与 transcript 来源校验。"""

from __future__ import annotations

import json
import re
import shlex
import stat
import sys
from pathlib import Path
from uuid import uuid4

from .store import ACTIVE, ConfirmationStore, confirmation_id, now_ms, wake_message


def _task_notice(text):
    if not isinstance(text, str) or not text.startswith("<task-notification>\n") or not text.endswith("\n</task-notification>"):
        return None
    matches = re.findall(r"<task-id>([A-Za-z0-9_-]{1,100})</task-id>", text)
    return matches[0] if len(matches) == 1 else None


def _wait_command(command, project, session_id, request_id):
    if not isinstance(command, str):
        return False
    try:
        tokens = shlex.split(command)
        entry = next(index for index, token in enumerate(tokens)
                     if Path(token).name == "flower_confirmation.py")
        executable = Path(tokens[0]).name
        if not re.fullmatch(r"(?:python(?:[0-9]+(?:\.[0-9]+)*)?|py)", executable):
            return False
        prefix = tokens[1:entry]
        if prefix not in ([], ["-X", "utf8"], ["-3"], ["-3", "-X", "utf8"]):
            return False
        if (project / tokens[entry]).resolve(strict=True) != project / ".trellis/scripts/flower_confirmation.py":
            return False
        if tokens[entry + 1] != "wait":
            return False
        flags = tokens[entry + 2:]
        if len(flags) % 2:
            return False
        values = {}
        for index in range(0, len(flags), 2):
            key, value = flags[index:index + 2]
            if key not in ("--request", "--platform", "--session", "--target") or key in values:
                return False
            values[key] = value
        return (values.get("--request") == request_id and values.get("--platform", "claude") == "claude"
                and values.get("--session", session_id) == session_id
                and (project / values.get("--target", ".")).resolve(strict=True) == project)
    except (ValueError, OSError, StopIteration, IndexError):
        return False


def record_event(payload):
    """保存四类原生事件，内部通知在领取时再次核验来源。

    @param payload: 原始 Claude Hook JSON。
    @return: 空输出或本请求的原生唤醒上下文。
    """
    event = payload.get("hook_event_name")
    if event not in ("SessionStart", "UserPromptSubmit", "Stop", "SessionEnd"):
        return {}
    project = Path(payload["cwd"]).resolve(strict=True)
    if not (project / ".trellis/scripts/confirmation_policy.py").is_file():
        return {}
    session_id = confirmation_id(payload["session_id"])
    transcript = payload.get("transcript_path")
    if not isinstance(transcript, str) or Path(transcript).name != session_id + ".jsonl":
        raise ValueError("Claude 缺少精确会话记录路径")
    store = ConfirmationStore(project, session_id, "claude")
    reminders = []
    def apply(old):
        value = old or {"version": 2, "sessionId": session_id, "generation": 0, "lastHumanMessageId": None, "request": None}
        native = value.get("native") or {"version": 1, "project": str(project), "sessionId": session_id,
                                         "tasks": {}, "runId": str(uuid4())}
        if native.get("project") != str(project) or native.get("sessionId") != session_id:
            raise ValueError("Claude 事件会话或项目不符")
        native.update(transcript=transcript, at=now_ms())
        request = value.get("request")
        if event == "SessionStart":
            native.update(runId=str(uuid4()), ended=False, tasks={}, humanId=None, turn=None)
            value["generation"] += 1
            if request and request["state"] in ACTIVE:
                request.update(state="cancelled", error="session_restarted")
        elif event == "UserPromptSubmit":
            prompt_id = confirmation_id(payload.get("prompt_id"))
            task_id = _task_notice(payload.get("prompt"))
            owned = native.get("tasks", {}).get(task_id)
            native.update(turn={"id": prompt_id, "status": "inProgress"}, ended=False)
            if owned:
                native["notification"] = {"taskId": task_id, "requestId": owned, "promptId": prompt_id}
                reminders.append(wake_message(owned, "claude"))
            elif native.get("humanId") != prompt_id:
                native["humanId"] = prompt_id
                value["lastHumanMessageId"] = prompt_id
                value["generation"] += 1
                if request and request["state"] in ACTIVE:
                    request.update(state="cancelled", error="user_replied")
        elif event == "Stop":
            prompt_id = confirmation_id(payload.get("prompt_id"))
            text = payload.get("last_assistant_message")
            if not isinstance(text, str) or len(text.encode("utf-8")) > 512 * 1024:
                raise ValueError("Claude 最终展示正文不可核验")
            native["turn"] = {"id": prompt_id, "status": "completed"}
            native["display"] = {"turnId": prompt_id, "text": text, "at": native["at"]}
            for task in payload.get("background_tasks", []):
                if (not request or task.get("type") != "shell"
                        or not _wait_command(task.get("command"), project, session_id, request["id"])):
                    continue
                task_id = task.get("id")
                if not isinstance(task_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", task_id):
                    raise ValueError("Claude 原生任务 ID 无效")
                native["tasks"][task_id] = request["id"]
                request["nativeTaskId"] = task_id
            for identifier in list(native["tasks"])[:-8]:
                del native["tasks"][identifier]
        else:
            native["ended"] = True
            value["generation"] += 1
            if request and request["state"] in ACTIVE:
                request.update(state="cancelled", error="session_ended")
        value["native"] = native
        return value
    store.update(apply)
    return {"hookSpecificOutput": {"hookEventName": "UserPromptSubmit", "additionalContext": reminders[-1]}} if reminders else {}


class ClaudeClient:
    """观察精确原生 Hook 状态与会话记录。"""

    delivery_on_exit = True

    def __init__(self, project, session_id, platform=None):
        """创建精确会话适配器。

        @param project: 项目根。
        @param session_id: 原生会话 UUID。
        @param platform: 可注入的平台能力条件。
        @return: None。
        """
        if (platform or sys.platform) != "linux":
            raise ValueError("Claude 后台确认目前只验证 Linux/WSL")
        self.store = ConfirmationStore(project, session_id, "claude")
        self.project = self.store.project
        self.session_id = self.store.session_id

    def connect(self):
        """核对原生 Hook 和活动 runId。

        @return: None。
        """
        native = (self.store.read() or {}).get("native") or {}
        if (native.get("version") != 1 or native.get("project") != str(self.project)
                or native.get("sessionId") != self.session_id or native.get("ended")):
            raise ValueError("Claude 原生确认 Hook 不可用或会话已退出，保持人工确认")
        confirmation_id(native.get("runId"))
        self.snapshot()

    def snapshot(self):
        """核验有界 transcript 的真实人工和任务通知来源。

        @return: 人工基线、当前回合、通知和 runId。
        """
        native = (self.store.read() or {}).get("native") or {}
        if not native or native.get("ended"):
            raise ValueError("Claude 会话状态不可用")
        file = Path(native["transcript"])
        info = file.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_size > 16 * 1024 * 1024:
            raise ValueError("Claude 会话记录不可核验或超过预算")
        with file.open("rb") as stream:
            raw = stream.read(16 * 1024 * 1024 + 1)
        if len(raw) > 16 * 1024 * 1024:
            raise ValueError("Claude 会话记录超过预算")
        human_id = None
        notification = None
        for line in raw.split(b"\n")[:-1]:
            if not line.strip():
                continue
            entry = json.loads(line.decode("utf-8"))
            if entry.get("type") != "user" or entry.get("isSidechain") or entry.get("sessionId") != self.session_id:
                continue
            if (entry.get("origin") or {}).get("kind") == "human" and entry.get("turnOrigin") == "human":
                human_id = confirmation_id(entry.get("promptId"))
            elif (entry.get("origin") or {}).get("kind") == "task-notification" and entry.get("turnOrigin") == "task_notification":
                task_id = _task_notice((entry.get("message") or {}).get("content"))
                if task_id and native["tasks"].get(task_id):
                    notification = {"taskId": task_id, "requestId": native["tasks"][task_id], "promptId": entry.get("promptId")}
            elif isinstance((entry.get("message") or {}).get("content"), str) and not entry.get("isCompactSummary"):
                raise ValueError("Claude 消息来源字段不可核验，保持人工确认")
        if not human_id:
            raise ValueError("Claude 缺少真实人工输入基线；关闭记录的会话保持人工确认")
        hook_notice = native.get("notification") or {}
        pending = (hook_notice.get("promptId") == (native.get("turn") or {}).get("id")
                   and hook_notice.get("requestId") == native.get("tasks", {}).get(hook_notice.get("taskId"))
                   and bool(hook_notice.get("requestId"))
                   and (notification or {}).get("promptId") != hook_notice.get("promptId"))
        return {"humanId": human_id, "turn": native.get("turn"), "notification": notification,
                "notificationPending": pending, "runId": native.get("runId")}

    def assistant_text(self, turn_id):
        """读取 Stop 绑定的原始展示。

        @param turn_id: 原回合标识。
        @return: 完整最终正文。
        """
        display = ((self.store.read() or {}).get("native") or {}).get("display") or {}
        if display.get("turnId") != turn_id:
            raise ValueError("Claude 最终展示回合不符")
        return display["text"]

    def add(self, request_id):
        """返回 Stop 已绑定的本次后台任务。

        @param request_id: 请求 UUID。
        @return: 原生任务标识；worker 随后退出以触发通知。
        """
        request = (self.store.read() or {}).get("request") or {}
        if request.get("id") != request_id or not request.get("nativeTaskId"):
            raise ValueError("Claude 未绑定本次原生后台任务")
        return {"id": request["nativeTaskId"]}

    def remove(self, queue_id):
        """报告 Claude 原生完成通知的撤回边界。

        @param queue_id: 精确任务 ID。
        @return: not_retractable 或 not_pending。
        """
        return "not_retractable" if queue_id else "not_pending"

    def close(self):
        """结束本客户端的本次观察。

        @return: None。
        """
        return None
