# Putting the system on a server

This puts everything on **one Linux server** with one command: the admin panel, the API the phones talk to, the database, the
cache and the HTTPS front door. It is made for a small company (up to a few hundred employees on one 2 GB server).

> **सोप्या शब्दांत (short, in Marathi/Hinglish)**
> 1. Ek Ubuntu server ghya (2 GB RAM, 20 GB disk) ani ek domain (jase `calling.tumchi-company.com`) tya server chya IP kade point kara (DNS "A record").
> 2. Server var login karun: `git clone https://github.com/<owner>/call.git && cd call && sudo bash deploy/install.sh`
> 3. Domain ani admin email vicharel. 5-10 minute madhe sagla ready. Shevti admin panel cha address ani password disel.
> 4. Phone app chya build madhe `API_URL` = `https://tumcha-domain` thevun nava APK banva (GitHub → Actions → Android APK).
> 5. Dar ratri 2:30 la backup apoaap hoto. Update karayla: `bash deploy/update.sh`.

---

## What you need

| | |
|---|---|
| **A server** | Ubuntu 22.04 or 24.04 (Debian 12 also works), **2 GB RAM or more**, 20 GB disk, a public IP address. Any provider: DigitalOcean, Hetzner, AWS Lightsail, Contabo, a local data centre... |
| **A domain name** | e.g. `calling.example.com`. Create a DNS **A record** for it that points to the server's IP address. HTTPS certificates are free (Let's Encrypt) and handled automatically. |
| **Open ports** | 80 and 443 (also in the provider's firewall / "security group"). Port 22 for you to log in. |
| **An e-mail address** | The first administrator's login. |

**Why a domain?** The phones' app only talks to servers over HTTPS (plain `http` is allowed only for addresses on the local
network, which is what the testing setup used). A real server needs a certificate, and certificates need a domain name.

No domain yet? For a server **inside the office network** you can leave the domain empty: the system then runs on plain
`http://<server-ip>` and works for phones connected to the same Wi-Fi.

## Installing

Log in to the server (`ssh root@<server-ip>`) and run:

```bash
git clone https://github.com/<owner>/call.git
cd call
sudo bash deploy/install.sh
```

The installer

1. checks the server and adds swap space if the memory is small,
2. installs Docker if it is missing,
3. asks for the **domain** and the **administrator's e-mail**,
4. creates `.env.production` with fresh random passwords and secrets (`chmod 600`),
5. starts the database, cache, API, panel and HTTPS front door,
6. waits until everything is healthy, checks that the administrator can sign in, and removes the first password from the file,
7. schedules a **nightly backup** (02:30) and prints the address and the first password.

It takes 5–10 minutes the first time (building the images). Running it again is safe: it keeps your settings.

Without questions (for scripts):

```bash
sudo DOMAIN=calling.example.com ADMIN_EMAIL=you@example.com bash deploy/install.sh
```

### After the install

1. Open `https://calling.example.com` and sign in with the e-mail and password the installer printed.
   You are asked to choose your own password first.
2. **Employees → New employee** creates the logins (or **Import sheet** for many at once). Send each person their details
   (the dialog has a *Send on WhatsApp* button).
3. Build the phone app for your server: in GitHub open **Settings → Secrets and variables → Actions → Variables** and set
   `API_URL` to `https://calling.example.com`, then run **Actions → Android APK → Run workflow** (or tag a new version).
   Install that APK on the phones. The address is compiled into the app, so a different server needs a new APK.
4. Check **Settings** in the panel: the call-recording notice text, the daily target and the retry rules.

## Everyday operations

| What | Command (run in the project folder on the server) |
|---|---|
| Update to the newest version | `bash deploy/update.sh` (makes a backup first, then restarts; ~1 minute of interruption) |
| Backup now | `bash deploy/backup.sh` → `/var/backups/calling` (database + recordings) |
| Restore | `bash deploy/restore.sh /var/backups/calling/db-<date>.sql.gz /var/backups/calling/files-<date>.tar.gz` |
| See what is running | `docker compose -f docker-compose.prod.yml --env-file .env.production ps` |
| Read the logs | `docker compose -f docker-compose.prod.yml --env-file .env.production logs -f --tail=100 api` (or `admin`, `caddy`, `mysql`) |
| Stop / start | `... stop` / `... up -d` |

Panel health: `https://calling.example.com/api/health?deep=1` answers `{"status":"ok","backend":"ok"}`.
API health: `https://calling.example.com/health`. Point an uptime monitor (UptimeRobot, Better Stack...) at them.

