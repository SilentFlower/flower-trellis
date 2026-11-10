"""Codex 精确会话、原生队列与冻结前台接入。"""

from __future__ import annotations

import json
import os
import re
import select
import stat
import sys
import time
from collections import OrderedDict
from pathlib import Path
from uuid import uuid4

from flower_tui_lifetime import bind_origin, check_binding, check_frontend_coverage, open_binding
from .store import ACTIVE, ConfirmationStore, confirmation_id, now_ms, wake_id, wake_message
from .transport import CodexTransport, RpcError


def record_event(payload):
    """原生人工输入进入模型前失效旧请求。

    @param payload: Codex Hook 原始 JSON。
    @return: 空 Hook 输出。
    """
    if payload.get("agent_id") or payload.get("hook_event_name") not in ("UserPromptSubmit", "Interrupt"):
        return {}
    project = Path(payload["cwd"]).resolve(strict=True)
    if not (project / ".trellis/scripts/confirmation_policy.py").is_file():
        return {}
    session_id = confirmation_id(payload["session_id"])
    store = ConfirmationStore(project, session_id, "codex")
    def apply(old):
        value = old or {"version": 2, "sessionId": session_id, "generation": 0,
                        "lastHumanMessageId": None, "request": None}
        value["native"] = {"version": 2, "project": str(project), "sessionId": session_id,
                           "at": now_ms(), "turnId": payload.get("turn_id")}
        request = value.get("request")
        internal = (payload["hook_event_name"] == "UserPromptSubmit" and request
                    and request["state"] in ("dispatching", "queued") and payload.get("prompt") == wake_message(request["id"]))
        # Hook 缺少 client_id，仅暂缓精确提醒取消；claim 仍核对原生记录来源。
        if not internal:
            value["generation"] += 1
            value["lastHumanMessageId"] = str(uuid4())
            if request and request["state"] in ACTIVE:
                request.update(state="cancelled", error="turn_interrupted" if payload["hook_event_name"] == "Interrupt" else "user_replied")
        return value
    store.update(apply)
    return {}


