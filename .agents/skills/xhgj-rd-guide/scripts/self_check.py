#!/usr/bin/env python3
"""Offline validation and upgrade-difference check for xhgj-rd-guide."""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import re
import sys
from pathlib import Path, PurePosixPath, PureWindowsPath
from typing import Any, Dict, Iterable, List, Sequence, Tuple

from render_real_usage import render_markdown


ROOT = Path(__file__).resolve().parents[1]
CONTRACT_PATH = ROOT / "contract.yaml"
CANONICAL_NAME_PATTERN = re.compile(r"^xhgj-[a-z0-9](?:[a-z0-9-]{0,56}[a-z0-9])?$")
ALIAS_PATTERN = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$")
VERSION_PATTERN = re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+$")
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
    "positive",
    "negative",
    "required-source-unreachable",
    "authority-conflict",
    "optional-detail-unreachable",
    "trellis-present",
    "trellis-absent",
}
DETERMINISTIC_CHECK_KINDS = {
    "required-source-access",
    "authority-conflict-routing",
    "catalog-only-routing",
    "installation-effectiveness",
}


class CheckError(Exception):
    """A deterministic self-check failure."""


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


def require_string_array(value: Any, label: str) -> List[str]:
    if not isinstance(value, list) or not value:
        raise CheckError(f"{label}: must be a non-empty array")
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
        limitations = result["limitations"]
        if not isinstance(limitations, list) or not all(
            isinstance(item, str) and item.strip() for item in limitations
        ):
            raise CheckError(f"{label}.limitations must be a string array")
        if layers == required_layers:
            fully_verified_clients.append(client)
    if clients != fully_verified_clients:
        raise CheckError(
            "compatibility.clients must exactly match clients verified for "
            "discovery, routing and constraints"
        )


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
    try:
        lines = path.read_text(encoding="utf-8-sig").splitlines()
    except OSError as exc:
        raise CheckError(f"cannot read {path}: {exc}") from exc
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


def validate_required_source_access(value: Any) -> None:
    data = require_exact_keys(
        value,
        {"required", "current_source_accessible", "used_stale_material", "action"},
        "required-source-access",
    )
    required = require_bool(data["required"], "required-source-access.required")
    accessible = require_bool(
        data["current_source_accessible"],
        "required-source-access.current_source_accessible",
    )
    used_stale = require_bool(
        data["used_stale_material"], "required-source-access.used_stale_material"
    )
    action = require_string(data["action"], "required-source-access.action")
    if required and not accessible and (used_stale or action != "stop"):
        raise CheckError("required-current-source-unreachable")


def validate_authority_conflict_routing(value: Any) -> None:
    data = require_exact_keys(
        value,
        {"conflict_detected", "read_paths", "output_routes"},
        "authority-conflict-routing",
    )
    conflict = require_bool(
        data["conflict_detected"], "authority-conflict-routing.conflict_detected"
    )
    read_paths = require_string_array(
        data["read_paths"], "authority-conflict-routing.read_paths"
    )
    output_routes = require_string_array(
        data["output_routes"], "authority-conflict-routing.output_routes"
    )
    if conflict:
        required = {"catalog/sources.yaml", "governance/authority-registry.yaml"}
        if not required.issubset(read_paths) or not required.issubset(output_routes):
            raise CheckError("authority-conflict-control-plane-locators-missing")


def validate_catalog_only_routing(value: Any) -> None:
    data = require_exact_keys(
        value,
        {
            "reference_mode",
            "stable_locator",
            "output_routes",
            "claims_unique_execution_basis",
        },
        "catalog-only-routing",
    )
    reference_mode = require_string(
        data["reference_mode"], "catalog-only-routing.reference_mode"
    )
    stable_locator = require_string(
        data["stable_locator"], "catalog-only-routing.stable_locator"
    )
    output_routes = require_string_array(
        data["output_routes"], "catalog-only-routing.output_routes"
    )
    claims_unique = require_bool(
        data["claims_unique_execution_basis"],
        "catalog-only-routing.claims_unique_execution_basis",
    )
    if reference_mode == "catalog-only":
        if claims_unique:
            raise CheckError("catalog-only-promoted-to-canonical")
        if stable_locator not in output_routes:
            raise CheckError("catalog-only-stable-locator-missing")


