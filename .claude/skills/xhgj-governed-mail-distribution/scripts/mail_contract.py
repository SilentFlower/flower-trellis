#!/usr/bin/env python3
"""Resolve governed mail plan versions into one executable contract."""

import json
from pathlib import Path

import thread_record


CURRENT_SCHEMA_VERSION = "2.0"
LEGACY_SCHEMA_VERSIONS = (None, "", "1", "1.0")

INTENTS = (
    "acknowledgement",
    "discussion",
    "formal-delivery",
    "release",
    "notification",
)
THREAD_KINDS = ("new", "reply", "update")
BODY_MODES = ("plain", "multipart")
STYLE_STRATEGIES = ("minimal", "reviewed-template")
ADDRESSING_SOURCES = (
    "user-explicit",
    "recipient-preference",
    "thread-history",
    "scenario-default",
    "omitted",
)
VERIFIED_TEMPLATE_IDS = ("governed-mail-v1",)


def schema_version(plan):
    value = plan.get("schema_version")
    if value is None:
        return None
    return str(value).strip()


def is_legacy(plan):
    return schema_version(plan) in LEGACY_SCHEMA_VERSIONS


def resolve_intent(plan):
    if is_legacy(plan):
        return "formal-delivery"
    return plan.get("intent")


def raw_thread(plan):
    if is_legacy(plan):
        mail = plan.get("mail", {})
        thread = mail.get("thread", {})
    else:
        thread = plan.get("thread", {})
    return dict(thread) if isinstance(thread, dict) else {}


def thread_record_path(plan, base_dir=None):
    thread = raw_thread(plan)
    value = thread.get("record_path")
    if not isinstance(value, str) or not value.strip():
        return None
    path = Path(value)
    if base_dir and not path.is_absolute():
        path = Path(base_dir) / path
    return path


def load_thread_record(plan, base_dir=None):
    path = thread_record_path(plan, base_dir)
    if path is None:
        return None, None, None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data, thread_record.record_sha256(path), None
    except (OSError, ValueError) as exc:
        return None, None, "%s: %s" % (type(exc).__name__, exc)


def resolve_thread(plan, base_dir=None):
    result = raw_thread(plan)
    if is_legacy(plan):
        return result
    record, digest, error = load_thread_record(plan, base_dir)
    if error:
        result["record_error"] = error
        return result
    if record is None:
        return result
    result["record_sha256"] = digest
    if not isinstance(record, dict):
        result["record_error"] = "thread record root must be an object"
        return result
    source = record.get("source", {})
    resolution = record.get("resolution", {})
    result["discovery"] = {
        "status": record.get("status"),
        "adapter": source.get("adapter"),
        "candidate_count": resolution.get("candidate_count"),
        "selected_by": resolution.get("selected_by"),
        "evidence": resolution.get("evidence", []),
    }
    message = record.get("message")
    if record.get("status") == "resolved" and isinstance(message, dict):
        if not result.get("in_reply_to"):
            result["in_reply_to"] = message.get("message_id")
        if not result.get("references"):
            result["references"] = list(message.get("references", []))
    return result


def resolve_presentation(plan):
    if is_legacy(plan):
        mail = plan.get("mail", {})
        return {
            "body_mode": "multipart",
            "style_strategy": "reviewed-template",
            "template_id": mail.get("template_id"),
            "legacy_inferred": True,
        }
    presentation = plan.get("presentation", {})
    if not isinstance(presentation, dict):
        presentation = {}
    result = dict(presentation)
    result["legacy_inferred"] = False
    return result


def resolve_addressing(plan):
    if is_legacy(plan):
        return None
    communication = plan.get("communication", {})
    if not isinstance(communication, dict):
        return None
    addressing = communication.get("addressing")
    return dict(addressing) if isinstance(addressing, dict) else None
