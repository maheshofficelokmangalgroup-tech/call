"""Acceptance: Employee A cannot access Employee B's assigned contacts (IDOR), RBAC on admin endpoints."""

from tests.conftest import auth_headers


def test_employee_sees_only_assigned_contacts(client, make, emp_a, emp_b, as_a):
    mine = make.contact(name="Mine", assign_to=emp_a)
    theirs = make.contact(name="Theirs", assign_to=emp_b)
    make.contact(name="Nobody")

    listing = client.get("/api/v1/contacts", headers=as_a).json()
    assert [c["id"] for c in listing["items"]] == [mine.id]
    assert listing["total"] == 1

    assert client.get(f"/api/v1/contacts/{mine.id}", headers=as_a).status_code == 200
    # another employee's contact must be indistinguishable from a non-existent one
    foreign = client.get(f"/api/v1/contacts/{theirs.id}", headers=as_a)
    missing = client.get("/api/v1/contacts/999999", headers=as_a)
    assert foreign.status_code == missing.status_code == 404
    assert foreign.json()["error"]["message"] == missing.json()["error"]["message"]


def test_employee_cannot_reach_foreign_contact_through_any_subresource(client, make, emp_a, emp_b, as_a):
    theirs = make.contact(assign_to=emp_b)
    for path in (f"/api/v1/contacts/{theirs.id}/notes", f"/api/v1/contacts/{theirs.id}/calls"):
        assert client.get(path, headers=as_a).status_code == 404
    assert client.post(f"/api/v1/contacts/{theirs.id}/notes", headers=as_a, json={"body": "hi"}).status_code == 404
    assert client.patch(f"/api/v1/contacts/{theirs.id}", headers=as_a, json={"name": "hacked"}).status_code == 403


def test_employee_cannot_use_admin_endpoints(client, as_a, make, emp_a):
    c = make.contact(assign_to=emp_a)
    assert client.get("/api/v1/employees", headers=as_a).status_code == 403
    assert client.post("/api/v1/employees", headers=as_a, json={"email": "x@y.co", "full_name": "X Y"}).status_code == 403
    assert client.post("/api/v1/contacts", headers=as_a, json={"name": "N", "phone": "9876543210"}).status_code == 403
    assert client.delete(f"/api/v1/contacts/{c.id}", headers=as_a).status_code == 403
    assert client.post("/api/v1/contacts/assign", headers=as_a, json={"contact_ids": [c.id], "employee_ids": [emp_a.id]}).status_code == 403
    assert client.get("/api/v1/audit-logs", headers=as_a).status_code == 403
    assert client.post("/api/v1/teams", headers=as_a, json={"name": "T"}).status_code == 403
    assert client.get("/api/v1/contacts/import", headers=as_a).status_code == 403


def test_admin_sees_everything_and_can_filter_by_owner(client, make, emp_a, emp_b, as_admin):
    a = make.contact(assign_to=emp_a)
    b = make.contact(assign_to=emp_b)
    free = make.contact()
    allc = client.get("/api/v1/contacts", headers=as_admin).json()
    assert {c["id"] for c in allc["items"]} == {a.id, b.id, free.id}
    only_a = client.get(f"/api/v1/contacts?employee_id={emp_a.id}", headers=as_admin).json()
    assert [c["id"] for c in only_a["items"]] == [a.id]
    unassigned = client.get("/api/v1/contacts?unassigned=true", headers=as_admin).json()
    assert [c["id"] for c in unassigned["items"]] == [free.id]


def test_manager_sees_team_only(client, make):
    team = make.team("Sales")
    other_team = make.team("Support")
    manager = make.employee(role="manager", team=team)
    mate = make.employee(team=team)
    outsider = make.employee(team=other_team)
    mine = make.contact(assign_to=mate)
    theirs = make.contact(assign_to=outsider)
    headers = auth_headers(client, manager)

    ids = {c["id"] for c in client.get("/api/v1/contacts", headers=headers).json()["items"]}
    assert ids == {mine.id}
    assert client.get(f"/api/v1/contacts/{theirs.id}", headers=headers).status_code == 404
    assert client.get("/api/v1/employees", headers=headers).json()["total"] == 2  # manager + mate, not the outsider
    assert client.get(f"/api/v1/employees/{outsider.id}", headers=headers).status_code == 403
    assert client.post("/api/v1/contacts", headers=headers, json={"name": "N", "phone": "9876543210"}).status_code == 403