def validate_installation_effectiveness(value: Any) -> None:
    data = require_exact_keys(
        value,
        {"canonical_version", "installed", "installed_version", "claim_effective"},
        "installation-effectiveness",
    )
    canonical_version = require_string(
        data["canonical_version"], "installation-effectiveness.canonical_version"
    )
    if not VERSION_PATTERN.fullmatch(canonical_version):
        raise CheckError("installation-effectiveness.canonical_version is invalid")
    installed = require_bool(
        data["installed"], "installation-effectiveness.installed"
    )
    installed_version = data["installed_version"]
    if installed_version is not None:
        installed_version = require_string(
            installed_version, "installation-effectiveness.installed_version"
        )
        if not VERSION_PATTERN.fullmatch(installed_version):
            raise CheckError("installation-effectiveness.installed_version is invalid")
    claim_effective = require_bool(
        data["claim_effective"], "installation-effectiveness.claim_effective"
    )
    if claim_effective and (
        not installed or installed_version != canonical_version
    ):
        raise CheckError("installation-version-not-effective")


def validate_deterministic_check(kind: str, value: Any) -> None:
    validators = {
        "required-source-access": validate_required_source_access,
        "authority-conflict-routing": validate_authority_conflict_routing,
        "catalog-only-routing": validate_catalog_only_routing,
        "installation-effectiveness": validate_installation_effectiveness,
    }
    validator = validators.get(kind)
    if validator is None:
        raise CheckError(f"deterministic-check-kind-unsupported: {kind}")
    validator(value)


