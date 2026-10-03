"""Every route, asked by every kind of caller.

For each operation the API declares (taken from its OpenAPI document, so a new route is included automatically):
  * nobody signed in           -> 401 for everything except the few routes that are public on purpose
  * an employee                -> 403 exactly on the routes that are for staff or administrators
  * a manager                  -> 403 exactly on the routes that are for administrators
  * an administrator           -> never 401 / 403
  * whoever it is, and whatever nonsense is sent -> never a 5xx (an unhandled error is a bug, and a way to probe the server)

A route that is added without thinking about who may call it makes this test fail until the lists below are updated on purpose.
"""

from __future__ import annotations

import io
import re

import pytest

from tests.conftest import auth_headers

# Routes anybody may call (they carry their own credential or none at all).
PUBLIC = {
    ("POST", "/api/v1/auth/login"),
    ("POST", "/api/v1/auth/refresh"),
}

# Routes an employee may not call (administrators and managers only), and the ones a manager may not call (administrators only).
STAFF_ONLY = {
    ("GET", "/api/v1/analytics/overview"),
    ("GET", "/api/v1/analytics/employees"),
    ("GET", "/api/v1/analytics/employees.csv"),
    ("GET", "/api/v1/analytics/employees/{employee_id}"),
    ("GET", "/api/v1/analytics/followups"),
    ("GET", "/api/v1/analytics/followups/list"),
    ("GET", "/api/v1/analytics/conversations"),
    ("GET", "/api/v1/analytics/conversations/timeline"),
    ("GET", "/api/v1/analytics/live"),
    ("GET", "/api/v1/calls/export.csv"),
    ("GET", "/api/v1/employees"),  # a manager lists their own team (checked below)
    ("GET", "/api/v1/campaigns/{campaign_id}/progress"),
}
ADMIN_ONLY = {
    ("GET", "/api/v1/audit-logs"),
    ("GET", "/api/v1/settings"),
    ("POST", "/api/v1/employees"),
    ("POST", "/api/v1/employees/bulk"),
    ("GET", "/api/v1/employees/{employee_id}"),
    ("PATCH", "/api/v1/employees/{employee_id}"),
    ("POST", "/api/v1/employees/{employee_id}/deactivate"),
    ("POST", "/api/v1/employees/{employee_id}/activate"),
    ("POST", "/api/v1/employees/{employee_id}/reset-password"),
    ("POST", "/api/v1/employees/{employee_id}/revoke-sessions"),
    ("GET", "/api/v1/employees/{employee_id}/devices"),
    ("DELETE", "/api/v1/employees/{employee_id}/devices/{device_id}"),
    ("GET", "/api/v1/employees/{employee_id}/sessions"),
    ("GET", "/api/v1/employees/{employee_id}/credentials"),
    ("GET", "/api/v1/employees/credentials.xlsx"),
    ("GET", "/api/v1/distribution/overview"),
    ("POST", "/api/v1/distribution/rebalance/preview"),
    ("POST", "/api/v1/distribution/rebalance"),
    ("GET", "/api/v1/distribution/runs"),
    ("GET", "/api/v1/distribution/runs/{run_id}"),
    ("POST", "/api/v1/teams"),
    ("PATCH", "/api/v1/teams/{team_id}"),
    ("DELETE", "/api/v1/teams/{team_id}"),
    ("POST", "/api/v1/contacts/import"),
    ("GET", "/api/v1/contacts/import"),
    ("GET", "/api/v1/contacts/import/{import_id}"),
    ("GET", "/api/v1/contacts/import/{import_id}/rows"),
    ("GET", "/api/v1/contacts/import/{import_id}/issues.csv"),
    ("GET", "/api/v1/contacts/import/{import_id}/plan"),
    ("POST", "/api/v1/contacts/import/{import_id}/confirm"),
    ("POST", "/api/v1/contacts/import/{import_id}/retry"),
    ("POST", "/api/v1/contacts/import/{import_id}/cancel"),
    ("POST", "/api/v1/contacts"),
    ("POST", "/api/v1/contacts/assign"),
    ("POST", "/api/v1/contacts/unassign"),
    ("PATCH", "/api/v1/contacts/{contact_id}"),
    ("DELETE", "/api/v1/contacts/{contact_id}"),
    ("POST", "/api/v1/campaigns"),
    ("PATCH", "/api/v1/campaigns/{campaign_id}"),
    ("POST", "/api/v1/campaigns/{campaign_id}/contacts"),
    ("DELETE", "/api/v1/campaigns/{campaign_id}/contacts/{contact_id}"),
    ("GET", "/api/v1/campaigns/{campaign_id}/assignees"),
    ("POST", "/api/v1/campaigns/{campaign_id}/assignees"),
    ("POST", "/api/v1/campaigns/{campaign_id}/distribute"),
    ("GET", "/api/v1/recordings/{recording_id}/access-log"),
    ("DELETE", "/api/v1/recordings/{recording_id}"),
    ("PUT", "/api/v1/settings/{key}"),
}
# the OpenAPI document of the API is the list of what exists
STAFF_ONLY_FOR_EMPLOYEE = STAFF_ONLY | ADMIN_ONLY
STAFF_ONLY_FOR_MANAGER = ADMIN_ONLY


