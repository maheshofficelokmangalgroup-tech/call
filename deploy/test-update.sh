#!/usr/bin/env bash
# Tests deploy/update.sh without Docker and without a server: a pretend `docker` records what it is asked and says "healthy".
#   * after the new version is healthy, the Caddyfile is tried in a throw-away container and ONLY Caddy's container is created again
#     (a changed Caddyfile does nothing otherwise: it is mounted as one file that `git pull` replaces)
#   * a Caddyfile that does not load: Caddy is not restarted (it keeps the working settings), and the update says it is not complete
#
#   bash deploy/test-update.sh
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
export FAKE_LOG="$WORK/docker.log"
fail() { echo "FAIL: $*" >&2; echo "--- docker calls ---" >&2; cat "$FAKE_LOG" >&2 2>/dev/null || true; exit 1; }

mkdir -p "$WORK/bin" "$WORK/repo/deploy"
cat > "$WORK/bin/docker" <<'EOS'
#!/usr/bin/env bash
echo "docker $*" >> "$FAKE_LOG"
case "$*" in
  *"caddy validate"*) if [ -n "${FAKE_BAD_CADDYFILE:-}" ]; then echo "Error: adapting config using caddyfile: the Caddyfile is BROKEN" >&2; exit 1; fi ;;
  *"curl"*"/health"*) echo '{"status":"ok","version":"9.9.9"}' ;;
esac
exit 0
EOS
chmod +x "$WORK/bin/docker"
export PATH="$WORK/bin:$PATH"

tr -d '\r' < "$SRC/update.sh" > "$WORK/repo/deploy/update.sh"   # (a checkout on Windows has CRLF line endings)
printf '#!/usr/bin/env bash\nexit 0\n' > "$WORK/repo/deploy/backup.sh"
printf 'REDIS_PASSWORD=already-there\n' > "$WORK/repo/.env.production"
update() { : > "$FAKE_LOG"; ( cd "$WORK/repo" && bash deploy/update.sh ) > "$WORK/out.txt" 2>&1; }
count() { grep -c "$1" "$FAKE_LOG" || true; }
line_of() { grep -n "$1" "$FAKE_LOG" | head -1 | cut -d: -f1; }

# 1. a healthy update: the Caddyfile is tried, then only Caddy is created again - after the new version is up
unset FAKE_BAD_CADDYFILE
update || fail "a healthy update must succeed"
grep -q "Updated. Running version: 9.9.9" "$WORK/out.txt" || fail "the update should say it is done"
[ "$(count 'caddy validate')" = 1 ] || fail "the Caddyfile must be tried once, got $(count 'caddy validate')"
[ "$(count 'up -d --force-recreate --no-deps caddy')" = 1 ] || fail "Caddy's container must be created again once"
[ "$(line_of 'up -d --build')" -lt "$(line_of 'caddy validate')" ] && [ "$(line_of 'caddy validate')" -lt "$(line_of 'force-recreate')" ] || fail "order: the new version up, the Caddyfile tried, then Caddy restarted"
echo "ok 1: a healthy update tries the Caddyfile and restarts only Caddy"

# 2. a Caddyfile that does not load: Caddy keeps running with the one it has, and the update does not pretend to be complete
export FAKE_BAD_CADDYFILE=1
if update; then fail "a Caddyfile that does not load must make the update fail"; fi
grep -q "BROKEN" "$WORK/out.txt" || fail "the reason Caddy gave should be shown"
grep -q "keeps running with the one it had" "$WORK/out.txt" || fail "the output should say that Caddy keeps its settings"
[ "$(count 'force-recreate')" = 0 ] || fail "Caddy must NOT be restarted with a Caddyfile that does not load"
if grep -q "Updated. Running version" "$WORK/out.txt"; then fail "the update must not say it is done"; fi
echo "ok 2: a Caddyfile that does not load: Caddy is left alone and the update fails"
echo "all update script checks passed"
