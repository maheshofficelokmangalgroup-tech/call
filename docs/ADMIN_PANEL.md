# The admin panel - what you can do

Sign in with an **administrator** or **manager** account (employees use the mobile app). Administrators see and change
everything; a manager sees the employees of their own team and cannot change anything.

## Dashboard

The first page. Pick the period at the top right (Today, Yesterday, Last 7 days, Last 30 days, This month, Last month or any dates).
Every page uses that period.

* **Eight numbers** with the change since the period before: calls, answered, talk time, average conversation, employees who
  called, people reached, recordings, calls still waiting for an outcome.
* **Live now** - who is on a call this second, whom they are calling and a running timer; and how many employees are online,
  idle or offline. It refreshes by itself every few seconds.
* **Latest calls** - the newest calls of the team. Click one to open it.
* **Charts** - calls per day (or minutes of talk time), how the calls ended, the busiest hours and weekdays, and who made the most calls.
* **Recordings** - how many answered calls have a recording and, for the others, *why not* (see below).

## Employees

A table of everybody: status (on a call / online / idle / offline / inactive), calls, answer rate, talk time, people reached,
recordings and today's progress against the daily target. Click the column titles to sort, use the search box, the team, role and
status filters, or the coloured status chips. **Export** downloads the table as a spreadsheet.

**Creating employees** (administrators)

* **New employee** - name, e-mail, mobile, role (employee / manager / administrator), team, daily target. The system makes a strong
  temporary password (or you type one). The next screen shows the **Employee ID, e-mail and password once**, with *Copy all* and
  *Send on WhatsApp* buttons. The person signs in on the mobile app with the ID or the e-mail and must choose their own password.
* **Import sheet** - for many people at once: upload a CSV (from Excel: *Save As -> CSV*). Every line is checked first
  (wrong e-mail, unknown team, repeated e-mail...) and the lines with problems are listed with the reason. After the import you can
  download a **login sheet** with everybody's ID and password. Use *Sample file* in the dialog to see the columns.
* Managers can sign in to the panel too: create them with the role *Manager* and a team.

**One employee** (click a row): their calls, how long they talked, whom they called most, when they usually start and finish,
progress against today's target, charts, the list of calls, the people they called, their recordings and the phones they signed in on.
*Manage* (administrators): edit details, reset the password (a new one is shown once), sign out of all phones, deactivate / activate,
and release a phone when the account is locked to the first phone.

## Calls

Every call in the period: when it started, who called, whom, the result (answered / not answered), talk time, the outcome the employee chose
and whether it was recorded. Filter by employee, result, outcome, minimum talk time, recorded or not, or search a name or number;
sort by newest, oldest or longest talk. **Export CSV** gives the same list (with the filters) as a spreadsheet.

**Click a call** to see everything: who called, the **timing** (started, talk time, how long it rang, ended), the notes the employee wrote,
the **recording player** (play, pause, jump, 10-second skips, speed, and *Download* for administrators) and **what happened** step by step.
The address bar changes to `...?call=123`; send that link to a colleague to show them the call.

### Why does a call have no recording?

Android does not let ordinary apps record the other person during a call: on most phones the microphone delivers only silence. The app tries,
throws away an empty recording and tells the server why. The panel shows the reason on the call and counts them on the dashboard:

| Reason | What it means / what to do |
|---|---|
| The phone gave only silence | Android blocked it. Use a cloud-telephony provider for recordings of every call ([TELEPHONY.md](TELEPHONY.md)). |
| Microphone permission is off | The employee has not allowed the microphone in the app's phone setup. |
| The recorder could not run | The phone refused to start the recorder. |
| Saved on the phone, upload pending | The phone has the file and will send it when it is online. |
| No report | An older app version, or the call was made outside the app. |

## Recordings

All recorded calls of the period, ready to play in the list (only one plays at a time). Recordings that are still arriving or failed to upload
are marked. Every time somebody listens to or downloads a recording it is written to the audit log.

## Contacts, campaigns, teams

* **Contacts** - search and filter; add one, or **Import sheet** (Excel / CSV: checked first, duplicates and bad lines listed, then confirmed);
  open a contact to read the notes and every call made to it; select many and **Give to employees** (one person, or shared evenly).
* **Campaigns** - a goal with a list of contacts and a target number of calls; choose who calls, hand out the waiting contacts, watch the progress.
* **Teams** - group employees; a manager sees the team they belong to.

## Audit log and settings (administrators)

* **Audit log** - who signed in, who created or changed an account, reset a password, opened or deleted a recording, exported a report,
  changed a setting - with time and address.
* **Settings** - switch call recording on/off and edit the notice employees accept, the default daily target for new employees, how long to
  wait before a contact that did not answer comes back to an employee's list, and what happens to duplicate contacts in an import.

## Tips

* `Ctrl + K` (or the search box at the top) jumps to any page or employee.
* The sun / moon button switches between light and dark mode. The menu on the left collapses to icons.
* On a phone the menu opens with the button at the top left, and tables become cards.
* If you forget your password ask another administrator to reset it. If nobody can sign in, see [DEPLOYMENT.md](DEPLOYMENT.md) (*Troubleshooting*).
