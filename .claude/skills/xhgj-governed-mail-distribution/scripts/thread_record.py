#!/usr/bin/env python3
"""Build and validate body-free records for an original mail thread."""

import datetime
from email.header import decode_header
from email.parser import BytesParser
from email.policy import default
from email.utils import getaddresses, parsedate_to_datetime
import hashlib
import json
from pathlib import Path
import re


THREAD_RECORD_SCHEMA_VERSION = "1.0"
RECORD_STATUSES = ("resolved", "ambiguous", "not-found", "missing-rfc-message-id")
ADAPTERS = ("context-record", "imap", "pop3", "dws", "eml", "json")
CLUE_KEYS = ("subject", "time_start", "time_end", "from", "to", "attachment_name")
MESSAGE_ID_RE = re.compile(r"^<[^<>\s@]+@[^<>\s]+>$")
REFERENCE_RE = re.compile(r"<[^<>\s]+@[^<>\s]+>")
FORBIDDEN_RECORD_KEYS = {
    "body", "bodypreview", "contentbytes", "credential", "html", "mime",
    "password", "raw", "secret", "token", "uniquebody",
}


def now_iso():
    return datetime.datetime.now(datetime.timezone.utc).astimezone().isoformat()


def decode_value(value):
    if value is None:
        return ""
    parts = []
    for payload, charset in decode_header(str(value)):
        if isinstance(payload, bytes):
            parts.append(payload.decode(charset or "utf-8", errors="replace"))
        else:
            parts.append(payload)
    return "".join(parts).strip()


def address_values(values):
    if values is None:
        return []
    if isinstance(values, dict):
        nested = first_value(values, ("emailAddress", "email_address"))
        if nested is not None:
            return address_values(nested)
        direct = first_value(values, ("address", "email", "mail", "value"))
        return address_values(direct)
    if isinstance(values, str):
        values = [values]
    if not isinstance(values, list):
        return []
    decoded = []
    for value in values:
        if isinstance(value, dict):
            decoded.extend(address_values(value))
        else:
            decoded.append(decode_value(value))
    return sorted({address.lower() for _, address in getaddresses(decoded) if address})


def reference_values(values):
    if values is None:
        return []
    if isinstance(values, list):
        text = " ".join(str(value) for value in values)
    else:
        text = str(values)
    found = []
    for item in REFERENCE_RE.findall(text):
        if item not in found:
            found.append(item)
    return found


def message_id_value(value):
    value = decode_value(value)
    matches = REFERENCE_RE.findall(value)
    return matches[0] if len(matches) == 1 else ""


def local_timezone():
    return datetime.datetime.now().astimezone().tzinfo


def parse_datetime(value):
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        timestamp = float(value)
        if timestamp > 100000000000:
            timestamp /= 1000.0
        parsed = datetime.datetime.fromtimestamp(timestamp, datetime.timezone.utc)
    elif isinstance(value, datetime.datetime):
        parsed = value
    else:
        text = str(value).strip()
        if not text:
            return None
        try:
            parsed = datetime.datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError:
            try:
                parsed = parsedate_to_datetime(text)
            except (TypeError, ValueError, OverflowError):
                return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=local_timezone())
    return parsed.astimezone(datetime.timezone.utc)


def datetime_iso(value):
    parsed = parse_datetime(value)
    return parsed.isoformat() if parsed is not None else None


def attachment_names(message):
    names = []
    for part in message.walk():
        filename = decode_value(part.get_filename())
        if filename and filename not in names:
            names.append(filename)
    return names


def candidate_id(candidate):
    stable = "\n".join([
        candidate.get("message_id") or "",
        candidate.get("date") or "",
        candidate.get("subject") or "",
        candidate.get("locator") or "",
    ])
    return hashlib.sha256(stable.encode("utf-8")).hexdigest()[:16].upper()