def validate_cases(path: Path) -> Tuple[int, int]:
    data = load_json_compatible(path)
    if set(data) != {
        "schema_version",
        "required_output_sections",
        "cases",
        "deterministic_cases",
    }:
        raise CheckError("tests/cases.json: unexpected fields")
    if data["schema_version"] != 2:
        raise CheckError("tests/cases.json: schema_version must be 2")
    sections = require_string_array(
        data["required_output_sections"], "tests/cases.json.required_output_sections"
    )
    if sections != ["路由结果", "生效约束", "未读取边界", "下一步"]:
        raise CheckError("tests/cases.json: output sections do not match the Skill contract")
    cases = data["cases"]
    if not isinstance(cases, list) or not cases:
        raise CheckError("tests/cases.json: cases must be non-empty")
    kinds = set()
    ids = set()
    for index, case in enumerate(cases):
        label = f"tests/cases.json.cases[{index}]"
        expected = {"id", "kind", "prompt", "expected_routes", "expected_action"}
        require_exact_keys(case, expected, label)
        case_id = require_string(case["id"], f"{label}.id")
        if case_id in ids:
            raise CheckError(f"{label}.id: duplicate {case_id!r}")
        ids.add(case_id)
        kinds.add(require_string(case["kind"], f"{label}.kind"))
        require_string(case["prompt"], f"{label}.prompt")
        if not isinstance(case["expected_routes"], list) or not all(
            isinstance(item, str) and item for item in case["expected_routes"]
        ):
            raise CheckError(f"{label}.expected_routes: must be a string array")
        require_string(case["expected_action"], f"{label}.expected_action")
    missing = sorted(REQUIRED_CASE_KINDS - kinds)
    if missing:
        raise CheckError(f"tests/cases.json: missing scenario kinds {missing}")

    deterministic_cases = data["deterministic_cases"]
    if not isinstance(deterministic_cases, list) or not deterministic_cases:
        raise CheckError("tests/cases.json: deterministic_cases must be non-empty")
    deterministic_ids = set()
    deterministic_kinds = set()
    for index, case in enumerate(deterministic_cases):
        label = f"tests/cases.json.deterministic_cases[{index}]"
        require_exact_keys(case, {"id", "kind", "input", "expected_error"}, label)
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
            if expected_error not in str(exc):
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
    path: Path, version: str, expected_review_status: str
) -> Dict[str, Any]:
    data = load_json_compatible(path)
    expected = {
        "schema_version",
        "skill_version",
        "client",
        "environment",
        "as_of",
        "status",
        "usage_metadata",
        "scenarios",
        "review",
    }
    require_exact_keys(data, expected, "real usage evidence")
    if data["schema_version"] != 2 or data["skill_version"] != version:
        raise CheckError("real usage evidence: schema or skill version mismatch")
    try:
        dt.date.fromisoformat(data["as_of"])
    except (TypeError, ValueError) as exc:
        raise CheckError("real usage evidence: as_of must be YYYY-MM-DD") from exc
    if data["status"] not in {"pending", "executed", "passed", "failed"}:
        raise CheckError("real usage evidence: invalid status")
    validate_usage_metadata(data["usage_metadata"], version)
    if not isinstance(data["scenarios"], list):
        raise CheckError("real usage evidence: scenarios must be an array")
    if data["status"] in {"executed", "passed"}:
        scenario_kinds = set()
        for index, scenario in enumerate(data["scenarios"]):
            label = f"real usage evidence.scenarios[{index}]"
            expected = {
                "id",
                "kind",
                "input",
                "read_files",
                "output",
                "output_line_count",
                "result",
            }
            require_exact_keys(scenario, expected, label)
            require_string(scenario["id"], f"{label}.id")
            scenario_kinds.add(require_string(scenario["kind"], f"{label}.kind"))
            require_string(scenario["input"], f"{label}.input")
            if not isinstance(scenario["read_files"], list) or not all(
                isinstance(item, str) and item for item in scenario["read_files"]
            ):
                raise CheckError(f"{label}.read_files: must be a string array")
            output = require_string(scenario["output"], f"{label}.output")
            non_empty_lines = [line for line in output.splitlines() if line.strip()]
            if scenario["output_line_count"] != len(non_empty_lines):
                raise CheckError(f"{label}.output_line_count does not match output")
            if not all(f"{section}：" in output for section in ["路由结果", "生效约束", "未读取边界", "下一步"]):
                raise CheckError(f"{label}.output: missing required sections")
            if scenario["result"] != "passed":
                raise CheckError(f"{label}.result: executed evidence must pass")
        missing = sorted(REQUIRED_CASE_KINDS - scenario_kinds)
        if missing:
            raise CheckError(f"real usage evidence: missing scenario kinds {missing}")
    review = require_exact_keys(
        data["review"], {"agent_review", "maintainer_review"}, "real usage review"
    )
    agent_review = require_exact_keys(
        review["agent_review"], {"status", "summary"}, "real usage review.agent_review"
    )
    if agent_review["status"] not in {"pending", "passed", "failed"}:
        raise CheckError("real usage review.agent_review.status is invalid")
    require_string(agent_review["summary"], "real usage review.agent_review.summary")
    maintainer_review = require_exact_keys(
        review["maintainer_review"],
        {"status", "summary"},
        "real usage review.maintainer_review",
    )
    if maintainer_review["status"] not in {
        "pending-maintainer-review",
        "passed",
        "changes-requested",
    }:
        raise CheckError("real usage review.maintainer_review.status is invalid")
    require_string(
        maintainer_review["summary"], "real usage review.maintainer_review.summary"
    )
    if maintainer_review["status"] != expected_review_status:
        raise CheckError("Maintainer review status must match its evidence")
    return data


