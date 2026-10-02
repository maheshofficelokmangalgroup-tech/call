#!/usr/bin/env bash
# One-command installer for a fresh Ubuntu / Debian server.
#
#   git clone https://github.com/<owner>/call.git && cd call
#   sudo bash deploy/install.sh
#
# It asks two questions (the domain and the administrator's e-mail), then installs Docker, creates the secrets, starts the
# whole stack and prints the address and the first password. To skip the questions:
#   sudo DOMAIN=calling.example.com ADMIN_EMAIL=you@example.com bash deploy/install.sh
# Running it again later is safe: it keeps your settings and repairs / updates what is installed.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
ENV_FILE=".env.production"
COMPOSE=(docker compose -f docker-compose.prod.yml --env-file "$ENV_FILE")

say()  { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
note() { printf '    %s\n' "$*"; }
warn() { printf '\033[1;33m!!  %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

env_get() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' || true; }

random_alnum() { local s; s="$(openssl rand -base64 96 | tr -dc 'A-Za-z0-9')"; printf '%s' "${s:0:$1}"; }
random_password() {
  local p
  while :; do
    p="$(random_alnum 14)"
    [[ "$p" =~ [0-9] && "$p" =~ [a-z] && "$p" =~ [A-Z] ]] && break
  done
  printf '%s' "$p"
}

[ "$(id -u)" -eq 0 ] || die "Run this as root:  sudo bash deploy/install.sh"
[ -f docker-compose.prod.yml ] || die "Run this from the project folder (docker-compose.prod.yml was not found)."

# ------------------------------------------------------------------------------------------------------ the server
say "Checking the server"
if [ -r /etc/os-release ]; then
  . /etc/os-release
  case "${ID:-}" in
    ubuntu|debian) note "Operating system: ${PRETTY_NAME:-$ID}" ;;
    *) warn "This installer is made for Ubuntu or Debian (found: ${PRETTY_NAME:-unknown}). It may still work." ;;
  esac
fi
command -v openssl >/dev/null || { apt-get update -y >/dev/null && apt-get install -y openssl curl ca-certificates >/dev/null; }
command -v curl >/dev/null || apt-get install -y curl ca-certificates >/dev/null

mem_mb=$(awk '/MemTotal/ {printf "%d", $2/1024}' /proc/meminfo)
note "Memory: ${mem_mb} MB"
if [ "$mem_mb" -lt 1700 ] && [ -z "$(env_get ADMIN_IMAGE)" ]; then
  warn "Less than 2 GB of memory: building the panel on this server may run out of memory."
  warn "If the build fails, use the prebuilt images (see docs/DEPLOYMENT.md, 'Small servers')."
fi
if [ "$mem_mb" -lt 3500 ] && [ "$(swapon --show --noheadings | wc -l)" -eq 0 ]; then
  say "Adding 2 GB of swap space (this server has little memory)"
  fallocate -l 2G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
  chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

if ! command -v docker >/dev/null; then
  say "Installing Docker"
  curl -fsSL https://get.docker.com | sh
fi
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is missing. Install the 'docker-compose-plugin' package and run this again."
systemctl enable --now docker >/dev/null 2>&1 || true

