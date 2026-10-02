# Importing contacts and sharing them between employees

A sheet of 10 contacts or of a million: it is checked, no number gets in twice, and what is new is shared **equally between the
employees who are working** - somebody who stopped working gets nothing, and what was waiting with them is shared out again.

## In the admin panel

**Contacts → Import sheet**

1. **Upload** the `.csv` or `.xlsx` (up to 200 MB - about a million contacts). The header row needs a *name* and a *phone* column;
   email, city, category, tags, priority, `Assigned to` and any other column are optional (other columns are kept on the contact).
2. **Check** - the server reads it line by line (a big sheet takes a few minutes; you can close the window). You see how many lines
   are ready, already contacts, repeated inside the sheet, or have a problem - and download the list of problem lines with the reason
   for each, to fix and upload again.
3. **Who gets them** - everybody who is working (default), only people you choose, or nobody (added without an owner). The table
   shows every employee, whether they count as working, what they have now and what they would get. *"10,000 contacts ÷ 10 people =
   1,000 each"* - and when it does not divide, *"and 3 people get one more"*. The plan you see is what happens: the numbers are
   fixed when you press **Add**.
4. **Add** - the contacts are written in small steps with a progress bar, rows per second and the time left. You can close the
   window; open the import again from the banner on the Contacts page. **Stop** keeps what is already added.

Employees see the new contacts in their calling queue at once, and get one notification ("1,000 new contacts assigned").

### From the server (the way to load a sheet of a million)

```bash
# put the file on the server, then inside the API container:
docker compose exec api python -m scripts.import_contacts /app/var/contacts.csv            # check + show the plan, nothing added
docker compose exec api python -m scripts.import_contacts /app/var/contacts.csv --yes      # check, then add and share
python -m scripts.import_contacts sheet.xlsx --employees 12,15,18 --strategy balance_total --yes
python -m scripts.import_contacts sheet.csv --unassigned --yes                              # no owner
```

It is the same pipeline as the panel (same checks, same rules), without the web server's upload limit. Without `--yes` the import
stays *previewed* and can be confirmed from the panel. `Ctrl+C` asks it to stop after the step it is in.

## The rules

### What is checked in every line

| Column | Rule |
| --- | --- |
| Name | required, at most 255 characters; invisible and control characters are removed, accents are normalised |
| Mobile | required; spreadsheet damage is repaired (`9.8765E+9`, `'9876543210`, `9876543210.0`); must be a valid mobile number (India by default); stored as `+919876543210` |
| Email | optional; must look like an email |
| Priority | optional; `1-3` or High / Medium / Low; the upload's default when empty |
| Tags | optional; separated by `, ; |` (at most 20) |
| Assigned to | optional; an employee code or email of an active employee - that row goes to that person (see below) |
| any other column | kept as an extra field of the contact (at most 30, 500 characters each) |

### No duplicate gets in - three levels

1. **Inside the sheet** - the same number written in different ways (`9876543210`, `+91 98765 43210`, `09876543210`,
   `98765-43210`) is one number; the first line wins, the others are listed as repeats.
2. **Against the contacts you have** - looked up in batches through the unique index on the phone number. In *skip* mode the
   existing contact is left exactly as it is; in *update* mode it gets the data of the sheet. A contact that was deleted before is
   brought back.
3. **At the moment of writing** - the database has a unique index on the number, and contacts are inserted with "leave out the rows
   whose number is there". So even a number that was added by somebody else *after* the check cannot become a second contact.

### How the new contacts are shared

* **Who is working** - an employee is *working* when they were seen within `inactive_after_days` (default **2**, 1-90, Settings).
  "Seen" is the newest of: a sign-in, a request of the app (token renewal), a report of the phone (heartbeat, also what the open app
  said in the last minutes). An account created within that time that has not signed in yet counts as working (*new*).
  **Not working:** not seen for longer, never seen although the account is older than that, or the account is deactivated.
