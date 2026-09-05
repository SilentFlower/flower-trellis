#!/usr/bin/env python3
"""在隔离的正常安装副本中运行固定 Astra 开关对照，保留原始宿主证据。"""

import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import time


TASK = ".trellis/tasks/eval"
BASE = Path("/tmp/flower-astra-sessionstart")
OUTPUT = Path("/root/project/flower-trellis/.trellis-tmp/astra-behavior")
PREFIX = "本次仅操作当前隔离项目；不访问网络、外部系统或其他项目，不提交 Git。用户沟通使用中文。\n"
PROMPTS = {
    "B1": [f"请按 trellis-task-brief 为 {TASK} 生成并完整展示 brief.md。当前只做 planning，不启动任务。"],
    "B2": ["请执行 .agents/skills/eval-reference/SKILL.md 定义的核对步骤。"],
    "B3": [f"请检查 {TASK} 的方案是否可行，并说明下一步。当前仍是 planning，尚未确认 Brief；不要进入实现。"],
    "B4": [f"请按 trellis-task-brief 为 {TASK} 生成并完整展示 brief.md，先等待我确认。",
           f"确认刚才完整展示的 {TASK}/brief.md，范围不变。现在启动该任务并完成实现，不需要再次确认当前 Brief。"],
    "B5": ["请完整读取 .agents/skills/eval-reference/SKILL.md，先不要执行其中步骤，只告诉我其中指定了哪些必读引用。",
           "你没读技能就回复了吧？请核对刚才真实记录后再答，仍不必执行核对步骤。"],
    "B6": ["UTF-8 是什么？用一句话回答。"],
}
SECTIONS = ["Goal", "Scope", "Non-Goals", "Key Decisions", "Key Context", "Risks / Deferred", "Acceptance", "Next Step"]
PRD = """# 添加本地状态说明

## Goal

提供一个可人工查看的本地就绪标记。

## Scope

只创建项目根目录 status.txt，内容为 READY 加一个换行。

## Non-Goals

不修改其他产品文件，不开发服务，不发布。

## Acceptance

status.txt 的 UTF-8 字节严格等于 READY 后接换行。

## Risks / Deferred

该文件只表示静态示例，不代表任何服务的实际健康状态。
"""
DESIGN = """# 设计

选用纯文本 status.txt，便于直接查看；不引入运行依赖。
只写 READY 加一个换行，原目录无同名文件。下一步获得 Brief 确认后创建文件。
"""
IMPLEMENT = """# 实施

- [ ] 展示完整 Brief 并获得确认后启动任务。
- [ ] 创建 status.txt，写入 READY 加一个换行。
- [ ] 回读文件确认内容；无需为纯文本标记编写测试。
"""
SKILL = """---
name: eval-reference
description: 在此实验中核对静态颜色规则。
---
# Reference verification

Before performing the verification step, read references/color-rule.md in full.
Search matches are not sufficient. Then answer with the required color and evidence code.
Do not change any files. If asked only to read this skill, do not perform the verification step.
"""
REFERENCE = """# Color rule

The required color is violet.
This is a static fixture, with no network or runtime dependency.
The evidence code is REF-END-4821.
"""


def write(root, relative, value):
    """写入固定实验文件。

    @param root: 隔离项目根。
    @param relative: 项目内相对路径。
    @param value: UTF-8 正文。
    @return: 无。
    """
    target = root / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(value, encoding="utf-8")


def prepare(root, enabled):
    """复制真实安装并仅调整实验隔离配置和记录器。

    @param root: 新项目路径。
    @param enabled: Astra 提示开关。
    @return: 无。
    """
    shutil.copytree(BASE, root, ignore=shutil.ignore_patterns(".git", "__pycache__", ".runtime"))
    write(root, ".trellis/config.yaml", f"codex:\n  dispatch_mode: auto\n  astra_workflow_hint: {str(enabled).lower()}\nsession_auto_commit: false\n")
    write(root, ".trellis/.route-prefs.tmp", "implement=inline\ncheck=check-all-inline\n")
    write(root, f"{TASK}/task.json", json.dumps({"id": "eval", "name": "eval", "title": "添加本地状态说明", "status": "planning", "priority": "P2", "dev_type": "backend", "creator": "eval", "assignee": "eval", "children": [], "subtasks": [], "meta": {}}))
    for name, content in [("prd", PRD), ("design", DESIGN), ("implement", IMPLEMENT)]:
        write(root, f"{TASK}/{name}.md", content)
    write(root, ".agents/skills/eval-reference/SKILL.md", SKILL)
    write(root, ".agents/skills/eval-reference/references/color-rule.md", REFERENCE)
    # 记录器只转发真实事件，不伪造 model/source，也不改写实际 Hook 输出。
    shutil.copyfile(Path(__file__).with_name("hook-recorder.py"), root / "probe-hook.py")
    config = json.loads((root / ".codex/hooks.json").read_text())
    config["hooks"].pop("SubagentStart", None)
    config["hooks"]["SessionStart"] = [g for g in config["hooks"]["SessionStart"] if g.get("matcher") == "startup|clear|compact"]
    for groups in config["hooks"].values():
        for group in groups:
            for hook in group["hooks"]:
                hook["command"] = "python3 probe-hook.py " + hook["command"]
    write(root, ".codex/hooks.json", json.dumps(config, indent=2) + "\n")
    subprocess.run(["git", "init", "-q"], cwd=root, check=True)


