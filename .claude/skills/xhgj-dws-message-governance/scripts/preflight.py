#!/usr/bin/env python3
"""Validate a frozen DWS message plan without executing external actions."""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Sequence, Tuple


ROOT_KEYS = {
    "schema_version",
    "message_state",
    "governance",
    "dws_runtime",
    "target",
    "recipients",
    "message_profile",
    "profile_contract",
    "recipient_review",
    "title",
    "message_type",
    "text",
    "payload_ref",
    "ai_tag",
    "uuid",
    "explicit_send_authorization",
    "human_review",
    "dry_run",
    "final_payload_frozen",
    "internal_notes_removed",
    "at_all",
    "at_open_dingtalk_ids",
    "mention_verification",
    "requires_response",
    "response",
    "transport",
    "post_send_readback",
}
GOVERNANCE_KEYS = {
    "standard_locator",
    "playbook_locator",
    "current_source_verified",
    "required_source_accessible",
    "conflict_detected",
}
DWS_RUNTIME_KEYS = {
    "installed",
    "authenticated",
    "organization_confirmed",
    "version",
    "commands_rechecked",
}
TARGET_KEYS = {"type", "identifier", "confirmed"}
RECIPIENT_KEYS = {"to", "cc", "fyi", "all_members_role"}
RECIPIENT_REVIEW_KEYS = {
    "need_is_clear",
    "action_is_clear",
    "mobile_readable",
    "references_accessible",
    "sensitive_content_removed",
}
HUMAN_REVIEW_KEYS = {"approved", "reviewer", "payload_sha256"}
DRY_RUN_KEYS = {"reviewed", "payload_sha256"}
MENTION_VERIFICATION_KEYS = {
    "post_send_readback_planned",
    "controlled_recipient_test_confirmed",
    "tested_dws_version",
    "evidence_locator",
}
BOOTSTRAP_PROFILE_KEYS = {
    "test_purpose",
    "authorization_locator",
    "test_recipient_open_dingtalk_ids",
    "participants_confirmed",
    "minimum_disclosure_confirmed",
    "business_action_present",
    "pre_send_duplicate_check_completed",
    "duplicate_check_locator",
    "evidence_output_locator",
    "recipient_delivery_confirmation_planned",
}
BOOTSTRAP_RESULT_KEYS = {
    "schema_version",
    "message_id",
    "sent_at",
    "technical_readback",
    "recipient_delivery_confirmation",
}
TECHNICAL_READBACK_KEYS = {
    "status",
    "locator",
    "rendered_open_dingtalk_ids",
}
RECIPIENT_CONFIRMATION_KEYS = {"status", "locator"}
POST_SEND_KEYS = {"planned", "method", "non_first_line_check"}
RESPONSE_KEYS = {
    "deadline",
    "deadline_policy",
    "method",
    "minimum_response",
    "non_response_policy",
    "closer",
}
PROFILE_FIELDS = {
    "notification": {"change", "impact", "action_requirement"},
    "execution": {"action", "deadline", "response_method", "closer"},
    "inquiry": {"question", "response_format"},
    "decision": {"options", "decision_needed", "tradeoff"},
}
MESSAGE_STATES = {"send-ready", "mention-bootstrap-ready"}
BOOTSTRAP_STATE = "mention-bootstrap-ready"
BOOTSTRAP_PROFILE = "mention-bootstrap"
BOOTSTRAP_TEST_PURPOSE = "named-mention-rendering"
BOOTSTRAP_MARKER = "【具名提醒受控测试】"
MESSAGE_TYPES = {"text", "image", "file"}
TARGET_TYPES = {"group", "direct"}
TRANSPORTS = {"single-line", "node-entry", "native-binary"}
PLACEHOLDER_PATTERN = re.compile(r"<[^>]+>")
ORDERED_ITEM_PATTERN = re.compile(r"^\s*(\d+)\.\s+\S")
PLAIN_ITEM_PATTERN = re.compile(r"^\s*(?:\d+）|【[^】]+】)\s*\S")
HEX_SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")


class PlanError(Exception):
    """The plan file cannot be loaded."""


def load_json_object(path: Path, label: str) -> Dict[str, Any]:
    try:
        if str(path) == "-":
            value = json.loads(sys.stdin.read())
        else:
            value = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError) as exc:
        raise PlanError(f"cannot load {label}: {exc}") from exc
    if not isinstance(value, dict):
        raise PlanError(f"{label} root must be an object")
    return value


