#!/usr/bin/env bash
# Tests deploy.sh without Docker and without a server: a pretend `docker` records what it is asked and says "healthy" only for the
# image tag it was told is good. What is checked is what must never go wrong on the real server:
#   * a .env without a final newline is not corrupted when a line is added to it
#   * a healthy new version is put into service
#   * a new version that does not become healthy is replaced by the one that was running (files and image tag), and the run FAILS
#     (so the pipeline shows red) while the service is up again
#   * "the one that was running" is what the container runs, not what the files and .env say (an attempt that stopped early had
#     already moved those forward - this happened)
#   * when there is nothing to go back to, nothing is touched
#   * the front door: after a healthy deploy the Caddyfile is tried in a throw-away container and Caddy's container is created again
#     (a changed Caddyfile does nothing otherwise); a Caddyfile that does not load, or that Caddy does not start with, fails the run and
#     the earlier version is put back
#
#   bash deploy/shared/test-deploy.sh
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
export FAKE_LOG="$WORK/docker.log"
export FAKE_STATE="$WORK"
export FAKE_HOST="calling.example.test"
export HEALTH_ROUNDS=2 HEALTH_PAUSE=0 CADDY_SETTLE=0

fail() { echo "FAIL: $*" >&2; echo "--- docker calls ---" >&2; cat "$FAKE_LOG" >&2 2>/dev/null || true; exit 1; }

# a pretend docker (answers according to FAKE_HEALTHY_TAG, which it compares with the IMAGE_TAG in .env; "*" = every version is healthy).
# Caddy: "validate" fails for a Caddyfile that says BROKEN; a Caddyfile that says NOSTART loads but Caddy does not come up with it.
mkdir -p "$WORK/bin"
cat > "$WORK/bin/docker" <<'EOS'
#!/usr/bin/env bash
echo "docker $*" >> "$FAKE_LOG"
case "$*" in
  *"certbot/certbot certificates"*) echo "Certificate Name: $FAKE_HOST" ;;
  *"exec -T api curl"*"/ready"*)
    tag="$(grep -E '^IMAGE_TAG=' .env | cut -d= -f2-)"
    [ "$FAKE_HEALTHY_TAG" = "*" ] || [ "$tag" = "$FAKE_HEALTHY_TAG" ] || exit 1 ;;
  *"exec -T api curl"*"/health"*) echo '{"status":"ok"}' ;;
  *"ps --filter"*"label=com.docker.compose.service=api"*) echo "ghcr.io/example/call/api:$FAKE_RUNNING_TAG" ;;
  *"caddy validate"*) if grep -q BROKEN Caddyfile; then echo "Error: adapting config using caddyfile: the Caddyfile is BROKEN" >&2; exit 1; fi ;;
  *"up -d --force-recreate --no-deps caddy"*) if grep -q NOSTART Caddyfile; then rm -f "$FAKE_STATE/caddy_up"; else : > "$FAKE_STATE/caddy_up"; fi ;;
  *"ps --status running --services"*) if [ -f "$FAKE_STATE/caddy_up" ]; then echo caddy; fi ;;
esac
exit 0
EOS
chmod +x "$WORK/bin/docker"
export PATH="$WORK/bin:$PATH"

# a git server with four commits, and the clone the script works in. Every commit has its own Caddyfile.
git init -q --bare "$WORK/origin.git"
git clone -q "$WORK/origin.git" "$WORK/clone" 2>/dev/null
cd "$WORK/clone"
git config user.email test@example.com
git config user.name test
mkdir -p deploy/shared
tr -d '\r' < "$SRC/deploy.sh" > deploy/shared/deploy.sh   # (a checkout on Windows has CRLF line endings)
echo "old front door" > deploy/shared/Caddyfile
echo one > version.txt; git add -A; git commit -q -m one; OLD="$(git rev-parse HEAD)"
echo two > version.txt; echo "new front door" > deploy/shared/Caddyfile;      git commit -qam two;   NEW="$(git rev-parse HEAD)"
echo three > version.txt; echo "BROKEN front door" > deploy/shared/Caddyfile; git commit -qam three; BAD="$(git rev-parse HEAD)"
echo four > version.txt; echo "NOSTART front door" > deploy/shared/Caddyfile; git commit -qam four;  STUCK="$(git rev-parse HEAD)"
git push -q origin HEAD:refs/heads/main 2>/dev/null
OLD_TAG="sha-${OLD:0:7}"; NEW_TAG="sha-${NEW:0:7}"; BAD_TAG="sha-${BAD:0:7}"; STUCK_TAG="sha-${STUCK:0:7}"

