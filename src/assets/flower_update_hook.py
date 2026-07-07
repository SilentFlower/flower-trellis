#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""SessionStart 启动更新检查 hook。

脚本只做只读检查和上下文注入:调用 `flower-trellis self-check --json`,
发现可执行更新时输出 `<flower-update>` 块。失败、离线、无更新或关闭检查时静默退出,
避免影响 Codex / Claude Code 正常启动。
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path


ACTIONABLE_STATUSES = {"update_available", "project_out_of_sync"}


def _debug(message: str) -> None:
    """在显式调试时输出简短错误。"""
    if os.environ.get("FLOWER_UPDATE_HOOK_DEBUG"):
        print(f"flower_update_hook: {message}", file=sys.stderr)


def _project_dir(hook_input: dict) -> Path:
    """从平台环境变量或 hook stdin 解析项目目录。"""
    for name in (
        "CLAUDE_PROJECT_DIR",
        "CODEX_PROJECT_DIR",
        "CURSOR_PROJECT_DIR",
        "GEMINI_PROJECT_DIR",
        "QODER_PROJECT_DIR",
        "CODEBUDDY_PROJECT_DIR",
        "TRAE_PROJECT_DIR",
    ):
        value = os.environ.get(name)
        if value:
            return Path(value).resolve()
    return Path(str(hook_input.get("cwd") or ".")).resolve()


def _run_self_check(project_dir: Path) -> dict | None:
    """执行 flower-trellis self-check 并解析 JSON。"""
    try:
        result = subprocess.run(
            [
                "flower-trellis",
                "self-check",
                "--json",
                "--target",
                str(project_dir),
            ],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=8,
            cwd=str(project_dir),
        )
    except (subprocess.TimeoutExpired, FileNotFoundError, PermissionError) as exc:
        _debug(str(exc))
        return None
    if result.returncode != 0:
        _debug(result.stderr.strip() or f"退出码 {result.returncode}")
        return None
    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        _debug(f"JSON 解析失败:{exc}")
        return None
    return data if isinstance(data, dict) else None


def _format_context(data: dict) -> str:
    """把 self-check JSON 转成给 AI 读取的短上下文块。"""
    current = data.get("current") or {}
    project = data.get("project") or {}
    remote = data.get("remote") or {}
    ai = data.get("ai") or {}
    safety = data.get("safety") or {}
    out_of_sync_reasons = project.get("outOfSyncReasons") or []
    lines = [
        "<flower-update>",
        f"status: {data.get('status')}",
        f"policy: {data.get('policy')}",
        f"current_flower: {current.get('flowerVersion')}",
        f"project_flower: {project.get('flowerVersion')}",
        f"bundled_trellis: {current.get('bundledTrellisVersion')}",
        f"project_trellis: {project.get('trellisVersion')}",
    ]
    if "outOfSync" in project:
        lines.append(f"project_out_of_sync: {project.get('outOfSync')}")
    if out_of_sync_reasons:
        lines.append(f"project_out_of_sync_reasons: {', '.join(out_of_sync_reasons)}")
    if remote.get("tags"):
        lines.append(f"remote: {json.dumps(remote.get('tags'), ensure_ascii=False)}")
    if remote.get("errorCode"):
        lines.append(f"remote_error_code: {remote.get('errorCode')}")
    command = (data.get("commands") or {}).get("recommended") or ai.get("command")
    if command:
        lines.append(f"recommended_command: {command}")
    if safety.get("reasons"):
        lines.append(f"safety_reasons: {', '.join(safety.get('reasons') or [])}")
    if ai.get("mode"):
        lines.append(f"ai_mode: {ai.get('mode')}")
    if ai.get("mode") == "ask":
        lines.append("ai_required_action: 必须先向用户提出明确确认问题;用户确认前禁止执行 recommended_command。")
    if ai.get("instruction"):
        lines.append(f"ai_instruction: {ai.get('instruction')}")
    lines.append("</flower-update>")
    return "\n".join(lines)


def _emit_context(context: str) -> None:
    """输出 Codex / Claude Code 都接受的 SessionStart hook JSON。"""
    result = {
        "suppressOutput": True,
        "systemMessage": "flower-trellis update context injected",
        "hookSpecificOutput": {
            "hookEventName": "SessionStart",
            "additionalContext": context,
        },
    }
    print(json.dumps(result, ensure_ascii=False), flush=True)


def main() -> None:
    try:
        hook_input = json.loads(sys.stdin.read() or "{}")
        if not isinstance(hook_input, dict):
            hook_input = {}
    except json.JSONDecodeError:
        hook_input = {}

    data = _run_self_check(_project_dir(hook_input))
    if not data or data.get("status") not in ACTIONABLE_STATUSES:
        return
    _emit_context(_format_context(data))


if __name__ == "__main__":
    main()
