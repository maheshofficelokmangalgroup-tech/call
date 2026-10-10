"""Take the contacts of an import away again - for a sheet that was added the wrong way - and add the corrected sheet the ordinary way.

    python -m scripts.remove_import 30              # only LOOK: how many contacts of import 30 there are, how many nobody has touched, who owns them
    python -m scripts.remove_import 30 --yes        # remove the ones nobody has touched

Only contacts nobody has done anything with are removed: no call, no note, no callback, still "new". What an employee has started on
stays. The numbers of the removed contacts are free again. The import is found in the panel (Contacts -> Import, the history) - its number
is the "#" of the row. Run it where the API runs, e.g.  docker compose exec api python -m scripts.remove_import 30
"""

from __future__ import annotations

import argparse
import sys

from sqlalchemy import select

from app.core.database import new_session
from app.models.employee import Employee
from app.models.imports import Import
from app.services import import_undo


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0], formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("import_id", type=int, help="the number of the import (the # of its row in the panel's import history)")
    parser.add_argument("--yes", action="store_true", help="really remove the untouched contacts (without it nothing is changed)")
    args = parser.parse_args(argv)

    db = new_session()
    try:
        imp = db.get(Import, args.import_id)
        if imp is None:
            print(f"There is no import {args.import_id}.", file=sys.stderr)
            return 2
        found = import_undo.count(db, args.import_id)
        names = {e.id: f"{e.full_name} ({e.employee_code})" for e in db.scalars(select(Employee).where(Employee.id.in_(list(found.owners) or [0])))}
        print(f"Import {imp.id}: '{imp.filename}', {imp.status}, added {imp.inserted_rows:,} contacts on {imp.created_at:%Y-%m-%d %H:%M}")
        print(f"  contacts of this import that exist now: {found.contacts:,}")
        print(f"  nobody has touched: {found.untouched:,}   (these would be removed)")
        print(f"  somebody has started on: {found.touched:,}   (these stay)")
        for employee_id, number in sorted(found.owners.items(), key=lambda item: -item[1]):
            print(f"    {names.get(employee_id, '#' + str(employee_id))}: {number:,}")
        if not args.yes:
            print("Nothing was changed. Run it again with --yes to remove them.")
            return 0
        done = import_undo.remove_untouched(db, args.import_id, actor_label="scripts.remove_import")
        print(f"Removed {done['removed']:,} contacts; {done['kept']:,} of this import stay.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