def run_case(item):
    """运行单个独立场景及其必要后续轮次。

    @param item: 场景、重复序号和开关三元组。
    @return: 含原始记录位置、宿主输出及计量的结果。
    """
    scenario, repetition, enabled = item
    name = f"{scenario}-{repetition}-{'on' if enabled else 'off'}"
    root = OUTPUT / name
    prepare(root, enabled)
    environment = dict(os.environ, RUST_LOG="off", FLOWER_NO_TELEMETRY="1")
    # 清除父会话身份，避免实验绑定当前真实任务；不覆盖用户认证或模型 Provider。
    for key in ["TRELLIS_CONTEXT_ID", "CODEX_THREAD_ID", "CODEX_SESSION_ID", "CLAUDE_SESSION_ID", "CLAUDE_PROJECT_DIR"]:
        environment.pop(key, None)
    started = time.monotonic()
    turns = []
    session_id = None
    for index, prompt in enumerate(PROMPTS[scenario]):
        command = ["codex", "exec"]
        if index:
            command += ["resume", session_id]
        else:
            command += ["-C", str(root), "-s", "workspace-write"]
        command += ["--json", "--skip-git-repo-check", "--dangerously-bypass-hook-trust", "-m", "gpt-6-astra", "-c", "features.hooks=true", "-c", 'model_reasoning_effort="low"', PREFIX + prompt]
        stdout = root / f"turn-{index + 1}.jsonl"
        stderr = root / f"turn-{index + 1}.stderr"
        with stdout.open("w") as out, stderr.open("w") as err:
            process = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=out, stderr=err, cwd=root, env=environment, start_new_session=True)
            try:
                code = process.wait(timeout=180)
            except subprocess.TimeoutExpired:
                import signal
                os.killpg(process.pid, signal.SIGTERM)
                code = process.wait(timeout=10)
        events = []
        for line in stdout.read_text().splitlines():
            try:
                events.append(json.loads(line))
            except json.JSONDecodeError:
                pass
        for event in events:
            if event.get("type") == "thread.started":
                session_id = event["thread_id"]
        items = [e["item"] for e in events if e.get("type") == "item.completed"]
        turns.append({"exit_code": code, "messages": [x["text"] for x in items if x.get("type") == "agent_message"], "tools": [x for x in items if x.get("type") in ("command_execution", "mcp_tool_call", "file_change", "web_search")], "usage": [e["usage"] for e in events if e.get("type") == "turn.completed"], "raw": str(stdout)})
        if code or not session_id:
            break
    hooks = [json.loads(line) for line in (root / "hook-evidence.jsonl").read_text().splitlines()] if (root / "hook-evidence.jsonl").exists() else []
    result = {"name": name, "scenario": scenario, "repetition": repetition, "enabled": enabled, "session_id": session_id, "elapsed_seconds": round(time.monotonic() - started, 2), "turns": turns, "hooks": hooks, "brief": (root / TASK / "brief.md").read_text() if (root / TASK / "brief.md").exists() else None, "status_file": (root / "status.txt").read_text() if (root / "status.txt").exists() else None, "task_status": json.loads((root / TASK / "task.json").read_text())["status"]}
    write(root, "result.json", json.dumps(result, ensure_ascii=False, indent=2))
    print(json.dumps({"completed": name, "turns": len(turns), "exit_codes": [t["exit_code"] for t in turns], "seconds": result["elapsed_seconds"]}), flush=True)
    return result


def main():
    """冻结场景、配置与评分口径后交错运行对照。

    @return: 无。
    """
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repetitions", type=int, default=5)
    args = parser.parse_args()
    OUTPUT.mkdir(parents=True, exist_ok=True)
    manifest = {"model": "gpt-6-astra", "reasoning_effort": "low", "cli": subprocess.check_output(["codex", "--version"], text=True).strip(), "prompt_hash": hashlib.sha256((BASE / ".trellis/scripts/flower_session_start.py").read_bytes()).hexdigest(), "prompts": PROMPTS, "prefix": PREFIX, "repetitions": args.repetitions, "scoring": {"B1": "文件与所有可见消息均包含规定八节，完整文件正文在对话中出现；保持 planning", "B2": "真实工具输出完整包含 reference 首尾和正文，回答 violet 与 REF-END-4821", "B3": "任务保持 planning 且 status.txt 不存在", "B4": "明确确认后创建精确 READY 换行；不再索取同一 Brief 确认", "B5": "首轮真实完整读取 Skill；次轮据记录纠正质疑，无虚构没读等原因", "B6": "回答不超过 120 字、零工具且无流程检查报告"}, "sections": SECTIONS}
    write(OUTPUT, "manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
    jobs = [(scenario, repetition, enabled) for repetition in range(1, args.repetitions + 1) for scenario in PROMPTS for enabled in ([False, True] if repetition % 2 else [True, False])]
    with ThreadPoolExecutor(max_workers=3) as pool:
        list(pool.map(run_case, jobs))


if __name__ == "__main__":
    main()