def load_plan(path: Path) -> Dict[str, Any]:
    return load_json_object(path, "message plan")


def require_object(
    value: Any,
    keys: Sequence[str],
    label: str,
    errors: List[str],
) -> Dict[str, Any]:
    if not isinstance(value, dict):
        errors.append(f"{label} must be an object")
        return {}
    expected = set(keys)
    if set(value) != expected:
        errors.append(f"{label} fields must be exactly {sorted(expected)}")
    return value


def require_true(value: Dict[str, Any], key: str, errors: List[str], label: str = "") -> None:
    if value.get(key) is not True:
        prefix = f"{label}." if label else ""
        errors.append(f"{prefix}{key} must be true")


def require_false(
    value: Dict[str, Any], key: str, errors: List[str], label: str = ""
) -> None:
    if value.get(key) is not False:
        prefix = f"{label}." if label else ""
        errors.append(f"{prefix}{key} must be false")


def require_nonempty_string(
    value: Dict[str, Any],
    key: str,
    errors: List[str],
    label: str = "",
    reject_placeholder: bool = False,
) -> str:
    raw = value.get(key)
    prefix = f"{label}." if label else ""
    if not isinstance(raw, str) or not raw.strip():
        errors.append(f"{prefix}{key} must be a non-empty string")
        return ""
    if reject_placeholder and PLACEHOLDER_PATTERN.search(raw):
        errors.append(f"{prefix}{key} must not contain a placeholder")
    return raw


def require_unique_string_array(
    raw: Any, label: str, errors: List[str]
) -> List[str]:
    if (
        not isinstance(raw, list)
        or not raw
        or not all(isinstance(item, str) and item.strip() for item in raw)
        or len(raw) != len(set(raw))
    ):
        errors.append(f"{label} must be a unique non-empty string array")
        return []
    return list(raw)


def canonical_payload(plan: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "target": plan.get("target"),
        "title": plan.get("title"),
        "message_type": plan.get("message_type"),
        "text": plan.get("text"),
        "payload_ref": plan.get("payload_ref"),
        "ai_tag": plan.get("ai_tag"),
        "uuid": plan.get("uuid"),
        "at_all": plan.get("at_all"),
        "at_open_dingtalk_ids": plan.get("at_open_dingtalk_ids"),
    }


def payload_sha256(plan: Dict[str, Any]) -> str:
    encoded = json.dumps(
        canonical_payload(plan),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded + b"\n").hexdigest()


def validate_recipient_items(
    raw: Any,
    role: str,
    target_type: str,
    errors: List[str],
) -> List[Dict[str, str]]:
    if not isinstance(raw, list):
        errors.append(f"recipients.{role} must be an array")
        return []
    items: List[Dict[str, str]] = []
    for index, item in enumerate(raw):
        label = f"recipients.{role}[{index}]"
        if not isinstance(item, dict):
            errors.append(f"{label} must be an object")
            continue
        allowed = {"label", "open_dingtalk_id"} if role in {"to", "cc"} else {"label"}
        if not set(item).issubset(allowed) or "label" not in item:
            errors.append(f"{label} fields are invalid")
            continue
        person_label = item.get("label")
        if not isinstance(person_label, str) or not person_label.strip():
            errors.append(f"{label}.label must be a non-empty string")
        identifier = item.get("open_dingtalk_id", "")
        if role == "fyi" and "open_dingtalk_id" in item:
            errors.append(f"{label} must not define open_dingtalk_id")
        if target_type == "group" and role in {"to", "cc"}:
            if not isinstance(identifier, str) or not identifier.strip():
                errors.append(f"{label}.open_dingtalk_id is required for group TO/CC")
        if target_type == "direct" and "open_dingtalk_id" in item:
            errors.append(f"{label} must not duplicate the direct target identifier")
        items.append(
            {
                "label": person_label if isinstance(person_label, str) else "",
                "open_dingtalk_id": identifier if isinstance(identifier, str) else "",
            }
        )
    return items


