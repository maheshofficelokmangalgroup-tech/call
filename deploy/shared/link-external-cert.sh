#!/usr/bin/env bash
# Use the HTTPS certificate that another project on this server already keeps for PUBLIC_HOST - instead of getting one of our own.
#
# When to use it: ports 80 and 443 belong to another project whose Caddy holds (and renews) a certificate for the SAME host name. A new
# certificate from Let's Encrypt needs port 80 or 443 (issue-cert.sh), so there is no way to get one without touching that project. A
# certificate belongs to a host name, not to a port: the same files are valid on port 8445 too.
#
#   EXTERNAL_CERT_VOLUME=lmf_caddy_data bash link-external-cert.sh
#
# Optional: EXTERNAL_CERT_PATH (default: caddy/certificates/acme-v02.api.letsencrypt.org-directory/<PUBLIC_HOST> - where Caddy keeps it).
#
# What it does (nothing of the other project is changed - it is only LOOKED at, through a read-only mount):
#   1. checks that the certificate and its key are in that volume;
#   2. makes letsencrypt/live/<host>/fullchain.pem and privkey.pem point at them (the paths are those INSIDE Caddy's container, where
#      docker-compose.external-cert.yml mounts the folder read-only);
#   3. writes EXTERNAL_CERT_VOLUME, EXTERNAL_CERT_PATH and COMPOSE_FILE into .env, which makes deploy.sh and renew-cert.sh use that file.
# Caddy reads the files when it loads its settings: after the other project renews, renew-cert.sh (the weekly Certificate workflow) reloads Caddy.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
[ -f .env ] || { echo "No .env here: run setup.sh first." >&2; exit 1; }
env_get() { grep -E "^$1=" .env | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' || true; }
env_set() { # replace the line, or add it on a line of its own (the file may not end with a newline)
  if grep -q "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else { [ -z "$(tail -c1 .env)" ] || echo >> .env; printf '%s=%s\n' "$1" "$2" >> .env; }; fi
}

HOST="$(env_get PUBLIC_HOST)"
VOLUME="${EXTERNAL_CERT_VOLUME:?set EXTERNAL_CERT_VOLUME to the Docker volume with the Caddy data of the other project (docker volume ls)}"
SUB="${EXTERNAL_CERT_PATH:-caddy/certificates/acme-v02.api.letsencrypt.org-directory/$HOST}"
[ -n "$HOST" ] || { echo "PUBLIC_HOST is not set in .env" >&2; exit 1; }
[[ "$VOLUME" =~ ^[A-Za-z0-9_.-]+$ && "$SUB" =~ ^[A-Za-z0-9_./-]+$ && "$HOST" =~ ^[A-Za-z0-9.-]+$ ]] || { echo "Unsafe name." >&2; exit 1; }
docker volume inspect "$VOLUME" >/dev/null 2>&1 || { echo "The Docker volume '$VOLUME' does not exist." >&2; exit 1; }

# a read-only look: the two files must be there (their content is never shown)
docker run --rm --mount "type=volume,src=$VOLUME,dst=/x,readonly,volume-subpath=$SUB" alpine \
  sh -c "test -s '/x/$HOST.crt' && test -s '/x/$HOST.key'" \
  || { echo "No certificate for $HOST in '$VOLUME' at $SUB (expected $HOST.crt and $HOST.key)." >&2; exit 1; }

mkdir -p "letsencrypt/live/$HOST"
ln -sfn "/external-certs/$HOST.crt" "letsencrypt/live/$HOST/fullchain.pem"
ln -sfn "/external-certs/$HOST.key" "letsencrypt/live/$HOST/privkey.pem"

env_set EXTERNAL_CERT_VOLUME "$VOLUME"
env_set EXTERNAL_CERT_PATH "$SUB"
env_set COMPOSE_FILE "docker-compose.yml:docker-compose.external-cert.yml"
docker compose --env-file .env config -q
echo "Linked: $HOST uses the certificate in '$VOLUME' (read-only). Next: bash deploy.sh"