def test_create_contact_normalizes_phone_and_rejects_duplicates(client, as_admin):
    created = client.post("/api/v1/contacts", headers=as_admin, json={"name": "Asha", "phone": "98765 43210", "tags": ["vip", "VIP", " "]})
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["phone"] == "+919876543210"
    assert body["tags"] == ["vip"]

    dup = client.post("/api/v1/contacts", headers=as_admin, json={"name": "Asha 2", "phone": "+91-9876543210"})
    assert dup.status_code == 409 and dup.json()["error"]["code"] == "duplicate_phone"
    assert dup.json()["error"]["details"]["contact_id"] == body["id"]

    bad = client.post("/api/v1/contacts", headers=as_admin, json={"name": "Bad", "phone": "5551234567"})
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "invalid_phone"
    too_short = client.post("/api/v1/contacts", headers=as_admin, json={"name": "Bad", "phone": "12"})
    assert too_short.status_code == 422


def test_search_by_name_phone_location_category_and_custom_fields(client, as_admin, make):
    a = make.contact(name="Ramesh Patil", phone="9876501234")
    b = make.contact(name="Sunita Deshmukh", phone="9876505678")
    client.patch(f"/api/v1/contacts/{a.id}", headers=as_admin, json={"location": "Pune", "category": "Retail", "custom_fields": {"Company": "Acme Traders"}})

    def ids(query: str) -> set[int]:
        return {c["id"] for c in client.get(f"/api/v1/contacts?q={query}", headers=as_admin).json()["items"]}

    assert ids("ramesh") == {a.id}
    assert ids("5678") == {b.id}
    assert ids("pune") == {a.id}
    assert ids("retail") == {a.id}
    assert ids("acme") == {a.id}
    assert ids("ramesh pune") == {a.id}
    assert ids("ramesh sunita") == set()
    assert ids("%25") == set()  # LIKE wildcards are escaped


def test_delete_is_soft_and_phone_can_be_recreated(client, make, emp_a, as_admin, as_a):
    contact = make.contact(name="Old", phone="9876512345", assign_to=emp_a)
    assert client.delete(f"/api/v1/contacts/{contact.id}", headers=as_admin).status_code == 204
    assert client.get(f"/api/v1/contacts/{contact.id}", headers=as_admin).status_code == 404
    assert client.get("/api/v1/contacts", headers=as_a).json()["total"] == 0

    again = client.post("/api/v1/contacts", headers=as_admin, json={"name": "New name", "phone": "9876512345"})
    assert again.status_code == 201
    assert again.json()["id"] == contact.id  # same master record is revived, not duplicated
    assert again.json()["name"] == "New name"


def test_pagination_shape_and_limits(client, make, emp_a, as_a):
    for i in range(7):
        make.contact(name=f"C{i:02d}", assign_to=emp_a)
    page1 = client.get("/api/v1/contacts?page=1&page_size=3", headers=as_a).json()
    page3 = client.get("/api/v1/contacts?page=3&page_size=3", headers=as_a).json()
    assert page1["total"] == 7 and len(page1["items"]) == 3 and len(page3["items"]) == 1
    assert client.get("/api/v1/contacts?page_size=1000", headers=as_a).status_code == 422


def test_notes_are_idempotent_per_client_ref(client, make, emp_a, as_a):
    c = make.contact(assign_to=emp_a)
    body = {"body": "Prefers evening calls", "client_ref": "note-uuid-0001"}
    first = client.post(f"/api/v1/contacts/{c.id}/notes", headers=as_a, json=body).json()
    second = client.post(f"/api/v1/contacts/{c.id}/notes", headers=as_a, json=body).json()
    assert first["id"] == second["id"]
    notes = client.get(f"/api/v1/contacts/{c.id}/notes", headers=as_a).json()
    assert notes["total"] == 1 and notes["items"][0]["author_name"] == emp_a.full_name
