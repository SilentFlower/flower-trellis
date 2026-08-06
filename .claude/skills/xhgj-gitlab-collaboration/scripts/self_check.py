#!/usr/bin/env python3
"""Offline asset validation and optional non-sensitive GitLab preflight."""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path, PurePosixPath, PureWindowsPath
from typing import Any, Callable, Dict, Iterable, List, Optional, Sequence, Tuple
from urllib.parse import quote, unquote, urlsplit

from render_real_usage import render_markdown


ROOT = Path(__file__).resolve().parents[1]
EXPECTED_HOST = "gitlab.xhgjdev.com"
LEGACY_NEW_GITLAB_IP = "192.168.27.234"  # sensitive-scan: allow internal-ip documented corporate GitLab endpoint
MINIMUM_ACCESS_LEVEL = 30
COMMAND_TIMEOUT_SECONDS = 20
JSON_CONTENT_TYPE_HEADER = "Content-Type: application/json"
CANONICAL_NAME_PATTERN = re.compile(r"^xhgj-[a-z0-9](?:[a-z0-9-]{0,56}[a-z0-9])?$")
ALIAS_PATTERN = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$")
VERSION_PATTERN = re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+$")
PROJECT_PATH_PATTERN = r"[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)+"
BARE_REFERENCE_PATTERN = re.compile(
    r"(?<![A-Za-z0-9_./-])([!#][0-9]+)(?![0-9A-Za-z_-])"
)
FULL_REFERENCE_PATTERN = re.compile(
    rf"(?<![A-Za-z0-9_.-])(?P<project>{PROJECT_PATH_PATTERN})(?P<ref>[!#][0-9]+)\b"
)
FULL_URL_REFERENCE_PATTERN = re.compile(
    rf"https?://{re.escape(EXPECTED_HOST)}/(?P<project>{PROJECT_PATH_PATTERN})"
    r"/-/(?:merge_requests|issues|work_items)/(?P<iid>[0-9]+)\b"
)
INLINE_CODE_PATTERN = re.compile(r"`+[^`\n]*`+")
FENCED_CODE_PATTERN = re.compile(
    r"(?ms)^[ \t]*(?P<fence>`{3,}|~{3,})[^\n]*\n.*?^[ \t]*(?P=fence)[ \t]*$"
)
DETERMINISTIC_CHECK_KINDS = {
    "cross-project-references",
    "merge-gate",
    "merge-result",
}
SECRET_LITERAL_PATTERNS = (
    re.compile("gl" + r"pat-[A-Za-z0-9_-]{8,}"),
    re.compile("oauth" + r"2:[^\s@]+@", re.IGNORECASE),
    re.compile("private" + r"[_-]?token\s*[=:]\s*[^\s<]{8,}", re.IGNORECASE),
)
REQUIRED_KEYS = {
    "schema_version",
    "name",
    "aliases",
    "status",
    "version",
    "owner",
    "authority",
    "source",
    "entrypoint",
    "self_check",
    "tests",
    "compatibility",
    "upgrade_protection",
    "real_usage",
    "feedback",
}
COMPATIBILITY_KEYS = {
    "skill_format",
    "python",
    "offline",
    "clients",
    "client_verification",
    "project_rule_entries",
}
CLIENT_VERIFICATION_KEYS = {"required_layers", "results"}
CLIENT_VERIFICATION_RESULT_KEYS = {
    "client",
    "verified_layers",
    "as_of",
    "evidence",
    "limitations",
}
REQUIRED_CLIENT_VERIFICATION_LAYERS = ["discovery", "routing", "constraints"]
UPGRADE_KEYS = {"mode", "compare_command", "protected_paths", "on_difference"}
REAL_USAGE_KEYS = {
    "status",
    "evidence",
    "review_projection",
    "environment",
    "review_status",
    "as_of",
}
USAGE_METADATA_FIELDS = {
    "tool",
    "client_version",
    "model_snapshot",
    "session_id",
    "collected_at",
    "collection_method",
    "operating_system",
    "shell",
    "node_version",
    "browser_version",
    "asset_version",
}
REQUIRED_COLLECTED_METADATA_FIELDS = {
    "collected_at",
    "collection_method",
    "asset_version",
}
METADATA_UNAVAILABLE_VALUES = {
    "unknown",
    "not-collected",
    "client-not-exposed",
    "user-not-confirmed",
    "not-applicable",
}
REQUIRED_CASE_KINDS = {
    "positive-preflight",
    "wrong-host",
    "unauthenticated",
    "insufficient-role",
    "context-stale",
    "payload-mismatch",
    "required-source-unreachable",
    "worktree-branch-mismatch",
    "wrong-branch-committed",
    "ambiguous-target",
    "write-readback-failure",
    "high-impact-request",
    "worktime-recording",
    "worktime-unconfirmed",
    "worktime-duplicate",
    "worktime-readback-mismatch",
    "quick-action-injection",
    "commit-content-advisory",
    "commit-content-advisory-override",
    "cross-project-bare-ref",
    "render-readback-missing",
    "merge-gate-incomplete",
    "merge-result-unverified",
    "cross-project-render-link-wrong",
}
ROLE_NAMES = {
    0: "No access",
    5: "Minimal Access",
    10: "Guest",
    15: "Planner",
    20: "Reporter",
    30: "Developer",
    40: "Maintainer",
    50: "Owner",
}


class CheckError(Exception):
    """A deterministic self-check or live preflight failure."""


CommandRunner = Callable[[Sequence[str], Optional[Path]], subprocess.CompletedProcess]


