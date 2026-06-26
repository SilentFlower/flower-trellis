#!/usr/bin/env python3
"""读写当前 session runtime 文件里的 Trellis route 决策。"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


VALID_SOURCES = {"trellis-route", "numbered-fallback", "route-prefs"}
VALID_MODES = {
    "implement": {"inline", "subagent"},
    "check": {
        "check-all-inline",
        "check-all-subagent",
        "check-inline",
        "check-subagent",
    },
}
PREF_MODES = {
    "implement": {"inline", "subagent"},
    "check": {"check-all-inline", "check-all-subagent"},
}


def _repo_root() -> Path | None:
    """从当前目录向上查找 Trellis 项目根目录。"""
    current = Path.cwd().resolve()
    while True:
        if (current / ".trellis").is_dir():
            return current
        if current == current.parent:
            return None
        current = current.parent


def _utc_now() -> str:
    """返回秒级 UTC 时间字符串。"""
    return (
        datetime.now(timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )


def _read_json(path: Path) -> dict[str, Any]:
    """读取 JSON 对象，失败时返回空对象。"""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {}
    return data if isinstance(data, dict) else {}


def _write_json(path: Path, data: dict[str, Any]) -> None:
    """原子性要求不高的 runtime 状态写入。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(data, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def _print(data: dict[str, Any]) -> int:
    """输出给 AI 读取的紧凑 JSON。"""
    print(json.dumps(data, ensure_ascii=False, sort_keys=True))
    return 0


def _output(args: argparse.Namespace, data: dict[str, Any], verbose: dict[str, Any] | None = None) -> int:
    """按默认精简模式或详细模式输出 JSON。"""
    if getattr(args, "verbose", False) and verbose:
        data = {**data, **verbose}
    return _print(data)


def _decision_summary(decision: dict[str, Any]) -> dict[str, Any]:
    """提取默认输出需要的最小 route 决策字段。"""
    return {
        "mode": decision.get("mode"),
        "source": decision.get("source"),
    }


def _current_task(repo_root: Path) -> tuple[str | None, str | None, str | None]:
    """通过 task.py current --source 获取当前任务和 session key。"""
    result = subprocess.run(
        ["python3", str(repo_root / ".trellis/scripts/task.py"), "current", "--source"],
        cwd=repo_root,
        check=False,
        text=True,
        capture_output=True,
    )
    current = None
    source = None
    for line in result.stdout.splitlines():
        if line.startswith("Current task: "):
            value = line.split(": ", 1)[1].strip()
            current = None if value == "(none)" else value
        elif line.startswith("Source: "):
            source = line.split(": ", 1)[1].strip()
    context_key = None
    if source and source.startswith(("session:", "session-fallback:")):
        context_key = source.split(":", 1)[1].strip()
    return current, source, context_key


def _session_path(repo_root: Path, context_key: str) -> Path:
    """返回当前 session runtime 文件路径。"""
    return repo_root / ".trellis/.runtime/sessions" / f"{context_key}.json"


def _rel_path(repo_root: Path, path: Path) -> str:
    """尽量输出相对项目根的路径，便于用户阅读。"""
    try:
        return path.relative_to(repo_root).as_posix()
    except ValueError:
        return str(path)


def _pref_path(repo_root: Path) -> Path:
    """返回个人 route 默认配置文件路径。"""
    return repo_root / ".trellis/.route-prefs.tmp"


def _read_prefs(repo_root: Path) -> dict[str, str]:
    """读取个人 route 默认配置，只保留合法 key-value。"""
    path = _pref_path(repo_root)
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return {}

    prefs: dict[str, str] = {}
    for raw in lines:
        if "=" not in raw:
            continue
        key, value = raw.split("=", 1)
        key = key.strip()
        value = value.strip()
        if key in PREF_MODES and value in PREF_MODES[key]:
            prefs[key] = value
    return prefs


def _write_prefs(repo_root: Path, prefs: dict[str, str]) -> None:
    """写入个人 route 默认配置；为空则删除文件。"""
    path = _pref_path(repo_root)
    valid = {
        target: value
        for target, value in prefs.items()
        if target in PREF_MODES and value in PREF_MODES[target]
    }
    if not valid:
        try:
            path.unlink()
        except FileNotFoundError:
            pass
        return

    lines = []
    for target in ("implement", "check"):
        value = valid.get(target)
        if value:
            lines.append(f"{target}={value}")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _valid_decision(decision: Any, target: str, current_task: str) -> bool:
    """校验 runtime 中的 route 决策是否能复用。"""
    if not isinstance(decision, dict):
        return False
    return (
        decision.get("target") == target
        and decision.get("mode") in VALID_MODES[target]
        and decision.get("source") in VALID_SOURCES
        and decision.get("scope") == "task"
        and decision.get("task") == current_task
    )


def _decision(target: str, mode: str, source: str, current_task: str) -> dict[str, str]:
    """构造标准 route 决策对象。"""
    return {
        "target": target,
        "mode": mode,
        "source": source,
        "scope": "task",
        "task": current_task,
        "decided_at": _utc_now(),
    }


def _write_runtime_decision(
    repo_root: Path,
    context_key: str,
    current_task: str,
    target: str,
    mode: str,
    source: str,
) -> tuple[Path, dict[str, str]]:
    """写入 session runtime 文件中的 route_decisions 字段。"""
    path = _session_path(repo_root, context_key)
    context = _read_json(path)
    now = _utc_now()
    context.setdefault("platform", context_key.split("_", 1)[0] if "_" in context_key else "session")
    context["last_seen_at"] = now
    context["current_task"] = current_task
    context.setdefault("current_run", None)
    context["route_state_version"] = 1
    decisions = context.get("route_decisions")
    if not isinstance(decisions, dict):
        decisions = {}
    decision = _decision(target, mode, source, current_task)
    decision["decided_at"] = now
    decisions[target] = decision
    context["route_decisions"] = decisions
    _write_json(path, context)
    return path, decision


def _current_context_or_miss(repo_root: Path) -> tuple[str | None, str | None, str | None, dict[str, Any] | None]:
    """解析当前任务和 session key；失败时返回可直接输出的 miss 对象。"""
    current_task, source, context_key = _current_task(repo_root)
    if not current_task:
        return None, source, None, {"status": "miss", "reason": "no-current-task", "source": source}
    if not context_key:
        return current_task, source, None, {"status": "miss", "reason": "no-session-context", "source": source}
    return current_task, source, context_key, None


def read_runtime(args: argparse.Namespace) -> int:
    """只读取并校验当前 target 的 runtime route 决策。"""
    repo_root = _repo_root()
    if repo_root is None:
        return _print({"status": "miss", "reason": "not-trellis-project"})

    current_task, _, context_key, miss = _current_context_or_miss(repo_root)
    if miss:
        return _print(miss)
    assert current_task is not None and context_key is not None

    path = _session_path(repo_root, context_key)
    context = _read_json(path)
    decision = context.get("route_decisions", {}).get(args.target)
    if _valid_decision(decision, args.target, current_task):
        return _output(
            args,
            {
                "status": "hit",
                **_decision_summary(decision),
            },
            {
                "decision": decision,
                "path": _rel_path(repo_root, path),
                "context_key": context_key,
                "task": current_task,
            }
        )

    return _output(
        args,
        {
            "status": "miss",
            "reason": "no-valid-decision",
        },
        {
            "path": _rel_path(repo_root, path),
            "context_key": context_key,
            "task": current_task,
        }
    )


def resolve_route(args: argparse.Namespace) -> int:
    """按 runtime → prefs 的优先级解析 route 决策。"""
    repo_root = _repo_root()
    if repo_root is None:
        return _print({"status": "miss", "reason": "not-trellis-project"})

    current_task, _, context_key, miss = _current_context_or_miss(repo_root)
    if miss:
        return _print(miss)
    assert current_task is not None and context_key is not None

    path = _session_path(repo_root, context_key)
    context = _read_json(path)
    decision = context.get("route_decisions", {}).get(args.target)
    if _valid_decision(decision, args.target, current_task):
        return _output(
            args,
            {
                "status": "hit",
                "origin": "runtime",
                **_decision_summary(decision),
            },
            {
                "decision": decision,
                "path": _rel_path(repo_root, path),
                "context_key": context_key,
                "task": current_task,
            }
        )

    prefs = _read_prefs(repo_root)
    pref_mode = prefs.get(args.target)
    if pref_mode in PREF_MODES[args.target]:
        written_path, pref_decision = _write_runtime_decision(
            repo_root,
            context_key,
            current_task,
            args.target,
            pref_mode,
            "route-prefs",
        )
        return _output(
            args,
            {
                "status": "hit",
                "origin": "route-prefs",
                **_decision_summary(pref_decision),
            },
            {
                "decision": pref_decision,
                "path": _rel_path(repo_root, written_path),
                "pref_path": _rel_path(repo_root, _pref_path(repo_root)),
                "context_key": context_key,
                "task": current_task,
                "wrote_runtime": True,
            }
        )

    return _output(
        args,
        {
            "status": "miss",
            "reason": "no-valid-decision-or-pref",
        },
        {
            "path": _rel_path(repo_root, path),
            "pref_path": _rel_path(repo_root, _pref_path(repo_root)),
            "context_key": context_key,
            "task": current_task,
        }
    )


def write_route(args: argparse.Namespace) -> int:
    """写入当前 target 的 route 决策并保留 session 文件的其他字段。"""
    if args.source not in VALID_SOURCES:
        return _print({"status": "error", "reason": "invalid-source", "source": args.source})
    if args.mode not in VALID_MODES[args.target]:
        return _print(
            {
                "status": "error",
                "reason": "invalid-mode",
                "target": args.target,
                "mode": args.mode,
            }
        )

    repo_root = _repo_root()
    if repo_root is None:
        return _print({"status": "skipped", "reason": "not-trellis-project"})

    if args.save_pref:
        if args.mode not in PREF_MODES[args.target]:
            return _print(
                {
                    "status": "error",
                    "reason": "mode-cannot-be-saved-as-pref",
                    "target": args.target,
                    "mode": args.mode,
                }
            )
        prefs = _read_prefs(repo_root)
        prefs[args.target] = args.mode
        _write_prefs(repo_root, prefs)

    current_task, source, context_key = _current_task(repo_root)
    if not current_task:
        return _print({"status": "skipped", "reason": "no-current-task", "source": source})
    if not context_key:
        return _print({"status": "skipped", "reason": "no-session-context", "source": source})

    path, decision = _write_runtime_decision(
        repo_root,
        context_key,
        current_task,
        args.target,
        args.mode,
        args.source,
    )
    return _output(
        args,
        {
            "status": "written",
            **_decision_summary(decision),
        },
        {
            "decision": decision,
            "path": _rel_path(repo_root, path),
            "pref_path": _rel_path(repo_root, _pref_path(repo_root)) if args.save_pref else None,
            "context_key": context_key,
            "task": current_task,
            "saved_pref": bool(args.save_pref),
        }
    )


def clear_pref(args: argparse.Namespace) -> int:
    """清除当前 target 的个人默认 route 配置。"""
    repo_root = _repo_root()
    if repo_root is None:
        return _print({"status": "skipped", "reason": "not-trellis-project"})
    prefs = _read_prefs(repo_root)
    existed = args.target in prefs
    prefs.pop(args.target, None)
    _write_prefs(repo_root, prefs)
    return _output(
        args,
        {
            "status": "cleared",
            "target": args.target,
        },
        {
            "existed": existed,
            "pref_path": _rel_path(repo_root, _pref_path(repo_root)),
        }
    )


def build_parser() -> argparse.ArgumentParser:
    """构造命令行参数解析器。"""
    parser = argparse.ArgumentParser(description="Read/write Trellis route state.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    resolve_parser = subparsers.add_parser("resolve", help="resolve route from runtime then prefs")
    resolve_parser.add_argument("--target", choices=sorted(VALID_MODES), required=True)
    resolve_parser.add_argument("--verbose", action="store_true", help="include diagnostic paths and session metadata")
    resolve_parser.set_defaults(func=resolve_route)

    read_parser = subparsers.add_parser("read-runtime", help="read a runtime route decision")
    read_parser.add_argument("--target", choices=sorted(VALID_MODES), required=True)
    read_parser.add_argument("--verbose", action="store_true", help="include diagnostic paths and session metadata")
    read_parser.set_defaults(func=read_runtime)

    write_parser = subparsers.add_parser("write", help="write a route decision")
    write_parser.add_argument("--target", choices=sorted(VALID_MODES), required=True)
    write_parser.add_argument("--mode", required=True)
    write_parser.add_argument("--source", choices=sorted(VALID_SOURCES), required=True)
    write_parser.add_argument("--save-pref", action="store_true")
    write_parser.add_argument("--verbose", action="store_true", help="include diagnostic paths and session metadata")
    write_parser.set_defaults(func=write_route)

    clear_parser = subparsers.add_parser("clear-pref", help="clear a personal route preference")
    clear_parser.add_argument("--target", choices=sorted(PREF_MODES), required=True)
    clear_parser.add_argument("--verbose", action="store_true", help="include diagnostic paths and preference metadata")
    clear_parser.set_defaults(func=clear_pref)

    return parser


def main() -> int:
    """脚本入口。"""
    parser = build_parser()
    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
