"""Taking the contacts of an import away again - for a sheet that was added the wrong way.

Only the contacts nobody has done anything with are removed: no call was made to them, no note was written, no callback was promised, and
they are still "new". Whatever an employee has started on stays, with the import it came from. The numbers of the removed contacts are free
again, so the corrected sheet can be added the ordinary way.

Done in steps of 2,000 contacts, every step one transaction; doing it twice is harmless (what is gone is not found again).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from sqlalchemy import delete, exists, func, or_, select
from sqlalchemy.orm import Session

from app.core import cache
from app.core.errors import Conflict, NotFound
from app.core.timeutils import utcnow
from app.models.cache_events import EVERYONE, QUIET, employee_epoch
from app.models.call import Call, Callback, CallNote
from app.models.contact import CampaignContact, Contact, ContactAssignment, ContactPhone
from app.models.imports import IMPORT_APPLYING, IMPORT_VALIDATING, Import
from app.services import audit_service

log = logging.getLogger(__name__)

STEP = 2000


@dataclass
class UndoCount:
    contacts: int  # of the import, still there
    untouched: int  # nobody has done anything with them: these can be removed
    touched: int  # somebody has started on them: they stay
    owners: dict[int, int]  # who has how many of the untouched ones


def _touched():
    """A contact somebody has started on."""
    return or_(
        Contact.status != "new",
        Contact.call_count > 0,
        exists().where(Call.contact_id == Contact.id),
        exists().where(CallNote.contact_id == Contact.id),
        exists().where(Callback.contact_id == Contact.id),
    )


def count(db: Session, import_id: int) -> UndoCount:
    if db.get(Import, import_id) is None:
        raise NotFound("Import not found.")
    total = db.scalar(select(func.count(Contact.id)).where(Contact.import_id == import_id)) or 0
    touched = db.scalar(select(func.count(Contact.id)).where(Contact.import_id == import_id, _touched())) or 0
    owners = dict(
        db.execute(
            select(ContactAssignment.employee_id, func.count(ContactAssignment.id))
            .join(Contact, Contact.id == ContactAssignment.contact_id)
            .where(Contact.import_id == import_id, ContactAssignment.status == "active", ~_touched())
            .group_by(ContactAssignment.employee_id)
        ).all()
    )
    return UndoCount(contacts=total, untouched=total - touched, touched=touched, owners={int(k): int(v) for k, v in owners.items()})


def remove_untouched(db: Session, import_id: int, *, actor_label: str = "system") -> dict[str, int]:
    """Remove the untouched contacts of the import. Returns {"removed": n, "kept": n}."""
    imp = db.get(Import, import_id)
    if imp is None:
        raise NotFound("Import not found.")
    if imp.status in (IMPORT_APPLYING, IMPORT_VALIDATING):
        raise Conflict("This import is still running. Wait until it is finished (or stop it first).", code="import_running")
    before = count(db, import_id)
    removed = 0
    affected: set[int] = set(before.owners)
    while True:
        ids = list(db.scalars(select(Contact.id).where(Contact.import_id == import_id, ~_touched()).order_by(Contact.id).limit(STEP)))
        if not ids:
            break
        db.info[QUIET] = True  # (the queues are cleared once, at the end)
        affected.update(db.scalars(select(ContactAssignment.employee_id).where(ContactAssignment.contact_id.in_(ids)).distinct()))
        db.execute(delete(ContactAssignment).where(ContactAssignment.contact_id.in_(ids)))
        db.execute(delete(CampaignContact).where(CampaignContact.contact_id.in_(ids)))
        db.execute(delete(ContactPhone).where(ContactPhone.contact_id.in_(ids)))
        db.execute(delete(Contact).where(Contact.id.in_(ids)))
        db.commit()
        removed += len(ids)
    kept = db.scalar(select(func.count(Contact.id)).where(Contact.import_id == import_id)) or 0
    imp = db.get(Import, import_id)
    assert imp is not None
    imp.result = {**(imp.result or {}), "removed_contacts": int((imp.result or {}).get("removed_contacts", 0)) + removed, "removed_at": utcnow().isoformat()}
    audit_service.record(
        db, action="import.contacts_removed", actor=None, actor_label=actor_label, entity_type="import", entity_id=import_id,
        details={"removed": removed, "kept": kept, "filename": imp.filename},
    )
    cache.bump(db, EVERYONE)
    db.commit()
    cache.bump_now(*[employee_epoch(e) for e in affected])
    log.info("Import %s: %s untouched contacts removed, %s stay", import_id, removed, kept)
    return {"removed": removed, "kept": kept}
