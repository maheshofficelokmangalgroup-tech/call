#!/usr/bin/env bash
# Back up the database and the files (recordings kept on this server, imports).
#
#   bash deploy/backup.sh                  # into /var/backups/calling
#   BACKUP_DIR=/mnt/usb/calling KEEP_DAYS=30 bash deploy/backup.sh
#
# The installer runs it every night. Copy the folder to another place now and then (another server, a cloud drive): a backup
# that lives only on the machine that fails is not a backup.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
ENV_FILE=".env.production"
[ -f "$ENV_FILE" ] || { echo "No $ENV_FILE here." >&2; exit 1; }
COMPOSE=(docker compose -f docker-compose.prod.yml --env-file "$ENV_FILE")

DIR="${BACKUP_DIR:-/var/backups/calling}"
KEEP="${KEEP_DAYS:-14}"
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$DIR"
umask 077

echo "[$(date '+%F %T')] backing up to $DIR"
# --single-transaction: a consistent copy while people keep calling
"${COMPOSE[@]}" exec -T mysql sh -c 'exec mysqldump --single-transaction --quick --routines --no-tablespaces -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"' \
  | gzip > "$DIR/db-$STAMP.sql.gz.part"
mv "$DIR/db-$STAMP.sql.gz.part" "$DIR/db-$STAMP.sql.gz"
[ "$(stat -c %s "$DIR/db-$STAMP.sql.gz")" -gt 500 ] || { echo "The database backup is suspiciously small." >&2; exit 1; }

# the recordings and imports live in the api_data volume (empty when recordings are in S3)
docker run --rm -v calling_api_data:/data:ro -v "$DIR":/backup alpine:3 \
  sh -c "tar czf /backup/files-$STAMP.tar.gz.part -C /data . && mv /backup/files-$STAMP.tar.gz.part /backup/files-$STAMP.tar.gz"

find "$DIR" -maxdepth 1 \( -name 'db-*.sql.gz' -o -name 'files-*.tar.gz' \) -mtime +"$KEEP" -delete
echo "[$(date '+%F %T')] done: db-$STAMP.sql.gz ($(du -h "$DIR/db-$STAMP.sql.gz" | cut -f1)), files-$STAMP.tar.gz ($(du -h "$DIR/files-$STAMP.tar.gz" | cut -f1))"
