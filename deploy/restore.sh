#!/usr/bin/env bash
# Put a backup back:
#   bash deploy/restore.sh /var/backups/calling/db-20261001-023000.sql.gz [/var/backups/calling/files-20261001-023000.tar.gz]
#
# This REPLACES the current database (and the files, when a files archive is given). The system is stopped while it runs.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
ENV_FILE=".env.production"
COMPOSE=(docker compose -f docker-compose.prod.yml --env-file "$ENV_FILE")

DB_DUMP="${1:-}"
FILES="${2:-}"
[ -n "$DB_DUMP" ] && [ -f "$DB_DUMP" ] || { echo "Usage: bash deploy/restore.sh <db-....sql.gz> [files-....tar.gz]" >&2; exit 1; }
[ -z "$FILES" ] || [ -f "$FILES" ] || { echo "$FILES does not exist." >&2; exit 1; }

echo "This will REPLACE the live database with $DB_DUMP${FILES:+ and the files with $FILES}."
read -r -p "Type YES to continue: " answer
[ "$answer" = "YES" ] || { echo "Cancelled."; exit 1; }

echo "==> Safety copy of the current state first"
bash deploy/backup.sh || echo "(the safety copy failed; continuing because you asked to restore)"

echo "==> Stopping the panel and the API"
"${COMPOSE[@]}" stop admin api caddy

echo "==> Restoring the database"
"${COMPOSE[@]}" exec -T mysql sh -c 'exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -e "DROP DATABASE IF EXISTS \`$MYSQL_DATABASE\`; CREATE DATABASE \`$MYSQL_DATABASE\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"'
gunzip -c "$DB_DUMP" | "${COMPOSE[@]}" exec -T mysql sh -c 'exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"'

if [ -n "$FILES" ]; then
  echo "==> Restoring the files"
  docker run --rm -v calling_api_data:/data -v "$(dirname "$(readlink -f "$FILES")")":/backup:ro alpine:3 \
    sh -c "find /data -mindepth 1 -delete && tar xzf /backup/$(basename "$FILES") -C /data && chown -R 10001:10001 /data"
fi

echo "==> Starting again (the API applies any newer database changes by itself)"
"${COMPOSE[@]}" up -d
echo "Done."