def candidate_from_message(message, locator, adapter, attachments_parsed=True):
    references = reference_values(message.get_all("References", []))
    in_reply_to = reference_values(message.get_all("In-Reply-To", []))
    for item in in_reply_to:
        if item not in references:
            references.append(item)
    result = {
        "message_id": message_id_value(message.get("Message-ID")),
        "references": references,
        "subject": decode_value(message.get("Subject")),
        "date": datetime_iso(message.get("Date")),
        "from": address_values(message.get_all("From", [])),
        "to": address_values(message.get_all("To", [])),
        "cc": address_values(message.get_all("Cc", [])),
        "reply_to": address_values(message.get_all("Reply-To", [])),
        "attachment_names": attachment_names(message),
        "locator": str(locator),
        "adapter": adapter,
    }
    result["_field_status"] = {
        "message_id": "parsed" if result["message_id"] else "missing",
        "references": (
            "parsed" if message.get_all("References", [])
            or message.get_all("In-Reply-To", []) else "derived-from-message-id"
        ),
        "recipient_matrix": (
            "parsed" if result["from"] and result["to"] else "partial"
        ),
        "attachments": (
            "parsed" if result["attachment_names"] else "none"
        ) if attachments_parsed else "unavailable",
    }
    result["candidate_id"] = candidate_id(result)
    return result


def candidate_from_bytes(raw, locator, adapter, attachments_parsed=True):
    message = BytesParser(policy=default).parsebytes(raw)
    return candidate_from_message(
        message, locator, adapter, attachments_parsed=attachments_parsed)


def first_value(mapping, names):
    for name in names:
        if name in mapping and mapping.get(name) not in (None, ""):
            return mapping.get(name)
    return None


def has_any_key(mapping, names):
    return any(name in mapping for name in names)


def internet_header_value(mapping, header_name):
    headers = first_value(mapping, ("internetMessageHeaders", "headers"))
    if isinstance(headers, dict):
        for name, value in headers.items():
            if str(name).casefold() == header_name.casefold():
                return value
    if isinstance(headers, list):
        for header in headers:
            if not isinstance(header, dict):
                continue
            name = first_value(header, ("name", "headerName", "key"))
            if str(name or "").casefold() == header_name.casefold():
                return first_value(header, ("value", "headerValue"))
    return None


def filename_values(values):
    if values is None:
        return []
    if isinstance(values, (str, dict)):
        values = [values]
    if not isinstance(values, list):
        return []
    result = []
    for value in values:
        if isinstance(value, dict):
            value = first_value(value, ("name", "filename", "fileName", "title"))
        name = decode_value(value)
        if name and name not in result:
            result.append(name)
    return result


def candidate_from_mapping(mapping, locator, adapter):
    if not isinstance(mapping, dict):
        raise ValueError("normalized message entry must be an object")
    message_id_names = (
        "internetMessageId", "InternetMessageId", "internet_message_id",
        "rfc_message_id",
    )
    if adapter != "dws":
        message_id_names += ("message_id",)
    references_names = ("references", "References")
    in_reply_to_names = ("in_reply_to", "inReplyTo", "In-Reply-To")
    from_names = ("from", "sender", "From")
    to_names = ("to", "recipients", "toRecipients", "To")
    cc_names = ("cc", "ccRecipients", "Cc")
    reply_to_names = ("reply_to", "replyTo")
    attachment_names_keys = ("attachment_names", "attachments")
    message_id = first_value(mapping, message_id_names)
    if message_id is None:
        message_id = internet_header_value(mapping, "Message-ID")
    references = first_value(mapping, references_names)
    if references is None:
        references = internet_header_value(mapping, "References")
    in_reply_to = first_value(mapping, in_reply_to_names)
    if in_reply_to is None:
        in_reply_to = internet_header_value(mapping, "In-Reply-To")
    parsed_references = reference_values(references)
    for item in reference_values(in_reply_to):
        if item not in parsed_references:
            parsed_references.append(item)
    attachments = first_value(mapping, attachment_names_keys)
    result = {
        "message_id": message_id_value(message_id),
        "references": parsed_references,
        "subject": decode_value(first_value(mapping, ("subject", "Subject"))),
        "date": datetime_iso(first_value(mapping, (
            "date", "sent_at", "sentDateTime", "receivedDateTime", "createTime",
        ))),
        "from": address_values(first_value(mapping, from_names)),
        "to": address_values(first_value(mapping, to_names)),
        "cc": address_values(first_value(mapping, cc_names)),
        "reply_to": address_values(first_value(mapping, reply_to_names)),
        "attachment_names": filename_values(attachments),
        "locator": str(locator),
        "adapter": adapter,
    }
    result["_field_status"] = {
        "message_id": "parsed" if result["message_id"] else "missing",
        "references": (
            "parsed" if references is not None or in_reply_to is not None
            else "derived-from-message-id"
        ),
        "recipient_matrix": (
            "parsed" if has_any_key(mapping, from_names)
            and has_any_key(mapping, to_names) else "partial"
        ),
        "attachments": (
            "parsed" if result["attachment_names"] else "none"
        ) if has_any_key(mapping, attachment_names_keys) else "unavailable",
    }
    result["candidate_id"] = candidate_id(result)
    return result


