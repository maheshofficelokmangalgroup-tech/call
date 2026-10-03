#!/usr/bin/env bash
# Bring this server to a version of the system: get the matching files, pull the matching images, restart what changed, wait
# until it is healthy - and when the new version does not become healthy, go back to the one that was running.
#
#   bash deploy/shared/deploy.sh                     # the newest version on the main branch (image tag "latest")
#   bash deploy/shared/deploy.sh sha-1a2b3c4 <40-character commit id>     # exactly this version (what CI does)
#
# A GitHub token can be given on standard input (the CI does): it is used only to download the images, and is kept apart from
# the Docker login of the other projects on this server (DOCKER_CONFIG below).
# HEALTH_ROUNDS x HEALTH_PAUSE seconds is how long a version gets to become healthy (default 60 x 4 s = four minutes).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
cd "$HERE"
[ -f .env ] || { echo "No .env here: run setup.sh first." >&2; exit 1; }

TAG="${1:-}"
SHA="${2:-}"
HEALTH_ROUNDS="${HEALTH_ROUNDS:-60}"
HEALTH_PAUSE="${HEALTH_PAUSE:-4}"
CADDY_SETTLE="${CADDY_SETTLE:-4}"
env_get() { grep -E "^$1=" .env | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' || true; }
# a new line in .env: the file may not end with a newline, and the new line must never be glued to the last one
env_add() { [ -z "$(tail -c1 .env)" ] || echo >> .env; printf '%s\n' "$1" >> .env; }
say() { printf '\n==> %s\n' "$*"; }

# a server set up before the Redis password existed gets one (once; it only has to match between Redis and the API, both read .env)
if [ -z "$(env_get REDIS_PASSWORD)" ]; then
  env_add "REDIS_PASSWORD=$(openssl rand -base64 96 | tr -dc 'A-Za-z0-9' | cut -c1-40)"
  echo "Added REDIS_PASSWORD to .env."
fi

# our own Docker credentials: never touch the login the other projects on this server rely on
export DOCKER_CONFIG="$ROOT/.docker"
mkdir -p "$DOCKER_CONFIG"
chmod 700 "$DOCKER_CONFIG"

TOKEN=""
if [ ! -t 0 ]; then IFS= read -r -t 5 TOKEN || true; fi
if [ -n "$TOKEN" ]; then
  printf '%s' "$TOKEN" | docker login ghcr.io -u "${GITHUB_ACTOR:-ci}" --password-stdin >/dev/null
fi

# what runs now: the way back when the new version does not become healthy
PREVIOUS_SHA=""
if [ -d "$ROOT/.git" ]; then PREVIOUS_SHA="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || true)"; fi
PREVIOUS_TAG="$(env_get IMAGE_TAG)"

if [ -n "$SHA" ] && [ -d "$ROOT/.git" ]; then
  say "Files for commit ${SHA:0:7}"
  git -C "$ROOT" fetch --quiet origin
  git -C "$ROOT" checkout --quiet --detach "$SHA"
fi

# the version to run goes into .env, so a later plain `docker compose up -d` keeps it
if [ -n "$TAG" ]; then
  if grep -q '^IMAGE_TAG=' .env; then sed -i "s|^IMAGE_TAG=.*|IMAGE_TAG=$TAG|" .env; else env_add "IMAGE_TAG=$TAG"; fi
fi
COMPOSE=(docker compose --env-file .env)

say "Checking the files"
"${COMPOSE[@]}" config -q
# the certificate folder belongs to root (it holds the private key), so ask certbot instead of looking into it
certificates="$(docker run --rm -v "$PWD/letsencrypt:/etc/letsencrypt" certbot/certbot certificates 2>/dev/null || true)"
# (a here-string, not a pipe: "grep -q" ends at the first match, and with pipefail the writer's broken pipe would count as a failure)
grep -q "Certificate Name: $(env_get PUBLIC_HOST)" <<<"$certificates" || { echo "No certificate yet: run issue-cert.sh first." >&2; exit 1; }

say "Downloading the images (tag $(env_get IMAGE_TAG))"
"${COMPOSE[@]}" pull --quiet

wait_healthy() {
  local _
  for _ in $(seq 1 "$HEALTH_ROUNDS"); do
    if "${COMPOSE[@]}" exec -T api curl -fsS -m 4 http://localhost:8000/ready >/dev/null 2>&1 \
       && "${COMPOSE[@]}" exec -T admin wget -q -O /dev/null -T 4 "http://127.0.0.1:3000/api/health?deep=1" >/dev/null 2>&1; then
      return 0
    fi
    sleep "$HEALTH_PAUSE"
  done
  return 1
}

show_trouble() {
  "${COMPOSE[@]}" ps || true
  "${COMPOSE[@]}" logs --tail=40 api admin caddy || true
}

# The front door. Caddy reads its Caddyfile once, when its container starts, and the file is mounted into the container as ONE file:
# `git checkout` replaces it with a new file that the running container never sees (it keeps the old one), and Compose finds nothing to
# recreate (the Caddy service itself did not change). So a changed Caddyfile does nothing until Caddy's container is created again -
# which is done here at every deploy (the API and the panel are restarted anyway), after the file has been tried in a throw-away
# container: a file that does not load would take the front door down while the API and the panel look healthy.
CADDY_RECREATED=""
front_door() {
  local result
  if ! result="$("${COMPOSE[@]}" run --rm --no-deps -T caddy caddy validate --config /etc/caddy/Caddyfile 2>&1)"; then
    printf '%s\n' "$result" >&2
    return 1
  fi
  CADDY_RECREATED=yes
  "${COMPOSE[@]}" up -d --force-recreate --no-deps caddy || return 1
  sleep "$CADDY_SETTLE"
  # (a here-string, not a pipe: see above)
  grep -qx caddy <<<"$("${COMPOSE[@]}" ps --status running --services 2>/dev/null || true)"
}

# The new version is not healthy: put the one that was running back (its images are still on this server: the newest three of each
# are kept). The database only ever gets columns and indexes added, which the older version does not mind.
go_back() {
  if [ -z "$SHA" ] || [ -z "$PREVIOUS_SHA" ] || [ "$PREVIOUS_SHA" = "$SHA" ] || [[ "$PREVIOUS_TAG" != sha-* ]]; then
    echo "There is no earlier version to go back to." >&2
    return 0
  fi
  say "Going back to the version that was running (${PREVIOUS_SHA:0:7}, image tag $PREVIOUS_TAG)"
  git -C "$ROOT" checkout --quiet --detach "$PREVIOUS_SHA"
  sed -i "s|^IMAGE_TAG=.*|IMAGE_TAG=$PREVIOUS_TAG|" .env
  "${COMPOSE[@]}" up -d --remove-orphans
  if wait_healthy; then
    # (Caddy too, when it was restarted with the Caddyfile of the new version: it gets the one that belongs to the earlier version)
    if [ -n "$CADDY_RECREATED" ] && ! front_door; then
      echo "Caddy could not be restarted with the earlier Caddyfile: look at the logs." >&2
    fi
    echo "The earlier version is running again. The new version (${SHA:0:7}) was NOT put into service." >&2
  else
    show_trouble
    echo "The earlier version is not healthy either: look at the logs above." >&2
  fi
}

say "Starting"
"${COMPOSE[@]}" up -d --remove-orphans

say "Waiting until the API, the panel and the database answer"
if ! wait_healthy; then
  show_trouble
  echo "Not healthy after $((HEALTH_ROUNDS * HEALTH_PAUSE)) seconds." >&2
  go_back
  exit 1
fi

say "Healthy. Version: $("${COMPOSE[@]}" exec -T api curl -fsS -m 4 http://localhost:8000/health)"

say "Restarting the front door with the Caddyfile of this version"
if ! front_door; then
  show_trouble
  echo "Caddy did not accept the Caddyfile of this version, or did not start with it." >&2
  go_back
  exit 1
fi

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