def load_json_compatible(path: Path) -> Dict[str, Any]:
    try:
        lines = path.read_text(encoding="utf-8-sig").splitlines()
    except OSError as exc:
        raise CheckError(f"cannot read {path}: {exc}") from exc
    payload = "\n".join(line for line in lines if not line.lstrip().startswith("#"))
    try:
        value = json.loads(payload)
    except json.JSONDecodeError as exc:
        raise CheckError(f"{path}: expected JSON-compatible content: {exc}") from exc
    if not isinstance(value, dict):
        raise CheckError(f"{path}: root must be an object")
    return value


def require_exact_keys(value: Any, expected: set[str], label: str) -> Dict[str, Any]:
    if not isinstance(value, dict):
        raise CheckError(f"{label}: must be an object")
    if set(value) != expected:
        raise CheckError(
            f"{label}: fields must be exactly {sorted(expected)}; got {sorted(value)}"
        )
    return value


def require_string(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise CheckError(f"{label}: must be a non-empty string")
    return value


def require_string_array(
    value: Any, label: str, *, allow_empty: bool = False
) -> List[str]:
    if not isinstance(value, list) or (not allow_empty and not value):
        suffix = "an array" if allow_empty else "a non-empty array"
        raise CheckError(f"{label}: must be {suffix}")
    if not all(isinstance(item, str) and item.strip() for item in value):
        raise CheckError(f"{label}: items must be non-empty strings")
    if len(value) != len(set(value)):
        raise CheckError(f"{label}: values must be unique")
    return value


def require_bool(value: Any, label: str) -> bool:
    if not isinstance(value, bool):
        raise CheckError(f"{label}: must be a boolean")
    return value


def validate_client_verification(value: Any, clients: List[str]) -> None:
    verification = require_exact_keys(
        value, CLIENT_VERIFICATION_KEYS, "compatibility.client_verification"
    )
    required_layers = verification["required_layers"]
    if required_layers != REQUIRED_CLIENT_VERIFICATION_LAYERS:
        raise CheckError(
            "compatibility.client_verification.required_layers must be "
            "discovery, routing and constraints"
        )
    results = verification["results"]
    if not isinstance(results, list) or not results:
        raise CheckError("compatibility.client_verification.results must be non-empty")
    seen_clients = []
    fully_verified_clients = []
    for index, raw_result in enumerate(results):
        label = f"compatibility.client_verification.results[{index}]"
        result = require_exact_keys(raw_result, CLIENT_VERIFICATION_RESULT_KEYS, label)
        client = require_string(result["client"], f"{label}.client")
        if client in seen_clients:
            raise CheckError(f"{label}.client must be unique")
        seen_clients.append(client)
        layers = require_string_array(result["verified_layers"], f"{label}.verified_layers")
        if (
            any(layer not in required_layers for layer in layers)
            or layers != [layer for layer in required_layers if layer in layers]
        ):
            raise CheckError(
                f"{label}.verified_layers must be an ordered subset of {required_layers}"
            )
        try:
            dt.date.fromisoformat(result["as_of"])
        except (TypeError, ValueError) as exc:
            raise CheckError(f"{label}.as_of must be YYYY-MM-DD") from exc
        evidence = require_string_array(result["evidence"], f"{label}.evidence")
        if any(
            not locator.startswith(("skill:", "repo:"))
            or not locator.split(":", 1)[1].strip()
            for locator in evidence
        ):
            raise CheckError(f"{label}.evidence must use skill: or repo: locators")
        require_string_array(
            result["limitations"], f"{label}.limitations", allow_empty=True
        )
        if layers == required_layers:
            fully_verified_clients.append(client)
    if clients != fully_verified_clients:
        raise CheckError(
            "compatibility.clients must exactly match clients verified for "
            "discovery, routing and constraints"
        )


def require_optional_bool(value: Any, label: str) -> Optional[bool]:
    if value is not None and not isinstance(value, bool):
        raise CheckError(f"{label}: must be a boolean or null")
    return value


def require_string_map(value: Any, label: str) -> Dict[str, str]:
    if not isinstance(value, dict):
        raise CheckError(f"{label}: must be an object")
    result = {}
    for key, item in value.items():
        result[require_string(key, f"{label}.key")] = require_string(
            item, f"{label}[{key!r}]"
        )
    return result


def resolve_local_path(root: Path, raw_path: str, label: str) -> Path:
    require_string(raw_path, label)
    if (
        Path(raw_path).is_absolute()
        or PurePosixPath(raw_path).is_absolute()
        or PureWindowsPath(raw_path).anchor
    ):
        raise CheckError(f"{label}: absolute paths are not allowed")
    candidate = (root / raw_path).resolve()
    try:
        candidate.relative_to(root.resolve())
    except ValueError as exc:
        raise CheckError(f"{label}: path escapes the skill directory") from exc
    return candidate


def parse_skill_frontmatter(path: Path) -> Dict[str, str]:
    lines = path.read_text(encoding="utf-8-sig").splitlines()
    if not lines or lines[0] != "---":
        raise CheckError("SKILL.md: missing frontmatter")
    try:
        end = lines.index("---", 1)
    except ValueError as exc:
        raise CheckError("SKILL.md: missing closing frontmatter") from exc
    data: Dict[str, str] = {}
    for line in lines[1:end]:
        if not line.strip():
            continue
        if ":" not in line:
            raise CheckError(f"SKILL.md: unsupported frontmatter line {line!r}")
        key, value = line.split(":", 1)
        data[key.strip()] = value.strip()
    if set(data) != {"name", "description"}:
        raise CheckError("SKILL.md: frontmatter must contain only name and description")
    if not data["description"] or "TODO" in data["description"]:
        raise CheckError("SKILL.md: description must be complete")
    return data


def mask_markdown_code(text: str) -> str:
    masked = FENCED_CODE_PATTERN.sub("", text)
    return INLINE_CODE_PATTERN.sub("", masked)


def extract_cross_project_references(
    body: str, current_project: str
) -> Dict[str, str]:
    references: Dict[str, str] = {}
    for match in FULL_REFERENCE_PATTERN.finditer(body):
        project = match.group("project")
        if project != current_project:
            references[match.group(0)] = project
    for match in FULL_URL_REFERENCE_PATTERN.finditer(body):
        project = match.group("project")
        if project != current_project:
            references[match.group(0)] = project
    return references


def require_no_unconfirmed_bare_refs(
    body: str, confirmed_local_refs: Sequence[str]
) -> None:
    found = {match.group(1) for match in BARE_REFERENCE_PATTERN.finditer(body)}
    confirmed = set(confirmed_local_refs)
    if any(not re.fullmatch(r"[!#][0-9]+", item) for item in confirmed):
        raise CheckError("confirmed-local-ref-invalid")
    if not confirmed <= found:
        raise CheckError("confirmed-local-ref-not-found")
    if found - confirmed:
        raise CheckError("cross-project-bare-ref")


def require_render_target(locator: str, actual_project: Optional[str]) -> None:
    if not actual_project:
        raise CheckError("render-readback-missing")


def require_render_target_project(
    expected_project: str, actual_project: str
) -> None:
    if actual_project != expected_project:
        raise CheckError("cross-project-render-link-wrong")


def validate_cross_project_evidence(value: Any) -> None:
    evidence = require_exact_keys(
        value,
        {"current_project", "body", "confirmed_local_refs", "rendered_targets"},
        "cross-project evidence",
    )
    current_project = require_string(
        evidence["current_project"], "cross-project evidence.current_project"
    )
    body = mask_markdown_code(
        require_string(evidence["body"], "cross-project evidence.body")
    )
    confirmed_local_refs = require_string_array(
        evidence["confirmed_local_refs"],
        "cross-project evidence.confirmed_local_refs",
        allow_empty=True,
    )
    rendered_targets = require_string_map(
        evidence["rendered_targets"], "cross-project evidence.rendered_targets"
    )
    require_no_unconfirmed_bare_refs(body, confirmed_local_refs)
    expected_targets = extract_cross_project_references(body, current_project)
    if set(rendered_targets) - set(expected_targets):
        raise CheckError("render-readback-unexpected-target")
    for locator, expected_project in expected_targets.items():
        actual_project = rendered_targets.get(locator)
        require_render_target(locator, actual_project)
        require_render_target_project(expected_project, actual_project or "")


def validate_merge_gate(value: Any) -> None:
    evidence = require_exact_keys(
        value,
        {
            "uses_pipeline_as_admission_evidence",
            "pipeline_content_trusted",
            "project_setting_readback",
            "only_allow_merge_if_pipeline_succeeds",
            "alternative_evidence",
        },
        "merge-gate evidence",
    )
    uses_pipeline = require_bool(
        evidence["uses_pipeline_as_admission_evidence"],
        "merge-gate evidence.uses_pipeline_as_admission_evidence",
    )
    content_trusted = require_bool(
        evidence["pipeline_content_trusted"],
        "merge-gate evidence.pipeline_content_trusted",
    )
    setting_readback = require_bool(
        evidence["project_setting_readback"],
        "merge-gate evidence.project_setting_readback",
    )
    setting = require_optional_bool(
        evidence["only_allow_merge_if_pipeline_succeeds"],
        "merge-gate evidence.only_allow_merge_if_pipeline_succeeds",
    )
    alternative = evidence["alternative_evidence"]
    if not isinstance(alternative, str):
        raise CheckError("merge-gate evidence.alternative_evidence: must be a string")
    if uses_pipeline:
        if not content_trusted or not setting_readback or setting is not True:
            raise CheckError("merge-gate-incomplete")
    elif not alternative.strip():
        raise CheckError("merge-gate-incomplete")


def validate_merge_result(value: Any) -> None:
    evidence = require_exact_keys(
        value,
        {
            "merged",
            "project_squash_option",
            "mr_squash",
            "expected_squash",
            "method_comparison_complete",
            "result_readback",
            "squash_commit_sha",
        },
        "merge-result evidence",
    )
    merged = require_bool(evidence["merged"], "merge-result evidence.merged")
    option = require_string(
        evidence["project_squash_option"],
        "merge-result evidence.project_squash_option",
    )
    if option not in {"never", "always", "default_on", "default_off"}:
        raise CheckError("merge-result-project-squash-option-invalid")
    mr_squash = require_bool(
        evidence["mr_squash"], "merge-result evidence.mr_squash"
    )
    expected_squash = require_bool(
        evidence["expected_squash"], "merge-result evidence.expected_squash"
    )
    comparison_complete = require_bool(
        evidence["method_comparison_complete"],
        "merge-result evidence.method_comparison_complete",
    )
    result_readback = require_bool(
        evidence["result_readback"], "merge-result evidence.result_readback"
    )
    squash_commit_sha = evidence["squash_commit_sha"]
    if squash_commit_sha is not None and not isinstance(squash_commit_sha, str):
        raise CheckError("merge-result evidence.squash_commit_sha: must be string or null")
    if not comparison_complete or mr_squash != expected_squash:
        raise CheckError("merge-result-unverified")
    if option == "never" and expected_squash:
        raise CheckError("merge-result-method-conflicts-with-project")
    if option == "always" and not expected_squash:
        raise CheckError("merge-result-method-conflicts-with-project")
    if merged:
        if not result_readback:
            raise CheckError("merge-result-unverified")
        has_squash_sha = bool(squash_commit_sha and squash_commit_sha.strip())
        if has_squash_sha != expected_squash:
            raise CheckError("merge-result-mismatch")
    elif result_readback or squash_commit_sha:
        raise CheckError("merge-result-unverified")


def validate_deterministic_check(kind: str, value: Any) -> None:
    if kind == "cross-project-references":
        validate_cross_project_evidence(value)
    elif kind == "merge-gate":
        validate_merge_gate(value)
    elif kind == "merge-result":
        validate_merge_result(value)
    else:
        raise CheckError(f"deterministic-check-kind-unsupported: {kind}")


def validate_operation_evidence(value: Any) -> Dict[str, Any]:
    evidence = require_exact_keys(
        value, {"schema_version", "checks"}, "operation evidence"
    )
    if evidence["schema_version"] != 1:
        raise CheckError("operation evidence.schema_version must be 1")
    checks = evidence["checks"]
    if not isinstance(checks, list) or not checks:
        raise CheckError("operation evidence.checks must be a non-empty array")
    ids = set()
    kinds = set()
    for index, item in enumerate(checks):
        label = f"operation evidence.checks[{index}]"
        check = require_exact_keys(item, {"id", "kind", "input"}, label)
        check_id = require_string(check["id"], f"{label}.id")
        if check_id in ids:
            raise CheckError(f"{label}.id: duplicate {check_id!r}")
        ids.add(check_id)
        kind = require_string(check["kind"], f"{label}.kind")
        kinds.add(kind)
        validate_deterministic_check(kind, check["input"])
    return {"checks": len(checks), "kinds": sorted(kinds)}


def validate_operation_evidence_file(path: Path) -> Dict[str, Any]:
    return validate_operation_evidence(load_json_compatible(path))


def validate_cases(path: Path) -> Tuple[int, int]:
    data = load_json_compatible(path)
    require_exact_keys(
        data,
        {
            "schema_version",
            "required_output_sections",
            "cases",
            "deterministic_cases",
        },
        "tests/cases.json",
    )
    if data["schema_version"] != 2:
        raise CheckError("tests/cases.json: schema_version must be 2")
    sections = require_string_array(
        data["required_output_sections"], "tests/cases.json.required_output_sections"
    )
    if sections != ["当前目标", "已确认事实", "停止条件", "未执行动作", "下一步"]:
        raise CheckError("tests/cases.json: output sections do not match the Skill contract")
    cases = data["cases"]
    if not isinstance(cases, list) or not cases:
        raise CheckError("tests/cases.json: cases must be non-empty")
    kinds = set()
    ids = set()
    for index, case in enumerate(cases):
        label = f"tests/cases.json.cases[{index}]"
        require_exact_keys(
            case,
            {"id", "kind", "prompt", "expected_sources", "expected_action"},
            label,
        )
        case_id = require_string(case["id"], f"{label}.id")
        if case_id in ids:
            raise CheckError(f"{label}.id: duplicate {case_id!r}")
        ids.add(case_id)
        kinds.add(require_string(case["kind"], f"{label}.kind"))
        require_string(case["prompt"], f"{label}.prompt")
        require_string_array(
            case["expected_sources"], f"{label}.expected_sources", allow_empty=True
        )
        require_string(case["expected_action"], f"{label}.expected_action")
    missing = sorted(REQUIRED_CASE_KINDS - kinds)
    if missing:
        raise CheckError(f"tests/cases.json: missing scenario kinds {missing}")
    deterministic_cases = data["deterministic_cases"]
    if not isinstance(deterministic_cases, list) or not deterministic_cases:
        raise CheckError("tests/cases.json: deterministic_cases must be non-empty")
    deterministic_ids = set()
    deterministic_kinds = set()
    for index, item in enumerate(deterministic_cases):
        label = f"tests/cases.json.deterministic_cases[{index}]"
        case = require_exact_keys(
            item, {"id", "kind", "input", "expected_error"}, label
        )
        case_id = require_string(case["id"], f"{label}.id")
        if case_id in deterministic_ids:
            raise CheckError(f"{label}.id: duplicate {case_id!r}")
        deterministic_ids.add(case_id)
        kind = require_string(case["kind"], f"{label}.kind")
        deterministic_kinds.add(kind)
        expected_error = require_string(
            case["expected_error"], f"{label}.expected_error"
        )
        try:
            validate_deterministic_check(kind, case["input"])
        except CheckError as exc:
            if str(exc) != expected_error:
                raise CheckError(
                    f"deterministic case {case_id}: expected {expected_error}, got {exc}"
                ) from exc
        else:
            raise CheckError(
                f"deterministic case {case_id}: expected {expected_error} but passed"
            )
    missing_deterministic = sorted(
        DETERMINISTIC_CHECK_KINDS - deterministic_kinds
    )
    if missing_deterministic:
        raise CheckError(
            "tests/cases.json: missing deterministic kinds "
            + str(missing_deterministic)
        )
    return len(cases), len(deterministic_cases)


def validate_usage_metadata(metadata: Any, version: str) -> None:
    values = require_exact_keys(
        metadata, USAGE_METADATA_FIELDS, "real usage evidence.usage_metadata"
    )
    for field in USAGE_METADATA_FIELDS:
        item = values[field]
        label = f"real usage evidence.usage_metadata.{field}"
        if not isinstance(item, dict):
            raise CheckError(f"{label} must be an object")
        if set(item) == {"value"}:
            value = require_string(item["value"], f"{label}.value")
        elif set(item) == {"unavailable"}:
            if item["unavailable"] not in METADATA_UNAVAILABLE_VALUES:
                raise CheckError(f"{label}.unavailable is invalid")
            if field in REQUIRED_COLLECTED_METADATA_FIELDS:
                raise CheckError(f"{label} must use a collected value")
            continue
        else:
            raise CheckError(f"{label} must contain exactly value or unavailable")
        if field == "collected_at":
            try:
                collected_at = dt.datetime.fromisoformat(value)
            except ValueError as exc:
                raise CheckError(f"{label}.value must be an ISO-8601 datetime") from exc
            if collected_at.tzinfo is None or collected_at.utcoffset() is None:
                raise CheckError(f"{label}.value must include a timezone offset")
        if field == "asset_version" and value != version:
            raise CheckError(f"{label}.value must match skill_version")


def validate_usage_evidence(
    path: Path, version: str, expected_status: str, expected_review_status: str
) -> Dict[str, Any]:
    data = load_json_compatible(path)
    require_exact_keys(
        data,
        {
            "schema_version",
            "skill_version",
            "client",
            "environment",
            "as_of",
            "status",
            "usage_metadata",
            "scenarios",
            "review",
        },
        "real usage evidence",
    )
    if data["schema_version"] != 2 or data["skill_version"] != version:
        raise CheckError("real usage evidence: schema or skill version mismatch")
    if data["status"] != expected_status:
        raise CheckError("real usage status must match its evidence")
    try:
        dt.date.fromisoformat(data["as_of"])
    except (TypeError, ValueError) as exc:
        raise CheckError("real usage evidence.as_of must be YYYY-MM-DD") from exc
    for field in ("client", "environment"):
        require_string(data[field], f"real usage evidence.{field}")
    validate_usage_metadata(data["usage_metadata"], version)
    scenarios = data["scenarios"]
    if not isinstance(scenarios, list):
        raise CheckError("real usage evidence.scenarios must be an array")
    seen_ids = set()
    for index, scenario in enumerate(scenarios):
        label = f"real usage evidence.scenarios[{index}]"
        require_exact_keys(
            scenario,
            {
                "id",
                "kind",
                "input",
                "read_files",
                "output",
                "output_line_count",
                "result",
            },
            label,
        )
        scenario_id = require_string(scenario["id"], f"{label}.id")
        if scenario_id in seen_ids:
            raise CheckError(f"{label}.id: duplicate {scenario_id!r}")
        seen_ids.add(scenario_id)
        require_string(scenario["kind"], f"{label}.kind")
        require_string(scenario["input"], f"{label}.input")
        require_string_array(
            scenario["read_files"], f"{label}.read_files", allow_empty=True
        )
        output = require_string(scenario["output"], f"{label}.output")
        non_empty_lines = [line for line in output.splitlines() if line.strip()]
        if scenario["output_line_count"] != len(non_empty_lines):
            raise CheckError(f"{label}.output_line_count does not match output")
        result = require_string(scenario["result"], f"{label}.result")
        if expected_status == "pending" and result != "pending":
            raise CheckError(f"{label}.result must remain pending")
        if expected_status != "pending" and result == "pending":
            raise CheckError(f"{label}.result cannot remain pending")
    review = require_exact_keys(
        data["review"], {"agent_review", "maintainer_review"}, "real usage review"
    )
    agent = require_exact_keys(
        review["agent_review"], {"status", "summary"}, "agent review"
    )
    maintainer = require_exact_keys(
        review["maintainer_review"], {"status", "summary"}, "Maintainer review"
    )
    if agent["status"] not in {"pending", "passed", "failed"}:
        raise CheckError("agent review status is invalid")
    if maintainer["status"] not in {
        "pending-maintainer-review",
        "passed",
        "changes-requested",
    }:
        raise CheckError("Maintainer review status is invalid")
    require_string(agent["summary"], "agent review.summary")
    require_string(maintainer["summary"], "Maintainer review.summary")
    if expected_status != "pending" and agent["status"] == "pending":
        raise CheckError("executed real usage requires a completed agent review")
    if maintainer["status"] != expected_review_status:
        raise CheckError("Maintainer review status must match its evidence")
    return data


def scan_secret_literals(root: Path) -> int:
    scanned = 0
    for path in sorted(root.rglob("*")):
        if not path.is_file() or "__pycache__" in path.parts or path.suffix == ".pyc":
            continue
        try:
            text = path.read_text(encoding="utf-8-sig")
        except UnicodeDecodeError as exc:
            raise CheckError(f"non-UTF-8 asset detected: {path.relative_to(root)}") from exc
        scanned += 1
        for pattern in SECRET_LITERAL_PATTERNS:
            if pattern.search(text):
                raise CheckError(
                    f"credential-like literal detected in {path.relative_to(root).as_posix()}"
                )
    return scanned


def validate_skill(root: Path = ROOT) -> Dict[str, Any]:
    contract = require_exact_keys(
        load_json_compatible(root / "contract.yaml"), REQUIRED_KEYS, "contract.yaml"
    )
    if contract["schema_version"] != 2:
        raise CheckError("contract.yaml.schema_version must be 2")
    name = require_string(contract["name"], "contract.yaml.name")
    if not CANONICAL_NAME_PATTERN.fullmatch(name) or root.name != name:
        raise CheckError("contract.yaml.name must be xhgj-<domain> and match the directory")
    aliases = require_string_array(
        contract["aliases"], "contract.yaml.aliases", allow_empty=True
    )
    if any(
        not ALIAS_PATTERN.fullmatch(alias) or alias.startswith("xhgj-")
        for alias in aliases
    ) or name in aliases:
        raise CheckError("contract.yaml.aliases must stay outside the xhgj- namespace")
    if contract["status"] not in {"incubating", "migrating", "active", "superseded"}:
        raise CheckError("contract.yaml.status is invalid")
    version = require_string(contract["version"], "contract.yaml.version")
    if not VERSION_PATTERN.fullmatch(version):
        raise CheckError("contract.yaml.version must be semantic x.y.z")
    for field in ("owner", "authority", "source", "feedback"):
        require_string(contract[field], f"contract.yaml.{field}")

    entrypoint = resolve_local_path(root, contract["entrypoint"], "entrypoint")
    self_check = resolve_local_path(root, contract["self_check"], "self_check")
    if not entrypoint.is_file() or not self_check.is_file():
        raise CheckError("contract entrypoint and self_check must exist")
    if parse_skill_frontmatter(entrypoint)["name"] != name:
        raise CheckError("SKILL.md name does not match contract.yaml")

    tests = require_string_array(contract["tests"], "contract.yaml.tests")
    test_paths = []
    for index, raw_path in enumerate(tests):
        path = resolve_local_path(root, raw_path, f"tests[{index}]")
        if not path.is_file():
            raise CheckError(f"tests[{index}]: missing file {raw_path!r}")
        test_paths.append(path)
    case_count, deterministic_case_count = validate_cases(
        root / "tests" / "cases.json"
    )

    compatibility = require_exact_keys(
        contract["compatibility"], COMPATIBILITY_KEYS, "compatibility"
    )
    if compatibility["offline"] is not True:
        raise CheckError("compatibility.offline must be true")
    clients = require_string_array(compatibility["clients"], "compatibility.clients")
    validate_client_verification(compatibility["client_verification"], clients)
    require_string_array(
        compatibility["project_rule_entries"],
        "compatibility.project_rule_entries",
        allow_empty=True,
    )
    for field in ("skill_format", "python"):
        require_string(compatibility[field], f"compatibility.{field}")

    upgrade = require_exact_keys(
        contract["upgrade_protection"], UPGRADE_KEYS, "upgrade_protection"
    )
    if upgrade["mode"] != "detect-and-stop":
        raise CheckError("upgrade_protection.mode must be detect-and-stop")
    if "self_check.py --compare" not in require_string(
        upgrade["compare_command"], "upgrade_protection.compare_command"
    ):
        raise CheckError("upgrade_protection.compare_command must invoke --compare")
    if "never overwrite" not in require_string(
        upgrade["on_difference"], "upgrade_protection.on_difference"
    ):
        raise CheckError("upgrade differences must never overwrite")
    protected_paths = require_string_array(
        upgrade["protected_paths"], "upgrade_protection.protected_paths"
    )
    protected_resolved = []
    for index, raw_path in enumerate(protected_paths):
        path = resolve_local_path(root, raw_path, f"protected_paths[{index}]")
        if not path.exists():
            raise CheckError(f"protected_paths[{index}]: missing {raw_path!r}")
        protected_resolved.append(path)

    usage = require_exact_keys(contract["real_usage"], REAL_USAGE_KEYS, "real_usage")
    if usage["status"] not in {"pending", "executed", "passed", "failed"}:
        raise CheckError("real_usage.status is invalid")
    if usage["review_status"] not in {
        "pending-maintainer-review",
        "passed",
        "changes-requested",
    }:
        raise CheckError("real_usage.review_status is invalid")
    require_string(usage["environment"], "real_usage.environment")
    try:
        dt.date.fromisoformat(usage["as_of"])
    except (TypeError, ValueError) as exc:
        raise CheckError("real_usage.as_of must be YYYY-MM-DD") from exc
    evidence_path = resolve_local_path(root, usage["evidence"], "real_usage.evidence")
    projection_path = resolve_local_path(
        root, usage["review_projection"], "real_usage.review_projection"
    )
    if not evidence_path.is_file() or not projection_path.is_file():
        raise CheckError("real usage evidence and projection must exist")
    for path in [*test_paths, evidence_path, projection_path]:
        if not any(item == path or item in path.parents for item in protected_resolved):
            raise CheckError(
                f"{path.relative_to(root).as_posix()} must be upgrade-protected"
            )
    evidence = validate_usage_evidence(
        evidence_path, version, usage["status"], usage["review_status"]
    )
    expected_projection = render_markdown(evidence, Path(usage["evidence"]).as_posix())
    if projection_path.read_text(encoding="utf-8-sig") != expected_projection:
        raise CheckError(
            "real usage review projection drift detected; run render_real_usage.py"
        )
    if contract["status"] == "active" and (
        usage["status"] != "passed" or usage["review_status"] != "passed"
    ):
        raise CheckError("active skill requires passed usage and Maintainer review")

    return {
        "skill": name,
        "version": version,
        "status": contract["status"],
        "cases": case_count,
        "deterministic_cases": deterministic_case_count,
        "usage_status": usage["status"],
        "review_status": usage["review_status"],
        "protected_paths": protected_paths,
        "scanned_text_files": scan_secret_literals(root),
    }


def iter_protected_files(root: Path, paths: Sequence[str]) -> Iterable[Path]:
    for raw_path in paths:
        path = resolve_local_path(root, raw_path, "protected path")
        if path.is_file():
            yield path
        elif path.is_dir():
            yield from sorted(
                item
                for item in path.rglob("*")
                if item.is_file()
                and "__pycache__" not in item.parts
                and item.suffix != ".pyc"
            )


def digest_map(root: Path, paths: Sequence[str]) -> Dict[str, str]:
    digests = {}
    for path in iter_protected_files(root, paths):
        try:
            content = path.read_bytes().decode("utf-8")
        except UnicodeDecodeError as exc:
            raise CheckError(f"protected file is not valid UTF-8: {path}") from exc
        normalized = content.replace("\r\n", "\n")
        digests[path.relative_to(root).as_posix()] = hashlib.sha256(
            normalized.encode("utf-8")
        ).hexdigest()
    return digests


def installed_version(installed_root: Path) -> str:
    contract = load_json_compatible(installed_root / "contract.yaml")
    name = require_string(contract.get("name"), "installed contract.name")
    if name != ROOT.name:
        raise CheckError(
            f"compare target skill mismatch: expected {ROOT.name}, got {name}"
        )
    version = require_string(contract.get("version"), "installed contract.version")
    if not VERSION_PATTERN.fullmatch(version):
        raise CheckError("installed contract.version must be semantic x.y.z")
    return version


def compare_installation(
    reference_root: Path, installed_root: Path, paths: Sequence[str]
) -> List[str]:
    if not installed_root.is_dir():
        raise CheckError(f"compare target is not a directory: {installed_root}")
    reference = digest_map(reference_root, paths)
    installed = digest_map(installed_root, paths)
    return [
        path
        for path in sorted(set(reference) | set(installed))
        if reference.get(path) != installed.get(path)
    ]


def subprocess_runner(
    argv: Sequence[str], cwd: Optional[Path] = None
) -> subprocess.CompletedProcess[str]:
    try:
        result = subprocess.run(
            list(argv),
            cwd=str(cwd) if cwd else None,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=COMMAND_TIMEOUT_SECONDS,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired, IndexError) as exc:
        raise CheckError("preflight-command-unavailable") from exc
    try:
        stdout = result.stdout.decode("utf-8")
        stderr = result.stderr.decode("utf-8")
    except (AttributeError, UnicodeDecodeError) as exc:
        raise CheckError("preflight-output-not-utf8") from exc
    return subprocess.CompletedProcess(result.args, result.returncode, stdout, stderr)


def glab_json_input_args(
    glab: str,
    *,
    host: str,
    method: str,
    endpoint: str,
    input_path: str = "-",
) -> List[str]:
    if host != EXPECTED_HOST:
        raise CheckError("wrong-host")
    normalized_method = method.upper()
    if normalized_method not in {"POST", "PUT", "PATCH"}:
        raise CheckError("gitlab-json-method-unsupported")
    if not endpoint or not input_path:
        raise CheckError("gitlab-json-input-incomplete")
    return [
        glab,
        "api",
        "--hostname",
        host,
        "--method",
        normalized_method,
        "--header",
        JSON_CONTENT_TYPE_HEADER,
        "--input",
        input_path,
        endpoint,
    ]


def normalize_gitlab_text(value: str) -> str:
    """Normalize only terminal CR/LF characters used by GitLab text fields."""

    return value.rstrip("\r\n")


def compare_gitlab_text(expected: str, actual: str) -> Dict[str, Any]:
    expected_normalized = normalize_gitlab_text(expected)
    actual_normalized = normalize_gitlab_text(actual)

    def digest(value: str) -> str:
        return hashlib.sha256(value.encode("utf-8")).hexdigest()

    return {
        "equal": expected_normalized == actual_normalized,
        "normalization": "trim-terminal-crlf-only",
        "expected_raw_sha256": digest(expected),
        "actual_raw_sha256": digest(actual),
        "expected_normalized_sha256": digest(expected_normalized),
        "actual_normalized_sha256": digest(actual_normalized),
    }


def run_command(
    runner: CommandRunner,
    argv: Sequence[str],
    *,
    cwd: Optional[Path] = None,
    error_code: str,
) -> str:
    result = runner(argv, cwd)
    if result.returncode != 0:
        raise CheckError(error_code)
    return result.stdout


def load_selected_json(raw: str, label: str) -> Dict[str, Any]:
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise CheckError(f"{label}-invalid-response") from exc
    if not isinstance(value, dict):
        raise CheckError(f"{label}-invalid-response")
    return value


def access_level(value: Any) -> int:
    if not isinstance(value, dict):
        return 0
    level = value.get("access_level", 0)
    return level if isinstance(level, int) else 0


def role_name(level: int) -> str:
    eligible = [key for key in ROLE_NAMES if key <= level]
    return ROLE_NAMES[max(eligible)] if eligible else "No access"


def parse_remote(raw: str, expected_project: str) -> Dict[str, str]:
    value = raw.strip()
    parsed = urlsplit(value)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise CheckError("remote-transport-unsupported")
    if parsed.username is not None or parsed.password is not None:
        raise CheckError("credential-embedded-in-remote")
    host = parsed.hostname.lower()
    if host == EXPECTED_HOST:
        remote_form = "hostname-form"
    elif host == LEGACY_NEW_GITLAB_IP:
        remote_form = "ip-form"
    else:
        raise CheckError("remote-host-mismatch")
    project_path = unquote(parsed.path).strip("/")
    if project_path.endswith(".git"):
        project_path = project_path[:-4]
    if project_path != expected_project:
        raise CheckError("remote-project-mismatch")
    return {
        "scheme": parsed.scheme,
        "host": host,
        "form": remote_form,
        "project": project_path,
    }


def live_preflight(
    *,
    host: str,
    project: str,
    repo: Path,
    expected_username: str,
    expected_name: str,
    expected_email: str,
    expected_branch: Optional[str],
    glab_path: Optional[str],
    runner: CommandRunner = subprocess_runner,
) -> Dict[str, Any]:
    if host != EXPECTED_HOST:
        raise CheckError("wrong-host")
    if not project or project.startswith("/") or project.endswith("/") or "/" not in project:
        raise CheckError("invalid-project-path")
    if not repo.is_dir():
        raise CheckError("repository-directory-unavailable")
    glab = glab_path or shutil.which("glab")
    if not glab:
        raise CheckError("glab-not-installed")

    run_command(runner, [glab, "version"], error_code="glab-not-runnable")
    run_command(
        runner,
        [glab, "auth", "status", "--hostname", host],
        error_code="gitlab-not-authenticated",
    )
    user = load_selected_json(
        run_command(
            runner,
            [glab, "api", "--hostname", host, "user"],
            error_code="gitlab-user-unreadable",
        ),
        "gitlab-user",
    )
    username = user.get("username")
    user_name = user.get("name")
    if username != expected_username:
        raise CheckError("gitlab-user-mismatch")

    encoded_project = quote(project, safe="")
    project_data = load_selected_json(
        run_command(
            runner,
            [glab, "api", "--hostname", host, f"projects/{encoded_project}"],
            error_code="gitlab-project-unreadable",
        ),
        "gitlab-project",
    )
    if project_data.get("path_with_namespace") != project:
        raise CheckError("gitlab-project-mismatch")
    permissions = project_data.get("permissions")
    if not isinstance(permissions, dict):
        permissions = {}
    direct_level = access_level(permissions.get("project_access"))
    inherited_level = access_level(permissions.get("group_access"))
    effective_level = max(direct_level, inherited_level)
    if effective_level < MINIMUM_ACCESS_LEVEL:
        raise CheckError("gitlab-role-below-developer")
    if direct_level and inherited_level:
        access_source = "direct-and-group"
    elif direct_level:
        access_source = "direct"
    elif inherited_level:
        access_source = "group-inherited"
    else:
        access_source = "unknown"

    git_prefix = ["git", "-C", str(repo.resolve())]
    remote = parse_remote(
        run_command(
            runner,
            [*git_prefix, "remote", "get-url", "origin"],
            error_code="origin-unreadable",
        ),
        project,
    )
    git_name = run_command(
        runner,
        [*git_prefix, "config", "user.name"],
        error_code="git-name-unreadable",
    ).strip()
    git_email = run_command(
        runner,
        [*git_prefix, "config", "user.email"],
        error_code="git-email-unreadable",
    ).strip()
    if git_name != expected_name or git_email.casefold() != expected_email.casefold():
        raise CheckError("git-identity-mismatch")
    branch = run_command(
        runner,
        [*git_prefix, "branch", "--show-current"],
        error_code="git-branch-unreadable",
    ).strip()
    if expected_branch and branch != expected_branch:
        raise CheckError("git-branch-mismatch")
    status_lines = run_command(
        runner,
        [*git_prefix, "status", "--porcelain=v1", "-b"],
        error_code="git-status-unreadable",
    ).splitlines()
    dirty = any(line and not line.startswith("##") for line in status_lines)

    return {
        "mode": "live-read-only",
        "host": host,
        "username": username,
        "user_name": user_name if isinstance(user_name, str) else "",
        "project": project,
        "access": {
            "effective_level": effective_level,
            "role": role_name(effective_level),
            "source": access_source,
            "direct_level": direct_level,
            "inherited_level": inherited_level,
        },
        "remote": remote,
        "git_identity": {"name": git_name, "email": git_email},
        "branch": branch,
        "worktree_dirty": dirty,
        "credential_material": "not-read-not-output",
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--compare", type=Path)
    parser.add_argument("--expect-version")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--live", action="store_true")
    parser.add_argument("--evidence", type=Path)
    parser.add_argument("--host", default=EXPECTED_HOST)
    parser.add_argument("--project")
    parser.add_argument("--repo", type=Path)
    parser.add_argument("--expected-username")
    parser.add_argument("--expected-name")
    parser.add_argument("--expected-email")
    parser.add_argument("--expected-branch")
    parser.add_argument("--glab")
    args = parser.parse_args()
    try:
        summary = validate_skill()
        if args.expect_version:
            if not VERSION_PATTERN.fullmatch(args.expect_version):
                raise CheckError("--expect-version must be semantic x.y.z")
            if summary["version"] != args.expect_version:
                raise CheckError(
                    "installed-version-mismatch: "
                    f"expected={args.expect_version} actual={summary['version']}"
                )
            summary["expected_version"] = args.expect_version
        if args.compare:
            target = args.compare.resolve()
            target_version = installed_version(target)
            differences = compare_installation(
                ROOT, target, summary["protected_paths"]
            )
            if differences:
                raise CheckError(
                    "upgrade differences detected; explicit choice required; "
                    f"reference={summary['version']} installed={target_version}: "
                    + ", ".join(differences)
                )
            summary["compare"] = "no-differences"
            summary["installed_version"] = target_version
        if args.evidence:
            summary["evidence"] = validate_operation_evidence_file(
                args.evidence.resolve()
            )
        if args.live:
            required = {
                "--project": args.project,
                "--repo": args.repo,
                "--expected-username": args.expected_username,
                "--expected-name": args.expected_name,
                "--expected-email": args.expected_email,
            }
            missing = [flag for flag, value in required.items() if value is None]
            if missing:
                raise CheckError("live preflight missing required inputs: " + ", ".join(missing))
            summary["live"] = live_preflight(
                host=args.host,
                project=args.project,
                repo=args.repo,
                expected_username=args.expected_username,
                expected_name=args.expected_name,
                expected_email=args.expected_email,
                expected_branch=args.expected_branch,
                glab_path=args.glab,
            )
    except CheckError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    if args.json:
        print(json.dumps(summary, ensure_ascii=False, sort_keys=True))
    else:
        print(
            "xhgj-gitlab-collaboration self-check passed: "
            + json.dumps(summary, ensure_ascii=False, sort_keys=True)
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
