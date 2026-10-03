"""Turning the cells of one sheet row into a contact: which column is which, and whether the row is acceptable."""

from __future__ import annotations

import hashlib
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
    "name": {
        "name", "full name", "fullname", "customer name", "contact name", "client name", "lead name", "naam", "voter name", "elector name",
        "person name",
    },
    "phone": {
        "phone", "mobile", "mobile number", "mobile no", "mobile no.", "phone number", "phone no", "contact number",
        "contact no", "contact", "whatsapp", "whatsapp number", "cell", "cell number", "number", "mobile1",
    },
    "email": {"email", "email id", "e mail", "mail", "email address"},
    "location": {"location", "city", "area", "place", "town", "district"},
    # what a voter list (or any list of people) has
    "relative_name": {"relative name", "relative", "relation name", "father name", "husband name", "father husband name", "guardian name", "relative s name"},
    "age": {"age"},
    "gender": {"gender", "sex"},
    "epic_no": {"epic no", "epic", "epic number", "epic id", "voter id", "voter id no", "voter id number", "voter card no"},
    "pincode": {"pincode", "pin code", "pin", "voter pincode", "zip", "zip code", "postal code", "postcode"},
    "address": {"address", "voter address", "full address", "residential address", "home address", "house address", "current address"},
    "category": {"category", "segment", "type", "customer type", "lead type"},
    "priority": {"priority"},
    "tags": {"tags", "tag", "labels", "label"},
    "assigned_to": {"assigned to", "assignee", "employee", "employee code", "employee id", "agent", "assigned employee"},
}

def norm_header(value: Any) -> str:
    """'Voter Name', 'voter_name', 'VOTER-NAME', "Voter's Name" and 'VoterName' are one and the same header: only letters and digits, in lower case."""
    return re.sub(r"[\W_]+", "", unicodedata.normalize("NFKC", str(value or "")).lower())


_ALIAS_LOOKUP = {norm_header(alias): canonical for canonical, aliases in HEADER_ALIASES.items() for alias in aliases}
# When no header is a known name for the person's name (or number), the ONE header that says "name" (or "mobile" / "phone") is taken -
# unless it is somebody else's name (the relative's, the agent's ...).
_FALLBACK_WORDS = {"name": ("name",), "phone": ("mobile", "phone")}
_NOT_THE_PERSON = ("relative", "relation", "father", "husband", "guardian", "mother", "spouse", "parent", "booth", "company", "campaign", "team", "employee", "agent", "assign")

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
    for want, words in _FALLBACK_WORDS.items():
        if want in used:
            continue
        found = [
            idx for idx, header in custom.items()
            if any(w in norm_header(header) for w in words) and not any(w in norm_header(header) for w in _NOT_THE_PERSON)
        ]
        if len(found) == 1:  # (two candidates: it is not guessed)
            canonical[found[0]] = want
            used.add(want)
            del custom[found[0]]
    return canonical, custom


def _clean(text: str) -> str:
    """No control or invisible characters, one normal form for accents, no stray spaces."""
    return unicodedata.normalize("NFC", _CONTROL.sub("", text)).strip()


def _age(value: Any) -> int | None:
    """35, '35', 35.0 -> 35. Anything that is not a plausible age is simply left out (the row is still good)."""
    digits = re.sub(r"\D", "", text(value).split(".")[0])
    return int(digits) if digits and 0 < int(digits) <= 150 else None


def _gender(value: Any) -> str | None:
    word = text(value).strip().lower()
    if not word:
        return None
    if word[0] == "m":
        return "M"
    if word[0] == "f" or word.startswith("w"):  # female, woman
        return "F"
    return "O" if word[0] in "ot" else None  # other, third gender


def _pincode(value: Any) -> str | None:
    digits = re.sub(r"\D", "", text(value).split(".")[0])
    return digits[:6] if digits else None


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


def person_key(data: dict[str, Any]) -> str | None:
    """A short stable key of WHO a row is: name, relative, age, gender, pincode and address, in lower case with the spaces made
    equal. Rows with the same key are one person (with the numbers of all those rows).

    A row only has a key when it says enough about the person (an address, a relative or a voter card number, and at least two of
    the details) - a plain list of names and numbers is not merged: two customers called "Rahul" are two contacts."""
    details = [data.get(k) for k in ("relative_name", "age", "gender", "pincode", "address", "epic_no")]
    if not (data.get("address") or data.get("relative_name") or data.get("epic_no")) or sum(1 for d in details if d) < 2:
        return None
    identity = "|".join(
        _SPACES.sub(" ", str(data.get(k) or "")).strip().casefold() for k in ("name", "relative_name", "age", "gender", "pincode", "address")
    )
    return hashlib.blake2b(identity.encode("utf-8"), digest_size=12).hexdigest()


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

    relative_name = _SPACES.sub(" ", text(values.get("relative_name")))[:255] or None
    address = _SPACES.sub(" ", text(values.get("address")))[:2000] or None
    epic_no = re.sub(r"\s+", "", text(values.get("epic_no"))).upper()[:32] or None
    age = _age(values.get("age"))
    gender = _gender(values.get("gender"))
    pincode = _pincode(values.get("pincode"))

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
        "relative_name": relative_name,
        "age": age,
        "gender": gender,
        "epic_no": epic_no,
        "pincode": pincode,
        "address": address,
        "category": text(values.get("category"))[:100] or None,
        "priority": priority,
        "tags": tags,
        "custom_fields": custom_fields,
        "assigned_employee_id": assigned_employee_id,
    }
    return RowResult(row_number, ROW_VALID, data, [], normalized)
