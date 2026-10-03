"""A version that is put back after a failed deploy must start on the database a newer version already changed."""

from __future__ import annotations

import logging

import pytest
from alembic.script import ScriptDirectory
from sqlalchemy import text

from app.core.database import get_engine
from scripts import bootstrap
from tests.conftest import _alembic_config


@pytest.fixture()
def stamped():
    """Pretend a newer version applied a revision this one has never heard of; put the real one back afterwards."""
    with get_engine().begin() as conn:
        real = conn.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
        conn.execute(text("UPDATE alembic_version SET version_num = '9999'"))
    yield real
    with get_engine().begin() as conn:
        conn.execute(text("UPDATE alembic_version SET version_num = :real"), {"real": real})


def test_a_database_that_is_newer_than_this_version_is_used_as_it_is(stamped, caplog):
    with caplog.at_level(logging.WARNING, logger="bootstrap"):
        bootstrap.run_migrations()  # (does not raise "Can't locate revision")
    assert "newer than this version knows" in caplog.text
    with get_engine().connect() as conn:
        assert conn.execute(text("SELECT version_num FROM alembic_version")).scalar_one() == "9999"  # and nothing was touched


def test_a_database_that_is_up_to_date_or_behind_is_still_migrated(caplog):
    with caplog.at_level(logging.WARNING, logger="bootstrap"):
        bootstrap.run_migrations()
    assert "newer than this version knows" not in caplog.text
    head = ScriptDirectory.from_config(_alembic_config()).get_current_head()  # (the newest migration of this version, whichever it is)
    with get_engine().connect() as conn:
        assert conn.execute(text("SELECT version_num FROM alembic_version")).scalar_one() == head
