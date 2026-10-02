#!/usr/bin/env bash
# Get the HTTPS certificate for PUBLIC_HOST from Let's Encrypt (free).
#
# This server's ports 80 and 443 belong to other projects, so the certificate is requested in certbot's "webroot" way: certbot
# writes a one-time token file into the folder (CERTBOT_WEBROOT_VOLUME) that the server's existing web server already serves
# under /.well-known/acme-challenge/ for every host name, Let's Encrypt fetches it over port 80, and the file is deleted again.
#
#   bash issue-cert.sh --dry-run     # a practice run against Let's Encrypt's test server: proves the path works, keeps nothing
#   bash issue-cert.sh               # the real certificate (kept in ./letsencrypt, valid 90 days, renewed by renew-cert.sh)
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
[ -f .env ] || { echo "No .env here: run setup.sh first." >&2; exit 1; }
env_get() { grep -E "^$1=" .env | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }

HOST="$(env_get PUBLIC_HOST)"
EMAIL="$(env_get ACME_EMAIL)"
VOLUME="$(env_get CERTBOT_WEBROOT_VOLUME)"
[ -n "$HOST" ] && [ -n "$EMAIL" ] && [ -n "$VOLUME" ] || { echo "PUBLIC_HOST, ACME_EMAIL and CERTBOT_WEBROOT_VOLUME must be set in .env" >&2; exit 1; }
docker volume inspect "$VOLUME" >/dev/null 2>&1 || { echo "The Docker volume '$VOLUME' does not exist (it is the folder the existing web server serves /.well-known/acme-challenge/ from)." >&2; exit 1; }

mkdir -p letsencrypt
extra=()
[ "${1:-}" = "--dry-run" ] && extra+=(--dry-run)

docker run --rm \
  -v "$PWD/letsencrypt:/etc/letsencrypt" \
  -v "$VOLUME:/var/www/certbot" \
  certbot/certbot certonly --webroot -w /var/www/certbot -d "$HOST" \
  --email "$EMAIL" --agree-tos --no-eff-email --non-interactive --keep-until-expiring "${extra[@]}"
