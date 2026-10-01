"""Phone number normalisation (E.164) - the single source of truth for duplicate detection."""

from __future__ import annotations

import re
from decimal import Decimal, InvalidOperation
from typing import Any

import phonenumbers

from app.core.config import get_settings

_SCIENTIFIC = re.compile(r"^\d+(\.\d+)?[eE]\+?\d+$")
_TRAILING_ZERO_DECIMAL = re.compile(r"^\d+\.0+$")


def clean_phone_input(raw: Any) -> str:
    """Undo what spreadsheets do to phone numbers (floats, scientific notation, apostrophes)."""
    if raw is None:
        return ""
    if isinstance(raw, bool):
        return ""
    if isinstance(raw, float):
        return str(int(raw)) if raw.is_integer() else str(raw)
    if isinstance(raw, int):
        return str(raw)
    text = str(raw).strip().lstrip("'").strip()
    if _SCIENTIFIC.match(text):
        try:
            return str(int(Decimal(text)))
        except (InvalidOperation, ValueError):
            return text
    if _TRAILING_ZERO_DECIMAL.match(text):
        return text.split(".")[0]
    return text


def normalize_phone(raw: Any, region: str | None = None) -> str | None:
    """Return the E.164 form of a valid phone number, or None when it cannot be validated."""
    text = clean_phone_input(raw)
    if not text or len(text) > 32:
        return None
    region = region or get_settings().default_phone_region
    try:
        number = phonenumbers.parse(text, region)
    except phonenumbers.NumberParseException:
        return None
    if not phonenumbers.is_valid_number(number):
        return None
    return phonenumbers.format_number(number, phonenumbers.PhoneNumberFormat.E164)


def format_display(e164: str) -> str:
    """Human friendly international format, e.g. '+91 98765 43210'."""
    try:
        number = phonenumbers.parse(e164, None)
        return phonenumbers.format_number(number, phonenumbers.PhoneNumberFormat.INTERNATIONAL)
    except phonenumbers.NumberParseException:
        return e164


def digits_only(value: str) -> str:
    return re.sub(r"\D", "", value or "")
