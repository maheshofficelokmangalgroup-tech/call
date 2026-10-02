#!/usr/bin/env bash
# Give the system its own database user on the RDS server, able to reach ONLY its own database - so the RDS master password is
# used once, here, and is never stored in the system's settings.
#
#   RDS_ADMIN_PASSWORD='...' DB_HOST=<endpoint> DB_PASSWORD='<password for the new user>' bash create-database-user.sh
#
# Optional: RDS_ADMIN_USER (admin), DB_PORT (3306), DB_NAME (Calling_db), DB_USER (calling_app), MAX_CONNECTIONS (12).
# The RDS server allows few connections and every project shares them, so the new user is limited to MAX_CONNECTIONS.
# It is safe to run again (it resets the password and keeps the grants).
set -euo pipefail

: "${RDS_ADMIN_PASSWORD:?set RDS_ADMIN_PASSWORD}"
: "${DB_HOST:?set DB_HOST}"
: "${DB_PASSWORD:?set DB_PASSWORD}"
ADMIN_USER="${RDS_ADMIN_USER:-admin}"
PORT="${DB_PORT:-3306}"
NAME="${DB_NAME:-Calling_db}"
USER_NAME="${DB_USER:-calling_app}"
LIMIT="${MAX_CONNECTIONS:-12}"

[[ "$NAME" =~ ^[A-Za-z0-9_]+$ && "$USER_NAME" =~ ^[A-Za-z0-9_]+$ && "$LIMIT" =~ ^[0-9]+$ ]] || { echo "Unsafe name or number." >&2; exit 1; }
[[ "$DB_PASSWORD" =~ ^[A-Za-z0-9]{16,}$ ]] || { echo "DB_PASSWORD must be at least 16 letters and digits (no symbols: it goes into a URL)." >&2; exit 1; }

if command -v mysql >/dev/null; then
  client=(mysql)
else
  client=(docker run --rm -i -e MYSQL_PWD mysql:8.4 mysql)
fi

export MYSQL_PWD="$RDS_ADMIN_PASSWORD"
# the statements go in through standard input, so no password appears in a process list
"${client[@]}" -h "$DB_HOST" -P "$PORT" -u "$ADMIN_USER" --connect-timeout=15 <<SQL
CREATE USER IF NOT EXISTS '$USER_NAME'@'%' IDENTIFIED BY '$DB_PASSWORD' WITH MAX_USER_CONNECTIONS $LIMIT;
ALTER USER '$USER_NAME'@'%' IDENTIFIED BY '$DB_PASSWORD' WITH MAX_USER_CONNECTIONS $LIMIT;
GRANT ALL PRIVILEGES ON \`$NAME\`.* TO '$USER_NAME'@'%';
SQL
echo "Database user '$USER_NAME' can use '$NAME' (at most $LIMIT connections) and nothing else."
