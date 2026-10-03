"""scripts/selftest_sharing.py: the clean-up puts everything back for every worker (not only in the database) and touches nothing of anybody else."""

from __future__ import annotations

from app.models.contact import Contact, ContactAssignment
from app.models.employee import Employee
from app.models.system import Setting
from app.services.settings_service import get_setting, set_setting
from scripts import selftest_sharing

RUN = "abc123"


def switched_off_by_the_test(db) -> None:
    """What the self-test does at the start (through the API): the automatic sharing is switched off, and a worker reads it."""
    set_setting(db, "auto_rebalance", True)
    db.commit()
    assert get_setting(db, "auto_rebalance") is True
    set_setting(db, "auto_rebalance", False)
    db.commit()
    assert get_setting(db, "auto_rebalance") is False  # now remembered, as it is on a real server
    db.rollback()


def clean(db, *, admin_email: str, employee_ids: list[int], previous) -> None:
    selftest_sharing._clean(db, selftest_sharing.Report(), RUN, admin_email, employee_ids, [], previous)
    db.rollback()


def test_the_setting_is_back_for_every_worker_not_only_in_the_database(db):
    switched_off_by_the_test(db)
    clean(db, admin_email=f"zz-selftest-{RUN}@example.com", employee_ids=[], previous=True)
    assert db.get(Setting, "auto_rebalance").value is True  # the database
    assert get_setting(db, "auto_rebalance") is True  # what a worker reads: before the fix it stayed False until the remembered copy expired


def test_a_setting_that_did_not_exist_before_is_removed_and_the_default_applies_again(db):
    switched_off_by_the_test(db)
    clean(db, admin_email=f"zz-selftest-{RUN}@example.com", employee_ids=[], previous=None)
    assert db.get(Setting, "auto_rebalance") is None
    assert get_setting(db, "auto_rebalance") is True  # the default of the product


def test_it_removes_what_it_made_and_nothing_that_belongs_to_somebody_else(db, make):
    real = make.employee(code="REAL1", email="real@example.com", name="A real employee")
    real_contact = make.contact(name="A real customer", assign_to=real)
    admin = make.employee(role="admin", code="ZZADMIN", email=f"zz-selftest-{RUN}@example.com", name="ZZSELFTEST administrator")
    mine = make.employee(code="ZZ1", email=f"zz-selftest-{RUN}-01@example.com", name=f"ZZSELFTEST {RUN} 01")
    made = make.contact(name="ZZSELFTEST a1", assign_to=mine)
    unowned = make.contact(name="ZZSELFTEST a2")
    ids = {"real": real.id, "real_contact": real_contact.id, "admin": admin.id, "mine": mine.id, "made": made.id, "unowned": unowned.id}
    admin_email = admin.email
    switched_off_by_the_test(db)

    clean(db, admin_email=admin_email, employee_ids=[ids["mine"]], previous=True)

    assert db.get(Employee, ids["mine"]) is None and db.get(Employee, ids["admin"]) is None
    assert db.get(Contact, ids["made"]) is None and db.get(Contact, ids["unowned"]) is None
    assert db.query(ContactAssignment).filter(ContactAssignment.contact_id == ids["made"]).count() == 0
    assert db.get(Employee, ids["real"]) is not None and db.get(Contact, ids["real_contact"]) is not None  # nothing of anybody else
    assert db.query(ContactAssignment).filter(ContactAssignment.employee_id == ids["real"]).count() == 1
    assert get_setting(db, "auto_rebalance") is True
