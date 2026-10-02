"""Reset a password from the server's command line - for the day every administrator has forgotten theirs.

    docker compose -f docker-compose.prod.yml --env-file .env.production exec api \\
        python -m scripts.reset_password admin@company.com

Prints a new random password, makes the account ask for a new one at the next sign-in and signs the person out everywhere.
The reset is written to the audit log. Add --activate to switch a deactivated account back on.
"""

from __future__ import annotations

import argparse
import sys

from app.core.database import new_session
from app.core.security import hash_password
from app.core.timeutils import utcnow
from app.services import audit_service
from app.services.auth_service import find_employee_by_identifier, revoke_all_sessions
from app.services.employee_service import generate_temporary_password


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("who", help="e-mail address or employee ID of the account")
    parser.add_argument("--activate", action="store_true", help="also switch the account on if it was deactivated")
    args = parser.parse_args()

    db = new_session()
    try:
        employee = find_employee_by_identifier(db, args.who)
        if employee is None:
            print(f"No account found for '{args.who}'.", file=sys.stderr)
            return 1
        if not employee.is_active and not args.activate:
            print(f"{employee.email} is deactivated. Run again with --activate to switch it on, or activate it in the panel.", file=sys.stderr)
            return 2

        password = generate_temporary_password()
        employee.password_hash = hash_password(password)
        employee.must_change_password = True
        employee.password_changed_at = utcnow()
        if args.activate:
            employee.is_active = True
        revoked = revoke_all_sessions(db, employee.id, reason="password_reset")
        audit_service.record(
            db,
            action="employee.reset_password",
            actor_label="server command line",
            entity_type="employee",
            entity_id=employee.id,
            details={"sessions_revoked": revoked, "activated": bool(args.activate), "via": "scripts.reset_password"},
        )
        db.commit()
        print(f"\nNew password for {employee.full_name} ({employee.email}, {employee.employee_code}):\n\n    {password}\n")
        print("They must choose their own password at the next sign-in. All their sign-ins were ended.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