* **Equal** (default) - *n* contacts between *k* people: everyone gets `n ÷ k`; the remainder (fewer than *k*) goes one each to the
  people with the lightest load, then the lowest id. So nobody ever has more than one more than anybody else.
* **Even out the work** - whoever has the least to call now gets the most, until everybody has the same in total.
* **Order** - *Mixed* (everybody gets a mix of the whole sheet; if the job stops early everybody still has about the same) or *In
  blocks* (the first part to the first person ...). The person for a line depends only on its position, so a job that stopped goes on
  exactly where it was.
* **`Assigned to` in the sheet** - a line that names its employee goes to that person; the other lines are shared. (If the named
  person is not working, the plan says so; the rebalancing moves it later.)
* **Nobody is working** - the import is refused with a clear message unless you choose "add without an owner".

### When somebody stops working: the rebalancing (**People → Work sharing**)

The contacts of an employee who is *not working* that nobody has called yet (`new`, `in progress`) and that have no callback
promised to that person are given to the people who are working - equally (or evened out). Contacts that were worked on (answered,
interested, finished ...) and promised callbacks **stay** where they are.

* **By hand** - *Share their contacts now* shows exactly who gives how many and who receives how many, then moves them (steps of 1,000;
  a contact somebody is editing at that moment waits for the next round).
* **By itself** - every ten minutes the server looks; if somebody stopped working and there is something to take, it does it
  (Settings → *Share their contacts automatically*; off = only by hand). Every run is in the history (when, who gave, who received)
  and in the audit log; receivers get a notification.
* Doing it twice changes nothing: what was moved is not on the list any more. Old assignments are kept as history.

### The passwords an administrator hands out

When an employee is created (or a password is reset) the password is kept **encrypted** (Fernet, key derived from the server's JWT
secret) so an administrator can **look at it again** - *Employees → ⋯ → Show password*, or download a *Login sheet* (Excel) of a list of
employees. It exists only until the employee chooses their own password (then it is wiped - nobody can ever see a password the
employee chose), until the account is deactivated, or for 30 days (`CREDENTIAL_KEEP_DAYS`). Every look and every download is written to the audit log
and rate limited; the login sheet is built so that no cell can be a spreadsheet formula.

## How it behaves at scale (measured)

On a laptop with MySQL 8.4 (384 MB buffer pool), one process:

| 1,000,000-row CSV (66 MB), 100,000 contacts before | |
| --- | --- |
| check (read, validate, compare with the contacts) | **216 s** (4,600 lines/s) |
| add + share to 20 employees | **268 s** (3,300 contacts/s) |
| result | 881,973 new = 979,943 different numbers - 97,970 that were contacts; 10,041 bad lines and 10,016 repeats found exactly; **44,098 or 44,099 each** |
| memory of the process | **215 MB** peak |
| a number twice in the database | none (checked) |

The same numbers are checked automatically on every push (`import-scale` job in CI: 300,000 rows on MySQL, plus an Excel file).

Why it holds: the sheet is read **one row at a time** (never loaded); valid rows go to a file, only the *numbers* are kept in memory
(about 70 MB per million); the database is touched in **steps of 2,000 rows**, each its own transaction that also moves the resume
point; the work pauses a little after every step (more when a step was slow) because the database is shared with the phones.

### Safe when things go wrong

* A restart, deploy or crash in the middle: the work is in small committed steps; the next process **takes over** (a lease in the
  database, renewed every few seconds) and carries on where the last one stopped. No contact is added twice or lost. (Imports live in
  the `api_data` volume, which survives container re-creation.)
* An error: the import is marked *stopped half way*; what was added stays; **Continue** does the rest.
* Two people press Add: only one import is added at a time (the second is told to wait).
* Cancel while adding: stops after the current step, keeps what is added, tells the receivers.
* An upload nobody confirmed is removed after 7 days; the files of a finished import are removed at once (the list of problem lines
  is kept 7 days); the line-level data in the database (personal data) is removed after 30 days.

### Security of the upload

