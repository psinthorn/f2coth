# Deploying F2 Website to DigitalOcean (auto-deploy on merge to `main`)

This repo already ships a complete CI/CD pipeline. On every push to `main` it
builds all service images (including `assethub-api`), pushes them to GHCR,
copies the compose files to your server, applies DB migrations, and restarts
the stack — then smoke-tests it. You only need to stand up a **DigitalOcean
Droplet** as the target and set a handful of GitHub secrets.

> Model: a single Droplet running `docker compose` with **Traefik** terminating
> TLS via Let's Encrypt. This is *not* DigitalOcean App Platform — it's the
> same compose stack you run locally, with the `docker-compose.prod.yml` overlay.

---

## How the pipeline works (`.github/workflows/deploy.yml`)

```
push to main ──▶ build-and-push (all images → ghcr.io, tagged with the git SHA)
             └─▶ deploy (SSH to the Droplet):
                   • scp docker-compose*.yml + migrations + deploy script
                   • docker login ghcr.io
                   • docker compose pull
                   • apply every database/migrations/*.sql  (065_assethub.sql included)
                   • docker compose up -d
                   • prune old images
             └─▶ smoke test https://<domain>/…
```

- `push to main` → **production** environment. `push to staging` → **staging**.
- Migrations are idempotent (`CREATE TABLE IF NOT EXISTS`, `ON CONFLICT …`), so
  re-applying on every deploy is safe.
- The server's `/opt/f2-website/.env` holds all secrets; the deploy only rewrites
  `IMAGE_TAG` and `GHCR_OWNER`.

---

## 1. Create the Droplet

- **Ubuntu 24.04 LTS**, 4 GB RAM minimum (2 GB is tight once LibreOffice/docgen
  runs). A `s-2vcpu-4gb` Droplet is a good start.
- Add your SSH key during creation.
- Once up, point DNS at it **before the first deploy** (Traefik needs it for the
  Let's Encrypt HTTP-01 challenge):
  - `A  @        → <droplet-ip>`  (or a subdomain like `assets.yourdomain.com`)
  - `A  www      → <droplet-ip>`  (optional)

Open the firewall for web + SSH (DigitalOcean Cloud Firewall or `ufw`):

```bash
ufw allow OpenSSH
ufw allow 80
ufw allow 443
ufw enable
```

## 2. Install Docker + a deploy user

SSH in as root, then:

```bash
curl -fsSL https://get.docker.com | sh          # Docker + compose plugin

adduser --disabled-password --gecos "" deploy
usermod -aG docker deploy
mkdir -p /opt/f2-website && chown deploy:deploy /opt/f2-website

# let the deploy user in over SSH (the pipeline authenticates as this user)
mkdir -p /home/deploy/.ssh
# paste the PUBLIC key whose PRIVATE key you'll put in the VPS_SSH_KEY secret:
nano /home/deploy/.ssh/authorized_keys
chown -R deploy:deploy /home/deploy/.ssh && chmod 700 /home/deploy/.ssh && chmod 600 /home/deploy/.ssh/authorized_keys
```

> Generate a dedicated deploy keypair on your Mac if you don't have one:
> `ssh-keygen -t ed25519 -C "f2-deploy" -f ~/.ssh/f2_deploy`
> — the **private** key (`~/.ssh/f2_deploy`) goes in the `VPS_SSH_KEY` secret;
> the **public** key (`~/.ssh/f2_deploy.pub`) goes in `authorized_keys` above.

## 3. Provision `/opt/f2-website/.env` on the Droplet

The deploy script requires this file to already exist. Copy `.env.example` from
the repo, fill in real values, and scp it up once:

```bash
scp .env deploy@<droplet-ip>:/opt/f2-website/.env
```

Must-set values for production (see `.env.example` for the full list):

| Key | Value |
|---|---|
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | strong, unique |
| `JWT_SECRET` | `openssl rand -base64 48` |
| `TOKEN_PEPPER` | `openssl rand -base64 48` — **AssetHub enrollment-token pepper** |
| `DOMAIN` | your domain, e.g. `assets.yourdomain.com` |
| `ACME_EMAIL` | email for Let's Encrypt |
| `GHCR_OWNER` | your GitHub owner, lowercase (e.g. `psinthorn`) |
| `CORS_ALLOWED_ORIGINS` | `https://<your-domain>` |
| app keys | `ANTHROPIC_API_KEY`, `SMTP_*`, `RESELLERCLUB_*`, … as used |

> **Never commit `.env`.** It's git-ignored; it lives only on the Droplet.

## 4. Make the GHCR packages pullable

The images are pushed to `ghcr.io/<owner>/f2-*`. The pipeline logs the Droplet
into GHCR with a short-lived `GITHUB_TOKEN` on each deploy, so **private**
packages work out of the box. If you'd rather, mark the packages Public in
GitHub → your profile → Packages.

## 5. Set GitHub secrets, variables & environments

In the repo: **Settings → Environments → New environment → `production`**
(repeat for `staging` if you use it). Add these **environment secrets**:

| Secret | Value |
|---|---|
| `VPS_HOST` | Droplet IP or hostname |
| `VPS_USER` | `deploy` |
| `VPS_SSH_KEY` | the **private** key (PEM/OpenSSH), full contents |
| `VPS_PORT` | `22` (optional) |

Then **Settings → Secrets and variables → Actions → Variables** (repo-level):

| Variable | Value |
|---|---|
| `GHCR_OWNER` | your GitHub owner, lowercase |
| `PROD_DOMAIN` | your production domain (e.g. `assets.yourdomain.com`) |
| `STAGING_DOMAIN` | staging domain (only if you use a `staging` branch) |

> `PROD_DOMAIN` / `STAGING_DOMAIN` are optional — without them the pipeline
> falls back to `f2.co.th` / `staging.f2.co.th`. Set `PROD_DOMAIN` so the smoke
> test hits *your* domain.

## 6. First deploy

Either merge to `main`, or trigger manually:
**Actions → Deploy → Run workflow → environment: production**.

Watch the run. On success the Droplet is serving `https://<your-domain>` with a
valid Let's Encrypt cert, and AssetHub is live at `/api/assethub` with its
migration applied.

Verify:

```bash
curl -sI https://<your-domain>/                          # 200/301
curl -s  https://<your-domain>/api/assethub/collector/collect.sh | head -1   # #!/bin/bash
```

Then in the admin console → **Asset Register → Tokens**, the Install panel's
**Server URL** field now shows `https://<your-domain>` automatically, so the
one-liners you hand to clients are correct.

---

## Day-2 notes

- **Rollback**: re-run a previous successful Deploy run, or on the Droplet
  `cd /opt/f2-website && set_env IMAGE_TAG <old-sha>` then
  `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d`.
- **Logs**: `cd /opt/f2-website && docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f --tail=200 assethub-api`.
- **Backups**: `pg_dump` the postgres volume and snapshot the `assethub-reports`
  volume (generated handover files) on a schedule.
- **CI gate**: `.github/workflows/build.yml` runs tests + `i18n-check` on every
  push; keep deploys gated on it being green.

## Local (your Mac) vs. deployed — the collector URL

- Running a collector **on the Mac itself**: `http://localhost` works.
- Running from **another machine** (a client PC, the probe box): `localhost`
  won't reach your Mac — use the Mac's LAN IP (`http://192.168.1.x`) in the
  Install panel's Server URL field.
- **In production**: the panel auto-fills your real `https://` domain, so the
  commands are correct with no edits.
