"""Reference data the application cannot run without: roles, dispositions and default settings.

`ensure_reference_data` is idempotent. It only inserts what is missing and never overwrites
values an administrator has changed.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.call import CallDisposition
from app.models.employee import ROLE_ADMIN, ROLE_EMPLOYEE, ROLE_MANAGER, Role
from app.models.system import Setting

ROLES = [
    (ROLE_ADMIN, "Full access to administration, reports and recordings."),
    (ROLE_MANAGER, "Read access to the activity of employees in their own team."),
    (ROLE_EMPLOYEE, "Calls assigned contacts and records outcomes."),
]

# code, label, category, requires_callback, sort_order
DISPOSITIONS = [
    ("CONNECTED", "Connected", "connected", False, 1),
    ("NO_ANSWER", "No Answer", "not_connected", False, 2),
    ("BUSY", "Busy", "not_connected", False, 3),
    ("SWITCHED_OFF", "Switched Off", "not_connected", False, 4),
    ("INVALID_NUMBER", "Invalid Number", "not_connected", False, 5),
    ("INTERESTED", "Interested", "connected", False, 6),
    ("NOT_INTERESTED", "Not Interested", "connected", False, 7),
    ("CALLBACK", "Callback", "connected", True, 8),
    ("FOLLOW_UP", "Follow-up", "connected", True, 9),
    ("COMPLETED", "Completed", "connected", False, 10),
    ("DO_NOT_CONTACT", "Do Not Contact", "other", False, 11),
]

DEFAULT_SETTINGS: dict[str, tuple[object, str]] = {
    "retry_rules": (
        {
            "NO_ANSWER": {"delay_minutes": 120, "max_attempts": 3},
            "BUSY": {"delay_minutes": 30, "max_attempts": 5},
            "SWITCHED_OFF": {"delay_minutes": 240, "max_attempts": 3},
        },
        "Retry delay and attempt limit for not-connected outcomes.",
    ),
    "recording": (
        {
            "enabled": False,
            "notice_text": (
                "Calls made through this app may be recorded for quality and training purposes. "
                "Recordings are stored privately and are only accessible to authorised staff."
            ),
        },
        "Call recording switch and the notice employees must acknowledge. Keep disabled until "
        "the organisation has completed its legal/compliance review.",
    ),
    "default_daily_target": (50, "Daily calling target for newly created employees."),
    "duplicate_policy": ("skip", "Default handling of duplicate phone numbers during import: skip | update."),
    "inactive_after_days": (
        2,
        "An employee who has not been seen for this many days is not given new contacts, and (with automatic rebalancing on) the "
        "contacts they have not started on are given to the employees who are working.",
    ),
    "auto_rebalance": (
        True,
        "Automatically give the not-yet-called contacts of employees who are no longer working to the ones who are, every few minutes.",
    ),
}


def ensure_reference_data(db: Session) -> None:
    existing_roles = {r.name for r in db.scalars(select(Role))}
    for name, description in ROLES:
        if name not in existing_roles:
            db.add(Role(name=name, description=description))

    existing_codes = {d.code for d in db.scalars(select(CallDisposition))}
    for code, label, category, requires_callback, sort_order in DISPOSITIONS:
        if code not in existing_codes:
            db.add(
                CallDisposition(
                    code=code,
                    label=label,
                    category=category,
                    requires_callback=requires_callback,
                    sort_order=sort_order,
                    is_active=True,
                )
            )

    existing_settings = {s.key for s in db.scalars(select(Setting))}
    for key, (value, description) in DEFAULT_SETTINGS.items():
        if key not in existing_settings:
            db.add(Setting(key=key, value=value, description=description))

    db.commit()
