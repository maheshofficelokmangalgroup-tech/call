"""Turning the cells of one sheet row into a contact: which column is which, and whether the row is acceptable."""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any

from app.schemas.common import validate_email
from app.services.phone import clean_phone_input, normalize_phone

ROW_VALID = "valid"
ROW_INVALID = "invalid"

HEADER_ALIASES: dict[str, set[str]] = {
    "name": {"name", "full name", "fullname", "customer name", "contact name", "client name", "lead name", "naam"},
    "phone": {
        "phone", "mobile", "mobile number", "mobile no", "mobile no.", "phone number", "phone no", "contact number",
        "contact no", "contact", "whatsapp", "whatsapp number", "cell", "cell number", "number", "mobile1",
    },
    "email": {"email", "email id", "e mail", "mail", "email address"},
    "location": {"location", "city", "area", "address", "place", "town", "district"},
    "category": {"category", "segment", "type", "customer type", "lead type"},
    "priority": {"priority"},
    "tags": {"tags", "tag", "labels", "label"},
    "assigned_to": {"assigned to", "assignee", "employee", "employee code", "employee id", "agent", "assigned employee"},
}
_ALIAS_LOOKUP = {alias: canonical for canonical, aliases in HEADER_ALIASES.items() for alias in aliases}

_PRIORITY_WORDS = {
    "1": 1, "high": 1, "h": 1, "urgent": 1,
    "2": 2, "medium": 2, "med": 2, "m": 2, "normal": 2, "": 2,
    "3": 3, "low": 3, "l": 3,
}
# control characters, invisible ones (zero-width, bidi marks, byte-order mark) and lone surrogates (cannot be stored anywhere).
# Written as code points on purpose: invisible characters in the source of a program are how "trojan source" attacks hide.
_INVISIBLE = (
    *range(0x00, 0x09), 0x0B, 0x0C, *range(0x0E, 0x20), *range(0x7F, 0xA0),
    *range(0x200B, 0x2010), 0x2028, 0x2029, *range(0x202A, 0x202F), *range(0x2060, 0x2065), 0xFEFF, *range(0xD800, 0xE000),
)
_CONTROL = re.compile("[" + "".join(re.escape(chr(code)) for code in _INVISIBLE) + "]")
_SPACES = re.compile(r"\s+")


@dataclass
class RowResult:
    row_number: int
    status: str
    data: dict[str, Any]
    errors: list[str] = field(default_factory=list)
    normalized_phone: str | None = None


def norm_header(value: Any) -> str:
    return re.sub(r"[\s_\-]+", " ", str(value or "").strip().lower())


def map_headers(headers: list[str]) -> tuple[dict[int, str], dict[int, str]]:
    """(columns the system knows by position, the other named columns - kept as extra fields of the contact)."""
    canonical: dict[int, str] = {}
    custom: dict[int, str] = {}
    used: set[str] = set()
    for idx, header in enumerate(headers):
        key = _ALIAS_LOOKUP.get(norm_header(header))
        if key and key not in used:
            canonical[idx] = key
            used.add(key)
        elif str(header).strip():
            custom[idx] = _clean(str(header))[:60]
    return canonical, custom


def _clean(text: str) -> str:
    """No control or invisible characters, one normal form for accents, no stray spaces."""
    return unicodedata.normalize("NFC", _CONTROL.sub("", text)).strip()


def cell(row: list[Any], idx: int) -> Any:
    return row[idx] if idx < len(row) else None


def text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "yes" if value else "no"
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return _clean(str(value))


def validate_row(
    row_number: int,
    row: list[Any],
    canonical: dict[int, str],
    custom: dict[int, str],
    *,
    default_priority: int,
    employees: dict[str, int],
) -> RowResult:
    values = {key: cell(row, idx) for idx, key in canonical.items()}
    errors: list[str] = []

    name = _SPACES.sub(" ", text(values.get("name")))
    if not name:
        errors.append("Name is required.")
    elif len(name) > 255:
        errors.append("Name is longer than 255 characters.")

    raw_phone = clean_phone_input(values.get("phone"))
    normalized = None
    if not raw_phone:
        errors.append("Mobile number is required.")
    else:
        raw_phone = _clean(raw_phone)
        normalized = normalize_phone(raw_phone)
        if normalized is None:
            errors.append(f"Invalid mobile number '{raw_phone[:32]}'.")

    email = text(values.get("email")) or None
    if email:
        try:
            email = validate_email(email)
        except ValueError:
            errors.append(f"Invalid email '{email[:60]}'.")
            email = None

    priority = default_priority
    prio_text = text(values.get("priority")).lower()
    if prio_text:
        if prio_text in _PRIORITY_WORDS:
            priority = _PRIORITY_WORDS[prio_text]
        else:
            errors.append(f"Invalid priority '{prio_text[:20]}' (use 1-3 or High/Medium/Low).")

    tags = [t.strip()[:40] for t in re.split(r"[;,|]", text(values.get("tags"))) if t.strip()][:20]

    custom_fields: dict[str, Any] = {}
    for idx, header in custom.items():
        value = text(cell(row, idx))
        if value:
            custom_fields[header] = value[:500]
        if len(custom_fields) >= 30:
            break

    assigned_employee_id = None
    assigned_key = text(values.get("assigned_to"))
    if assigned_key:
        assigned_employee_id = employees.get(assigned_key.lower())
        if assigned_employee_id is None:
            errors.append(f"Unknown or inactive employee '{assigned_key[:40]}'.")

    if errors:
        raw = {(custom.get(i) or canonical.get(i) or f"col{i}"): text(cell(row, i))[:200] for i in range(len(row))}
        return RowResult(row_number, ROW_INVALID, raw, errors, normalized)

    data = {
        "name": name,
        "phone_raw": raw_phone[:64],
        "email": email,
        "location": text(values.get("location"))[:255] or None,
        "category": text(values.get("category"))[:100] or None,
        "priority": priority,
        "tags": tags,
        "custom_fields": custom_fields,
        "assigned_employee_id": assigned_employee_id,
    }
    return RowResult(row_number, ROW_VALID, data, [], normalized)
