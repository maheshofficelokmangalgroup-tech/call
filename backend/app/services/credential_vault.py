"""The first password of an employee, kept so that the administrator who handed it out can look at it again.

Passwords are never stored in a readable form - except this one kind: the password an *administrator* chose or generated for somebody
(a new account, a reset). It is kept ENCRYPTED, and only until the employee signs in and chooses their own password: then it is deleted
and nobody - not even an administrator - can ever see what the employee chose. Every viewing is written to the audit log, only
administrators may look, and the row disappears after `credential_keep_days` (30) even if the employee never signed in.

The key is derived from the server's JWT secret (HKDF, with a purpose of its own), so there is nothing more to configure and a stolen
copy of the database alone shows nothing. If the secret is ever changed, stored first passwords become unreadable (a reset makes a new one).
"""

from __future__ import annotations

import base64
from dataclasses import dataclass
from datetime import datetime, timedelta
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.timeutils import utcnow
from app.models.distribution import EmployeeCredential
from app.models.employee import Employee

KIND_GENERATED, KIND_ADMIN_SET = "generated", "admin_set"


@lru_cache(maxsize=4)
def _fernet_for(secret: str) -> Fernet:
    key = HKDF(algorithm=hashes.SHA256(), length=32, salt=b"employee-calling/credential-vault", info=b"first-password-v1").derive(secret.encode())
    return Fernet(base64.urlsafe_b64encode(key))


def _fernet() -> Fernet:
    return _fernet_for(get_settings().jwt_secret)


@dataclass(frozen=True)
class StoredCredential:
    employee_id: int
    password: str
    kind: str
    created_at: datetime
    created_by: int | None
    view_count: int


def store(db: Session, *, employee_id: int, password: str, kind: str, actor_id: int | None) -> None:
    """Remember the password that was just handed out (replaces an older one). The caller commits."""
    token = _fernet().encrypt(password.encode("utf-8")).decode("ascii")
    row = db.get(EmployeeCredential, employee_id)
    if row is None:
        db.add(EmployeeCredential(employee_id=employee_id, ciphertext=token, kind=kind, created_at=utcnow(), created_by=actor_id, view_count=0))
    else:
        row.ciphertext, row.kind, row.created_at, row.created_by = token, kind, utcnow(), actor_id
        row.last_viewed_at, row.view_count = None, 0


def forget(db: Session, employee_id: int) -> None:
    """The employee chose their own password (or the account was switched off): nothing stays. The caller commits."""
    db.execute(delete(EmployeeCredential).where(EmployeeCredential.employee_id == employee_id))


def _expired(row: EmployeeCredential) -> bool:
    return row.created_at < utcnow() - timedelta(days=get_settings().credential_keep_days)


def read(db: Session, employee_id: int) -> StoredCredential | None:
    """The stored password, or None when there is none (the employee has chosen their own, it expired, or the key changed)."""
    row = db.get(EmployeeCredential, employee_id)
    if row is None or _expired(row):
        return None
    try:
        password = _fernet().decrypt(row.ciphertext.encode("ascii")).decode("utf-8")
    except (InvalidToken, ValueError):
        return None
    return StoredCredential(employee_id, password, row.kind, row.created_at, row.created_by, row.view_count)


def note_viewed(db: Session, employee_id: int) -> None:
    row = db.get(EmployeeCredential, employee_id)
    if row is not None:
        row.last_viewed_at = utcnow()
        row.view_count += 1


def pending_employee_ids(db: Session) -> list[int]:
    """Everybody whose first password can still be looked at."""
    cutoff = utcnow() - timedelta(days=get_settings().credential_keep_days)
    return list(db.scalars(select(EmployeeCredential.employee_id).where(EmployeeCredential.created_at >= cutoff)))


def purge_expired(db: Session) -> int:
    cutoff = utcnow() - timedelta(days=get_settings().credential_keep_days)
    result = db.execute(delete(EmployeeCredential).where(EmployeeCredential.created_at < cutoff))
    db.commit()
    return int(result.rowcount or 0)


def labels(db: Session, employee_ids: list[int]) -> dict[int, Employee]:
    return {e.id: e for e in db.scalars(select(Employee).where(Employee.id.in_(employee_ids)))} if employee_ids else {}
