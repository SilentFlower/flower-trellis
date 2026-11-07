#!/usr/bin/env python3
"""统一确认入口的材料快照、计时策略与会话内控制客户端。"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import socket
import stat
import subprocess
import sys
import uuid
from pathlib import Path


SESSION_ENV = "FLOWER_CONFIRMATION_SESSION"
KINDS = {"brief": "implement", "check": "repair_all_and_recheck", "push": "execute_git_plan"}
DEFAULTS = {
    "enabled": True,
    "brief": {"enabled": True, "base_seconds": 100, "threshold_chars": 1000,
              "increment_chars": 500, "increment_seconds": 30},
    "check": {"enabled": True, "base_seconds": 100, "increment_seconds": 30},
    "push": {"enabled": True, "seconds": 200},
}


def _boolean(value):
    """严格解析布尔值，避免字符串 false 被当作真值。"""
    if isinstance(value, bool):
        return value
    if isinstance(value, str) and value.lower() in ("true", "false"):
        return value.lower() == "true"
    raise ValueError("确认开关必须为 true 或 false")


def _integer(value, allow_zero=False):
    """解析非负或正整数秒数，不接受浮点数和布尔值。"""
    if isinstance(value, bool) or not re.fullmatch(r"\d+", str(value)):
        raise ValueError("确认时长和计数必须为整数")
    number = int(value)
    if number < (0 if allow_zero else 1) or number > 86400 * 1000:
        raise ValueError("确认配置数值超出有效范围")
    return number


def read_policy(root):
    """读取并严格验证本功能配置；@param root 项目根；@return 策略字典。"""
    from common.trellis_config import read_trellis_config

    config_file = root / ".trellis/config.yaml"
    raw = config_file.read_text(encoding="utf-8") if config_file.exists() else ""
    config = read_trellis_config(root)
    if not config and any(line.strip() and not line.lstrip().startswith("#") for line in raw.splitlines()):
        raise ValueError("项目配置损坏，保持人工确认")
    # 上游读取器会容忍不认识的行；本功能自己的配置块必须拒绝重复键与缺少冒号的行。
    inside = False
    seen = set()
    section = None
    for line in raw.splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if not line[0].isspace():
            if re.match(r"^confirmation_timeout\b", line):
                if inside or (0, "confirmation_timeout") in seen:
                    raise ValueError("confirmation_timeout 重复定义")
                if not re.fullmatch(r"confirmation_timeout\s*:\s*(?:#.*)?", line):
                    raise ValueError("confirmation_timeout 必须为映射")
                inside = True
                seen.add((0, "confirmation_timeout"))
                continue
            inside = False
        if not inside:
            continue
        match = re.fullmatch(r"( +)([a-z_]+)\s*:\s*(.*?)\s*", line)
        if not match or len(match.group(1)) not in (2, 4):
            raise ValueError("confirmation_timeout 缩进或字段格式无效")
        indent, key = len(match.group(1)), match.group(2)
        if indent == 2:
            section = key
        token = (section, indent, key)
        if token in seen:
            raise ValueError("confirmation_timeout 字段重复")
        seen.add(token)
    block = config.get("confirmation_timeout", {})
    if not isinstance(block, dict) or set(block) - set(DEFAULTS):
        raise ValueError("confirmation_timeout 字段无效")
    result = {"enabled": _boolean(block.get("enabled", True))}
    for kind in KINDS:
        values = block.get(kind, {})
        if not isinstance(values, dict) or set(values) - set(DEFAULTS[kind]):
            raise ValueError("确认类型配置字段无效：" + kind)
        result[kind] = {}
        for key, default in DEFAULTS[kind].items():
            value = values.get(key, default)
            result[kind][key] = _boolean(value) if key == "enabled" else _integer(value, key == "increment_seconds")
    return result


def calculate_seconds(policy, kind, display, problem_ids):
    """计算唯一时长公式。

    @param policy: 已严格解析的策略。
    @param kind: brief、check或push。
    @param display: LF规范化的完整正文。
    @param problem_ids: 当前待处置ID清单。
    @return: 整数秒，禁用或零问题时为0。
    """
    values = policy[kind]
    if not policy["enabled"] or not values["enabled"]:
        return 0
    if kind == "brief":
        extra = max(0, len(display.strip()) - values["threshold_chars"])
        steps = (extra + values["increment_chars"] - 1) // values["increment_chars"]
        return values["base_seconds"] + steps * values["increment_seconds"]
    if kind == "check":
        count = len(set(problem_ids))
        return 0 if count == 0 else values["base_seconds"] + (count - 1) * values["increment_seconds"]
    return values["seconds"]


def _project_file(root, relative):
    """只读取当前项目内的真实文件，拒绝软链越界。"""
    if not isinstance(relative, str) or not relative or re.search(r"[\x00-\x1f\x7f-\x9f]", relative):
        raise ValueError("材料路径无效")
    file = (root / relative).resolve()
    try:
        file.relative_to(root)
    except ValueError:
        raise ValueError("确认材料超出当前项目")
    if not file.is_file() or file.stat().st_size > 4 * 1024 * 1024:
        raise ValueError("确认材料不存在或超过4MiB")
    return file


def _digest(value):
    """对规范JSON取摘要，正文只保留在当前快照中。"""
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                     separators=(",", ":")).encode("utf-8")).hexdigest()


def _git(root, args):
    """只执行固定前缀的只读Git查询，不执行提交或推送。"""
    result = subprocess.run(["git", *args], cwd=str(root), capture_output=True, check=False)
    if result.returncode:
        raise ValueError("无法核验当前Git基线，保持人工确认")
    return result.stdout


def _git_snapshot(root, paths):
    """绑定单仓基线；@param root 仓库根；@param paths 精确文件；@return 只读基线。"""
    if Path(_git(root, ["rev-parse", "--show-toplevel"]).decode("utf-8").strip()).resolve() != root:
        raise ValueError("提交计划必须明确真实Git根目录")
    branch = _git(root, ["branch", "--show-current"]).decode("utf-8").strip()
    if not branch or _git(root, ["ls-files", "-u"]):
        raise ValueError("提交计划分支或冲突状态无效")
    contents = {}
    for value in sorted(set(paths)):
        if re.search(r"[\x00-\x1f\x7f-\x9f]", value):
            raise ValueError("Git文件名含终端控制字符")
        original = root / value
        if original.is_symlink():
            raise ValueError("Git计划不能包含软链")
        candidate = original.resolve()
        try:
            relative = candidate.relative_to(root).as_posix()
        except ValueError:
            raise ValueError("Git计划路径超出当前仓库")
        if relative == ".":
            raise ValueError("Git计划必须列出精确文件")
        if candidate.is_dir():
            entry = _git(root, ["ls-files", "--stage", "-z", "--", relative])
            if not entry.startswith(b"160000 ") or entry.count(b"\0") != 1:
                raise ValueError("Git计划必须列出精确文件，目录只允许已跟踪的gitlink")
            contents[relative] = {"gitlink": _git(candidate, ["rev-parse", "HEAD"]).decode().strip()}
        else:
            if candidate.exists() and not candidate.is_file():
                raise ValueError("Git计划包含不支持的文件类型")
            contents[relative] = ({"sha256": hashlib.sha256(candidate.read_bytes()).hexdigest(),
                                   "mode": stat.S_IMODE(candidate.stat().st_mode)} if candidate.is_file() else None)
    integration = {}
    for name in ("MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply"):
        location = Path(os.fsdecode(_git(root, ["rev-parse", "--git-path", name]).strip()))
        if not location.is_absolute():
            location = root / location
        integration[name] = hashlib.sha256(location.read_bytes()).hexdigest() if location.is_file() else location.exists()
    result = {"root": str(root), "head": _git(root, ["rev-parse", "HEAD"]).decode().strip(),
              "branch": branch, "integration": integration,
              "index": hashlib.sha256(_git(root, ["diff", "--cached", "--binary"])).hexdigest(),
              "config": hashlib.sha256(_git(root, ["config", "--null", "--list"])).hexdigest(),
              "refs": hashlib.sha256(_git(root, ["for-each-ref", "--format=%(refname) %(objectname)"])).hexdigest(),
              "paths": contents}
    return result


def build_snapshot(root, spec, owner):
    """冻结材料与当前策略。

    @param root: 当前项目根目录。
    @param spec: 材料、范围及模式。
    @param owner: 当前原生会话键。
    @return: 只用于本次入口核验的快照。
    """
    from common.active_task import resolve_active_task

    allowed = {"kind", "file", "basis", "problem_ids", "git_paths", "mode", "repositories"}
    if not isinstance(spec, dict) or set(spec) - allowed or spec.get("kind") not in KINDS:
        raise ValueError("确认请求类型或字段无效")
    if not isinstance(owner, str) or not re.fullmatch(r"[A-Za-z0-9_.-]{1,512}", owner):
        raise ValueError("当前会话身份无效")
    # inspector 在独立进程运行；显式绑定已核验 owner，绝不采用唯一活动任务回退。
    previous = os.environ.get("TRELLIS_CONTEXT_ID")
    os.environ["TRELLIS_CONTEXT_ID"] = owner
    try:
        active = resolve_active_task(root, allow_single_session_fallback=False)
    finally:
        if previous is None:
            os.environ.pop("TRELLIS_CONTEXT_ID", None)
        else:
            os.environ["TRELLIS_CONTEXT_ID"] = previous
    if active.stale or active.source_type in ("session-corrupt", "session-io_error"):
        raise ValueError("当前活动任务状态无效")
    kind = spec["kind"]
    if kind == "brief" and not active.task_path:
        raise ValueError("Brief确认必须绑定当前任务")
    body_file = _project_file(root, spec.get("file"))
    display = body_file.read_text(encoding="utf-8").replace("\r\n", "\n").replace("\r", "\n")
    if not display.strip() or re.search(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]", display):
        raise ValueError("确认正文为空或含终端控制字符")
    basis = spec.get("basis", [])
    problems = spec.get("problem_ids", [])
    paths = spec.get("git_paths", [])
    if not all(isinstance(items, list) and len(items) <= 1000 and all(isinstance(x, str) and x for x in items)
               for items in (basis, problems, paths)):
        raise ValueError("确认材料清单无效")
    if kind == "check" and any(not re.fullmatch(r"(?:CHK|FBK|DOC)-[A-Za-z0-9_-]+", item)
                               or not re.search(r"(?<![A-Za-z0-9_-])" + re.escape(item) + r"(?![A-Za-z0-9_-])", display)
                               for item in problems):
        raise ValueError("待处置问题标识未出现在当前报告")
    files = [body_file, *[_project_file(root, item) for item in basis]]
    if active.task_path:
        task = _project_file(root, active.task_path + "/task.json")
        task_data = json.loads(task.read_text(encoding="utf-8"))
        if kind == "brief":
            if task_data.get("status") != "planning":
                raise ValueError("首次Brief确认仅适用于planning任务")
            for name in ("prd.md", "design.md", "implement.md"):
                candidate = task.parent / name
                if candidate.is_file():
                    files.append(candidate)
            if body_file != task.parent / "brief.md" or body_file.stat().st_mtime_ns < max(p.stat().st_mtime_ns for p in files):
                raise ValueError("Brief不是当前任务的最新材料")
        files.append(task)
    git_basis = None
    summary = ""
    if kind == "push":
        mode = spec.get("mode")
        repositories = spec.get("repositories", [])
        if (mode not in ("push", "commit-only") or not isinstance(repositories, list)
                or len(repositories) > 100 or (not paths and not repositories)):
            raise ValueError("提交确认需要明确模式及精确文件范围")
        entries = ([{"root": str(root), "git_paths": paths}] if paths else []) + repositories
        git_basis = {"mode": mode, "repositories": []}
        seen_roots = set()
        for entry in entries:
            if (not isinstance(entry, dict) or set(entry) != {"root", "git_paths"}
                    or not isinstance(entry["root"], str) or not entry["root"]
                    or re.search(r"[\x00-\x1f\x7f-\x9f]", entry["root"])
                    or not isinstance(entry["git_paths"], list) or not 0 < len(entry["git_paths"]) <= 1000
                    or not all(isinstance(value, str) and value for value in entry["git_paths"])):
                raise ValueError("多仓提交计划字段无效")
            repository = (root / entry["root"]).resolve()
            if repository in seen_roots:
                raise ValueError("提交计划重复列出同一Git仓库")
            seen_roots.add(repository)
            git_basis["repositories"].append(_git_snapshot(repository, entry["git_paths"]))
        summary = "\n\n提交模式：" + ("commit + push" if mode == "push" else "commit-only（仅本地提交）")
        summary += "".join("\n仓库：" + entry["root"] + "\n分支：" + entry["branch"] + "\n精确文件范围：\n"
                           + "\n".join("- " + item for item in entry["paths"]) for entry in git_basis["repositories"])
    policy = read_policy(root)
    seconds = calculate_seconds(policy, kind, display, problems)
    fingerprints = {p.relative_to(root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
    revision = _digest({"policy": policy, "spec": spec, "files": fingerprints, "git": git_basis,
                        "owner": owner, "task": active.task_path})
    return {"enabled": seconds > 0, "seconds": seconds, "revision": revision, "display": display + summary,
            "kind": kind, "action": KINDS[kind], "contextKey": owner, "task": active.task_path,
            "material": body_file.relative_to(root).as_posix()}


def session_descriptor():
    """读取本次入口的控制信息；@return 描述符，缺失或损坏时抛出异常。"""
    descriptor = json.loads(os.environ.get(SESSION_ENV, "null"))
    if (not isinstance(descriptor, dict) or descriptor.get("version") != 1
            or descriptor.get("platform") not in ("codex", "claude")
            or not isinstance(descriptor.get("port"), int) or isinstance(descriptor["port"], bool)
            or not 0 < descriptor["port"] < 65536
            or not isinstance(descriptor.get("token"), str) or len(descriptor["token"]) < 24
            or not isinstance(descriptor.get("root"), str) or not descriptor["root"]
            or not isinstance(descriptor.get("instance_id"), str) or not descriptor["instance_id"]):
        raise ValueError("当前没有有效的统一确认入口，保持人工确认")
    return descriptor


def session_request(message):
    """向当前入口发送控制消息；@param message 消息；@return 不含凭据的结果。"""
    descriptor = session_descriptor()
    payload = {**message, "token": descriptor["token"], "instance_id": descriptor.get("instance_id")}
    with socket.create_connection(("127.0.0.1", descriptor["port"]), timeout=15) as connection:
        connection.sendall((json.dumps(payload, ensure_ascii=False) + "\n").encode("utf-8"))
        data = b""
        while b"\n" not in data:
            chunk = connection.recv(65536)
            if not chunk or len(data) + len(chunk) > 1024 * 1024:
                raise ValueError("确认入口已断开或响应无效")
            data += chunk
    result = json.loads(data.split(b"\n", 1)[0].decode("utf-8"))
    if result.get("error"):
        raise ValueError(result["error"])
    return result


def bind_session(root, hook_input, platform):
    """由SessionStart绑定当前主会话。

    @param root: 当前项目根。
    @param hook_input: 原生SessionStart事件。
    @param platform: codex或claude。
    @return: 不含控制凭据的入口状态。
    """
    from common.active_task import resolve_context_key

    owner = resolve_context_key(hook_input, platform, allow_environment_context=False)
    if not owner:
        raise ValueError("原生SessionStart未提供会话身份")
    result = session_request({"method": "bind", "owner": owner, "root": str(root.resolve())})
    result["enabled"] = read_policy(root)["enabled"]
    return result


def _owner(platform):
    """只采用已核实的原生shell会话变量，不用历史任务猜身份。"""
    from common.active_task import resolve_context_key

    name = "CODEX_THREAD_ID" if platform == "codex" else "CLAUDE_CODE_SESSION_ID"
    value = os.environ.get(name)
    if not value:
        raise ValueError("当前工具未携带原生会话身份，保持人工确认")
    return resolve_context_key({"session_id": value}, platform, allow_environment_context=False)


def materialize(root, body):
    """冻结跨进程复核所需正文。

    @param root: 当前项目根。
    @param body: 完整文本。
    @return: gitignored材料相对路径，不含执行许可。
    """
    if not body.strip() or len(body.encode("utf-8")) > 4 * 1024 * 1024:
        raise ValueError("确认材料为空或超过4MiB")
    directory = (root / ".trellis/.runtime/confirmations/materials").resolve()
    try:
        directory.relative_to(root)
    except ValueError:
        raise ValueError("材料目录超出当前项目")
    directory.mkdir(parents=True, exist_ok=True)
    file = directory / (str(uuid.uuid4()) + ".md")
    with file.open("x", encoding="utf-8", newline="\n") as handle:
        handle.write(body)
    return {"file": file.relative_to(root).as_posix()}


def main():
    """执行命令行客户端；@return 成功0，拒绝或配置错误2。"""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("status", "prepare", "claim", "finish", "inspect", "bind", "materialize"))
    parser.add_argument("--root", default=str(Path(__file__).resolve().parents[2]))
    parser.add_argument("--kind", choices=tuple(KINDS))
    parser.add_argument("--file")
    parser.add_argument("--basis-file", action="append", default=[])
    parser.add_argument("--problem-id", action="append", default=[])
    parser.add_argument("--git-path", action="append", default=[])
    parser.add_argument("--repository", action="append", default=[], help='多仓计划JSON：{"root":"路径","git_paths":["精确文件"]}')
    parser.add_argument("--mode", choices=("push", "commit-only"))
    parser.add_argument("--request-id")
    parser.add_argument("--outcome", choices=("completed", "interrupted", "needs_verification"))
    parser.add_argument("--owner")
    args = parser.parse_args()
    root = Path(args.root).resolve()
    sys.path.insert(0, str(root / ".trellis/scripts"))
    try:
        if args.command != "inspect" and os.environ.get(SESSION_ENV):
            descriptor = session_descriptor()
            if Path(descriptor["root"]).resolve() != root:
                raise ValueError("当前命令与统一入口项目不匹配，保持人工确认")
        if args.command == "materialize":
            result = materialize(root, sys.stdin.read(4 * 1024 * 1024 + 1))
        elif args.command == "inspect":
            result = build_snapshot(root, json.load(sys.stdin), args.owner)
        elif args.command == "bind":
            result = bind_session(root, json.load(sys.stdin), session_descriptor()["platform"])
        elif args.command == "status":
            result = session_request({"method": "status"}) if os.environ.get(SESSION_ENV) else {"bound": False, "manual": True}
            if result.get("bound"):
                policy = read_policy(root)
                result.update({"enabled": policy["enabled"], "kinds": {kind: policy[kind]["enabled"] for kind in KINDS}})
        else:
            descriptor = session_descriptor()
            owner = _owner(descriptor["platform"])
            message = {"method": args.command, "owner": owner}
            if args.command == "prepare":
                message["spec"] = {"kind": args.kind, "file": args.file, "basis": args.basis_file,
                                   "problem_ids": args.problem_id, "git_paths": args.git_path, "mode": args.mode,
                                   "repositories": [json.loads(value) for value in args.repository]}
            else:
                message.update({"request_id": args.request_id, "outcome": args.outcome})
            result = session_request(message)
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except (ValueError, OSError, KeyError, TypeError, ImportError) as error:
        print(json.dumps({"error": str(error), "manual": True}, ensure_ascii=False))
        return 2


if __name__ == "__main__":
    sys.exit(main())