# --------------------------------------------------------------------------------------------------- the settings
NEW_ADMIN_PASSWORD=""
if [ ! -f "$ENV_FILE" ]; then
  say "Settings"
  DOMAIN="${DOMAIN:-}"
  if [ -z "$DOMAIN" ] && [ -t 0 ]; then
    echo "    Which domain name points to this server (for example calling.example.com)?"
    echo "    Leave it empty to run on the office network without HTTPS (the phones must then be on the same network)."
    read -r -p "    Domain: " DOMAIN
  fi
  DOMAIN="$(printf '%s' "$DOMAIN" | tr 'A-Z' 'a-z' | sed -e 's#^https\?://##' -e 's#/.*$##' -e 's/[[:space:]]//g')"

  server_ip="$(curl -4 -fsS -m 6 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')"
  if [ -n "$DOMAIN" ]; then
    [[ "$DOMAIN" =~ ^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$ ]] || die "'$DOMAIN' does not look like a domain name."
    SITE_ADDRESS="$DOMAIN"; PUBLIC_URL="https://$DOMAIN"; COOKIE_SECURE=true
    resolved="$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk 'NR==1{print $1}')"
    if [ -z "$resolved" ]; then
      warn "$DOMAIN does not point anywhere yet. Create a DNS 'A' record for it with the value $server_ip."
      warn "The site will not get its HTTPS certificate until that record exists."
    elif [ "$resolved" != "$server_ip" ]; then
      warn "$DOMAIN points to $resolved but this server is $server_ip. The HTTPS certificate will fail until they match."
    else
      note "$DOMAIN points to this server ($server_ip). Good."
    fi
  else
    SITE_ADDRESS=":80"; PUBLIC_URL="http://$(hostname -I | awk '{print $1}')"; COOKIE_SECURE=false
    warn "No domain: the site will use plain http at $PUBLIC_URL (office network only)."
  fi

  ADMIN_EMAIL="${ADMIN_EMAIL:-}"
  if [ -z "$ADMIN_EMAIL" ] && [ -t 0 ]; then
    read -r -p "    E-mail address of the administrator (used to sign in): " ADMIN_EMAIL
  fi
  [[ "$ADMIN_EMAIL" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]] || die "A valid administrator e-mail is needed (set ADMIN_EMAIL=...)."
  ADMIN_EMAIL="$(printf '%s' "$ADMIN_EMAIL" | tr 'A-Z' 'a-z')"

  NEW_ADMIN_PASSWORD="${ADMIN_PASSWORD:-$(random_password)}"

  # the link to the newest APK, taken from this repository's address (it is added to the WhatsApp message for new employees)
  APP_DOWNLOAD_URL="${APP_DOWNLOAD_URL:-}"
  if [ -z "$APP_DOWNLOAD_URL" ]; then
    origin="$(git config --get remote.origin.url 2>/dev/null || true)"
    if [[ "$origin" =~ github\.com[:/]([^/]+/[^/]+)$ ]]; then
      APP_DOWNLOAD_URL="https://github.com/${BASH_REMATCH[1]%.git}/releases/latest/download/EmployeeCalling.apk"
    fi
  fi
  umask 077
  cat > "$ENV_FILE" <<EOF
# Created by deploy/install.sh on $(date -u +%Y-%m-%dT%H:%MZ). Keep this file private; it holds the secrets of the system.
SITE_ADDRESS=$SITE_ADDRESS
PUBLIC_URL=$PUBLIC_URL
COOKIE_SECURE=$COOKIE_SECURE
ACME_EMAIL=$ADMIN_EMAIL
APP_NAME="${APP_NAME:-Employee Calling}"
APP_DOWNLOAD_URL=$APP_DOWNLOAD_URL

MYSQL_DATABASE=calling_app
MYSQL_USER=app
MYSQL_PASSWORD=$(random_alnum 32)
MYSQL_ROOT_PASSWORD=$(random_alnum 32)
MYSQL_BUFFER_POOL=$([ "$mem_mb" -ge 3500 ] && echo 512M || echo 256M)

APP_TIMEZONE=${APP_TIMEZONE:-Asia/Kolkata}
DEFAULT_PHONE_REGION=${DEFAULT_PHONE_REGION:-IN}
LOG_LEVEL=INFO
JWT_SECRET=$(random_alnum 64)
JWT_ACCESS_TTL_MINUTES=15
JWT_REFRESH_TTL_DAYS=30

STORAGE_BACKEND=local
MAX_RECORDING_MB=100

BOOTSTRAP_ADMIN_EMAIL=$ADMIN_EMAIL
BOOTSTRAP_ADMIN_PASSWORD=$NEW_ADMIN_PASSWORD

ADMIN_IMAGE=${ADMIN_IMAGE:-}
API_IMAGE=${API_IMAGE:-}
EOF
  chmod 600 "$ENV_FILE"
  note "Settings written to $ENV_FILE"
else
  say "Using the settings in $ENV_FILE"
fi

# ----------------------------------------------------------------------------------------------------- the firewall
if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q "Status: active"; then
  say "Opening the web ports in the firewall"
  ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ufw allow 443/udp >/dev/null
fi

# ----------------------------------------------------------------------------------------------------- the ports
# another web server (Apache, nginx) on the same machine would stop Caddy from starting; say so instead of failing mysteriously
for port in 80 443; do
  if command -v ss >/dev/null && ss -ltn "sport = :$port" 2>/dev/null | grep -q LISTEN \
     && ! docker ps --format '{{.Ports}}' 2>/dev/null | grep -q ":$port->"; then
    die "Port $port is already used by another program (often Apache or nginx). Stop it (for example: systemctl disable --now apache2 nginx) or use a clean server, then run this again."
  fi
