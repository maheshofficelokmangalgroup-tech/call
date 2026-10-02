"""Import every model so Base.metadata (and Alembic autogenerate) sees all tables."""

from app.models.base import Base
from app.models.call import Call, CallDisposition, CallEvent, CallNote, Callback
from app.models.contact import Campaign, CampaignAssignee, CampaignContact, Contact, ContactAssignment
from app.models.employee import Employee, EmployeeDevice, EmployeeSession, Role, Team
from app.models.imports import Import, ImportRow
from app.models.recording import Recording, RecordingAccessLog
from app.models.system import AuditLog, Notification, Setting
from app.models import cache_events  # noqa: F401  (registers the hooks that clear the queue caches when rows change)

__all__ = [
    "AuditLog",
    "Base",
    "Call",
    "CallDisposition",
    "CallEvent",
    "CallNote",
    "Callback",
    "Campaign",
    "CampaignAssignee",
    "CampaignContact",
    "Contact",
    "ContactAssignment",
    "Employee",
    "EmployeeDevice",
    "EmployeeSession",
    "Import",
    "ImportRow",
    "Notification",
    "Recording",
    "RecordingAccessLog",
    "Role",
    "Setting",
    "Team",
]