def validate_skill(root: Path = ROOT) -> Dict[str, Any]:
    contract = require_exact_keys(
        load_json_compatible(root / "contract.yaml"), REQUIRED_KEYS, "contract.yaml"
    )
    if contract["schema_version"] != 2:
        raise CheckError("contract.yaml.schema_version must be 2")
    name = require_string(contract["name"], "contract.yaml.name")
    if not CANONICAL_NAME_PATTERN.fullmatch(name) or root.name != name:
        raise CheckError("contract.yaml.name must be xhgj-<domain> and match the skill directory")
    aliases = require_string_array(contract["aliases"], "contract.yaml.aliases")
    if (
        any(not ALIAS_PATTERN.fullmatch(alias) or alias.startswith("xhgj-") for alias in aliases)
        or name in aliases
    ):
        raise CheckError(
            "contract.yaml.aliases must be distinct historical names outside xhgj-"
        )
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
    skill_meta = parse_skill_frontmatter(entrypoint)
    if skill_meta["name"] != name:
        raise CheckError("SKILL.md name does not match contract.yaml")

    tests = require_string_array(contract["tests"], "contract.yaml.tests")
    test_paths = []
    for index, raw_path in enumerate(tests):
        test_path = resolve_local_path(root, raw_path, f"tests[{index}]")
        if not test_path.is_file():
            raise CheckError(f"tests[{index}]: missing file {raw_path!r}")
        test_paths.append(test_path)
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
    for field in ("skill_format", "python"):
        require_string(compatibility[field], f"compatibility.{field}")
    if compatibility["project_rule_entries"] != [".trellis/spec/"]:
        raise CheckError(
            "compatibility.project_rule_entries must contain only .trellis/spec/"
        )

    upgrade = require_exact_keys(
        contract["upgrade_protection"], UPGRADE_KEYS, "upgrade_protection"
    )
    if upgrade["mode"] != "detect-and-stop":
        raise CheckError("upgrade_protection.mode must be detect-and-stop")
    require_string(upgrade["compare_command"], "upgrade_protection.compare_command")
    require_string(upgrade["on_difference"], "upgrade_protection.on_difference")
    protected_paths = require_string_array(
        upgrade["protected_paths"], "upgrade_protection.protected_paths"
    )
    protected_resolved = []
    for index, raw_path in enumerate(protected_paths):
        protected_path = resolve_local_path(root, raw_path, f"protected_paths[{index}]")
        if not protected_path.exists():
            raise CheckError(f"protected_paths[{index}]: missing {raw_path!r}")
        protected_resolved.append(protected_path)

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
    evidence_path = resolve_local_path(root, usage["evidence"], "real_usage.evidence")
    if not evidence_path.is_file():
        raise CheckError("real_usage.evidence must exist")
    projection_path = resolve_local_path(
        root, usage["review_projection"], "real_usage.review_projection"
    )
    if not projection_path.is_file():
        raise CheckError("real_usage.review_projection must exist")
    if projection_path.suffix.lower() != ".md":
        raise CheckError("real_usage.review_projection must be Markdown")
    for test_path in test_paths:
        if not any(
            protected == test_path or protected in test_path.parents
            for protected in protected_resolved
        ):
            raise CheckError(
                f"test path {test_path.relative_to(root).as_posix()!r} must be upgrade-protected"
            )
    if not any(
        protected == evidence_path or protected in evidence_path.parents
        for protected in protected_resolved
    ):
        raise CheckError("real_usage.evidence must be upgrade-protected")
    if not any(
        protected == projection_path or protected in projection_path.parents
        for protected in protected_resolved
    ):
        raise CheckError("real_usage.review_projection must be upgrade-protected")
    evidence = validate_usage_evidence(evidence_path, version, usage["review_status"])
    if evidence["status"] != usage["status"]:
        raise CheckError("real_usage status must match its evidence")
    source_locator = Path(usage["evidence"]).as_posix()
    expected_projection = render_markdown(evidence, source_locator)
    try:
        actual_projection = projection_path.read_text(encoding="utf-8-sig")
    except OSError as exc:
        raise CheckError(f"cannot read real usage review projection: {exc}") from exc
    if actual_projection != expected_projection:
        raise CheckError(
            "real usage review projection drift detected; "
            "run python scripts/render_real_usage.py"
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
        "review_projection": usage["review_projection"],
        "protected_paths": protected_paths,
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


def compare_installation(reference_root: Path, installed_root: Path, paths: Sequence[str]) -> List[str]:
    if not installed_root.is_dir():
        raise CheckError(f"compare target is not a directory: {installed_root}")
    reference = digest_map(reference_root, paths)
    installed = digest_map(installed_root, paths)
    differences = []
    for path in sorted(set(reference) | set(installed)):
        if reference.get(path) != installed.get(path):
            differences.append(path)
    return differences


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--compare", type=Path)
    parser.add_argument("--expect-version")
    parser.add_argument("--json", action="store_true")
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
    except CheckError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    if args.json:
        print(json.dumps(summary, ensure_ascii=False, sort_keys=True))
    else:
        print(
            "xhgj-rd-guide self-check passed: "
            + json.dumps(summary, ensure_ascii=False, sort_keys=True)
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
