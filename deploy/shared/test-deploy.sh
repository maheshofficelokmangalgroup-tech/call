#!/usr/bin/env bash
# Tests deploy.sh without Docker and without a server: a pretend `docker` records what it is asked and says "healthy" only for the
# image tag it was told is good. What is checked is what must never go wrong on the real server:
#   * a .env without a final newline is not corrupted when a line is added to it
#   * a healthy new version is put into service
#   * a new version that does not become healthy is replaced by the one that was running (files and image tag), and the run FAILS
#     (so the pipeline shows red) while the service is up again
#   * when there is nothing to go back to, nothing is touched
#
#   bash deploy/shared/test-deploy.sh
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
export FAKE_LOG="$WORK/docker.log"
export FAKE_HOST="calling.example.test"
export HEALTH_ROUNDS=2 HEALTH_PAUSE=0

fail() { echo "FAIL: $*" >&2; echo "--- docker calls ---" >&2; cat "$FAKE_LOG" >&2 2>/dev/null || true; exit 1; }

# a pretend docker (answers according to FAKE_HEALTHY_TAG, which it compares with the IMAGE_TAG in .env)
mkdir -p "$WORK/bin"
cat > "$WORK/bin/docker" <<'EOS'
#!/usr/bin/env bash
echo "docker $*" >> "$FAKE_LOG"
case "$*" in
  *"certbot/certbot certificates"*) echo "Certificate Name: $FAKE_HOST" ;;
  *"exec -T api curl"*"/ready"*)
    tag="$(grep -E '^IMAGE_TAG=' .env | cut -d= -f2-)"
    [ "$tag" = "$FAKE_HEALTHY_TAG" ] || exit 1 ;;
  *"exec -T api curl"*"/health"*) echo '{"status":"ok"}' ;;
esac
exit 0
EOS
chmod +x "$WORK/bin/docker"
export PATH="$WORK/bin:$PATH"

# a git server with two commits, and the clone the script works in
git init -q --bare "$WORK/origin.git"
git clone -q "$WORK/origin.git" "$WORK/clone" 2>/dev/null
cd "$WORK/clone"
git config user.email test@example.com
git config user.name test
mkdir -p deploy/shared
tr -d '\r' < "$SRC/deploy.sh" > deploy/shared/deploy.sh   # (a checkout on Windows has CRLF line endings)
echo one > version.txt; git add -A; git commit -q -m one; OLD="$(git rev-parse HEAD)"
echo two > version.txt; git commit -qam two;               NEW="$(git rev-parse HEAD)"
git push -q origin HEAD:refs/heads/main 2>/dev/null
OLD_TAG="sha-${OLD:0:7}"; NEW_TAG="sha-${NEW:0:7}"

fresh_server() { # $1 = the image tag that is running now; the file deliberately has no newline at the end
  : > "$FAKE_LOG"
  git checkout -q --detach "$OLD"
  printf 'PUBLIC_HOST=%s\nIMAGE_TAG=%s\nAPI_IMAGE=calling-api\nADMIN_IMAGE=calling-admin' "$FAKE_HOST" "$1" > deploy/shared/.env
}
deploy() { ( cd deploy/shared && bash deploy.sh "$@" < /dev/null ) > "$WORK/out.txt" 2>&1; }
tag_now() { grep -E '^IMAGE_TAG=' deploy/shared/.env | cut -d= -f2-; }
ups() { grep -c 'compose .*up -d' "$FAKE_LOG" || true; }

# 1. a healthy new version is put into service; .env keeps its lines and gets a password on a line of its own
fresh_server "$OLD_TAG"; export FAKE_HEALTHY_TAG="$NEW_TAG"
deploy "$NEW_TAG" "$NEW" || fail "a healthy version must deploy (exit $?)"
[ "$(tag_now)" = "$NEW_TAG" ] || fail "IMAGE_TAG should be $NEW_TAG, is $(tag_now)"
[ "$(git rev-parse HEAD)" = "$NEW" ] || fail "the files should be at the new commit"
grep -qx 'ADMIN_IMAGE=calling-admin' deploy/shared/.env || fail "the last line of .env was damaged (a new line glued to it)"
grep -Eq '^REDIS_PASSWORD=[A-Za-z0-9]{30,}$' deploy/shared/.env || fail "REDIS_PASSWORD missing or not on a line of its own"
[ "$(ups)" = 1 ] || fail "one 'up' expected, got $(ups)"
echo "ok 1: a healthy new version is put into service, .env is intact"

# 2. the new version never becomes healthy, the old one does: back to the old one, and the run fails
fresh_server "$OLD_TAG"; export FAKE_HEALTHY_TAG="$OLD_TAG"
if deploy "$NEW_TAG" "$NEW"; then fail "an unhealthy new version must make the run fail"; fi
[ "$(tag_now)" = "$OLD_TAG" ] || fail "the old image tag should be back, is $(tag_now)"
[ "$(git rev-parse HEAD)" = "$OLD" ] || fail "the old files should be back"
[ "$(ups)" = 2 ] || fail "two 'up' expected (new, then back), got $(ups)"
grep -q "earlier version is running again" "$WORK/out.txt" || fail "the output should say the earlier version is running again"
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

# 5. a file that is not understood by compose stops the deploy before anything is changed
fresh_server "$OLD_TAG"
cat > "$WORK/bin/docker" <<'EOS'
#!/usr/bin/env bash
echo "docker $*" >> "$FAKE_LOG"
case "$*" in *" config -q"*) exit 1 ;; esac
exit 0
EOS
if deploy "$NEW_TAG" "$NEW"; then fail "a broken compose file must stop the deploy"; fi
[ "$(ups)" = 0 ] || fail "nothing may be started when the files are wrong"
echo "ok 5: a broken compose file stops the deploy before anything is started"
echo "all deploy script checks passed"
