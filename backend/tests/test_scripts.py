"""The command-line helpers an operator runs on the server."""

import re

from app.models.employee import EmployeeSession
from app.models.system import AuditLog
from scripts import reset_password
from tests.conftest import PASSWORD, login


def run_reset(monkeypatch, capsys, *args: str) -> tuple[int, str, str]:
    monkeypatch.setattr("sys.argv", ["reset_password", *args])
    code = reset_password.main()
    out = capsys.readouterr()
    return code, out.out, out.err


def test_reset_password_gives_a_working_temporary_password(client, emp_a, db, monkeypatch, capsys):
    login(client, emp_a.email)  # an existing sign-in that must be ended
    code, out, _ = run_reset(monkeypatch, capsys, emp_a.email)
    assert code == 0
    new_password = re.search(r"\n\n\s+(\S+)\n", out).group(1)
    assert new_password != PASSWORD and len(new_password) >= 12

    # the old password is dead, the new one works and has to be replaced at once
    assert client.post("/api/v1/auth/login", json={"identifier": emp_a.email, "password": PASSWORD}).status_code == 401
    signed_in = login(client, emp_a.email, password=new_password)
    assert signed_in["must_change_password"] is True

    db.expire_all()
    ended = db.query(EmployeeSession).filter(EmployeeSession.employee_id == emp_a.id, EmployeeSession.revoked_reason == "password_reset").count()
    assert ended == 1
    entry = db.query(AuditLog).filter(AuditLog.action == "employee.reset_password", AuditLog.entity_id == str(emp_a.id)).one()
    assert entry.actor_label == "server command line"
    assert new_password not in str(entry.details)  # the secret itself is never logged


def test_reset_password_finds_the_account_by_employee_id_too(client, emp_a, monkeypatch, capsys):
    code, out, _ = run_reset(monkeypatch, capsys, emp_a.employee_code.lower())
    assert code == 0 and emp_a.email in out


def test_reset_password_refuses_unknown_and_deactivated_accounts_unless_asked(client, make, db, monkeypatch, capsys):
    assert run_reset(monkeypatch, capsys, "nobody@example.com")[0] == 1

    gone = make.employee(code="GONE", email="gone@example.com")
    gone.is_active = False
    db.commit()
    code, _, err = run_reset(monkeypatch, capsys, gone.email)
    assert code == 2 and "--activate" in err

    code, out, _ = run_reset(monkeypatch, capsys, gone.email, "--activate")
    assert code == 0
    new_password = re.search(r"\n\n\s+(\S+)\n", out).group(1)
    assert login(client, gone.email, password=new_password)["employee"]["id"] == gone.id