fresh_server() { # $1 = the image tag that is running now; the file deliberately has no newline at the end
  : > "$FAKE_LOG"
  export FAKE_RUNNING_TAG="$1"
  git checkout -q --detach "$OLD"
  printf 'PUBLIC_HOST=%s\nIMAGE_TAG=%s\nAPI_IMAGE=calling-api\nADMIN_IMAGE=calling-admin' "$FAKE_HOST" "$1" > deploy/shared/.env
  : > "$FAKE_STATE/caddy_up"  # Caddy is running (with the old Caddyfile)
}
deploy() { ( cd deploy/shared && bash deploy.sh "$@" < /dev/null ) > "$WORK/out.txt" 2>&1; }
tag_now() { grep -E '^IMAGE_TAG=' deploy/shared/.env | cut -d= -f2-; }
ups() { grep -c 'compose .*up -d --remove-orphans' "$FAKE_LOG" || true; }
recreates() { grep -c 'up -d --force-recreate --no-deps caddy' "$FAKE_LOG" || true; }
validations() { grep -c 'caddy validate' "$FAKE_LOG" || true; }
line_of() { grep -n "$1" "$FAKE_LOG" | head -1 | cut -d: -f1; }

# 1. a healthy new version is put into service; .env keeps its lines and gets a password on a line of its own
fresh_server "$OLD_TAG"; export FAKE_HEALTHY_TAG="$NEW_TAG"
deploy "$NEW_TAG" "$NEW" || fail "a healthy version must deploy (exit $?)"
[ "$(tag_now)" = "$NEW_TAG" ] || fail "IMAGE_TAG should be $NEW_TAG, is $(tag_now)"
[ "$(git rev-parse HEAD)" = "$NEW" ] || fail "the files should be at the new commit"
grep -qx 'ADMIN_IMAGE=calling-admin' deploy/shared/.env || fail "the last line of .env was damaged (a new line glued to it)"
grep -Eq '^REDIS_PASSWORD=[A-Za-z0-9]{30,}$' deploy/shared/.env || fail "REDIS_PASSWORD missing or not on a line of its own"
[ "$(ups)" = 1 ] || fail "one 'up' expected, got $(ups)"
# the front door: the Caddyfile is tried in a throw-away container, then ONLY Caddy's container is created again - both after the new
# version is up (and healthy), never before
[ "$(validations)" = 1 ] || fail "the Caddyfile must be tried once, got $(validations)"
[ "$(recreates)" = 1 ] || fail "Caddy's container must be created again once, got $(recreates)"
[ "$(line_of 'up -d --remove-orphans')" -lt "$(line_of 'caddy validate')" ] || fail "the Caddyfile is tried only after the new version is up"
[ "$(line_of 'caddy validate')" -lt "$(line_of 'force-recreate')" ] || fail "the Caddyfile must be tried BEFORE Caddy is restarted with it"
[ -f "$WORK/caddy_up" ] || fail "Caddy should be running at the end"
echo "ok 1: a healthy new version is put into service, .env is intact, the front door is tried and restarted"

# 2. the new version never becomes healthy, the old one does: back to the old one, and the run fails
fresh_server "$OLD_TAG"; export FAKE_HEALTHY_TAG="$OLD_TAG"
if deploy "$NEW_TAG" "$NEW"; then fail "an unhealthy new version must make the run fail"; fi
[ "$(tag_now)" = "$OLD_TAG" ] || fail "the old image tag should be back, is $(tag_now)"
[ "$(git rev-parse HEAD)" = "$OLD" ] || fail "the old files should be back"
[ "$(ups)" = 2 ] || fail "two 'up' expected (new, then back), got $(ups)"
grep -q "earlier version is running again" "$WORK/out.txt" || fail "the output should say the earlier version is running again"
[ "$(recreates)" = 0 ] && [ "$(validations)" = 0 ] || fail "the front door must not be touched by a version that is not healthy"
echo "ok 2: an unhealthy new version is replaced by the one that was running, and the run fails"

# 3. nothing to go back to (the server ran 'latest'): the run fails and the old version is not pretended
fresh_server "latest"; export FAKE_HEALTHY_TAG="never"
if deploy "$NEW_TAG" "$NEW"; then fail "must fail"; fi
[ "$(ups)" = 1 ] || fail "no second 'up' expected when there is nothing to go back to, got $(ups)"
grep -q "no earlier version" "$WORK/out.txt" || fail "the output should say there is no earlier version"
echo "ok 3: nothing to go back to: nothing invented"

# 4. the same commit again, unhealthy: no 'going back' to itself
fresh_server "$NEW_TAG"; git checkout -q --detach "$NEW"; export FAKE_HEALTHY_TAG="never"
if deploy "$NEW_TAG" "$NEW"; then fail "must fail"; fi
[ "$(ups)" = 1 ] || fail "a version must not 'go back' to itself, got $(ups) up"
echo "ok 4: the same version is not 'gone back' to"

# 5. an attempt that stopped early had moved the files and .env to the new version, but the old one still RUNS: going back means that one
fresh_server "$OLD_TAG"; git checkout -q --detach "$NEW"; sed -i "s|^IMAGE_TAG=.*|IMAGE_TAG=$NEW_TAG|" deploy/shared/.env
export FAKE_RUNNING_TAG="$OLD_TAG" FAKE_HEALTHY_TAG="$OLD_TAG"
if deploy "$NEW_TAG" "$NEW"; then fail "an unhealthy new version must make the run fail"; fi
[ "$(tag_now)" = "$OLD_TAG" ] || fail "the RUNNING version's tag should be back, is $(tag_now)"
[ "$(git rev-parse HEAD)" = "$OLD" ] || fail "the RUNNING version's files should be back"
echo "ok 5: after an attempt that stopped early, going back means the version that really runs"