def operations(client):
    schema = client.app.openapi()
    for path, item in schema["paths"].items():
        for method, op in item.items():
            if method.upper() in ("GET", "POST", "PUT", "PATCH", "DELETE"):
                yield method.upper(), path, op


# asking this route as the caller ends the caller's own session, which would spoil every request after it
SESSION_ENDING = {("POST", "/api/v1/auth/logout")}


def url_for(path: str, victim_id: int = 1) -> str:
    """Every {id} becomes 1, except the employee: that is somebody else, so that "reset his password" cannot hit the caller."""
    path = path.replace("{employee_id}", str(victim_id))
    return re.sub(r"\{[^}]+\}", "1", path)


def send(client, method: str, path: str, op: dict, headers: dict | None, victim_id: int = 1):
    kwargs: dict = {"headers": headers or {}}
    content = (op.get("requestBody") or {}).get("content", {})
    if "multipart/form-data" in content:
        kwargs["files"] = {"file": ("probe.csv", io.BytesIO(b"name,phone\nA,9876543210\n"), "text/csv")}
    elif content:
        kwargs["json"] = {}
    return client.request(method, url_for(path, victim_id), **kwargs)


def probe(client, headers, victim_id: int = 1):
    """{(method, path): status} for every operation, asked with these headers."""
    return {(m, p): send(client, m, p, op, headers, victim_id).status_code for m, p, op in operations(client) if (m, p) not in SESSION_ENDING}


@pytest.fixture()
def callers(client, make):
    admin = make.employee(role="admin", code="MTXA", email="mtx-admin@example.com")
    manager = make.employee(role="manager", code="MTXM", email="mtx-manager@example.com", team=make.team("Matrix team"))
    employee = make.employee(code="MTXE", email="mtx-employee@example.com")
    victim = make.employee(code="MTXV", email="mtx-victim@example.com")
    result = {name: auth_headers(client, who) for name, who in (("admin", admin), ("manager", manager), ("employee", employee))}
    result["victim_id"] = victim.id  # type: ignore[assignment]
    return result


def test_the_lists_in_this_file_name_routes_that_exist(client):
    existing = {(m, p) for m, p, _ in operations(client)}
    assert (PUBLIC | STAFF_ONLY | ADMIN_ONLY) <= existing, sorted((PUBLIC | STAFF_ONLY | ADMIN_ONLY) - existing)


def test_nobody_signed_in_gets_nothing(client):
    refused = {k: v for k, v in probe(client, None).items() if k not in PUBLIC}
    assert {v for v in refused.values()} == {401}, {k: v for k, v in refused.items() if v != 401}
    # the routes that are public still answer without being asked who the caller is
    for method, path, op in operations(client):
        if (method, path) in PUBLIC:
            assert send(client, method, path, op, None).status_code != 401 or path.endswith("login") or path.endswith("refresh")


def test_an_employee_is_refused_exactly_where_staff_only_routes_are(client, callers):
    statuses = probe(client, callers["employee"], callers["victim_id"])
    forbidden = {k for k, v in statuses.items() if v == 403}
    assert forbidden == STAFF_ONLY_FOR_EMPLOYEE, {"unexpectedly forbidden": sorted(forbidden - STAFF_ONLY_FOR_EMPLOYEE), "unexpectedly open": sorted(STAFF_ONLY_FOR_EMPLOYEE - forbidden)}
    assert 401 not in {statuses[k] for k in statuses if k not in PUBLIC}


