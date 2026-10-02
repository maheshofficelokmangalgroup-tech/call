"""Shared fixtures.

The suite runs on SQLite by default. To run the very same tests against MySQL 8:
    TEST_DATABASE_URL="mysql+pymysql://user:pw@127.0.0.1:3306/calling_test?charset=utf8mb4" pytest
(the database must exist and be empty; tables are created by Alembic migrations).
"""

from __future__ import annotations

import os
import shutil
import tempfile
from collections.abc import Iterator
from datetime import datetime, timedelta, timezone

_TMP = tempfile.mkdtemp(prefix="calling-tests-")
os.environ.update(
    {
        "APP_ENV": "test",
        "DATABASE_URL": os.environ.get("TEST_DATABASE_URL", f"sqlite:///{_TMP}/test.db"),
        "REDIS_URL": "",
        "JWT_SECRET": "test-secret-0123456789-0123456789-0123456789",
        "BCRYPT_ROUNDS": "4",
        "LOCAL_STORAGE_PATH": f"{_TMP}/storage",
        "IMPORT_STORAGE_PATH": f"{_TMP}/imports",
        "LOG_LEVEL": "WARNING",
        "LOG_JSON": "false",
        "APP_TIMEZONE": "Asia/Kolkata",
        "JOBS_INLINE": "true",  # an import / a rebalancing is done right where it is asked for: a test can look at the result at once
        "BACKGROUND_JOBS": "false",  # (the scheduler is only started by the tests that are about it)
        "IMPORT_CHUNK_PAUSE_MS": "0",
    }
)

import pytest  # noqa: E402
from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.core.config import get_settings, reset_settings_cache  # noqa: E402
from app.core.database import get_engine, new_session  # noqa: E402
from app.core.redis_client import get_redis  # noqa: E402
from app.core.security import hash_password  # noqa: E402
from app.models import Base  # noqa: E402
from app.models.employee import Employee, Role, Team  # noqa: E402
from app.services.reference_data import ensure_reference_data  # noqa: E402
from app.services.phone import normalize_phone  # noqa: E402

PASSWORD = "Passw0rd-Test"


def _alembic_config() -> Config:
    cfg = Config(os.path.join(os.path.dirname(__file__), "..", "alembic.ini"))
    cfg.set_main_option("script_location", os.path.join(os.path.dirname(__file__), "..", "migrations"))
    return cfg


@pytest.fixture(scope="session", autouse=True)
def _schema() -> Iterator[None]:
    reset_settings_cache()
    assert get_settings().app_env == "test"
    command.upgrade(_alembic_config(), "head")
    yield
    get_engine().dispose()
    shutil.rmtree(_TMP, ignore_errors=True)


@pytest.fixture(autouse=True)
def _clean_state() -> Iterator[None]:
    """Empty every table (keeping the schema) and reseed reference data before each test."""
    engine = get_engine()
    with engine.begin() as conn:
        if engine.dialect.name == "mysql":
            conn.execute(text("SET FOREIGN_KEY_CHECKS=0"))
        for table in reversed(Base.metadata.sorted_tables):
            conn.execute(table.delete())
        if engine.dialect.name == "mysql":
            conn.execute(text("SET FOREIGN_KEY_CHECKS=1"))
    get_redis().flushall() if hasattr(get_redis(), "flushall") else None  # type: ignore[union-attr]
    db = new_session()
    try:
        ensure_reference_data(db)
    finally:
        db.close()
    yield


@pytest.fixture()
def db() -> Iterator:
    session = new_session()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture()
def client() -> Iterator[TestClient]:
    from app.main import app

    with TestClient(app) as c:
        yield c