done

# ---------------------------------------------------------------------------------------------------------- start
say "Starting the system (the first start builds the images and can take several minutes)"
if [ -n "$(env_get ADMIN_IMAGE)" ] && [ -n "$(env_get API_IMAGE)" ]; then
  "${COMPOSE[@]}" pull
  "${COMPOSE[@]}" up -d --no-build --remove-orphans
else
  "${COMPOSE[@]}" up -d --build --remove-orphans
fi

say "Waiting for everything to become healthy"
healthy=""
for _ in $(seq 1 90); do
  if "${COMPOSE[@]}" exec -T api curl -fsS -m 4 http://localhost:8000/ready >/dev/null 2>&1 \
     && "${COMPOSE[@]}" exec -T admin wget -q -O /dev/null -T 4 "http://127.0.0.1:3000/api/health?deep=1" >/dev/null 2>&1; then
    healthy=yes; break
  fi
  sleep 4
done
if [ -z "$healthy" ]; then
  "${COMPOSE[@]}" ps
  die "The system did not become healthy in six minutes. See the logs with:  ${COMPOSE[*]} logs --tail=100"
fi
note "The API, the panel and the database are all healthy."

# when the administrator was created just now, prove the password works, then keep it out of the file
ADMIN_EMAIL_NOW="$(env_get BOOTSTRAP_ADMIN_EMAIL)"
ADMIN_PASSWORD_NOW="$(env_get BOOTSTRAP_ADMIN_PASSWORD)"
if [ -n "$ADMIN_PASSWORD_NOW" ] && [ -n "$NEW_ADMIN_PASSWORD" ]; then
  if "${COMPOSE[@]}" exec -T api curl -fsS -m 10 -X POST http://localhost:8000/api/v1/auth/login \
       -H 'content-type: application/json' -d "{\"identifier\":\"$ADMIN_EMAIL_NOW\",\"password\":\"$ADMIN_PASSWORD_NOW\"}" >/dev/null 2>&1; then
    sed -i -e 's/^BOOTSTRAP_ADMIN_PASSWORD=.*/# BOOTSTRAP_ADMIN_PASSWORD was removed after the first start/' "$ENV_FILE"
  else
    warn "The administrator could not sign in right after the start. Keep $ENV_FILE and check the logs."
    NEW_ADMIN_PASSWORD=""
  fi
fi

# --------------------------------------------------------------------------------------------------------- backups
if [ -d /etc/cron.d ]; then
  cat > /etc/cron.d/calling-backup <<EOF
# nightly backup of the database and the recordings (see deploy/backup.sh)
30 2 * * * root cd $ROOT && bash deploy/backup.sh >> /var/log/calling-backup.log 2>&1
EOF
  chmod 644 /etc/cron.d/calling-backup
  note "A backup will run every night at 02:30 into /var/backups/calling (the last 14 days are kept)."
fi

# ----------------------------------------------------------------------------------------------------- the address
PUBLIC_URL_NOW="$(env_get PUBLIC_URL)"
if [ "$(env_get COOKIE_SECURE)" = "true" ]; then
  say "Checking the public address (the HTTPS certificate is requested on the first visit)"
  ok=""
  for _ in $(seq 1 30); do
    if curl -fsS -m 8 "$PUBLIC_URL_NOW/health" >/dev/null 2>&1; then ok=yes; break; fi
    sleep 4
  done
  if [ -n "$ok" ]; then note "$PUBLIC_URL_NOW answers over HTTPS."; else
    warn "$PUBLIC_URL_NOW does not answer yet. Check that its DNS record points to this server and that ports 80 and 443 are open"
    warn "(also in the provider's firewall). Caddy keeps retrying; see:  ${COMPOSE[*]} logs caddy"
  fi
fi

echo
echo "============================================================================================"
echo "  Installed."
echo
echo "  Admin panel : $PUBLIC_URL_NOW"
echo "  API address for the phones (API_URL): $PUBLIC_URL_NOW"
echo "  Administrator: $ADMIN_EMAIL_NOW"
if [ -n "$NEW_ADMIN_PASSWORD" ]; then
echo "  Password     : $NEW_ADMIN_PASSWORD      <- shown only now; write it down and change it after signing in"
fi
echo
echo "  Update later      : bash deploy/update.sh"
echo "  Backup right now  : bash deploy/backup.sh"
echo "  Look at the logs  : ${COMPOSE[*]} logs -f --tail=100"
echo "============================================================================================"