def test_a_manager_is_refused_exactly_where_administrator_only_routes_are(client, callers):
    statuses = probe(client, callers["manager"], callers["victim_id"])
    forbidden = {k for k, v in statuses.items() if v == 403}
    assert forbidden == STAFF_ONLY_FOR_MANAGER, {"unexpectedly forbidden": sorted(forbidden - STAFF_ONLY_FOR_MANAGER), "unexpectedly open": sorted(STAFF_ONLY_FOR_MANAGER - forbidden)}


def test_an_administrator_is_never_refused(client, callers):
    statuses = probe(client, callers["admin"], callers["victim_id"])
    assert {k: v for k, v in statuses.items() if v in (401, 403)} == {}


@pytest.mark.parametrize("who", ["admin", "manager", "employee"])
def test_nonsense_never_causes_a_server_error(client, callers, who):
    statuses = probe(client, callers[who], callers["victim_id"])
    assert {k: v for k, v in statuses.items() if v >= 500} == {}


def test_a_token_that_claims_to_be_an_administrator_is_not_believed(client, callers, make):
    """Who somebody is comes from the database, never from what the token says about itself."""
    import jwt

    from app.core.config import get_settings
    from app.core.security import JWT_ISSUER
    from tests.conftest import login

    employee = make.employee(code="CLAIM", email="claim@example.com")
    real = login(client, employee.email)["access_token"]
    claims = jwt.decode(real, get_settings().jwt_secret, algorithms=["HS256"], issuer=JWT_ISSUER)
    claims["role"] = "admin"
    forged_role = jwt.encode(claims, get_settings().jwt_secret, algorithm="HS256")  # signed with the real key, but lying
    assert client.get("/api/v1/employees", headers={"Authorization": f"Bearer {forged_role}"}).status_code == 403


@pytest.mark.parametrize("make_token", ["none_algorithm", "wrong_key", "expired", "no_session", "other_issuer"])
def test_tokens_that_are_not_ours_are_refused(client, make, make_token):
    import time

    import jwt

    from app.core.config import get_settings
    from app.core.security import JWT_ISSUER
    from tests.conftest import login

    employee = make.employee(code="TOK1", email="tok1@example.com")
    real = login(client, employee.email)["access_token"]
    good = jwt.decode(real, get_settings().jwt_secret, algorithms=["HS256"], issuer=JWT_ISSUER)
    key = get_settings().jwt_secret
    if make_token == "none_algorithm":
        token = jwt.encode(good, None, algorithm="none")
    elif make_token == "wrong_key":
        token = jwt.encode(good, "some-other-secret-0123456789-0123456789-xx", algorithm="HS256")
    elif make_token == "expired":
        token = jwt.encode({**good, "exp": int(time.time()) - 10}, key, algorithm="HS256")
    elif make_token == "no_session":
        token = jwt.encode({**good, "sid": "00000000-0000-0000-0000-000000000000"}, key, algorithm="HS256")
    else:
        token = jwt.encode({**good, "iss": "somebody-else"}, key, algorithm="HS256")
    answer = client.get("/api/v1/me", headers={"Authorization": f"Bearer {token}"})
    assert answer.status_code == 401, (make_token, answer.text)


def test_the_answers_never_carry_a_password_hash(client, callers, make):
    texts = [
        client.get("/api/v1/me", headers=callers["employee"]).text,
        client.get("/api/v1/employees", headers=callers["admin"]).text,
        client.get("/api/v1/analytics/employees", headers=callers["admin"]).text,
    ]
    assert not any("password" in t.lower() and "hash" in t.lower() for t in texts)
    assert not any("$2b$" in t or "$2a$" in t for t in texts)  # bcrypt hashes


def test_a_manager_lists_only_their_own_team(client, make):
    mine, other = make.team("Mine"), make.team("Other")
    boss = make.employee(role="manager", code="LSTM", email="lstm@example.com", team=mine)
    worker = make.employee(code="LSTW", email="lstw@example.com", team=mine)
    make.employee(code="LSTX", email="lstx@example.com", team=other)
    items = client.get("/api/v1/employees", headers=auth_headers(client, boss)).json()["items"]
    assert {i["id"] for i in items} == {boss.id, worker.id}
