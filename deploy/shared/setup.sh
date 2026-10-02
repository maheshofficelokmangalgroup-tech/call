#!/usr/bin/env bash
# First-time preparation of this folder on the server: creates the settings file (.env) with fresh secrets and fetches the
# certificate bundle that lets the API verify the RDS server. Safe to run again: an existing .env is never overwritten.
#
#   PUBLIC_HOST=13-205-79-72.sslip.io HTTPS_PORT=8445 ACME_EMAIL=you@example.com ADMIN_EMAIL=you@example.com \
#   DATABASE_URL='mysql+pymysql://calling_app:<password>@<rds-endpoint>:3306/Calling_db?charset=utf8mb4&ssl_ca=/certs/rds-ca.pem' \
#   API_IMAGE=ghcr.io/<owner>/<repo>/api ADMIN_IMAGE=ghcr.io/<owner>/<repo>/admin bash setup.sh
#
# Then:  bash issue-cert.sh --dry-run && bash issue-cert.sh && bash deploy.sh
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

random_alnum() { local s; s="$(openssl rand -base64 96 | tr -dc 'A-Za-z0-9')"; printf '%s' "${s:0:$1}"; }
random_password() {
  local p
  while :; do
    p="$(random_alnum 14)"
    [[ "$p" =~ [0-9] && "$p" =~ [a-z] && "$p" =~ [A-Z] ]] && break
  done
  printf '%s' "$p"
}

mkdir -p certs letsencrypt
if [ ! -s certs/rds-global-bundle.pem ]; then
  curl -fsSL https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem -o certs/rds-global-bundle.pem
  echo "Downloaded the RDS certificate bundle."
fi

if [ -f .env ]; then
  echo ".env already exists - left as it is."
  exit 0
fi

: "${PUBLIC_HOST:?set PUBLIC_HOST}" "${ACME_EMAIL:?set ACME_EMAIL}" "${ADMIN_EMAIL:?set ADMIN_EMAIL}"
: "${DATABASE_URL:?set DATABASE_URL}" "${API_IMAGE:?set API_IMAGE}" "${ADMIN_IMAGE:?set ADMIN_IMAGE}"
PORT_HTTPS="${HTTPS_PORT:-8445}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-$(random_password)}"

umask 077
cat > .env <<EOF
# Created by setup.sh on $(date -u +%Y-%m-%dT%H:%MZ). Holds the secrets of the system: keep it private, never commit it.
PUBLIC_HOST=$PUBLIC_HOST
HTTPS_PORT=$PORT_HTTPS
PUBLIC_URL=https://$PUBLIC_HOST:$PORT_HTTPS
ACME_EMAIL=$ACME_EMAIL
CERTBOT_WEBROOT_VOLUME=${CERTBOT_WEBROOT_VOLUME:-app_certbot_webroot}

API_IMAGE=$API_IMAGE
ADMIN_IMAGE=$ADMIN_IMAGE
IMAGE_TAG=${IMAGE_TAG:-latest}

DATABASE_URL=$DATABASE_URL

APP_TIMEZONE=${APP_TIMEZONE:-Asia/Kolkata}
DEFAULT_PHONE_REGION=${DEFAULT_PHONE_REGION:-IN}
LOG_LEVEL=INFO
JWT_SECRET=$(random_alnum 64)
REDIS_PASSWORD=$(random_alnum 40)
JWT_ACCESS_TTL_MINUTES=15
JWT_REFRESH_TTL_DAYS=30
STORAGE_BACKEND=local
MAX_RECORDING_MB=100

BOOTSTRAP_ADMIN_EMAIL=$ADMIN_EMAIL
BOOTSTRAP_ADMIN_PASSWORD=$ADMIN_PASSWORD
EOF
chmod 600 .env
echo ".env created."
echo "FIRST_ADMIN_PASSWORD=$ADMIN_PASSWORD   (shown once; it is removed from .env after the first start)"
