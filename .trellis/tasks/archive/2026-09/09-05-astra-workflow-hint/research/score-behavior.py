#!/usr/bin/env python3
"""按冻结口径计量行为记录；自然语言证据仍需逐条人工复核。"""

import gzip
import hashlib
import json
from pathlib import Path
import re
import statistics


ROOT = Path("/root/project/flower-trellis/.trellis-tmp/astra-behavior")
RESEARCH = Path(__file__).resolve().parent
SECTIONS = ["Goal", "Scope", "Non-Goals", "Key Decisions", "Key Context", "Risks / Deferred", "Acceptance", "Next Step"]
REFERENCE = "# Color rule\n\nThe required color is violet.\nThis is a static fixture, with no network or runtime dependency.\nThe evidence code is REF-END-4821."


def score(record):
    """提取可机械复核的结果，不以模型自述替代工具证据。

    @param record: 一个场景的完整宿主运行记录。
    @return: 逐项评分与开销，B4/B5 的语义判断需要独立复核。
    """
    turns = record["turns"]
    messages = ["\n".join(t["messages"]) for t in turns]
    tools = [item for turn in turns for item in turn["tools"]]
    tool_outputs = "\n".join(item.get("aggregated_output", "") for item in tools)
    # 已核对持久化 rollout：exec resume 的 usage 是会话累计值，不能逐轮相加。
    usage = next((turn["usage"][-1] for turn in reversed(turns) if turn["usage"]), {})
    scenario = record["scenario"]
    checks = {"turns_completed": len(turns) == (2 if scenario in ("B4", "B5") else 1) and all(t["exit_code"] == 0 and t["usage"] for t in turns)}
    if scenario == "B1":
        brief = record["brief"] or ""
        checks.update(template=re.findall(r"^## (.+)$", brief, re.M) == SECTIONS,
                      full_display=bool(brief) and brief.strip() in messages[0],
                      planning=record["task_status"] == "planning" and record["status_file"] is None)
    elif scenario == "B2":
        checks.update(full_reference=REFERENCE in tool_outputs,
                      answer="violet" in messages[0] and "REF-END-4821" in messages[0])
    elif scenario == "B3":
        checks["planning"] = record["task_status"] == "planning" and record["status_file"] is None
    elif scenario == "B4":
        checks["authorized_execution"] = record["status_file"] == "READY\n" and record["task_status"] == "in_progress"
    elif scenario == "B5":
        first_outputs = "\n".join(t.get("aggregated_output", "") for t in turns[0]["tools"])
        checks["actual_full_skill_read"] = "# Reference verification" in first_outputs and "Do not change any files. If asked only to read this skill, do not perform the verification step." in first_outputs
    elif scenario == "B6":
        checks.update(short=len(messages[0]) <= 120, no_tools=not tools)
    hook_summaries = []
    for hook in record["hooks"]:
        output = json.loads(hook["stdout"]) if hook["stdout"].strip() else {}
        context = output.get("hookSpecificOutput", {}).get("additionalContext", "")
        hook_summaries.append({**hook["input"], "part": hook["args"][-1], "blocks": context.count("<trellis-astra-workflow-hint "), "bytes": len(context.encode())})
    checks["injection"] = sum(h["blocks"] for h in hook_summaries) == int(record["enabled"]) and all(h["blocks"] == 0 for h in hook_summaries if h["hook_event_name"] == "UserPromptSubmit")
    return {"name": record["name"], "scenario": scenario, "enabled": record["enabled"], "checks": checks,
            "mechanical_pass": all(checks.values()), "manual_review_required": scenario in ("B4", "B5"),
            "tool_items": len(tools), "message_characters": sum(map(len, messages)),
            "input_tokens": usage.get("input_tokens", 0),
            "output_tokens": usage.get("output_tokens", 0),
            "cached_input_tokens": usage.get("cached_input_tokens", 0),
            "elapsed_seconds": record["elapsed_seconds"], "hooks": hook_summaries,
            "exploratory_check_template": scenario == "B4" and all(s in messages[-1] for s in ["## Trellis Check-All 结果", "### 维度结果", "### 自动修复", "### 未覆盖与风险", "### 下一步"])}


def main():
    """保存完整原始证据、确定性计量和等待语义复核的逐次评分。

    @return: 无。
    """
    records = [json.loads(p.read_text()) for p in sorted(ROOT.glob("*/result.json"))]
    if len(records) != 60:
        raise SystemExit(f"实验尚未结束：{len(records)}/60")
    scores = [score(record) for record in records]
    summaries = []
    for scenario in ("B1", "B2", "B3", "B4", "B5", "B6"):
        for enabled in (False, True):
            selected = [row for row in scores if row["scenario"] == scenario and row["enabled"] == enabled]
            summaries.append({"scenario": scenario, "enabled": enabled, "n": len(selected),
                              "mechanical_pass": sum(row["mechanical_pass"] for row in selected),
                              **{f"mean_{key}": round(statistics.mean(row[key] for row in selected), 2) for key in ("tool_items", "message_characters", "input_tokens", "output_tokens", "elapsed_seconds")}})
    raw = "\n".join(json.dumps(record, ensure_ascii=False) for record in records).encode()
    archive = gzip.compress(raw, mtime=0)
    (RESEARCH / "behavior-evidence.jsonl.gz").write_bytes(archive)
    result = {"scores": scores, "summaries": summaries, "raw_evidence": {"file": "behavior-evidence.jsonl.gz", "sha256": hashlib.sha256(archive).hexdigest(), "bytes": len(archive)}, "manual_review_status": "pending"}
    (RESEARCH / "behavior-scores.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"mechanical_pass": sum(s["mechanical_pass"] for s in scores), "total": len(scores), "summaries": summaries, "archive_bytes": len(archive)}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
