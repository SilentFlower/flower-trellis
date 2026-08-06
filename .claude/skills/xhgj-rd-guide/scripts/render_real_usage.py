#!/usr/bin/env python3
"""Render the human-readable real-usage projection from canonical JSON."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any, Dict, Iterable, List


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = ROOT / "tests" / "fixtures" / "real-usage.json"
DEFAULT_OUTPUT = ROOT / "tests" / "fixtures" / "real-usage.md"
GENERATED_NOTICE = "由 JSON 生成，请勿手工编辑。"
METADATA_LABELS = [
    ("tool", "工具"),
    ("client_version", "客户端版本"),
    ("model_snapshot", "模型精确快照"),
    ("session_id", "会话 ID"),
    ("collected_at", "采集时间"),
    ("collection_method", "采集方式"),
    ("operating_system", "操作系统"),
    ("shell", "Shell"),
    ("node_version", "Node 版本"),
    ("browser_version", "浏览器版本"),
    ("asset_version", "资产版本"),
]


class RenderError(Exception):
    """The canonical evidence or generated projection is invalid."""


def load_evidence(path: Path) -> Dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RenderError(f"cannot load canonical evidence {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise RenderError(f"{path}: canonical evidence root must be an object")
    return value


def canonical_json_bytes(evidence: Dict[str, Any]) -> bytes:
    payload = json.dumps(
        evidence,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return (payload + "\n").encode("utf-8")


def evidence_digest(evidence: Dict[str, Any]) -> str:
    return hashlib.sha256(canonical_json_bytes(evidence)).hexdigest()


def fenced_text(value: Any) -> List[str]:
    text = str(value).rstrip("\n")
    longest_run = max((len(match) for match in re.findall(r"`+", text)), default=0)
    fence = "`" * max(3, longest_run + 1)
    return [f"{fence}text", text, fence]


def bullet_code(values: Iterable[Any]) -> List[str]:
    items = list(values)
    if not items:
        return ["- 无"]
    return [f"- `{item}`" for item in items]


def metadata_text(item: Dict[str, Any]) -> str:
    if "value" in item:
        return str(item["value"])
    return f"不可得：`{item['unavailable']}`"


def render_markdown(evidence: Dict[str, Any], source_locator: str) -> str:
    review = evidence["review"]
    lines = [
        "# xhgj-rd-guide 真实使用证据",
        "",
        f"> {GENERATED_NOTICE}",
        f"> 机器 canonical：`{source_locator}`",
        f"> 规范化内容 SHA-256：`{evidence_digest(evidence)}`",
        "",
        "## 元数据",
        "",
        f"- Skill 版本：`{evidence['skill_version']}`",
        f"- 客户端：{evidence['client']}",
        f"- 环境：{evidence['environment']}",
        f"- 事实截止：`{evidence['as_of']}`",
        f"- 状态：`{evidence['status']}`",
        "",
        "## 实战元数据",
        "",
        *[
            f"- {label}：{metadata_text(evidence['usage_metadata'][field])}"
            for field, label in METADATA_LABELS
        ],
        "",
        "## Review",
        "",
        f"- Agent 状态：`{review['agent_review']['status']}`",
        f"- Agent 摘要：{review['agent_review']['summary']}",
        f"- Maintainer 状态：`{review['maintainer_review']['status']}`",
        f"- Maintainer 摘要：{review['maintainer_review']['summary']}",
        "",
        "## 场景",
        "",
    ]
    for index, scenario in enumerate(evidence["scenarios"], start=1):
        lines.extend(
            [
                f"### {index}. {scenario['id']}",
                "",
                f"- 类型：`{scenario['kind']}`",
                f"- 结果：`{scenario['result']}`",
                f"- 非空输出行数：`{scenario['output_line_count']}`",
                "",
                "#### 输入",
                "",
                *fenced_text(scenario["input"]),
                "",
                "#### 读取文件",
                "",
                *bullet_code(scenario["read_files"]),
                "",
                "#### 输出",
                "",
                *fenced_text(scenario["output"]),
                "",
            ]
        )
    return "\n".join(lines).rstrip() + "\n"


def source_locator(source: Path) -> str:
    try:
        return source.resolve().relative_to(ROOT.resolve()).as_posix()
    except ValueError as exc:
        raise RenderError("canonical evidence must stay inside the Skill directory") from exc


def write_projection(source: Path, output: Path) -> str:
    rendered = render_markdown(load_evidence(source), source_locator(source))
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write(rendered)
    return rendered


def check_projection(source: Path, output: Path) -> None:
    expected = render_markdown(load_evidence(source), source_locator(source))
    try:
        actual = output.read_text(encoding="utf-8-sig")
    except OSError as exc:
        raise RenderError(f"cannot read review projection {output}: {exc}") from exc
    if actual != expected:
        raise RenderError(
            "review projection drift detected; run python scripts/render_real_usage.py"
        )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    try:
        if args.check:
            check_projection(args.source, args.output)
            print(f"real-usage projection is current: {args.output}")
        else:
            write_projection(args.source, args.output)
            print(f"rendered real-usage projection: {args.output}")
    except RenderError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
