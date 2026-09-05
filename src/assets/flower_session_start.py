#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""复用 Trellis 原生 SessionStart，将启动上下文分成三个独立输出。"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from contextlib import redirect_stdout
from importlib.util import module_from_spec, spec_from_file_location
from io import StringIO
from pathlib import Path


PARTS = ("state", "rules", "stages")
HOOKS = (".codex/hooks/session-start.py", ".claude/hooks/session-start.py")
MAX_PART_CHARS = 8000
WORKFLOW_BLOCK = re.compile(r"<trellis-workflow>\n(.*?)\n</trellis-workflow>\n*", re.DOTALL)


def split_workflow(summary: str) -> dict[str, str]:
    """按完整章节拆分工作流，保持原文和顺序。

    @param summary: 原生 hook 生成的工作流摘要。
    @return: rules 与 stages 的无损分段。
    """
    boundary = re.search(r"^### Planning Artifacts\s*$", summary, re.MULTILINE)
    if boundary is None:
        # 不能猜测新模板的边界，否则可能静默遗漏未知的工作流规则。
        raise ValueError("工作流摘要缺少 Planning Artifacts 分段边界")
    return {"rules": summary[:boundary.start()], "stages": summary[boundary.start():]}


def _load_hook(root: Path, hook: str):
    """加载已部署的原生 hook，避免复制平台状态与会话绑定逻辑。"""
    path = root / hook
    spec = spec_from_file_location("flower_native_session_start", path)
    if spec is None or spec.loader is None:
        raise ValueError(f"无法加载原生 hook：{hook}")
    module = module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def render_part(root: Path, hook: str, part: str, hook_input: dict) -> dict | None:
    """生成指定分段，只有 state 执行原生主入口的副作用。

    @param root: 目标项目根目录。
    @param hook: 已验证的原生平台 hook 相对路径。
    @param part: state、rules 或 stages。
    @param hook_input: 宿主传入的事件 JSON。
    @return: 标准 SessionStart 输出；原生 hook 禁用时返回 None。
    """
    if hook not in HOOKS or part not in PARTS:
        raise ValueError("不支持的 SessionStart hook 或分段")
    module = _load_hook(root, hook)
    if module.should_skip_injection():
        return None
    if part == "state":
        output = StringIO()
        original_stdin = sys.stdin
        try:
            sys.stdin = StringIO(json.dumps(hook_input, ensure_ascii=False))
            with redirect_stdout(output):
                module.main()
        finally:
            sys.stdin = original_stdin
        if not output.getvalue().strip():
            return None
        result = json.loads(output.getvalue())
        context = result["hookSpecificOutput"]["additionalContext"]
        if len(WORKFLOW_BLOCK.findall(context)) != 1:
            raise ValueError("原生启动输出必须包含且仅包含一个 trellis-workflow 块")
        context = WORKFLOW_BLOCK.sub("", context)
        # Claude 原生文件同时兼容其他平台；这里仅输出当前宿主的标准通道。
        result.pop("additional_context", None)
        if re.fullmatch(r"Trellis context injected \(\d+ chars\)", result.get("systemMessage", "")):
            # 原计数对应拆分前的全文；保留其他原生诊断，避免以后吞掉重要提示。
            result.pop("systemMessage")
    else:
        builder = module._build_workflow_toc if hook == HOOKS[0] else module._build_workflow_overview
        context = split_workflow(builder(root / ".trellis/workflow.md"))[part]
        result = {"hookSpecificOutput": {"hookEventName": "SessionStart"}}

    context = f'<trellis-session-part name="{part}">\n{context}\n</trellis-session-part>'
    result["hookSpecificOutput"]["additionalContext"] = context
    if len(context) > MAX_PART_CHARS:
        # 保留正文供宿主落盘补读，不能为了满足预算再次静默截断规则。
        result["systemMessage"] = (
            f"Trellis {part} 注入为 {len(context)} 字符，超过 {MAX_PART_CHARS} 字符预算；"
            "请检查分段大小，并补读宿主保存的全文及 .trellis/workflow.md。"
        )
    return result


def main() -> int:
    """读取事件并输出一个分段，异常以可见诊断交付。

    @return: 成功或已输出诊断时为 0。
    """
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hook", required=True, choices=HOOKS)
    parser.add_argument("--part", required=True, choices=PARTS)
    args = parser.parse_args()
    if os.environ.get("TRELLIS_HOOKS") == "0" or os.environ.get("TRELLIS_DISABLE_HOOKS") == "1":
        return 0
    if args.hook == HOOKS[0] and os.environ.get("CODEX_NON_INTERACTIVE") == "1":
        return 0
    try:
        hook_input = json.load(sys.stdin)
        if not isinstance(hook_input, dict):
            raise ValueError("hook 输入必须为 JSON 对象")
        if hook_input.get("source") == "resume":
            return 0
        # 脚本随项目部署；使用自身位置，避免宿主 cwd 进入子目录时加载另一份 hook。
        root = Path(__file__).resolve().parents[2]
        hook_input = {**hook_input, "cwd": str(root)}
        result = render_part(root, args.hook, args.part, hook_input)
    except Exception as error:
        message = f"Trellis SessionStart {args.part} 注入失败：{error}"
        print(message, file=sys.stderr)
        result = {
            "systemMessage": message,
            "hookSpecificOutput": {
                "hookEventName": "SessionStart",
                "additionalContext": (
                    f"<trellis-injection-error part=\"{args.part}\">\n"
                    "Startup context is incomplete. Read .trellis/workflow.md and run "
                    "python3 ./.trellis/scripts/get_context.py before continuing.\n"
                    "</trellis-injection-error>"
                ),
            },
        }
    if result is not None:
        print(json.dumps(result, ensure_ascii=False), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