def normalized_clues(clues):
    result = {}
    for key in CLUE_KEYS:
        value = clues.get(key) if isinstance(clues, dict) else None
        if isinstance(value, str):
            value = value.strip()
        if value not in (None, ""):
            result[key] = value
    return result


def candidate_matches(candidate, clues):
    clues = normalized_clues(clues)
    evidence = []
    subject = clues.get("subject")
    if subject:
        if subject.casefold() not in candidate.get("subject", "").casefold():
            return False, []
        evidence.append("subject")
    start = parse_datetime(clues.get("time_start"))
    end = parse_datetime(clues.get("time_end"))
    candidate_date = parse_datetime(candidate.get("date"))
    if start:
        if candidate_date is None or candidate_date < start:
            return False, []
        evidence.append("time_start")
    if end:
        if candidate_date is None or candidate_date > end:
            return False, []
        evidence.append("time_end")
    for clue_key, candidate_key in (("from", "from"), ("to", "to")):
        address = clues.get(clue_key)
        if address:
            normalized = address.lower()
            if normalized not in candidate.get(candidate_key, []):
                return False, []
            evidence.append(clue_key)
    attachment = clues.get("attachment_name")
    if attachment:
        if not any(
                attachment.casefold() in name.casefold()
                for name in candidate.get("attachment_names", [])):
            return False, []
        evidence.append("attachment_name")
    return True, evidence


def minimal_candidate(candidate):
    return {
        "candidate_id": candidate.get("candidate_id"),
        "subject": candidate.get("subject"),
        "date": candidate.get("date"),
        "from": candidate.get("from", []),
        "to": candidate.get("to", []),
        "attachment_names": candidate.get("attachment_names", []),
    }


def resolved_message(candidate):
    references = list(candidate.get("references", []))
    message_id = candidate.get("message_id", "")
    if message_id and message_id not in references:
        references.append(message_id)
    return {
        "message_id": message_id,
        "references": references,
        "subject": candidate.get("subject"),
        "date": candidate.get("date"),
        "from": candidate.get("from", []),
        "to": candidate.get("to", []),
        "cc": candidate.get("cc", []),
        "reply_to": candidate.get("reply_to", []),
        "attachment_names": candidate.get("attachment_names", []),
    }


def resolve_candidates(candidates, clues, adapter, selected_candidate_id=None,
                       limitations=None):
    matches = []
    evidence_by_id = {}
    for candidate in candidates:
        matched, evidence = candidate_matches(candidate, clues)
        if matched:
            matches.append(candidate)
            evidence_by_id[candidate["candidate_id"]] = evidence
    selected = None
    selected_by = None
    if selected_candidate_id:
        selected = next(
            (item for item in matches if item["candidate_id"] == selected_candidate_id),
            None,
        )
        if selected is None:
            raise ValueError(
                "selected candidate_id is not among the candidates matched by the clues"
            )
        selected_by = "owner-selection"
    elif len(matches) == 1:
        selected = matches[0]
        selected_by = "unique-match"

    status = "not-found"
    if selected is not None:
        status = "resolved" if selected.get("message_id") else "missing-rfc-message-id"
    elif matches:
        status = "ambiguous"
    record = {
        "schema_version": THREAD_RECORD_SCHEMA_VERSION,
        "status": status,
        "source": {
            "adapter": adapter,
            "retrieved_at": now_iso(),
            "limitations": list(limitations or []),
        },
        "query": {"clues": normalized_clues(clues)},
        "resolution": {
            "candidate_count": len(matches),
            "selected_by": selected_by,
            "evidence": evidence_by_id.get(
                selected.get("candidate_id") if selected else "", []),
        },
    }
    if selected is not None:
        record["resolution"]["candidate_id"] = selected["candidate_id"]
        record["resolution"]["field_status"] = dict(selected.get(
            "_field_status", {
                "message_id": "parsed" if selected.get("message_id") else "missing",
                "references": "derived-from-message-id",
                "recipient_matrix": "partial",
                "attachments": "unavailable",
            }))
        record["message"] = resolved_message(selected)
    elif matches:
        record["candidates"] = [minimal_candidate(item) for item in matches]
    return record


