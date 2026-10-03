"""Clears what is remembered about the calling queues and the numbers built on them, whenever the rows they come from change.

An employee's queue (and the dashboard figures) are remembered in Redis for a few seconds. Rather than every service having to
remember to say "the queue changed", this watches the database writes themselves:

  * changes made through the ORM (a call is created, a contact is handed to an employee, a callback is scheduled ...) are seen after
    each flush;
  * bulk statements (hand 5,000 contacts to somebody, an import, a contact is deleted) are seen as they are executed.

The cache is only cleared once the transaction has committed (see app.core.cache.defer_until_commit).
"""

from __future__ import annotations

from sqlalchemy import event, inspect
from sqlalchemy.orm import Session

from app.core import cache
from app.models.call import Call, Callback
from app.models.contact import Campaign, CampaignAssignee, CampaignContact, Contact, ContactAssignment, ContactPhone
from app.models.employee import Employee, Team
from app.models.system import Setting

EVERYONE = "queue:all"
ROSTER = "admin:roster"  # the people and teams the admin panel lists, and the settings: bumped by every real change of them

# an employee's row also changes at every sign-in and password check; none of that changes what the panel lists
_QUIET_EMPLOYEE_COLUMNS = {"last_login_at", "password_changed_at", "password_hash", "updated_at"}


def employee_epoch(employee_id: int | str) -> str:
    return f"queue:emp:{employee_id}"


# tables whose rows decide who sees which contact, and in what order
_PERSONAL = (Call, Callback, ContactAssignment)  # the row says whose queue it changes
_SHARED = (Contact, ContactPhone, Campaign, CampaignContact, CampaignAssignee)  # it changes many queues
_BULK_TABLES = {m.__tablename__ for m in (*_PERSONAL, *_SHARED)}
_ROSTER_TABLES = {m.__tablename__ for m in (Employee, Team, Setting)}


def _roster_changed(session: Session) -> bool:
    for obj in (*session.new, *session.deleted):
        if isinstance(obj, (Employee, Team, Setting)):
            return True
    for obj in session.dirty:
        if isinstance(obj, (Team, Setting)):
            return True
        if isinstance(obj, Employee) and any(attr.history.has_changes() and attr.key not in _QUIET_EMPLOYEE_COLUMNS for attr in inspect(obj).attrs):
            return True
    return False


_QUEUE_NOTES = "cache.queue"


def _queue_notes(session: Session) -> dict:
    """What this transaction has done to the queues, written down as it goes and acted on once, after the commit."""
    notes = session.info.get(_QUEUE_NOTES)
    if notes is None:
        notes = session.info[_QUEUE_NOTES] = {"people": set(), "contacts": False, "everyone": False}

        def _clear_the_queues() -> None:
            # A contact that changes in the same transaction as a call, a callback or a hand-over of somebody (the outcome of a call
            # changes the contact too) belongs to that person's queue alone. Hundreds of phones record outcomes all day: if each of
            # them cleared every queue, no queue would ever be remembered. A contact edited on its own (an administrator) can be
            # in anybody's queue.
            names = [EVERYONE] if notes["everyone"] or (notes["contacts"] and not notes["people"]) else []
            names += [employee_epoch(p) for p in sorted(notes["people"])]
            cache.bump_now(*names)

        cache.defer_until_commit(session, _clear_the_queues)
    return notes


QUIET = "queue_quiet"  # a session that sets this clears the queues it changes by itself (a bulk job that says exactly whose queue it touched)


@event.listens_for(Session, "after_flush")
def _after_flush(session: Session, _context) -> None:
    notes = None
    for obj in () if session.info.get(QUIET) else (*session.new, *session.dirty, *session.deleted):
        if isinstance(obj, _PERSONAL):
            if obj.employee_id is not None:
                notes = notes or _queue_notes(session)
                notes["people"].add(int(obj.employee_id))
        elif isinstance(obj, Contact):
            notes = notes or _queue_notes(session)
            notes["contacts"] = True
        elif isinstance(obj, _SHARED):
            notes = notes or _queue_notes(session)
            notes["everyone"] = True
    if _roster_changed(session):
        cache.bump(session, ROSTER)


@event.listens_for(Session, "do_orm_execute")
def _bulk_statements(state) -> None:
    if state.is_select:
        return
    table = getattr(state.statement, "table", None)
    name = getattr(table, "name", None)
    if name in _BULK_TABLES and not state.session.info.get(QUIET):
        # a statement that says whose queue it is about (the outcome of a call closes that person's callback) clears that queue only
        person = state.execution_options.get("queue_employee")
        notes = _queue_notes(state.session)
        if person is not None:
            notes["people"].add(int(person))
        else:
            notes["everyone"] = True
    if name in _ROSTER_TABLES:
        cache.bump(state.session, ROSTER)
