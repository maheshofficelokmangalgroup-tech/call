"""Clears what is remembered about the calling queues and the numbers built on them, whenever the rows they come from change.

An employee's queue (and the dashboard figures) are remembered in Redis for a few seconds. Rather than every service having to
remember to say "the queue changed", this watches the database writes themselves:

  * changes made through the ORM (a call is created, a contact is handed to an employee, a callback is scheduled ...) are seen after
    each flush;
  * bulk statements (hand 5,000 contacts to somebody, an import, a contact is deleted) are seen as they are executed.

The cache is only cleared once the transaction has committed (see app.core.cache.defer_until_commit).
"""

from __future__ import annotations

from sqlalchemy import event
from sqlalchemy.orm import Session

from app.core import cache
from app.models.call import Call, Callback
from app.models.contact import Campaign, CampaignAssignee, CampaignContact, Contact, ContactAssignment

EVERYONE = "queue:all"


def employee_epoch(employee_id: int | str) -> str:
    return f"queue:emp:{employee_id}"


# tables whose rows decide who sees which contact, and in what order
_PERSONAL = (Call, Callback, ContactAssignment)  # the row says whose queue it changes
_SHARED = (Contact, Campaign, CampaignContact, CampaignAssignee)  # it changes many queues
_BULK_TABLES = {m.__tablename__ for m in (*_PERSONAL, *_SHARED)}


@event.listens_for(Session, "after_flush")
def _after_flush(session: Session, _context) -> None:
    people: set[int] = set()
    everyone = False
    for obj in (*session.new, *session.dirty, *session.deleted):
        if isinstance(obj, _PERSONAL):
            if obj.employee_id is not None:
                people.add(int(obj.employee_id))
        elif isinstance(obj, _SHARED):
            everyone = True
    if everyone:
        cache.bump(session, EVERYONE)
    if people:
        cache.bump(session, *(employee_epoch(p) for p in people))


@event.listens_for(Session, "do_orm_execute")
def _bulk_statements(state) -> None:
    if state.is_select:
        return
    table = getattr(state.statement, "table", None)
    if table is not None and getattr(table, "name", None) in _BULK_TABLES:
        cache.bump(state.session, EVERYONE)