def record_errors(record):
    errors = []
    if not isinstance(record, dict):
        return ["thread record must be a JSON object"]
    if str(record.get("schema_version")) != THREAD_RECORD_SCHEMA_VERSION:
        errors.append("thread record schema_version must be %s"
                      % THREAD_RECORD_SCHEMA_VERSION)
    status = record.get("status")
    if status not in RECORD_STATUSES:
        errors.append("thread record status must be one of %s" % (RECORD_STATUSES,))
    source = record.get("source")
    if not isinstance(source, dict) or source.get("adapter") not in ADAPTERS:
        errors.append("thread record source.adapter must be one of %s" % (ADAPTERS,))
    resolution = record.get("resolution")
    if not isinstance(resolution, dict):
        errors.append("thread record resolution must be an object")
    elif not isinstance(resolution.get("candidate_count"), int):
        errors.append("thread record resolution.candidate_count must be an integer")
    if status in ("resolved", "missing-rfc-message-id"):
        message = record.get("message")
        if not isinstance(message, dict):
            errors.append("resolved thread record must include message metadata")
        else:
            message_id = message.get("message_id", "")
            if status == "resolved" and not MESSAGE_ID_RE.match(str(message_id)):
                errors.append("resolved thread record requires an RFC Message-ID")
            references = message.get("references")
            if not isinstance(references, list):
                errors.append("thread record message.references must be a list")
            elif status == "resolved" and message_id not in references:
                errors.append("thread record references must include message_id")
            for field in ("from", "to", "cc", "reply_to", "attachment_names"):
                if not isinstance(message.get(field, []), list):
                    errors.append("thread record message.%s must be a list" % field)
        field_status = resolution.get("field_status") if isinstance(resolution, dict) else None
        if not isinstance(field_status, dict):
            errors.append("resolved thread record must include resolution.field_status")
        else:
            allowed_statuses = {
                "message_id": ("parsed", "missing"),
                "references": ("parsed", "derived-from-message-id", "unavailable"),
                "recipient_matrix": ("parsed", "partial", "unavailable"),
                "attachments": ("parsed", "none", "unavailable"),
            }
            for field, allowed in allowed_statuses.items():
                if field_status.get(field) not in allowed:
                    errors.append(
                        "thread record field_status.%s must be one of %s"
                        % (field, allowed)
                    )
            if status == "resolved" and field_status.get("message_id") != "parsed":
                errors.append(
                    "resolved thread record field_status.message_id must be parsed")
    if status == "ambiguous" and not isinstance(record.get("candidates"), list):
        errors.append("ambiguous thread record must include minimal candidates")
    for path in forbidden_record_paths(record):
        errors.append("thread record must not persist body or credentials: %s" % path)
    return errors


def forbidden_record_paths(value, path="$"):
    result = []
    if isinstance(value, dict):
        for key, child in value.items():
            child_path = "%s.%s" % (path, key)
            if str(key).casefold() in FORBIDDEN_RECORD_KEYS:
                result.append(child_path)
            else:
                result.extend(forbidden_record_paths(child, child_path))
    elif isinstance(value, list):
        for index, child in enumerate(value):
            result.extend(forbidden_record_paths(
                child, "%s[%d]" % (path, index)))
    return result


def load_record(path):
    path = Path(path)
    return json.loads(path.read_text(encoding="utf-8"))


def record_sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest().upper()
