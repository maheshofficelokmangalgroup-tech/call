"""Acceptance: admin can upload a 10,000-row dataset and receive an import summary; duplicates follow the policy.
Section 15: transactional, preview-first import."""

import csv
import io
import time

from openpyxl import Workbook

from app.models.contact import CampaignContact, Contact, ContactAssignment
from app.models.system import Notification


def make_csv(rows: list[list], header=("Name", "Mobile", "Email", "City", "Category", "Priority", "Tags", "Company")) -> bytes:
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(header)
    writer.writerows(rows)
    return out.getvalue().encode("utf-8")


def upload(client, headers, content: bytes, *, name="contacts.csv", **form):
    resp = client.post("/api/v1/contacts/import", headers=headers, files={"file": (name, content, "text/csv")}, data=form)
    assert resp.status_code == 202, resp.text
    return resp.json()


def get_import(client, headers, import_id):
    return client.get(f"/api/v1/contacts/import/{import_id}", headers=headers).json()


def confirm(client, headers, import_id, **body):
    resp = client.post(f"/api/v1/contacts/import/{import_id}/confirm", headers=headers, json=body)
    assert resp.status_code == 202, resp.text
    return get_import(client, headers, import_id)  # background task has finished when the call returns


MIXED_ROWS = [
    ["Alice", "9876500001", "alice@example.com", "Pune", "Retail", "high", "vip;gold", "Acme"],  # 2 valid
    ["Bob", "98765 00002", "", "", "", "", "", ""],  # 3 valid
    ["Carl", "12345", "", "", "", "", "", ""],  # 4 invalid phone
    ["", "9876500003", "", "", "", "", "", ""],  # 5 missing name
    ["Alice Again", "+91 9876500001", "", "", "", "", "", ""],  # 6 duplicate inside the file
    ["Dave", "9876500004", "", "", "", "", "", ""],  # 7 already exists in the database
    ["Eve", "9876500005", "not-an-email", "", "", "", "", ""],  # 8 invalid email
    ["Fay", "9876500006", "", "", "", "urgent!!", "", ""],  # 9 invalid priority
]


def test_upload_is_validated_in_the_background_and_previewed(client, make, as_admin, db):
    make.contact(name="Dave (existing)", phone="9876500004")
    imp = upload(client, as_admin, make_csv(MIXED_ROWS))
    preview = get_import(client, as_admin, imp["id"])

    assert preview["status"] == "previewed"
    assert (preview["total_rows"], preview["valid_rows"], preview["invalid_rows"], preview["duplicate_rows"]) == (8, 2, 4, 2)
    assert preview["inserted_rows"] == preview["updated_rows"] == preview["skipped_rows"] == 0
    # preview-first: nothing has been written to contacts yet
    assert db.query(Contact).count() == 1

    invalid = client.get(f"/api/v1/contacts/import/{imp['id']}/rows?status=invalid", headers=as_admin).json()
    assert invalid["total"] == 4
    reasons = " | ".join(" ".join(r["errors"]) for r in invalid["items"])
    assert "Invalid mobile number" in reasons and "Name is required" in reasons and "Invalid email" in reasons and "Invalid priority" in reasons
    dups = client.get(f"/api/v1/contacts/import/{imp['id']}/rows?status=duplicate", headers=as_admin).json()
    assert {r["duplicate_of"] for r in dups["items"]} == {"file", "existing"}


def test_confirm_in_skip_mode_reports_inserted_and_skipped(client, make, as_admin, db):
    make.contact(name="Dave (existing)", phone="9876500004")
    imp = upload(client, as_admin, make_csv(MIXED_ROWS), mode="skip")
    done = confirm(client, as_admin, imp["id"])

    assert done["status"] == "completed", done
    assert (done["inserted_rows"], done["updated_rows"], done["skipped_rows"], done["invalid_rows"]) == (2, 0, 2, 4)

    alice = db.query(Contact).filter(Contact.normalized_phone == "+919876500001").one()
    assert (alice.name, alice.location, alice.category, alice.priority) == ("Alice", "Pune", "Retail", 1)
    assert alice.tags == ["vip", "gold"] and alice.custom_fields == {"Company": "Acme"}
    assert db.query(Contact).filter(Contact.normalized_phone == "+919876500004").one().name == "Dave (existing)"  # untouched
    assert db.query(Contact).count() == 3