class CodexClient:
    """只观察原生精确会话，沿用当前共享服务和前台。"""

    delivery_on_exit = False

    def __init__(self, project, session_id, env=None, platform=None, timeout=5):
        """创建精确项目客户端。

        @param project: 项目根。
        @param session_id: 原生会话 UUID。
        @param env: 可注入的隔离宿主环境。
        @param platform: 平台覆盖，仅供能力分支测试。
        @param timeout: 原生 RPC 超时秒数。
        @return: None。
        """
        if (platform or sys.platform) != "linux":
            raise ValueError("后台确认目前只验证 Linux/WSL 的共享服务")
        self.project = Path(project).resolve(strict=True)
        self.session_id = confirmation_id(session_id)
        environment = os.environ if env is None else env
        self.home = Path(environment.get("CODEX_HOME") or (Path.home() / ".codex")).resolve(strict=True)
        self.transport = CodexTransport(self.home / "app-server-control/app-server-control.sock", timeout, self._notification)
        self.rollout = None
        self.humans = []
        self.seen = OrderedDict()
        self.window_fd = None
        self.window = None
        self.checked_at = 0

    def _notification(self, packet):
        params = packet.get("params") or {}
        item = params.get("item") or {}
        if (params.get("threadId") == self.session_id and packet.get("method") in ("item/started", "item/completed")
                and item.get("type") == "userMessage" and not wake_id(item) and item.get("id") not in self.seen):
            identifier = confirmation_id(item.get("id"))
            self.seen[identifier] = True
            self.humans.append(identifier)
            while len(self.seen) > 4096:
                self.seen.popitem(last=False)

    def connect(self):
        """连接已有原生服务。

        @return: None。
        """
        self.transport.connect()

    def rpc(self, method, params):
        """调用精确原生方法。

        @param method: 原生方法名。
        @param params: 准确参数。
        @return: 原生结果对象。
        """
        return self.transport.rpc(method, params)

    def snapshot(self):
        """被动读取精确线程及消息来源，观察前台退出。

        @return: 人工基线、当前回合及内部唤醒快照。
        """
        if self.window_fd is not None:
            poll = select.poll()
            poll.register(self.window_fd, select.POLLIN)
            if poll.poll(0):
                raise ValueError("frontend_exited")
            if time.monotonic() - self.checked_at >= 0.25:
                check_binding(self.window)
                self.checked_at = time.monotonic()
        thread = self.rpc("thread/read", {"threadId": self.session_id, "includeTurns": False})["thread"]
        if thread.get("id") != self.session_id or Path(thread["cwd"]).resolve(strict=True) != self.project:
            raise ValueError("Codex 目标会话或项目目录不匹配")
        if thread.get("archived") or (thread.get("status") or {}).get("type") == "systemError":
            raise ValueError("Codex 目标线程处于错误状态")
        record = self.read_rollout(thread.get("path"))
        if not record["humanId"]:
            raise ValueError("Codex 会话没有可核验的人工消息基线")
        self.seen[record["humanId"]] = True
        humans, self.humans = self.humans, []
        wake = record["wake"]
        if wake and wake["turnId"] != (record["turn"] or {}).get("id"):
            wake = None
        return {"humanId": record["humanId"], "humanEvents": humans, "turn": record["turn"],
                "status": thread.get("status"), "wake": wake}

    def read_rollout(self, filename):
        """按文件身份增量读取原生 JSONL，保留未完成行。

        @param filename: thread/read 返回的准确路径。
        @return: 有界消息来源和最终正文缓存。
        """
        if not isinstance(filename, str) or not Path(filename).name.endswith("-" + self.session_id + ".jsonl"):
            raise ValueError("Codex 未提供精确会话记录路径")
        file = Path(filename)
        info = file.lstat()
        try:
            file.resolve(strict=True).relative_to(self.home / "sessions")
        except ValueError:
            raise ValueError("Codex 会话记录路径越界")
        if not stat.S_ISREG(info.st_mode) or info.st_size > 128 * 1024 * 1024:
            raise ValueError("Codex 会话记录不可核验或超出预算")
        identity = (str(file), info.st_dev, info.st_ino)
        cached = self.rollout
        if cached and cached["identity"] == identity and cached["size"] == info.st_size and cached["modified"] == info.st_mtime_ns:
            return cached
        previous = cached if cached and cached["identity"] == identity and info.st_size > cached["size"] else None
        record = ({**previous, "displays": OrderedDict(previous["displays"])} if previous else
                  {"offset": 0, "verified": False, "humanId": None, "turn": None, "wake": None, "displays": OrderedDict()})
        with file.open("rb") as stream:
            stream.seek(record["offset"])
            while stream.tell() < info.st_size:
                raw = stream.readline(min(2 * 1024 * 1024 + 1, info.st_size - stream.tell()))
                if not raw:
                    raise ValueError("Codex 会话记录在读取期间截断")
                if len(raw) > 2 * 1024 * 1024:
                    raise ValueError("Codex 单条记录超出预算")
                if not raw.endswith(b"\n"):
                    break
                record["offset"] = stream.tell()
                if not raw.strip():
                    continue
                entry = json.loads(raw.decode("utf-8"))
                if entry.get("type") == "session_meta":
                    if (entry.get("payload") or {}).get("id") != self.session_id:
                        raise ValueError("Codex 会话记录标识不符")
                    record["verified"] = True
                if entry.get("type") != "event_msg":
                    continue
                event = entry.get("payload") or {}
                if event.get("thread_id") and event["thread_id"] != self.session_id:
                    raise ValueError("Codex 记录中混入其他会话事件")
                kind = event.get("type")
                if kind in ("task_started", "turn_started"):
                    record["turn"] = {"id": event.get("turn_id"), "status": "inProgress"}
                if kind in ("task_complete", "turn_complete") and event.get("turn_id") == (record["turn"] or {}).get("id"):
                    record["turn"]["status"] = "completed"
                if kind == "turn_aborted" and (not event.get("turn_id") or event["turn_id"] == (record["turn"] or {}).get("id")):
                    record["turn"] = {"id": (record["turn"] or {}).get("id"), "status": "interrupted"}
                if kind == "thread_rolled_back":
                    record.update(humanId=None, turn=None, wake=None)
                    record["displays"].clear()
                if kind != "item_completed":
                    continue
                item = event.get("item") or {}
                if item.get("type") == "UserMessage":
                    internal = wake_id({"type": "userMessage", "content": item.get("content"), "clientId": item.get("client_id")})
                    if internal:
                        record["wake"] = {"requestId": internal, "turnId": event.get("turn_id")}
                    else:
                        record["humanId"] = confirmation_id(item.get("id"))
                if item.get("type") == "AgentMessage" and item.get("phase") == "final_answer":
                    parts = item.get("content")
                    if not isinstance(parts, list) or any(part.get("type") != "Text" or not isinstance(part.get("text"), str) for part in parts):
                        raise ValueError("Codex 最终正文结构不可核验")
                    turn_id = event.get("turn_id")
                    record["displays"][turn_id] = record["displays"].get(turn_id, "") + "".join(part["text"] for part in parts)
                    while len(record["displays"]) > 8:
                        record["displays"].popitem(last=False)
        if not record["verified"]:
            raise ValueError("Codex 缺少原生会话身份记录")
        record.update(identity=identity, size=info.st_size, modified=info.st_mtime_ns)
        self.rollout = record
        return record

    def assistant_text(self, turn_id):
        """读取原展示回合的最终正文。

        @param turn_id: 原展示回合。
        @return: 完整正文。
        """
        snapshot = self.snapshot()
        self.humans[:0] = snapshot.get("humanEvents", [])
        if turn_id not in self.rollout["displays"]:
            raise ValueError("Codex 原始最终展示不存在")
        return self.rollout["displays"][turn_id]

    def _origin(self):
        result = self.rpc("mcpServerStatus/list", {"threadId": self.session_id, "serverName": "codex_tui",
                                                  "detail": "toolsAndAuthOnly", "limit": 5})
        servers = [value for value in result.get("data", []) if value.get("name") == "codex_tui"]
        if (result.get("nextCursor") or len(servers) != 1 or servers[0].get("runtimeStatus") != "connected"
                or not re.fullmatch(r"http://(?:127\.0\.0\.1|\[::1\]):[1-9][0-9]{0,4}", servers[0].get("httpOrigin", ""))):
            raise ValueError("当前会话缺少唯一可核验的原生 TUI 服务，保持人工确认")
        return servers[0]["httpOrigin"]

    def _coverage(self):
        result = self.rpc("thread/loaded/list", {"limit": 1000})
        threads = result.get("data")
        if result.get("nextCursor") or not isinstance(threads, list) or not 0 < len(threads) <= 1000:
            raise ValueError("无法核验全部已加载原生会话")
        origins = set()
        for thread_id in threads:
            current = self.rpc("mcpServerStatus/list", {"threadId": thread_id, "serverName": "codex_tui", "detail": "toolsAndAuthOnly", "limit": 5})
            if current.get("nextCursor"):
                raise ValueError("原生 TUI 来源超出核验预算")
            origins.update(value["httpOrigin"] for value in current.get("data", [])
                           if value.get("name") == "codex_tui" and value.get("runtimeStatus") == "connected" and value.get("httpOrigin"))
        check_frontend_coverage(list(origins))

    def capture_window(self, turn_id):
        """从当前输入 Hook 和实际监听者冻结前台身份。

        @param turn_id: 当前活动回合。
        @return: 原窗口出生身份。
        """
        native = (ConfirmationStore(self.project, self.session_id, "codex").read() or {}).get("native") or {}
        if (native.get("version") != 2 or native.get("project") != str(self.project)
                or native.get("sessionId") != self.session_id or not turn_id or native.get("turnId") != turn_id):
            raise ValueError("当前会话尚未收到确认输入 Hook，重开原生客户端后使用；本次保持人工确认")
        origin = self._origin()
        binding = bind_origin(origin)
        if self._origin() != origin:
            raise ValueError("准备期间前台窗口绑定已改变")
        self._coverage()
        return binding

    def verify_window(self, binding):
        """复核冻结窗口和全部前台归属。

        @param binding: 原请求的窗口身份。
        @return: None；任何漂移均拒绝。
        """
        if self._origin() != binding.get("origin"):
            raise ValueError("原前台窗口绑定已改变")
        fd = open_binding(binding)
        os.close(fd)
        if self._origin() != binding["origin"]:
            raise ValueError("核验期间前台窗口绑定已改变")
        self._coverage()

    def observe_window(self, binding):
        """为 worker 持有自己的内核退出句柄。

        @param binding: 冻结窗口。
        @return: None。
        """
        self.verify_window(binding)
        self.window_fd = open_binding(binding)
        self.window = binding

    def add(self, request_id):
        """向同一原生线程投递一次唤醒。

        @param request_id: 请求 UUID。
        @return: 原生 queuedSubmission 回执。
        """
        result = self.rpc("thread/queue/add", {"threadId": self.session_id, "clientUserMessageId": request_id,
                                              "input": [{"type": "text", "text": wake_message(request_id)}]})
        queued = result.get("queuedSubmission") or {}
        if not queued.get("id"):
            raise ValueError("Codex 队列未返回有效回执，结果未知")
        return queued

    def remove(self, queue_id):
        """撤回本请求精确队列项。

        @param queue_id: 原生队列项标识。
        @return: deleted 或 not_pending。
        """
        try:
            self.rpc("thread/queue/delete", {"threadId": self.session_id, "queuedSubmissionId": queue_id})
            return "deleted"
        except RpcError as error:
            if error.code == -32600 and "queued submission not found" in str(error).lower():
                return "not_pending"
            raise

    def close(self):
        """释放自己的连接与 pidfd。

        @return: None。
        """
        if self.window_fd is not None:
            os.close(self.window_fd)
            self.window_fd = None
        self.transport.close()