# 6. a file that is not understood by compose stops the deploy before anything is changed
fresh_server "$OLD_TAG"
cat > "$WORK/bin/docker" <<'EOS'
#!/usr/bin/env bash
echo "docker $*" >> "$FAKE_LOG"
case "$*" in *" config -q"*) exit 1 ;; esac
exit 0
EOS
if deploy "$NEW_TAG" "$NEW"; then fail "a broken compose file must stop the deploy"; fi
[ "$(ups)" = 0 ] || fail "nothing may be started when the files are wrong"
echo "ok 6: a broken compose file stops the deploy before anything is started"

# (the pretend docker of the first cases again)
cat > "$WORK/bin/docker" <<'EOS'
#!/usr/bin/env bash
echo "docker $*" >> "$FAKE_LOG"
case "$*" in
  *"certbot/certbot certificates"*) echo "Certificate Name: $FAKE_HOST" ;;
  *"exec -T api curl"*"/ready"*)
    tag="$(grep -E '^IMAGE_TAG=' .env | cut -d= -f2-)"
    [ "$FAKE_HEALTHY_TAG" = "*" ] || [ "$tag" = "$FAKE_HEALTHY_TAG" ] || exit 1 ;;
  *"exec -T api curl"*"/health"*) echo '{"status":"ok"}' ;;
  *"ps --filter"*"label=com.docker.compose.service=api"*) echo "ghcr.io/example/call/api:$FAKE_RUNNING_TAG" ;;
  *"caddy validate"*) if grep -q BROKEN Caddyfile; then echo "Error: adapting config using caddyfile: the Caddyfile is BROKEN" >&2; exit 1; fi ;;
  *"up -d --force-recreate --no-deps caddy"*) if grep -q NOSTART Caddyfile; then rm -f "$FAKE_STATE/caddy_up"; else : > "$FAKE_STATE/caddy_up"; fi ;;
  *"ps --status running --services"*) if [ -f "$FAKE_STATE/caddy_up" ]; then echo caddy; fi ;;
esac
exit 0
EOS

# 7. everything is healthy, but Caddy cannot load the Caddyfile of the new version: Caddy is NOT restarted (it keeps the working
#    settings it has), the run fails, and the earlier version is put back
fresh_server "$OLD_TAG"; export FAKE_HEALTHY_TAG="*"
if deploy "$BAD_TAG" "$BAD"; then fail "a Caddyfile that does not load must make the run fail"; fi
grep -q "did not accept the Caddyfile" "$WORK/out.txt" || fail "the output should say that Caddy did not accept the Caddyfile"
grep -q "BROKEN" "$WORK/out.txt" || fail "the reason Caddy gave should be shown"
[ "$(recreates)" = 0 ] || fail "Caddy must NOT be restarted with a Caddyfile that does not load, got $(recreates) restarts"
[ "$(tag_now)" = "$OLD_TAG" ] && [ "$(git rev-parse HEAD)" = "$OLD" ] || fail "the earlier version (files and image tag) should be back"
[ "$(ups)" = 2 ] || fail "two 'up' expected (new, then back), got $(ups)"
[ -f "$WORK/caddy_up" ] || fail "Caddy must still be running"
grep -q "earlier version is running again" "$WORK/out.txt" || fail "the output should say the earlier version is running again"
echo "ok 7: a Caddyfile that does not load: Caddy keeps what it has, the run fails, the earlier version is back"

# 8. the Caddyfile loads but Caddy does not come up with it: the run fails, the earlier version is put back, and Caddy is restarted
#    with the Caddyfile of the earlier version
fresh_server "$OLD_TAG"; export FAKE_HEALTHY_TAG="*"
if deploy "$STUCK_TAG" "$STUCK"; then fail "a Caddy that does not start must make the run fail"; fi
grep -q "did not accept the Caddyfile of this version, or did not start with it" "$WORK/out.txt" || fail "the output should say that Caddy did not start"
[ "$(recreates)" = 2 ] || fail "Caddy should be restarted twice (with the new Caddyfile, then with the earlier one), got $(recreates)"
[ "$(git rev-parse HEAD)" = "$OLD" ] && [ "$(tag_now)" = "$OLD_TAG" ] || fail "the earlier version (files and image tag) should be back"
[ -f "$WORK/caddy_up" ] || fail "Caddy must be running again, with the Caddyfile of the earlier version"
grep -q "earlier version is running again" "$WORK/out.txt" || fail "the output should say the earlier version is running again"
echo "ok 8: Caddy does not start with the new Caddyfile: the earlier version AND its Caddyfile are put back"
echo "all deploy script checks passed"