def validate_markdown(text: str, errors: List[str]) -> None:
    lines = text.splitlines()
    for index, line in enumerate(lines):
        if index == 0:
            continue
        previous = lines[index - 1]
        ordered = ORDERED_ITEM_PATTERN.match(line)
        previous_ordered = ORDERED_ITEM_PATTERN.match(previous)
        if ordered and ordered.group(1) != "1" and previous.strip() and not previous_ordered:
            errors.append(
                "non-1 Markdown ordered list must start after a blank line"
            )
        if (
            PLAIN_ITEM_PATTERN.match(line)
            and PLAIN_ITEM_PATTERN.match(previous)
            and not previous.endswith("  ")
            and not previous.endswith("\\")
        ):
            errors.append(
                "plain numbered items require blank lines or Markdown hard breaks"
            )


def validate_deadline(value: str, errors: List[str]) -> None:
    try:
        parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        errors.append("response.deadline must be an ISO-8601 datetime")
        return
    if parsed.tzinfo is None:
        errors.append("response.deadline must include a timezone")


def validate_bootstrap_profile(
    profile_contract: Any,
    named_ids: List[str],
    title: str,
    text: str,
    message_type: Any,
    payload_ref: str,
    target_type: str,
    at_all: bool,
    errors: List[str],
) -> Dict[str, Any]:
    contract = require_object(
        profile_contract,
        BOOTSTRAP_PROFILE_KEYS,
        "profile_contract",
        errors,
    )
    if contract.get("test_purpose") != BOOTSTRAP_TEST_PURPOSE:
        errors.append(
            f"profile_contract.test_purpose must be {BOOTSTRAP_TEST_PURPOSE}"
        )
    require_nonempty_string(
        contract,
        "authorization_locator",
        errors,
        "profile_contract",
        reject_placeholder=True,
    )
    test_ids = require_unique_string_array(
        contract.get("test_recipient_open_dingtalk_ids"),
        "profile_contract.test_recipient_open_dingtalk_ids",
        errors,
    )
    if set(test_ids) != set(named_ids) or len(test_ids) != len(named_ids):
        errors.append(
            "profile_contract.test_recipient_open_dingtalk_ids must exactly match named TO/CC recipients"
        )
    require_true(contract, "participants_confirmed", errors, "profile_contract")
    require_true(
        contract, "minimum_disclosure_confirmed", errors, "profile_contract"
    )
    require_false(contract, "business_action_present", errors, "profile_contract")
    require_true(
        contract,
        "pre_send_duplicate_check_completed",
        errors,
        "profile_contract",
    )
    require_nonempty_string(
        contract,
        "duplicate_check_locator",
        errors,
        "profile_contract",
        reject_placeholder=True,
    )
    require_nonempty_string(
        contract,
        "evidence_output_locator",
        errors,
        "profile_contract",
        reject_placeholder=True,
    )
    require_true(
        contract,
        "recipient_delivery_confirmation_planned",
        errors,
        "profile_contract",
    )
    if target_type != "group":
        errors.append("mention bootstrap target.type must be group")
    if at_all:
        errors.append("mention bootstrap must not use at_all")
    if not named_ids:
        errors.append("mention bootstrap requires at least one named TO/CC recipient")
    if message_type != "text" or payload_ref.strip():
        errors.append("mention bootstrap only supports text messages without payload_ref")
    if not text.startswith(BOOTSTRAP_MARKER):
        errors.append(f"mention bootstrap text must start with {BOOTSTRAP_MARKER}")
    if BOOTSTRAP_MARKER not in title and "测试" not in title:
        errors.append("mention bootstrap title must clearly identify the message as a test")
    return contract


def bootstrap_evidence_template(plan: Dict[str, Any]) -> Dict[str, Any]:
    contract = plan["profile_contract"]
    return {
        "schema_version": 1,
        "kind": "named-mention-bootstrap-evidence",
        "status": "pending-test-execution",
        "dws_version": plan["dws_runtime"]["version"],
        "authorization": {
            "status": "confirmed",
            "locator": contract["authorization_locator"],
        },
        "target": plan["target"],
        "test_recipient_open_dingtalk_ids": contract[
            "test_recipient_open_dingtalk_ids"
        ],
        "payload_sha256": payload_sha256(plan),
        "uuid": plan["uuid"],
        "duplicate_check": {
            "status": "completed",
            "locator": contract["duplicate_check_locator"],
        },
        "technical_readback": {
            "status": "pending",
            "message_id": "",
            "sent_at": "",
            "locator": "",
            "rendered_open_dingtalk_ids": [],
        },
        "recipient_delivery_confirmation": {"status": "pending", "locator": ""},
        "evidence_output_locator": contract["evidence_output_locator"],
        "eligible_for_ordinary_send": False,
    }


