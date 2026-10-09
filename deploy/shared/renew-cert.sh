#!/usr/bin/env bash
# Renew the certificate when it has less than 30 days left, and load it into Caddy without any downtime.
# The "Certificate" workflow runs this every week (and you can run it by hand).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
[ -f .env ] || { echo "No .env here." >&2; exit 1; }
env_get() { grep -E "^$1=" .env | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }

# A certificate that another project keeps renewed (link-external-cert.sh): nothing to renew here. Caddy reads the files when it loads its
# settings, so a renewed certificate is only picked up by a reload - which has to be FORCED: an unchanged Caddyfile is otherwise "no change".
if [ -n "$(env_get EXTERNAL_CERT_VOLUME)" ]; then
  docker compose --env-file .env -f docker-compose.yml -f docker-compose.external-cert.yml exec -T caddy caddy reload --force --config /etc/caddy/Caddyfile
  echo "Caddy has loaded the certificate files again (the project that owns the certificate renews it)."
  exit 0
fi

VOLUME="$(env_get CERTBOT_WEBROOT_VOLUME)"
rm -f letsencrypt/.renewed

docker run --rm \
  -v "$PWD/letsencrypt:/etc/letsencrypt" \
  -v "$VOLUME:/var/www/certbot" \
  certbot/certbot renew --webroot -w /var/www/certbot --non-interactive --deploy-hook "touch /etc/letsencrypt/.renewed"

if [ -f letsencrypt/.renewed ]; then
  rm -f letsencrypt/.renewed
  docker compose --env-file .env exec -T caddy caddy reload --config /etc/caddy/Caddyfile
  echo "The certificate was renewed and loaded."
else
  echo "The certificate does not need renewing yet."
fi
docker run --rm -v "$PWD/letsencrypt:/etc/letsencrypt" certbot/certbot certificates 2>/dev/null | grep -E "Domains|Expiry" || true
