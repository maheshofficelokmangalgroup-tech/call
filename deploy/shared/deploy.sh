#!/usr/bin/env bash
# Bring this server to a version of the system: get the matching files, pull the matching images, restart what changed, wait
# until it is healthy.
#
#   bash deploy/shared/deploy.sh                     # the newest version on the main branch (image tag "latest")
#   bash deploy/shared/deploy.sh sha-1a2b3c4 <40-character commit id>     # exactly this version (what CI does)
#
# A GitHub token can be given on standard input (the CI does): it is used only to download the images, and is kept apart from
# the Docker login of the other projects on this server (DOCKER_CONFIG below).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
cd "$HERE"
[ -f .env ] || { echo "No .env here: run setup.sh first." >&2; exit 1; }

TAG="${1:-}"
SHA="${2:-}"
env_get() { grep -E "^$1=" .env | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' || true; }
say() { printf '\n==> %s\n' "$*"; }

# our own Docker credentials: never touch the login the other projects on this server rely on
export DOCKER_CONFIG="$ROOT/.docker"
mkdir -p "$DOCKER_CONFIG"
chmod 700 "$DOCKER_CONFIG"

TOKEN=""
if [ ! -t 0 ]; then IFS= read -r -t 5 TOKEN || true; fi
if [ -n "$TOKEN" ]; then
  printf '%s' "$TOKEN" | docker login ghcr.io -u "${GITHUB_ACTOR:-ci}" --password-stdin >/dev/null
fi

if [ -n "$SHA" ] && [ -d "$ROOT/.git" ]; then
  say "Files for commit ${SHA:0:7}"
  git -C "$ROOT" fetch --quiet origin
  git -C "$ROOT" checkout --quiet --detach "$SHA"
fi

# the version to run goes into .env, so a later plain `docker compose up -d` keeps it
if [ -n "$TAG" ]; then
  if grep -q '^IMAGE_TAG=' .env; then sed -i "s|^IMAGE_TAG=.*|IMAGE_TAG=$TAG|" .env; else echo "IMAGE_TAG=$TAG" >> .env; fi
fi
COMPOSE=(docker compose --env-file .env)

say "Checking the files"
"${COMPOSE[@]}" config -q
[ -f "letsencrypt/live/$(env_get PUBLIC_HOST)/fullchain.pem" ] || { echo "No certificate yet: run issue-cert.sh first." >&2; exit 1; }

say "Downloading the images (tag $(env_get IMAGE_TAG))"
"${COMPOSE[@]}" pull --quiet

say "Starting"
"${COMPOSE[@]}" up -d --remove-orphans

say "Waiting until the API, the panel and the database answer"
for _ in $(seq 1 60); do
  if "${COMPOSE[@]}" exec -T api curl -fsS -m 4 http://localhost:8000/ready >/dev/null 2>&1 \
     && "${COMPOSE[@]}" exec -T admin wget -q -O /dev/null -T 4 "http://127.0.0.1:3000/api/health?deep=1" >/dev/null 2>&1; then
    healthy=yes; break
  fi
  sleep 4
done
if [ -z "${healthy:-}" ]; then
  "${COMPOSE[@]}" ps
  "${COMPOSE[@]}" logs --tail=40 api admin
  echo "Not healthy after four minutes." >&2
  exit 1
fi

say "Healthy. Version: $("${COMPOSE[@]}" exec -T api curl -fsS -m 4 http://localhost:8000/health)"

# the first administrator was created from .env at the first start: prove that password works, then keep it out of the file
FIRST_ADMIN="$(env_get BOOTSTRAP_ADMIN_EMAIL)"
FIRST_PASSWORD="$(env_get BOOTSTRAP_ADMIN_PASSWORD)"
if [ -n "$FIRST_PASSWORD" ] && [ -n "$FIRST_ADMIN" ]; then
  if "${COMPOSE[@]}" exec -T api curl -fsS -m 10 -X POST http://localhost:8000/api/v1/auth/login -H 'content-type: application/json'        -d "{\"identifier\":\"$FIRST_ADMIN\",\"password\":\"$FIRST_PASSWORD\"}" >/dev/null 2>&1; then
    sed -i 's/^BOOTSTRAP_ADMIN_PASSWORD=.*/# BOOTSTRAP_ADMIN_PASSWORD was removed after the first start/' .env
    echo "The first administrator ($FIRST_ADMIN) can sign in; the password was removed from .env."
  fi
fi

# keep the disk tidy: only OUR old images (the newest three of each are kept; images in use are never removed)
for image in "$(env_get API_IMAGE)" "$(env_get ADMIN_IMAGE)"; do
  docker image ls --format '{{.ID}}' "$image" | awk '!seen[$0]++' | tail -n +4 | xargs -r docker image rm >/dev/null 2>&1 || true
done
"${COMPOSE[@]}" ps
