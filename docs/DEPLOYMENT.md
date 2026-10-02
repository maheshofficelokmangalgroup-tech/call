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

Building the panel needs about 2 GB of memory. On a smaller server use the images that GitHub builds (see the next section: the
`Deploy` workflow pushes them to `ghcr.io/<owner>/<repo>/admin` and `/api`) and set these two lines in `.env.production`:

```
ADMIN_IMAGE=ghcr.io/<owner>/<repo>/admin:latest
API_IMAGE=ghcr.io/<owner>/<repo>/api:latest
```

If the repository is private, sign the server in to the registry once:
`echo <token> | docker login ghcr.io -u <github-user> --password-stdin` (the token needs the `read:packages` permission).
`bash deploy/update.sh` then pulls instead of building.

## An existing server with the database on RDS (shared-server mode)

Use this when the server **already runs other projects** (their nginx owns ports 80 and 443) and the data should live on an
**AWS RDS** MySQL server instead of a database container. Everything is in `deploy/shared/`; nothing of the other projects is
touched. This is how the production system of this repository is deployed.

| Part | How |
|---|---|
| Containers | `calling-api`, `calling-admin`, `calling-redis`, `calling-caddy` (project name `calling`), memory-limited, logs rotated |
| Database | RDS, a **dedicated user** that can reach only its own database (`deploy/shared/create-database-user.sh`), connection limit 12, TLS verified with the RDS certificate bundle |
| Address | one HTTPS port of its own (default **8445**) - open it in the EC2 security group. Without a domain a free name such as `13-205-79-72.sslip.io` (the IP with dashes) works; with a domain put it in `PUBLIC_HOST` |
| Certificate | Let's Encrypt in certbot *webroot* mode through the existing nginx (`issue-cert.sh`); renewed weekly by the `Certificate` workflow |
| Images | built by GitHub Actions and pulled by the server; the server never builds |
| Recordings | in the `calling_api_data` Docker volume (add S3 later with `STORAGE_BACKEND=s3`) |
| Redis | has a **password** (`REDIS_PASSWORD`, generated by `deploy.sh` into the server's `.env` the first time); the API refuses to start in production without Redis, and `GET /ready` shows `"redis":"redis"` when it is the real one |
| A deploy that fails | `deploy.sh` waits four minutes for the new version to answer (`/ready` of the API with the database and Redis, the panel's deep health). When it does not, it **puts the version that was running back by itself** (its files and its image tag; the database only ever gets columns and indexes added, which the older version does not mind) and the run ends red, so the pipeline shows the failure while the service is up. `deploy/shared/test-deploy.sh` tests this with a pretend Docker (CI runs it) |
| Hardening | every container: no extra Linux capabilities, `no-new-privileges`; the API container's filesystem is read-only (only its data volume is writable); Caddy limits the size of a request per route |

**First-time setup** (once, on the server; the repository is cloned to `~/calling`):

```bash
cd ~/calling/deploy/shared
# 1. a database user that reaches only Calling_db (the RDS master password is used here, once, and never stored)
RDS_ADMIN_PASSWORD='...' DB_HOST=<rds-endpoint> DB_PASSWORD='<28 letters and digits>' bash create-database-user.sh
# 2. the settings file with fresh secrets (prints the first administrator's password once)
PUBLIC_HOST=<name> HTTPS_PORT=8445 ACME_EMAIL=<you> ADMIN_EMAIL=<you> API_IMAGE=ghcr.io/<owner>/<repo>/api \
ADMIN_IMAGE=ghcr.io/<owner>/<repo>/admin DATABASE_URL='mysql+pymysql://calling_app:<password>@<rds-endpoint>:3306/Calling_db?charset=utf8mb4&ssl_ca=/certs/rds-ca.pem' bash setup.sh
# 3. the certificate (a practice run first), then the first start
bash issue-cert.sh --dry-run && bash issue-cert.sh
bash deploy.sh
```

Afterwards updates are automatic (next section). Useful commands, from `deploy/shared`:

```bash
docker compose --env-file .env ps                    # what runs
docker compose --env-file .env logs -f --tail=100 api
bash deploy.sh                                       # newest images; or:  bash deploy.sh sha-1a2b3c4 <commit>  for an exact version
bash renew-cert.sh                                   # renew the certificate now if it has less than 30 days left
```

The RDS server limits the number of connections for **all** projects on it, so this system uses at most 8 (2 workers x 4) and its
database user is capped at 12. Backups of the database are RDS's automated backups (check their retention in the AWS console);
the recordings in the volume are not part of them - copy the volume now and then or move recordings to S3.

## Updating automatically from GitHub (CI/CD)

```
push to main -> CI (API on SQLite + MySQL, app, panel, browser tests, Docker stack)
             -> Deploy: build the panel and API images (ghcr.io) -> SSH -> server pulls exactly that commit's images,
                restarts, waits until healthy -> the public address is checked
```

* **Deploy** (`.github/workflows/deploy.yml`) starts by itself when CI passes on `main` and the push changed something that runs on
  the server (panel, API, deployment files); documents and app-only changes do not redeploy. *Actions -> Deploy -> Run workflow*
  deploys what you type in *What to deploy* (the full commit id, a tag or a branch; empty = the branch you picked). To **roll back**
  give the id of an older commit (the *Commits* page shows it): the images are built again from exactly that code and the server is
  moved to it. Set the repository variable `AUTO_DEPLOY=false` to switch the automatic part off.
* **Certificate** (`.github/workflows/certificate.yml`) renews the HTTPS certificate every Monday when it has less than 30 days left.
* Secrets (*Settings -> Secrets and variables -> Actions*): `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS`
  (the server's SSH host keys, so a different machine at that address is refused). Variable: `PUBLIC_URL`.
* The SSH key is a **dedicated deploy key**, not your login key. In the server's `~/.ssh/authorized_keys` it is written as
  `command="/home/ubuntu/calling/deploy/shared/ci-entry.sh",restrict ssh-ed25519 ...`, so it can run exactly two things:
  `deploy <tag> <commit>` and `renew-cert` - no shell, no file copy, no port forwarding. To revoke it, delete that line.
* The images are downloaded with the workflow's temporary token, kept in a Docker login of its own (`~/calling/.docker`), apart from
  the logins of other projects on the server.

For the generic all-in-one server (the first sections of this guide) `deploy/update.sh` is the update command and a plain
SSH workflow can call it.

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