def test_update_mode_updates_existing_duplicates(client, make, as_admin, db):
    make.contact(name="Old Name", phone="9876500004")
    rows = [["Dave New", "9876500004", "dave@example.com", "Mumbai", "", "", "hot", ""]]
    imp = upload(client, as_admin, make_csv(rows), mode="update")
    done = confirm(client, as_admin, imp["id"])
    assert (done["inserted_rows"], done["updated_rows"], done["skipped_rows"]) == (0, 1, 0)
    dave = db.query(Contact).filter(Contact.normalized_phone == "+919876500004").one()
    assert (dave.name, dave.email, dave.location, dave.tags) == ("Dave New", "dave@example.com", "Mumbai", ["hot"])
    assert dave.search_text.count("mumbai") == 1  # search index refreshed


def test_confirm_can_override_the_mode_chosen_at_upload(client, make, as_admin, db):
    make.contact(name="Old", phone="9876500004")
    imp = upload(client, as_admin, make_csv([["New", "9876500004", "", "", "", "", "", ""]]), mode="skip")
    done = confirm(client, as_admin, imp["id"], mode="update")
    assert done["updated_rows"] == 1 and db.query(Contact).one().name == "New"


def test_import_distributes_contacts_assigns_and_attaches_campaign(client, make, emp_a, emp_b, as_admin, as_a, db):
    campaign = make.campaign("Launch", status="active")
    rows = [[f"Person {i}", f"98765{i:05d}", "", "", "", "", "", ""] for i in range(10, 20)]
    imp = upload(
        client, as_admin, make_csv(rows), campaign_id=str(campaign.id), assign_employee_ids=f"{emp_a.id},{emp_b.id}", assign_strategy="round_robin"
    )
    done = confirm(client, as_admin, imp["id"])
    assert done["inserted_rows"] == 10 and done["assigned_rows"] == 10

    assert db.query(CampaignContact).filter_by(campaign_id=campaign.id).count() == 10
    per_owner = {emp_a.id: 0, emp_b.id: 0}
    for a in db.query(ContactAssignment).filter_by(status="active"):
        per_owner[a.employee_id] += 1
        assert a.campaign_id == campaign.id
    assert per_owner == {emp_a.id: 5, emp_b.id: 5}
    assert len(client.get("/api/v1/queue", headers=as_a).json()["items"]) == 5  # visible to the employee immediately
    assert db.query(Notification).filter_by(employee_id=emp_a.id, type="assignment").count() == 1


def test_assigned_to_column_overrides_distribution(client, make, emp_a, emp_b, as_admin, db):
    rows = [["X", "9876500101", emp_b.employee_code], ["Y", "9876500102", emp_a.email]]
    imp = upload(client, as_admin, make_csv(rows, header=("Name", "Phone", "Assigned To")), assign_employee_ids=str(emp_a.id))
    done = confirm(client, as_admin, imp["id"])
    assert done["assigned_rows"] == 2
    owners = {c.normalized_phone: a.employee_id for c, a in db.query(Contact, ContactAssignment).join(ContactAssignment, ContactAssignment.contact_id == Contact.id)}
    assert owners == {"+919876500101": emp_b.id, "+919876500102": emp_a.id}

    bad = upload(client, as_admin, make_csv([["Z", "9876500103", "nobody"]], header=("Name", "Phone", "Assigned To")))
    row = client.get(f"/api/v1/contacts/import/{bad['id']}/rows?status=invalid", headers=as_admin).json()["items"][0]
    assert "Unknown or inactive employee" in row["errors"][0]


def test_xlsx_with_numeric_phone_cells(client, as_admin, db):
    wb = Workbook()
    ws = wb.active
    ws.append(["Full Name", "Mobile No.", "City"])
    ws.append(["Numeric Nina", 9876500201, "Nagpur"])  # Excel stores the phone as a number
    ws.append(["Float Fred", 9876500202.0, "Nashik"])
    ws.append(["Sci Sam", "9.876500203E+9", "Thane"])  # what a CSV round-trip through Excel produces
    buf = io.BytesIO()
    wb.save(buf)
    imp = upload(client, as_admin, buf.getvalue(), name="leads.xlsx")
    preview = get_import(client, as_admin, imp["id"])
    assert (preview["valid_rows"], preview["invalid_rows"]) == (3, 0), preview
    confirm(client, as_admin, imp["id"])
    assert {c.normalized_phone for c in db.query(Contact)} == {"+919876500201", "+919876500202", "+919876500203"}


def test_bad_files_are_rejected_or_fail_with_a_clear_reason(client, as_admin):
    def post(content, name):
        return client.post("/api/v1/contacts/import", headers=as_admin, files={"file": (name, content, "text/plain")})

    assert post(b"hello", "notes.txt").status_code == 422
    assert post(b"", "empty.csv").json()["error"]["code"] == "empty_file"

    imp = upload(client, as_admin, b"Name,City\nAnna,Pune\n")
    failed = get_import(client, as_admin, imp["id"])
    assert failed["status"] == "failed" and "mobile number column" in failed["error_message"]


