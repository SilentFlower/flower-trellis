#!/usr/bin/env python3
"""Offline validation and upgrade-difference check for the governed mail Skill."""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import re
import sys
from pathlib import Path, PurePosixPath, PureWindowsPath
from typing import Any, Dict, Iterable, List, Sequence, Tuple


ROOT = Path(__file__).resolve().parents[1]
NAME = "xhgj-governed-mail-distribution"
VERSION_PATTERN = re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+$")
NAME_PATTERN = re.compile(r"^xhgj-[a-z0-9](?:[a-z0-9-]{0,56}[a-z0-9])?$")
ALIAS_PATTERN = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$")
EMAIL_PATTERN = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
IPV4_PATTERN = re.compile(r"(?<![0-9])(?:[0-9]{1,3}\.){3}[0-9]{1,3}(?![0-9])")
REQUIRED_CLIENT_LAYERS = ["discovery", "routing", "constraints"]
CONTRACT_KEYS = {
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
CLIENT_RESULT_KEYS = {
    "client",
    "verified_layers",
    "as_of",
    "evidence",
    "limitations",
}
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
EVIDENCE_KEYS = {
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
SCENARIO_KEYS = {
    "id",
    "kind",
    "input",
    "read_files",
    "output",
    "output_line_count",
    "result",
}
REQUIRED_ROUTING_CASES = {
    "draft-only",
    "reply-thread-recovery",
    "send-without-authorization",
    "migration-not-activated",
    "uncertain-receipt",
}
REQUIRED_PREFLIGHT_CASES = {
    "valid-send-ready",
    "migration-unregistered",
    "target-not-canonical",
    "activation-unconfirmed",
    "source-unavailable",
    "payload-drift",
    "preview-drift",
    "reply-without-record",
    "ambiguous-thread",
    "body-in-thread-record",
    "attachment-drift",
    "duplicate-recipient",
    "bcc-without-justification",
    "invalid-credential-reference",
    "formal-test-phrase",
    "pending-receipt",
    "release-approval-missing-timestamp",
    "release-approval-in-future",
    "release-approval-before-preview",
    "release-approval-before-selftest",
    "release-reviewed-state-residue",
    "release-review-window-too-short",
}
FORBIDDEN_TEXT = {
    "v0.2-" + "offline-preview",
    "v0.2.1-" + "internal-candidate",
    "valid_" + "until",
    "offline_" + "authorization",
    "distribution-" + "manifest.yaml",
    "governance-" + "snapshot.md",
    "rd-goal-progress-management" + "@",
    "smtp.qiye." + "aliyun.com",
    "C:" + "\\Users\\",
}


class CheckError(Exception):
    """A deterministic Skill check failed."""


def load_json_compatible(path: Path) -> Dict[str, Any]:
    try:
        lines = path.read_text(encoding="utf-8-sig").splitlines()
        payload = "\n".join(
            line for line in lines if not line.lstrip().startswith("#")
        )
        value = json.loads(payload)
    except (OSError, json.JSONDecodeError) as exc:
        raise CheckError(f"cannot load {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise CheckError(f"{path}: root must be an object")
    return value


def require_exact_keys(value: Any, expected: set, label: str) -> Dict[str, Any]:
    if not isinstance(value, dict) or set(value) != expected:
        raise CheckError(f"{label}: fields must be exactly {sorted(expected)}")
    return value


def require_string(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise CheckError(f"{label}: must be a non-empty string")
    return value


def require_string_array(value: Any, label: str, allow_empty: bool = False) -> List[str]:
    if (
        not isinstance(value, list)
        or (not allow_empty and not value)
        or len(value) != len(set(value))
        or not all(isinstance(item, str) and item.strip() for item in value)
    ):
        suffix = "" if allow_empty else " non-empty"
        raise CheckError(f"{label}: must be a unique{suffix} string array")
    return list(value)


def resolve_local_path(root: Path, raw_path: Any, label: str) -> Path:
    raw = require_string(raw_path, label)
    if (
        Path(raw).is_absolute()
        or PurePosixPath(raw).is_absolute()
        or PureWindowsPath(raw).anchor
    ):
        raise CheckError(f"{label}: absolute paths are not allowed")
    path = (root / raw).resolve()
    try:
        path.relative_to(root.resolve())
    except ValueError as exc:
        raise CheckError(f"{label}: path escapes the Skill directory") from exc
    return path


def parse_frontmatter(path: Path) -> Dict[str, str]:
    try:
        lines = path.read_text(encoding="utf-8-sig").splitlines()
    except OSError as exc:
        raise CheckError(f"cannot read {path}: {exc}") from exc
    if len(lines) < 4 or lines[0] != "---":
        raise CheckError("SKILL.md must start with YAML frontmatter")
    try:
        end = lines.index("---", 1)
    except ValueError as exc:
        raise CheckError("SKILL.md frontmatter is not closed") from exc
    values: Dict[str, str] = {}
    order = []
    for line in lines[1:end]:
        if ":" not in line:
            raise CheckError("SKILL.md frontmatter must use scalar key: value fields")
        key, value = line.split(":", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        order.append(key)
        values[key] = value
    if order != ["name", "description"] or not values.get("description"):
        raise CheckError("SKILL.md frontmatter must contain name and description")
    return values


def validate_client_verification(value: Any, clients: List[str]) -> None:
    data = require_exact_keys(
        value, CLIENT_VERIFICATION_KEYS, "compatibility.client_verification"
    )
    if data["required_layers"] != REQUIRED_CLIENT_LAYERS:
        raise CheckError(
            "compatibility.client_verification.required_layers must be discovery, routing, constraints"
        )
    results = data["results"]
    if not isinstance(results, list):
        raise CheckError("compatibility.client_verification.results must be an array")
    seen = []
    fully_verified = []
    for index, raw in enumerate(results):
        label = f"compatibility.client_verification.results[{index}]"
        result = require_exact_keys(raw, CLIENT_RESULT_KEYS, label)
        client = require_string(result["client"], f"{label}.client")
        if client in seen:
            raise CheckError(f"{label}.client must be unique")
        seen.append(client)
        layers = require_string_array(result["verified_layers"], f"{label}.verified_layers")
        if layers != [layer for layer in REQUIRED_CLIENT_LAYERS if layer in layers]:
            raise CheckError(f"{label}.verified_layers must be an ordered subset")
        if any(layer not in REQUIRED_CLIENT_LAYERS for layer in layers):
            raise CheckError(f"{label}.verified_layers contains an unknown layer")
        evidence = require_string_array(result["evidence"], f"{label}.evidence")
        if not all(item.startswith(("skill:", "repo:")) for item in evidence):
            raise CheckError(f"{label}.evidence must use skill: or repo: locators")
        require_string_array(result["limitations"], f"{label}.limitations", allow_empty=True)
        require_string(result["as_of"], f"{label}.as_of")
        if layers == REQUIRED_CLIENT_LAYERS:
            fully_verified.append(client)
    if clients != fully_verified:
        raise CheckError(
            "compatibility.clients must exactly match clients verified for discovery, routing and constraints"
        )


def normalized_json_digest(value: Dict[str, Any]) -> str:
    payload = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256((payload + "\n").encode("utf-8")).hexdigest()


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
    root: Path, usage: Dict[str, Any], version: str
) -> Tuple[str, int]:
    evidence_path = resolve_local_path(root, usage["evidence"], "real_usage.evidence")
    projection_path = resolve_local_path(
        root, usage["review_projection"], "real_usage.review_projection"
    )
    if not evidence_path.is_file() or not projection_path.is_file():
        raise CheckError("real usage evidence and projection must exist")
    evidence = require_exact_keys(
        load_json_compatible(evidence_path), EVIDENCE_KEYS, "real usage evidence"
    )
    if evidence["schema_version"] != 2 or evidence["skill_version"] != version:
        raise CheckError("real usage evidence schema or version mismatch")
    if evidence["status"] != usage["status"]:
        raise CheckError("real usage evidence status does not match contract")
    try:
        dt.date.fromisoformat(evidence["as_of"])
    except (TypeError, ValueError) as exc:
        raise CheckError("real usage evidence.as_of must be YYYY-MM-DD") from exc
    validate_usage_metadata(evidence["usage_metadata"], version)
    scenarios = evidence["scenarios"]
    if not isinstance(scenarios, list):
        raise CheckError("real usage evidence.scenarios must be an array")
    if evidence["status"] == "pending" and scenarios:
        raise CheckError("pending real usage must not claim executed scenarios")
    if evidence["status"] != "pending" and not scenarios:
        raise CheckError("executed real usage requires at least one scenario")
    seen = []
    for index, raw in enumerate(scenarios):
        label = f"real usage scenario[{index}]"
        scenario = require_exact_keys(raw, SCENARIO_KEYS, label)
        scenario_id = require_string(scenario["id"], f"{label}.id")
        if scenario_id in seen:
            raise CheckError(f"{label}.id must be unique")
        seen.append(scenario_id)
        require_string(scenario["kind"], f"{label}.kind")
        require_string(scenario["input"], f"{label}.input")
        require_string_array(scenario["read_files"], f"{label}.read_files")
        output = require_string(scenario["output"], f"{label}.output")
        line_count = len([line for line in output.splitlines() if line.strip()])
        if scenario["output_line_count"] != line_count:
            raise CheckError(f"{label}.output_line_count is stale")
        require_string(scenario["result"], f"{label}.result")
    review = require_exact_keys(
        evidence["review"], {"agent_review", "maintainer_review"}, "evidence.review"
    )
    allowed = {
        "agent_review": {"pending", "passed", "failed"},
        "maintainer_review": {"pending-maintainer-review", "passed", "changes-requested"},
    }
    for name in ("agent_review", "maintainer_review"):
        item = require_exact_keys(review[name], {"status", "summary"}, f"review.{name}")
        if item["status"] not in allowed[name]:
            raise CheckError(f"review.{name}.status is invalid")
        require_string(item["summary"], f"review.{name}.summary")
    if review["maintainer_review"]["status"] != usage["review_status"]:
        raise CheckError("Maintainer review status does not match contract")
    if evidence["status"] == "pending" and review["agent_review"]["status"] != "pending":
        raise CheckError("pending real usage must keep Agent review pending")
    projection = projection_path.read_text(encoding="utf-8-sig")
    markers = (
        "由 JSON 生成，请勿手工编辑。",
        f"机器 canonical：`{Path(usage['evidence']).as_posix()}`",
        f"规范化内容 SHA-256：`{normalized_json_digest(evidence)}`",
    )
    if not all(marker in projection for marker in markers):
        raise CheckError("real usage projection locator or digest is stale")
    return evidence["status"], len(scenarios)


def validate_cases(path: Path) -> Tuple[int, int]:
    data = require_exact_keys(
        load_json_compatible(path),
        {"schema_version", "routing_cases", "preflight_cases"},
        "cases",
    )
    if data["schema_version"] != 1:
        raise CheckError("cases.schema_version must be 1")
    routing_cases = data["routing_cases"]
    preflight_cases = data["preflight_cases"]
    if not isinstance(routing_cases, list) or not isinstance(preflight_cases, list):
        raise CheckError("case collections must be arrays")
    routing_ids = set()
    for index, item in enumerate(routing_cases):
        case = require_exact_keys(
            item,
            {"id", "kind", "prompt", "expected_reads", "expected_action"},
            f"routing_cases[{index}]",
        )
        routing_ids.add(require_string(case["id"], f"routing_cases[{index}].id"))
        require_string(case["kind"], f"routing_cases[{index}].kind")
        require_string(case["prompt"], f"routing_cases[{index}].prompt")
        require_string_array(case["expected_reads"], f"routing_cases[{index}].expected_reads")
        require_string(case["expected_action"], f"routing_cases[{index}].expected_action")
    preflight_ids = set()
    for index, item in enumerate(preflight_cases):
        case = require_exact_keys(
            item,
            {"id", "expected_status", "expected_error"},
            f"preflight_cases[{index}]",
        )
        preflight_ids.add(require_string(case["id"], f"preflight_cases[{index}].id"))
        if case["expected_status"] not in {"pass", "fail"}:
            raise CheckError(f"preflight_cases[{index}].expected_status is invalid")
        if not isinstance(case["expected_error"], str):
            raise CheckError(f"preflight_cases[{index}].expected_error must be a string")
    if not REQUIRED_ROUTING_CASES.issubset(routing_ids):
        raise CheckError("routing cases do not cover the required workflows")
    if not REQUIRED_PREFLIGHT_CASES.issubset(preflight_ids):
        raise CheckError("preflight cases do not cover the required failure paths")
    return len(routing_cases), len(preflight_cases)


def validate_forbidden_text(root: Path) -> None:
    for path in sorted(root.rglob("*")):
        if not path.is_file() or "__pycache__" in path.parts or path.suffix == ".pyc":
            continue
        try:
            text = path.read_text(encoding="utf-8-sig")
        except UnicodeDecodeError as exc:
            raise CheckError(f"Skill file is not valid UTF-8: {path}") from exc
        relative = path.relative_to(root).as_posix()
        for forbidden in FORBIDDEN_TEXT:
            if forbidden in text:
                raise CheckError(f"forbidden legacy or private source text in {relative}: {forbidden}")
        for address in EMAIL_PATTERN.findall(text):
            if not address.lower().endswith(".invalid"):
                raise CheckError(f"non-fixture email address in {relative}: {address}")
        for candidate in IPV4_PATTERN.findall(text):
            octets = [int(part) for part in candidate.split(".")]
            if all(0 <= part <= 255 for part in octets):
                raise CheckError(f"IP literal is not allowed in {relative}: {candidate}")


def validate_skill(root: Path = ROOT) -> Dict[str, Any]:
    contract = require_exact_keys(
        load_json_compatible(root / "contract.yaml"), CONTRACT_KEYS, "contract.yaml"
    )
    if contract["schema_version"] != 2:
        raise CheckError("contract.yaml.schema_version must be 2")
    name = require_string(contract["name"], "contract.yaml.name")
    if name != NAME or root.name != NAME or not NAME_PATTERN.fullmatch(name):
        raise CheckError("contract name must match the canonical Skill directory")
    aliases = require_string_array(contract["aliases"], "contract.yaml.aliases")
    if aliases != ["governed-mail-distribution"] or any(
        not ALIAS_PATTERN.fullmatch(alias) or alias.startswith("xhgj-") for alias in aliases
    ):
        raise CheckError("contract.yaml.aliases must preserve only the historical name")
    version = require_string(contract["version"], "contract.yaml.version")
    if not VERSION_PATTERN.fullmatch(version):
        raise CheckError("contract.yaml.version must be semantic x.y.z")
    if contract["status"] != "incubating":
        raise CheckError("initial Skill lifecycle must remain incubating")
    if contract["source"] != "migration:xhgj-governed-mail-distribution":
        raise CheckError("contract.yaml.source must identify the GMD migration")
    if contract["owner"] != "rd-guide-maintainers" or contract["authority"] != "rd-guide-maintainers":
        raise CheckError("owner and authority must remain rd-guide-maintainers")
    if contract["feedback"] != "issue:1":
        raise CheckError("feedback must remain issue:1 until a dedicated entry is approved")

    entrypoint = resolve_local_path(root, contract["entrypoint"], "entrypoint")
    self_check = resolve_local_path(root, contract["self_check"], "self_check")
    if not entrypoint.is_file() or not self_check.is_file():
        raise CheckError("entrypoint and self_check must exist")
    frontmatter = parse_frontmatter(entrypoint)
    if frontmatter["name"] != name or "TODO" in frontmatter["description"]:
        raise CheckError("SKILL.md metadata does not match the contract")

    tests = require_string_array(contract["tests"], "contract.yaml.tests")
    if tests != ["tests/test_self_check.py", "tests/cases.json"]:
        raise CheckError("contract.yaml.tests must declare the P1 test files")
    for raw_path in tests:
        if not resolve_local_path(root, raw_path, f"test {raw_path}").is_file():
            raise CheckError(f"declared test does not exist: {raw_path}")

    compatibility = require_exact_keys(
        contract["compatibility"], COMPATIBILITY_KEYS, "compatibility"
    )
    if compatibility["skill_format"] != "codex-skill-v1" or compatibility["offline"] is not True:
        raise CheckError("compatibility skill format or offline boundary is invalid")
    require_string(compatibility["python"], "compatibility.python")
    clients = require_string_array(
        compatibility["clients"], "compatibility.clients", allow_empty=True
    )
    validate_client_verification(compatibility["client_verification"], clients)
    require_string_array(
        compatibility["project_rule_entries"],
        "compatibility.project_rule_entries",
        allow_empty=True,
    )

    upgrade = require_exact_keys(
        contract["upgrade_protection"], UPGRADE_KEYS, "upgrade_protection"
    )
    if upgrade["mode"] != "detect-and-stop":
        raise CheckError("upgrade protection mode must be detect-and-stop")
    if "self_check.py --compare" not in upgrade["compare_command"]:
        raise CheckError("compare command must invoke self_check.py --compare")
    if "never overwrite" not in upgrade["on_difference"]:
        raise CheckError("upgrade differences must never overwrite")
    protected_paths = require_string_array(
        upgrade["protected_paths"], "upgrade_protection.protected_paths"
    )
    for raw_path in protected_paths:
        if not resolve_local_path(root, raw_path, f"protected path {raw_path}").exists():
            raise CheckError(f"protected path does not exist: {raw_path}")

    usage = require_exact_keys(contract["real_usage"], REAL_USAGE_KEYS, "real_usage")
    if usage["status"] not in ("executed", "passed"):
        raise CheckError("real usage must stay executed or passed once P1 evidence exists")
    if usage["review_status"] not in (
        "pending-maintainer-review",
        "passed",
        "changes-requested",
    ):
        raise CheckError("real_usage.review_status is not an admitted value")
    if usage["review_status"] == "passed" and usage["status"] != "passed":
        raise CheckError("Maintainer-reviewed real usage must also record a passed status")
    require_string(usage["environment"], "real_usage.environment")
    require_string(usage["as_of"], "real_usage.as_of")
    usage_status, scenario_count = validate_usage_evidence(root, usage, version)

    source_map = (root / "references" / "source-map.md").read_text(encoding="utf-8-sig")
    source_markers = (
        "catalog/sources.yaml",
        "governance/migration-ledger.yaml",
        "id=xhgj-governed-mail-distribution",
        "docs/playbooks/enterprise-mail-delivery.md",
        "required-source",
        "fail closed",
    )
    if not all(marker in source_map for marker in source_markers):
        raise CheckError("source-map.md does not preserve current-source routing")
    plan_contract = (root / "references" / "mail-plan-contract.md").read_text(
        encoding="utf-8-sig"
    )
    plan_markers = (
        "payload_sha256",
        "scripts/preflight.py",
        "migration_registered",
        "explicit_send_authorization",
        "uncertain_or_failed",
        "thread.record_path",
    )
    if not all(marker in plan_contract for marker in plan_markers):
        raise CheckError("mail-plan-contract.md is missing deterministic gate markers")
    openai = (root / "agents" / "openai.yaml").read_text(encoding="utf-8-sig")
    if "$xhgj-governed-mail-distribution" not in openai:
        raise CheckError("agents/openai.yaml default prompt must name the Skill")
    for script in (
        "mail_contract.py",
        "preflight.py",
        "render_mail.py",
        "resolve_thread.py",
        "send_mail.py",
        "thread_record.py",
    ):
        compile((root / "scripts" / script).read_text(encoding="utf-8-sig"), script, "exec")

    routing_count, preflight_count = validate_cases(root / "tests" / "cases.json")
    validate_forbidden_text(root)
    return {
        "skill": name,
        "version": version,
        "status": contract["status"],
        "clients": clients,
        "routing_cases": routing_count,
        "preflight_cases": preflight_count,
        "usage_status": usage_status,
        "usage_scenarios": scenario_count,
        "review_status": usage["review_status"],
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
    if name != NAME:
        raise CheckError(f"compare target skill mismatch: expected {NAME}, got {name}")
    version = require_string(contract.get("version"), "installed contract.version")
    if not VERSION_PATTERN.fullmatch(version):
        raise CheckError("installed contract.version must be semantic x.y.z")
    return version


def compare_installation(
    reference_root: Path,
    installed_root: Path,
    paths: Sequence[str],
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
            "xhgj-governed-mail-distribution self-check passed: "
            + json.dumps(summary, ensure_ascii=False, sort_keys=True)
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