**Backups:** the installer keeps 14 nights in `/var/backups/calling`. That is on the same machine — copy the folder somewhere
else regularly (`rsync`, `rclone` to a cloud drive...), for example weekly. To keep copies elsewhere automatically:
`BACKUP_DIR=/mnt/other-disk KEEP_DAYS=30 bash deploy/backup.sh` from your own cron job.

## Where things live

```
Internet ─► Caddy :80/:443 (HTTPS, certificate renewal)
              ├─ /api/v1/*, /health  ─► api    (FastAPI: phones + panel data)  ─► mysql, redis
              └─ everything else     ─► admin  (the panel; its /api/backend/* proxies to api, so the browser never holds a token)
volumes: mysql_data (database) · api_data (recordings + imports) · redis_data · caddy_data (certificates)
```

Only Caddy publishes ports. The API, panel, MySQL and Redis cannot be reached from outside.

## Settings you may want to change

Edit `.env.production`, then `docker compose -f docker-compose.prod.yml --env-file .env.production up -d`.

| Setting | Meaning |
|---|---|
| `APP_NAME` | The name in the panel's header (needs a rebuild: `bash deploy/update.sh`) |
| `APP_TIMEZONE` | Business time zone: decides what "today" means in every report (default `Asia/Kolkata`) |
| `STORAGE_BACKEND=s3` + `AWS_*` | Keep recordings in a private S3 bucket instead of the server's disk (recommended beyond a few GB) |
| `MAX_RECORDING_MB` | Largest recording a phone may upload (default 100) |
| `JWT_ACCESS_TTL_MINUTES`, `JWT_REFRESH_TTL_DAYS` | How long a sign-in lasts |
| `MYSQL_BUFFER_POOL` | Database cache: `256M` for 2 GB servers, `512M`–`1G` for bigger ones |

## Small servers (1 GB) — use prebuilt images

Building the panel needs about 2 GB of memory. On a smaller server let GitHub build the images instead (the workflow
`Publish images` runs for every version tag) and set these two lines in `.env.production`:

```
ADMIN_IMAGE=ghcr.io/<owner>/call/admin:latest
API_IMAGE=ghcr.io/<owner>/call/api:latest
```

If the repository is private, sign the server in to the registry once:
`echo <token> | docker login ghcr.io -u <github-user> --password-stdin` (the token needs the `read:packages` permission).
`bash deploy/update.sh` then pulls instead of building.

## Updating automatically from GitHub

The workflow **Deploy** (`.github/workflows/deploy.yml`) connects to the server over SSH and runs `deploy/update.sh`.
Add these under *Settings → Secrets and variables → Actions*:

| Secret | Value |
|---|---|
| `DEPLOY_HOST` | the server's address |
| `DEPLOY_USER` | the SSH user (it must be allowed to run Docker, e.g. `root`) |
| `DEPLOY_SSH_KEY` | a private key whose public half is in the server's `~/.ssh/authorized_keys` |
| `DEPLOY_PATH` | the project folder on the server, e.g. `/root/call` |

Run it from *Actions → Deploy → Run workflow*. Set the repository variable `AUTO_DEPLOY` to `true` to deploy on every push
to `main` as well.

## Security notes

* All secrets are generated on the server and never leave it. `.env.production` is readable by root only.
* Passwords are stored hashed (bcrypt); sign-ins are rate limited; refresh tokens rotate and a stolen one is detected.
* The panel keeps the sign-in in `httpOnly` cookies (JavaScript cannot read them) and sends state-changing calls only with a
  header a foreign website cannot add. Recordings are played through short-lived signed links and every listen is in the audit log.
* The API documentation pages (`/docs`) are switched off in production.
* Keep the server updated (`apt upgrade`), use SSH keys instead of passwords and turn the password login off.
* Call recording laws differ by country and by state: make sure the notice text in **Settings** matches your obligations.

## Troubleshooting

| Symptom | What to do |
|---|---|
| The site shows a certificate error / "not secure" | The domain's A record must point to the server and ports 80/443 must be open (also in the provider's firewall). Watch `docker compose ... logs caddy`; it keeps retrying. |
| The installer says the build ran out of memory | Use a 2 GB server, let the installer add swap, or switch to prebuilt images (above). |
| "Cannot reach the server" in the panel | `docker compose ... ps` — see which container is not healthy; read its logs. |
| The panel works but a phone cannot sign in | The APK was built with a different `API_URL`. Check the variable and build a new APK. |
| Forgot the administrator password | Another administrator can use *Employees → Manage → Reset password*. If nobody can sign in: `docker compose -f docker-compose.prod.yml --env-file .env.production exec api python -m scripts.reset_password admin@example.com` prints a new password. Always keep **two** administrators. |
| Disk is filling up | Recordings: `docker system df -v`; move recordings to S3 or enlarge the disk. Old backups: lower `KEEP_DAYS`. |