def validate_bootstrap_result(
    plan: Dict[str, Any], result: Dict[str, Any]
) -> Tuple[Dict[str, Any], List[str]]:
    errors: List[str] = []
    if plan.get("message_state") != BOOTSTRAP_STATE:
        errors.append("--bootstrap-result requires a mention-bootstrap-ready plan")
        return {}, errors
    value = require_object(result, BOOTSTRAP_RESULT_KEYS, "bootstrap_result", errors)
    if value.get("schema_version") != 1:
        errors.append("bootstrap_result.schema_version must be 1")
    message_id = require_nonempty_string(
        value, "message_id", errors, "bootstrap_result", reject_placeholder=True
    )
    sent_at = require_nonempty_string(
        value, "sent_at", errors, "bootstrap_result", reject_placeholder=True
    )
    if sent_at:
        try:
            parsed = dt.datetime.fromisoformat(sent_at.replace("Z", "+00:00"))
        except ValueError:
            errors.append("bootstrap_result.sent_at must be an ISO-8601 datetime")
        else:
            if parsed.tzinfo is None:
                errors.append("bootstrap_result.sent_at must include a timezone")

    technical = require_object(
        value.get("technical_readback"),
        TECHNICAL_READBACK_KEYS,
        "bootstrap_result.technical_readback",
        errors,
    )
    if technical.get("status") != "passed":
        errors.append("bootstrap_result.technical_readback.status must be passed")
    technical_locator = require_nonempty_string(
        technical,
        "locator",
        errors,
        "bootstrap_result.technical_readback",
        reject_placeholder=True,
    )
    rendered_ids = require_unique_string_array(
        technical.get("rendered_open_dingtalk_ids"),
        "bootstrap_result.technical_readback.rendered_open_dingtalk_ids",
        errors,
    )
    test_ids = plan["profile_contract"]["test_recipient_open_dingtalk_ids"]
    if set(rendered_ids) != set(test_ids) or len(rendered_ids) != len(test_ids):
        errors.append(
            "bootstrap_result technical rendered recipients must exactly match test recipients"
        )

    recipient = require_object(
        value.get("recipient_delivery_confirmation"),
        RECIPIENT_CONFIRMATION_KEYS,
        "bootstrap_result.recipient_delivery_confirmation",
        errors,
    )
    recipient_status = recipient.get("status")
    if recipient_status not in {"pending", "confirmed"}:
        errors.append(
            "bootstrap_result.recipient_delivery_confirmation.status must be pending or confirmed"
        )
    recipient_locator = recipient.get("locator")
    if not isinstance(recipient_locator, str):
        errors.append(
            "bootstrap_result.recipient_delivery_confirmation.locator must be a string"
        )
        recipient_locator = ""
    elif recipient_status == "confirmed":
        if not recipient_locator.strip() or PLACEHOLDER_PATTERN.search(recipient_locator):
            errors.append(
                "bootstrap_result.recipient_delivery_confirmation.locator must be non-empty when confirmed"
            )
    elif recipient_locator.strip():
        errors.append(
            "bootstrap_result.recipient_delivery_confirmation.locator must be empty while pending"
        )

    if errors:
        return {}, errors
    template = bootstrap_evidence_template(plan)
    eligible = recipient_status == "confirmed"
    template.update(
        {
            "status": (
                "complete" if eligible else "awaiting-recipient-confirmation"
            ),
            "technical_readback": {
                "status": "passed",
                "message_id": message_id,
                "sent_at": sent_at,
                "locator": technical_locator,
                "rendered_open_dingtalk_ids": rendered_ids,
            },
            "recipient_delivery_confirmation": {
                "status": recipient_status,
                "locator": recipient_locator,
            },
            "eligible_for_ordinary_send": eligible,
        }
    )
    return template, []