Extension and size are checked while the file arrives; the file is stored in a private folder under a random name (the name of the
file is never used as a path); free disk space is checked first. Text is read in UTF-8 / Windows-1252 / UTF-16, a delimiter of `, ; tab |`; a file with binary
data renamed to `.csv` is refused. For `.xlsx`: it must be a real workbook; **macros, password protection, unusual structure
(thousands of parts), a size that unpacks to more than 2 GB and entries compressed far more than any real sheet (zip bombs) are
refused before anything is unpacked**; formulas are never evaluated (only stored values are read); XML tricks (entity bombs) are
refused by `defusedxml`. The list of problem lines neutralises spreadsheet formulas. Only administrators can use any of this; every
step is audited.

## Settings and limits

| Setting | Default | |
| --- | --- | --- |
| `inactive_after_days` (Settings page) | 2 | days not seen = not working |
| `auto_rebalance` (Settings page) | on | share the contacts of people who stopped, every 10 minutes |
| `MAX_IMPORT_MB` | 200 | size of a sheet |
| `MAX_IMPORT_ROWS` | 1,100,000 | rows of a sheet |
| `MAX_IMPORT_COLUMNS` | 100 | columns |
| `IMPORT_CHUNK_ROWS` | 2,000 | rows per database transaction |
| `IMPORT_CHUNK_PAUSE_MS` | 20 | pause after every step |
| `IMPORT_KEEP_DAYS` | 7 | unconfirmed uploads / reports kept |
| `ASSIGN_MAX_CONTACTS` | 100,000 | "assign by filter" in one request (bigger: use the import) |
| `CREDENTIAL_KEEP_DAYS` | 30 | how long a handed-out password can be looked at |
| `JOBS_INLINE`, `BACKGROUND_JOBS` | false, true | tests run the work inline and without the scheduler |

The web front door (Caddy) accepts up to 210 MB on `/contacts/import`; the admin panel passes the upload on while it arrives (it never
holds the file in memory).

## API (administrators only)

| | |
| --- | --- |
| `POST /contacts/import` | upload (`file`, `mode`, `campaign_id`, `default_priority`); the check runs in the background |
| `GET /contacts/import`, `/{id}` | list / one import with progress (`status`, `scanned_rows`, `progress_percent`, `applied_rows`, `result`) |
| `GET /contacts/import/{id}/rows?status=` | the first problem lines / valid lines (sample) |
| `GET /contacts/import/{id}/issues.csv` | every problem line with the reason and the cells of the sheet |
| `GET /contacts/import/{id}/plan?employee_ids=&strategy=&order=&leave_unassigned=` | who is working, who gets how many (nothing is changed) |
| `POST /contacts/import/{id}/confirm` | `{mode, distribution: {strategy, order, employee_ids, leave_unassigned}}` |
| `POST /contacts/import/{id}/retry`, `/cancel` | continue a stopped import / cancel or stop |
| `GET /distribution/overview` | every employee with state, what they own, what could be taken back |
| `POST /distribution/rebalance/preview`, `/rebalance` | preview / do it (`from_employee_ids`, `to_employee_ids`, `strategy`, `order`) |
| `GET /distribution/runs`, `/runs/{id}` | history |
| `GET /employees/{id}/credentials`, `/employees/credentials.xlsx?ids=` | the password handed out (audited) / the login sheet |

## Files

`backend/app/services/`: `import_files.py` (safe readers), `import_rows.py` (what a line must be), `import_service.py` (the
pipeline), `distribution.py` (the arithmetic - pure, tested against brute force), `activity.py` (who is working),
`rebalance_service.py`, `workload.py`, `credential_vault.py`; `app/jobs.py` (background threads + scheduler); `scripts/import_contacts.py`,
`scripts/scale_check.py`, `scripts/make_big_sheet.py`. Tests: `tests/test_import*.py`, `test_distribution.py`, `test_rebalance.py`,
`test_activity.py`, `test_credentials.py`, `test_scale_paths.py`.
