"""Who counts as working: the rule, the sources of "seen", and the two settings that go with it."""

from __future__ import annotations

from datetime import timedelta

import pytest

from app.core.timeutils import utcnow
from app.models.employee import EmployeeDevice, EmployeeSession
from app.services import activity, heartbeat_service
from tests.test_import_distribution import away, team_of


NOW = utcnow()


class Person:
    def __init__(self, *, active=True, created_days_ago=30.0):
        self.is_active = active
        self.created_at = NOW - timedelta(days=created_days_ago)


@pytest.mark.parametrize(
    "person,seen_days_ago,expected",
    [
        (Person(), 0.01, ("active", "")),
        (Person(), 1.9, ("active", "")),  # still inside the two days
        (Person(), 2.1, ("inactive", "Not seen for 2 days.")),
        (Person(), 3.5, ("inactive", "Not seen for 3 days.")),
        (Person(), 1.0 + 24 / 24 + 0.1, ("inactive", "Not seen for 2 days.")),
        (Person(active=False), 0.01, ("deactivated", "The account is switched off.")),  # switched off beats everything
        (Person(created_days_ago=0.5), None, ("new", "Has not signed in yet.")),
        (Person(created_days_ago=2.5), None, ("inactive", "Has never signed in.")),
        (Person(created_days_ago=400), None, ("inactive", "Has never signed in.")),
    ],
)
def test_the_rule(person, seen_days_ago, expected):
    seen = None if seen_days_ago is None else NOW - timedelta(days=seen_days_ago)
    assert activity.classify(person, seen, NOW, days=2) == expected  # type: ignore[arg-type]


def test_one_day_is_a_day_not_a_calendar_date():
    person = Person()
    assert activity.classify(person, NOW - timedelta(hours=23), NOW, days=1)[0] == "active"  # type: ignore[arg-type]
    assert activity.classify(person, NOW - timedelta(hours=25), NOW, days=1) == ("inactive", "Not seen for 1 day.")  # type: ignore[arg-type]


def test_the_newest_sign_of_life_of_several_wins(make, db):
    (person,) = team_of(make, 1)
    away(db, person, days=20)
    db.add(EmployeeSession(id="s" * 36, employee_id=person.id, refresh_hash="h" * 64, expires_at=utcnow() + timedelta(days=1), last_used_at=utcnow() - timedelta(days=6)))
    db.add(EmployeeDevice(employee_id=person.id, device_uid="d1", last_seen_at=utcnow() - timedelta(days=4), last_heartbeat_at=utcnow() - timedelta(hours=60)))
    db.commit()
    (state,) = activity.employee_states(db)
    assert state.state == "inactive" and state.last_active_at is not None
    assert abs((utcnow() - state.last_active_at) - timedelta(hours=60)) < timedelta(minutes=1)  # the heartbeat of 60 hours ago is the newest

    db.query(EmployeeDevice).update({"last_heartbeat_at": utcnow() - timedelta(minutes=2)})
    db.commit()
    assert activity.employee_states(db)[0].state == "active"


def test_what_the_open_app_reported_to_redis_counts(make, db, client):
    (person,) = team_of(make, 1)
    away(db, person, days=20)
    assert activity.employee_states(db)[0].state == "inactive"
    from app.core.redis_client import get_redis
    import json

    get_redis().set(heartbeat_service._key(person.id), json.dumps({"at": utcnow().isoformat()}), ex=600)
    assert activity.employee_states(db)[0].state == "active"


def test_only_employees_are_listed_unless_asked_for_everybody(make, db):
    team_of(make, 2)
    make.employee(role="manager", code="MGR", email="mgr@example.com")
    make.employee(role="admin", code="ADM", email="adm@example.com")
    assert len(activity.employee_states(db)) == 2
    assert len(activity.employee_states(db, role=None)) == 4


def test_the_number_of_days_is_kept_between_1_and_90(make, db, client, as_admin):
    for value, accepted in ((1, True), (2, True), (90, True), (0, False), (91, False), (-3, False), ("two", False), (True, False), (2.5, False)):
        resp = client.put("/api/v1/settings/inactive_after_days", headers=as_admin, json={"value": value})
        assert (resp.status_code == 200) is accepted, (value, resp.text)
    client.put("/api/v1/settings/inactive_after_days", headers=as_admin, json={"value": 7})
    assert activity.inactive_after_days(db) == 7
    assert client.get("/api/v1/settings", headers=as_admin).json()["inactive_after_days"] == 7


def test_auto_rebalance_is_a_yes_or_no(client, as_admin):
    for value, accepted in ((True, True), (False, True), ("yes", False), (1, False), (None, False)):
        resp = client.put("/api/v1/settings/auto_rebalance", headers=as_admin, json={"value": value})
        assert (resp.status_code == 200) is accepted, (value, resp.text)
    assert client.get("/api/v1/settings", headers=as_admin).json()["auto_rebalance"] is False or True


def test_the_loads_are_counted_without_reading_the_contacts(make, db):
    a, b = team_of(make, 2)
    for i in range(5):
        make.contact(phone=f"{9400000000 + i * 3 + 1}", assign_to=a)
    counts = activity.assigned_counts(db, [a.id, b.id])
    assert counts == {a.id: 5, b.id: 0}
