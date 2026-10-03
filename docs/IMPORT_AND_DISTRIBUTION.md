# Importing contacts and sharing them between employees

A sheet of 10 contacts or of a million: it is checked, no number gets in twice, and what is new is shared **equally between the
employees who are working** - somebody who stopped working gets nothing, and what was waiting with them is shared out again.

A sheet may have **one row per number** (a voter list: the same person on many rows, one number on each). Those rows become **one
contact with all the numbers** - the name is shown once in the calling app and every number is on the person (see
[One person, many numbers](#one-person-many-numbers-a-voter-list)).

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
| Relative Name | optional; the father's / husband's name (up to 255 characters) |
| Age | optional; 1-150 (`35`, `35.0`, `'35`); anything else is left out - the row is still good |
| Gender | optional; `M`/`Male`, `F`/`Female`/`Woman`, `O`/`Other`; anything else is left out |
| EPIC No | optional; the voter card number (upper case, spaces removed) |
| Voter Pincode | optional; 6 digits |
| Voter Address | optional; up to 2,000 characters (a column called *Address* is this one; *City / Area / Place* are the short *Location*) |
| Email | optional; must look like an email |
| Priority | optional; `1-3` or High / Medium / Low; the upload's default when empty |
| Tags | optional; separated by `, ; |` (at most 20) |
| Assigned to | optional; an employee code or email of an active employee - that row goes to that person (see below) |
| any other column | kept as an extra field of the contact (at most 30, 500 characters each) |

**The column names** are matched in any spelling - capitals, spaces, `_`, `-`, `.` and apostrophes do not matter (`Voter Name`,
`voter_name`, `VOTER-NAME` and `VoterName` are the same). When none of the headers is a known name for the person's name (or number),
the **one** header that says *name* (or *mobile* / *phone*) is taken - never a relative's, an agent's or a booth's name, and never a
guess between two candidates. If the sheet still has no name or no mobile column, the check stops and **lists the columns it found**,
so it is clear what to rename.

### No duplicate gets in - three levels

1. **Inside the sheet** - the same number written in different ways (`9876543210`, `+91 98765 43210`, `09876543210`,
   `98765-43210`) is one number; the first line wins, the others are listed as repeats.
2. **Against the contacts you have** - looked up in batches through the unique index on the phone number. In *skip* mode the
   existing contact is left exactly as it is; in *update* mode it gets the data of the sheet. A contact that was deleted before is
   brought back.
3. **At the moment of writing** - the database has a unique index on the number, and contacts are inserted with "leave out the rows
   whose number is there". So even a number that was added by somebody else *after* the check cannot become a second contact.

### One person, many numbers (a voter list)

A voter list has **one row per number**: *Mobile Number, Voter Name, Relative Name, Age, Gender, EPIC No, Voter Pincode, Voter
Address*. The same person is on many rows (one number each), and the same number can be on many rows (a family that shares a
phone, a row typed twice). The import turns that into **people**:

* **Rows with the same name, relative, age, gender, pincode and address are one person** (capitals and spaces do not matter). The
  person is **one contact** with **all** their numbers (the first number is the main one). The calling app shows the name once.
* **Only when the row says enough about the person**: it needs an address, a relative's name or a voter card number, and at least two
  of relative / age / gender / pincode / address / EPIC. A plain list of names and numbers is never merged - two customers called
  *Rahul* stay two contacts.
* **Two different EPIC numbers are two people**, even if everything else is equal (twins at one address). A row without an EPIC
  number joins the first person it fits.
* **A number is in one contact only.** A number that is on rows of different people (a shared phone) belongs to the first row of the
  sheet; the later rows are listed as repeats of that number, and those people are still added with their other numbers. The
  database has a unique index on every number, so whatever the sheet says, no number is ever in two contacts.
* **At most 20 numbers per person** - more are not added, and the check says how many.
* **Every row is accounted for.** The check shows *people*, *numbers*, *rows that joined another row of the same person*, repeats and
  bad rows - and `bad + repeats + numbers = all rows`.
* **People you have already** (found by any of their numbers, or by who they are) are not made again. *Skip* mode **adds their new
  numbers** to the contact and touches nothing else; *update* mode also gives the contact the data of the sheet. A person who was
  deleted before is brought back.
* **The sharing is by person**: 53,304 people between 10 employees is 5,330 or 5,331 each - not by row.

In the calling app a person with several numbers shows **+N more numbers**; the contact screen has the **Numbers** list with a Call
button on every number, how often it was called and answered, *Wrong number* where an employee reported it, and *Next to call*. The
number the phone dials: **the one that was answered last time**, else **the one tried the fewest times** (so the numbers take turns,
the first of the person before the others); a number reported as not valid is left out unless nothing else is left. The server
records the number that was really dialled on the call. *Invalid number* as an outcome marks **that number** only: while the person
has another number, they stay in the queue.

In the admin panel: the contact list shows the first number and *+N*, the contact drawer has every number (with calls and
answered), the voter details (relative, age, gender, voter ID, pincode, address) and an editor for the numbers; the list can be
searched by **any** of the numbers, by name, relative, voter ID, pincode and address. The import check says *people / numbers / rows
that joined*.

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
and rate limited; the login sheet is built so that no cell can be a spreadsheet formula. The key is derived from `JWT_SECRET`: if that
secret is ever changed, the saved passwords can no longer be shown (the employees can still sign in; use *Reset password*). Employees
created before this feature have no saved password either - *Reset password* gives them one that can be looked at.

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

A **voter list** at the size of the real one (`python -m scripts.voter_check`; laptop, MySQL 8.4, 2,000 people were contacts before):

| 209,395 rows, 23.5 MB, 8 columns | |
| --- | --- |
| check (read, validate, group the rows of one person, compare with the contacts) | **25.8 s** (8,112 rows/s) |
| add + share to 10 employees (people and numbers, in steps of 2,000 people) | **14.8 s** |
| result | **53,304 people** with **161,244 numbers**; 123 bad rows, 48,528 repeats of a number, 107,440 rows joined another row of the same person - `123 + 48,528 + 160,744 = 209,395`; 2,000 people found again (not made twice), 1,351 of them got new numbers; **5,130 or 5,131 people each** |
| every person is one contact with all their numbers | 3,000 people looked up one by one by their numbers: 0 wrong |
| the same list again | adds nobody |
| memory of the process | **206 MB** peak |
| pages with 53,304 people | contacts first page 17 ms, find a person by their *last* number 6 ms, search by name 122 ms, by pincode 156 ms, the calling queue (100 people with all their numbers) 7 ms (medians) |

The rows of one person are brought together **on disk** (64 buckets, one at a time), never in memory.

**Why adding is that fast:** every step sends its rows to MySQL in a few statements (`app/core/dbutil.py`, `KeepExistingRow`). Written the
obvious way (SQLAlchemy's `on_duplicate_key_update`), the driver (pymysql) did not recognise the statement - it spent 6-7 seconds on
a pattern that failed, and then sent every row as a statement of its own: 386 s instead of 15 s for this list, and a round trip per row
on a database that is not on the same machine. `tests/test_dbutil.py` keeps it that way.

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

`backend/app/services/`: `import_files.py` (safe readers), `import_rows.py` (what a line must be, who a person is),
`import_service.py` (the pipeline), `contact_numbers.py` (the numbers of a person: which to dial, what happened on each),
`distribution.py` (the arithmetic - pure, tested against brute force), `activity.py` (who is working),
`rebalance_service.py`, `workload.py`, `credential_vault.py`; `app/jobs.py` (background threads + scheduler); `scripts/import_contacts.py`,
`scripts/scale_check.py`, `scripts/make_big_sheet.py`, `scripts/voter_check.py`, `scripts/make_voter_sheet.py`. Tests:
`tests/test_import*.py`, `test_people_numbers.py`, `test_distribution.py`, `test_rebalance.py`, `test_activity.py`,
`test_credentials.py`, `test_scale_paths.py`. Table `contact_phones` (migration `0007`) holds every number of every contact.