def test_confirm_twice_and_cancel_rules(client, as_admin, db):
    imp = upload(client, as_admin, make_csv([["One", "9876500301", "", "", "", "", "", ""]]))
    assert confirm(client, as_admin, imp["id"])["status"] == "completed"
    again = client.post(f"/api/v1/contacts/import/{imp['id']}/confirm", headers=as_admin, json={})
    assert again.status_code == 409 and again.json()["error"]["code"] == "bad_import_state"
    assert db.query(Contact).count() == 1

    second = upload(client, as_admin, make_csv([["Two", "9876500302", "", "", "", "", "", ""]]))
    cancelled = client.post(f"/api/v1/contacts/import/{second['id']}/cancel", headers=as_admin).json()
    assert cancelled["status"] == "cancelled"
    assert client.post(f"/api/v1/contacts/import/{second['id']}/confirm", headers=as_admin, json={}).status_code == 409
    assert db.query(Contact).count() == 1


def test_import_history_and_issue_report_are_csv_injection_safe(client, as_admin):
    rows = [["=HYPERLINK(\"http://evil\")", "abc", "", "", "", "", "", ""], ["Fine", "9876500401", "", "", "", "", "", ""]]
    imp = upload(client, as_admin, make_csv(rows))
    report = client.get(f"/api/v1/contacts/import/{imp['id']}/issues.csv", headers=as_admin)
    assert report.status_code == 200 and report.headers["content-type"].startswith("text/csv")
    lines = report.text.strip().splitlines()
    assert lines[0].startswith("row_number,status,problem")
    assert "'=HYPERLINK" in report.text and ",=HYPERLINK" not in report.text
    history = client.get("/api/v1/contacts/import", headers=as_admin).json()
    assert history["total"] == 1 and history["items"][0]["id"] == imp["id"]


def test_deleted_contacts_are_revived_by_import(client, make, as_admin, db):
    from app.core.timeutils import utcnow

    gone = make.contact(name="Gone", phone="9876500501")
    gone.deleted_at = utcnow()
    db.commit()
    imp = upload(client, as_admin, make_csv([["Back Again", "9876500501", "", "", "", "", "", ""]]))
    assert get_import(client, as_admin, imp["id"])["valid_rows"] == 1
    done = confirm(client, as_admin, imp["id"])
    assert done["inserted_rows"] == 1
    db.expire_all()
    revived = db.get(Contact, gone.id)
    assert revived.deleted_at is None and revived.name == "Back Again" and db.query(Contact).count() == 1


def test_a_10000_row_dataset_imports_with_a_full_summary(client, make, emp_a, emp_b, as_admin, db):
    rows = []
    for i in range(10_000):
        if i % 100 == 99:
            rows.append([f"Bad {i}", "00000", "", "", "", "", "", ""])  # 100 invalid
        elif i % 200 == 150:
            rows.append([f"Dup {i}", f"{9000000000 + 1}", "", "", "", "", "", ""])  # 50 duplicates of row 1
        else:
            rows.append([f"Customer {i}", f"{9000000000 + i * 3 + 1:010d}", f"c{i}@example.com", "Pune", "Retail", "", "", ""])
    started = time.perf_counter()
    imp = upload(client, as_admin, make_csv(rows), assign_employee_ids=f"{emp_a.id},{emp_b.id}", assign_strategy="balanced")
    preview = get_import(client, as_admin, imp["id"])
    validated_in = time.perf_counter() - started
    assert preview["status"] == "previewed", preview
    assert preview["total_rows"] == 10_000 and preview["invalid_rows"] == 100
    assert preview["valid_rows"] + preview["invalid_rows"] + preview["duplicate_rows"] == 10_000

    started = time.perf_counter()
    done = confirm(client, as_admin, imp["id"])
    applied_in = time.perf_counter() - started
    assert done["status"] == "completed", done
    assert done["inserted_rows"] == preview["valid_rows"]
    assert done["inserted_rows"] + done["skipped_rows"] + done["updated_rows"] == preview["valid_rows"] + preview["duplicate_rows"]
    assert done["assigned_rows"] == preview["valid_rows"]
    assert db.query(Contact).count() == preview["valid_rows"]
    per_owner = [db.query(ContactAssignment).filter_by(employee_id=e.id, status="active").count() for e in (emp_a, emp_b)]
    assert abs(per_owner[0] - per_owner[1]) <= 1  # balanced strategy
    print(f"\n10k import: validate {validated_in:.1f}s, apply {applied_in:.1f}s, valid={preview['valid_rows']}")
    assert validated_in < 60 and applied_in < 60
