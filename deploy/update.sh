#!/usr/bin/env bash
# Update the installed system to the newest version:   bash deploy/update.sh
# It makes a backup first, gets the new code (or the new prebuilt images), restarts what changed and waits until it is healthy.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
ENV_FILE=".env.production"
[ -f "$ENV_FILE" ] || { echo "No $ENV_FILE here: run deploy/install.sh first." >&2; exit 1; }
COMPOSE=(docker compose -f docker-compose.prod.yml --env-file "$ENV_FILE")
env_get() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' || true; }
say() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }

say "Backing up first"
bash deploy/backup.sh || echo "!!  The backup failed. Continuing, but check the disk space and /var/log/calling-backup.log."

if [ -d .git ]; then
  say "Getting the new version"
  git fetch --tags --quiet
  git pull --ff-only
fi

say "Restarting with the new version"
if [ -n "$(env_get ADMIN_IMAGE)" ] && [ -n "$(env_get API_IMAGE)" ]; then
  "${COMPOSE[@]}" pull
  "${COMPOSE[@]}" up -d --no-build --remove-orphans
else
  "${COMPOSE[@]}" up -d --build --remove-orphans
fi

say "Waiting until it is healthy"
for _ in $(seq 1 90); do
  if "${COMPOSE[@]}" exec -T api curl -fsS -m 4 http://localhost:8000/ready >/dev/null 2>&1 \
     && "${COMPOSE[@]}" exec -T admin wget -q -O /dev/null -T 4 "http://127.0.0.1:3000/api/health?deep=1" >/dev/null 2>&1; then
    docker image prune -f >/dev/null 2>&1 || true
    say "Updated. Running version: $("${COMPOSE[@]}" exec -T api curl -fsS -m 4 http://localhost:8000/health | sed -e 's/.*"version":"\([^"]*\)".*/\1/')"
    exit 0
  fi
  sleep 4
done
"${COMPOSE[@]}" ps
echo "The system is not healthy after the update. Logs:  ${COMPOSE[*]} logs --tail=100" >&2
exit 1