# ----------------------------------------------------------------- factories
class Factory:
    def __init__(self, db) -> None:
        self.db = db
        self._n = 0

    def _next(self) -> int:
        self._n += 1
        return self._n

    def team(self, name: str | None = None) -> Team:
        team = Team(name=name or f"Team {self._next()}")
        self.db.add(team)
        self.db.commit()
        return team

    def employee(
        self,
        *,
        role: str = "employee",
        code: str | None = None,
        email: str | None = None,
        name: str | None = None,
        team: Team | None = None,
        active: bool = True,
        password: str = PASSWORD,
        must_change: bool = False,
        target: int = 50,
    ) -> Employee:
        n = self._next()
        role_row = self.db.query(Role).filter(Role.name == role).one()
        emp = Employee(
            employee_code=(code or f"E{n:03d}").upper(),
            email=(email or f"user{n}@example.com").lower(),
            full_name=name or f"Test User {n}",
            password_hash=hash_password(password),
            role_id=role_row.id,
            team_id=team.id if team else None,
            is_active=active,
            daily_target=target,
            must_change_password=must_change,
        )
        self.db.add(emp)
        self.db.commit()
        self.db.refresh(emp)
        return emp

    def contact(self, *, phone: str | None = None, name: str | None = None, assign_to: Employee | None = None, campaign=None, **fields):
        from app.models.contact import CampaignContact, Contact, ContactAssignment
        from app.services.contact_service import build_search_text

        n = self._next()
        raw = phone or f"9{800000000 + n * 37:09d}"[:10]
        normalized = normalize_phone(raw)
        assert normalized, f"test phone {raw} is not valid"
        name = name or f"Contact {n}"
        contact = Contact(
            name=name,
            phone_raw=raw,
            normalized_phone=normalized,
            priority=fields.pop("priority", 2),
            tags=fields.pop("tags", []),
            custom_fields=fields.pop("custom_fields", {}),
            search_text=build_search_text(
                name=name, phone_raw=raw, normalized_phone=normalized, email=None, location=None, category=None, tags=[], custom_fields={}
            ),
            **fields,
        )
        self.db.add(contact)
        self.db.flush()
        if campaign is not None:
            self.db.add(CampaignContact(campaign_id=campaign.id, contact_id=contact.id))
        if assign_to is not None:
            self.db.add(
                ContactAssignment(
                    contact_id=contact.id,
                    employee_id=assign_to.id,
                    campaign_id=campaign.id if campaign is not None else None,
                    status="active",
                    active_contact_id=contact.id,
                )
            )
        self.db.commit()
        self.db.refresh(contact)
        return contact

    def campaign(self, name: str | None = None, status: str = "active", **fields):
        from app.models.contact import Campaign

        camp = Campaign(name=name or f"Campaign {self._next()}", status=status, **fields)
        self.db.add(camp)
        self.db.commit()
        return camp


@pytest.fixture()
def make(db) -> Factory:
    return Factory(db)


@pytest.fixture()
def admin(make) -> Employee:
    return make.employee(role="admin", code="ADMIN", email="admin@example.com", name="Admin User")


@pytest.fixture()
def emp_a(make) -> Employee:
    return make.employee(code="EMPA", email="a@example.com", name="Employee A")


@pytest.fixture()
def emp_b(make) -> Employee:
    return make.employee(code="EMPB", email="b@example.com", name="Employee B")


DEVICE = {"device_uid": "test-device-0001", "name": "Test Phone", "os_version": "14", "app_version": "1.0.0"}


def login(client: TestClient, identifier: str, password: str = PASSWORD, device: dict | None = DEVICE) -> dict:
    body = {"identifier": identifier, "password": password}
    if device is not None:
        body["device"] = device
    resp = client.post("/api/v1/auth/login", json=body)
    assert resp.status_code == 200, resp.text
    return resp.json()


def auth_headers(client: TestClient, user: Employee, **kwargs) -> dict[str, str]:
    data = login(client, user.email, **kwargs)
    return {"Authorization": f"Bearer {data['access_token']}"}


@pytest.fixture()
def as_admin(client, admin):
    return auth_headers(client, admin)


@pytest.fixture()
def as_a(client, emp_a):
    return auth_headers(client, emp_a)


@pytest.fixture()
def as_b(client, emp_b):
    return auth_headers(client, emp_b)


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat()


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def minutes(n: float) -> timedelta:
    return timedelta(minutes=n)