def validate_plan(plan: Dict[str, Any]) -> Dict[str, Any]:
    errors: List[str] = []
    warnings: List[str] = []
    if set(plan) != ROOT_KEYS:
        errors.append(f"plan fields must be exactly {sorted(ROOT_KEYS)}")
    if plan.get("schema_version") != 1:
        errors.append("schema_version must be 1")
    message_state = plan.get("message_state")
    if message_state not in MESSAGE_STATES:
        errors.append(
            "message_state must be send-ready or mention-bootstrap-ready; draft plans cannot be sent"
        )
    is_bootstrap = message_state == BOOTSTRAP_STATE

    governance = require_object(
        plan.get("governance"), GOVERNANCE_KEYS, "governance", errors
    )
    require_nonempty_string(governance, "standard_locator", errors, "governance")
    require_nonempty_string(governance, "playbook_locator", errors, "governance")
    require_true(governance, "current_source_verified", errors, "governance")
    require_true(governance, "required_source_accessible", errors, "governance")
    if governance.get("conflict_detected") is not False:
        errors.append("governance.conflict_detected must be false")

    runtime = require_object(
        plan.get("dws_runtime"), DWS_RUNTIME_KEYS, "dws_runtime", errors
    )
    for key in ("installed", "authenticated", "organization_confirmed", "commands_rechecked"):
        require_true(runtime, key, errors, "dws_runtime")
    runtime_version = require_nonempty_string(
        runtime, "version", errors, "dws_runtime", reject_placeholder=True
    )

    target = require_object(plan.get("target"), TARGET_KEYS, "target", errors)
    target_type = target.get("type")
    if target_type not in TARGET_TYPES:
        errors.append(f"target.type must be one of {sorted(TARGET_TYPES)}")
        target_type = ""
    require_nonempty_string(target, "identifier", errors, "target", reject_placeholder=True)
    require_true(target, "confirmed", errors, "target")

    recipients = require_object(
        plan.get("recipients"), RECIPIENT_KEYS, "recipients", errors
    )
    to_items = validate_recipient_items(recipients.get("to"), "to", target_type, errors)
    cc_items = validate_recipient_items(recipients.get("cc"), "cc", target_type, errors)
    fyi_items = validate_recipient_items(recipients.get("fyi"), "fyi", target_type, errors)
    all_members_role = recipients.get("all_members_role")
    if all_members_role not in {"none", "to", "cc"}:
        errors.append("recipients.all_members_role must be none, to or cc")

    profile = plan.get("message_profile")
    allowed_profiles = set(PROFILE_FIELDS) | {BOOTSTRAP_PROFILE}
    if profile not in allowed_profiles:
        errors.append(f"message_profile must be one of {sorted(allowed_profiles)}")
    profile_contract = plan.get("profile_contract")
    if not isinstance(profile_contract, dict):
        errors.append("profile_contract must be an object")
    elif is_bootstrap and profile != BOOTSTRAP_PROFILE:
        errors.append("mention-bootstrap-ready requires message_profile=mention-bootstrap")
    elif not is_bootstrap and profile == BOOTSTRAP_PROFILE:
        errors.append("mention-bootstrap profile requires message_state=mention-bootstrap-ready")
    elif profile in PROFILE_FIELDS:
        missing = [
            field
            for field in sorted(PROFILE_FIELDS[profile])
            if not isinstance(profile_contract.get(field), str)
            or not profile_contract.get(field, "").strip()
        ]
        if missing:
            errors.append(f"profile_contract missing non-empty fields: {missing}")

    recipient_review = require_object(
        plan.get("recipient_review"),
        RECIPIENT_REVIEW_KEYS,
        "recipient_review",
        errors,
    )
    for key in sorted(RECIPIENT_REVIEW_KEYS):
        require_true(recipient_review, key, errors, "recipient_review")

    title = plan.get("title")
    if not isinstance(title, str) or not title.strip():
        errors.append("title must be a non-empty string")
    elif PLACEHOLDER_PATTERN.search(title):
        errors.append("title must not contain a placeholder")
    message_type = plan.get("message_type")
    if message_type not in MESSAGE_TYPES:
        errors.append(f"message_type must be one of {sorted(MESSAGE_TYPES)}")
    text = plan.get("text")
    if not isinstance(text, str) or not text.strip():
        errors.append("text must be a non-empty string")
        text = ""
    payload_ref = plan.get("payload_ref")
    if not isinstance(payload_ref, str):
        errors.append("payload_ref must be a string")
        payload_ref = ""
    if message_type in {"image", "file"} and not payload_ref.strip():
        errors.append("image/file messages require payload_ref")
    if plan.get("ai_tag") is not True:
        errors.append("ai_tag must be true for AI-sent messages")
    uuid = plan.get("uuid")
    if not isinstance(uuid, str) or len(uuid.strip()) < 8 or PLACEHOLDER_PATTERN.search(uuid):
        errors.append("uuid must be a reviewed non-placeholder string of at least 8 characters")

    if plan.get("explicit_send_authorization") is not True:
        errors.append("explicit_send_authorization must be true")
    if plan.get("final_payload_frozen") is not True:
        errors.append("final_payload_frozen must be true")
    if plan.get("internal_notes_removed") is not True:
        errors.append("internal_notes_removed must be true")

    current_payload_sha = payload_sha256(plan)
    human_review = require_object(
        plan.get("human_review"), HUMAN_REVIEW_KEYS, "human_review", errors
    )
    require_true(human_review, "approved", errors, "human_review")
    require_nonempty_string(
        human_review, "reviewer", errors, "human_review", reject_placeholder=True
    )
    reviewed_sha = human_review.get("payload_sha256")
    if reviewed_sha != current_payload_sha:
        errors.append("human_review.payload_sha256 does not match the frozen payload")

    dry_run = require_object(plan.get("dry_run"), DRY_RUN_KEYS, "dry_run", errors)
    require_true(dry_run, "reviewed", errors, "dry_run")
    if dry_run.get("payload_sha256") != current_payload_sha:
        errors.append("dry_run.payload_sha256 does not match the frozen payload")

    at_all = plan.get("at_all")
    if not isinstance(at_all, bool):
        errors.append("at_all must be boolean")
        at_all = False
    raw_at_ids = plan.get("at_open_dingtalk_ids")
    if (
        not isinstance(raw_at_ids, list)
        or not all(isinstance(item, str) and item.strip() for item in raw_at_ids)
        or len(raw_at_ids) != len(set(raw_at_ids))
    ):
        errors.append("at_open_dingtalk_ids must be a unique non-empty string array")
        at_ids: List[str] = []
    else:
        at_ids = list(raw_at_ids)

    named_ids = [
        item["open_dingtalk_id"]
        for item in to_items + cc_items
        if item["open_dingtalk_id"]
    ]
    if len(named_ids) != len(set(named_ids)):
        errors.append("TO/CC open_dingtalk_id values must be unique")
    if target_type == "group":
        if at_all:
            if at_ids:
                errors.append("at_all and at_open_dingtalk_ids cannot be used together")
            if all_members_role not in {"to", "cc"}:
                errors.append("at_all requires all_members_role=to or cc")
            if to_items or cc_items:
                errors.append("at_all requires named TO/CC arrays to be empty")
            lowered = text.lower()
            if "@所有人" in text or "@all" in lowered or "<@all>" in lowered:
                errors.append("at_all message text must not contain a manual all-member mention")
            if text.startswith("@"):
                errors.append("message text must not start with @ when using at_all")
        else:
            if all_members_role != "none":
                errors.append("all_members_role must be none when at_all is false")
            if set(at_ids) != set(named_ids) or len(at_ids) != len(named_ids):
                errors.append("at_open_dingtalk_ids must exactly match named TO/CC recipients")
            for identifier in named_ids:
                if f"<@{identifier}>" not in text:
                    errors.append(
                        f"message text missing named mention placeholder for {identifier}"
                    )
    elif target_type == "direct":
        if len(to_items) != 1 or cc_items or fyi_items:
            errors.append("direct messages require exactly one implicit TO and no CC/FYI")
        if at_all or at_ids or all_members_role != "none":
            errors.append("direct messages must not use group mention fields")

    if is_bootstrap:
        validate_bootstrap_profile(
            profile_contract,
            named_ids,
            title if isinstance(title, str) else "",
            text,
            message_type,
            payload_ref,
            target_type,
            at_all,
            errors,
        )

    mention_required = target_type == "group" and (at_all or bool(named_ids))
    mention_verification = plan.get("mention_verification")
    if mention_required:
        if is_bootstrap:
            if mention_verification != {}:
                errors.append(
                    "mention_verification must be empty for mention bootstrap; authorization is not completed-test evidence"
                )
        else:
            mention_verification = require_object(
                mention_verification,
                MENTION_VERIFICATION_KEYS,
                "mention_verification",
                errors,
            )
            require_true(
                mention_verification,
                "post_send_readback_planned",
                errors,
                "mention_verification",
            )
            require_true(
                mention_verification,
                "controlled_recipient_test_confirmed",
                errors,
                "mention_verification",
            )
            tested_version = require_nonempty_string(
                mention_verification,
                "tested_dws_version",
                errors,
                "mention_verification",
                reject_placeholder=True,
            )
            require_nonempty_string(
                mention_verification,
                "evidence_locator",
                errors,
                "mention_verification",
                reject_placeholder=True,
            )
            if tested_version and runtime_version and tested_version != runtime_version:
                errors.append("mention verification DWS version does not match runtime version")
    elif mention_verification != {}:
        errors.append("mention_verification must be empty when no mention is requested")

    requires_response = plan.get("requires_response")
    if not isinstance(requires_response, bool):
        errors.append("requires_response must be boolean")
        requires_response = False
    has_to = bool(to_items) or all_members_role == "to" or target_type == "direct"
    if has_to and requires_response is not True:
        errors.append("messages with TO recipients require a response contract")
    response = plan.get("response")
    if requires_response:
        if not isinstance(response, dict) or not set(response).issubset(RESPONSE_KEYS):
            errors.append("response has invalid fields")
        else:
            for key in ("method", "minimum_response", "non_response_policy", "closer"):
                require_nonempty_string(response, key, errors, "response")
            deadline = response.get("deadline", "")
            deadline_policy = response.get("deadline_policy", "")
            if not isinstance(deadline, str) or not isinstance(deadline_policy, str):
                errors.append("response deadline fields must be strings")
            elif not deadline.strip() and not deadline_policy.strip():
                errors.append("response requires deadline or deadline_policy")
            elif deadline.strip():
                validate_deadline(deadline, errors)
    elif response != {}:
        errors.append("response must be empty when requires_response is false")

    transport = plan.get("transport")
    if transport not in TRANSPORTS:
        errors.append(f"transport must be one of {sorted(TRANSPORTS)}")
    multiline = "\n" in text or "\r" in text
    if multiline and transport not in {"node-entry", "native-binary"}:
        errors.append("multiline text requires node-entry or native-binary transport")
    validate_markdown(text, errors)

    post_send = require_object(
        plan.get("post_send_readback"), POST_SEND_KEYS, "post_send_readback", errors
    )
    require_true(post_send, "planned", errors, "post_send_readback")
    require_nonempty_string(post_send, "method", errors, "post_send_readback")
    if not isinstance(post_send.get("non_first_line_check"), bool):
        errors.append("post_send_readback.non_first_line_check must be boolean")
    elif multiline and post_send.get("non_first_line_check") is not True:
        errors.append("multiline text requires a non-first-line readback check")

    summary = {
        "status": "pass" if not errors else "fail",
        "payload_sha256": current_payload_sha,
        "errors": errors,
        "warnings": warnings,
        "bootstrap_evidence_template": None,
    }
    if is_bootstrap and not errors:
        summary["bootstrap_evidence_template"] = bootstrap_evidence_template(plan)
    return summary


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--bootstrap-result", type=Path)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    try:
        plan = load_plan(args.input)
        summary = validate_plan(plan)
        if args.bootstrap_result:
            if summary["status"] != "pass":
                summary["errors"].append(
                    "bootstrap result cannot be processed until the plan passes"
                )
                summary["status"] = "fail"
            else:
                result = load_json_object(args.bootstrap_result, "bootstrap result")
                evidence, evidence_errors = validate_bootstrap_result(plan, result)
                summary["errors"].extend(evidence_errors)
                summary["status"] = "pass" if not summary["errors"] else "fail"
                summary["bootstrap_evidence"] = evidence if not evidence_errors else None
    except PlanError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    if args.json:
        print(json.dumps(summary, ensure_ascii=False, sort_keys=True))
    else:
        print(f"status={summary['status']}")
        print(f"payload_sha256={summary['payload_sha256']}")
        for error in summary["errors"]:
            print(f"ERROR: {error}")
        for warning in summary["warnings"]:
            print(f"WARNING: {warning}")
        if summary.get("bootstrap_evidence"):
            print(
                "bootstrap_evidence="
                + json.dumps(
                    summary["bootstrap_evidence"], ensure_ascii=False, sort_keys=True
                )
            )
    return 0 if summary["status"] == "pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())
