# Production readiness playbook

Everything that needs to be in place — infrastructure, secrets, and human process — before flipping DNS to `f2.co.th`. Follow in order; each step assumes the previous is done.

If you're on staging you can skip the DNS + certificate steps.

---

## 1. VPS + Docker

- Ubuntu 22.04+ LTS server, 4 vCPU / 8 GB RAM / 80 GB SSD minimum
- Docker Engine + Compose plugin installed (`get.docker.com` script)
- `deploy` user in the `docker` group, key-only SSH (`PermitRootLogin no`, `PasswordAuthentication no`)
- UFW open on 22/tcp, 80/tcp, 443/tcp; everything else denied
- `/opt/f2-website` writeable by `deploy`
- `docker-compose.yml`, `docker-compose.prod.yml`, `.env`, `database/migrations/`, and `scripts/deploy-remote.sh` copied to `/opt/f2-website`

---

## 2. DNS + TLS

**Recommended path: Cloudflare in front of the VPS.** See the full playbook at [cloudflare-setup.md](cloudflare-setup.md) — 30–45 min, $0/month, gives you edge CDN + DDoS + a single global TLS layer.

Short version:

1. Add `f2.co.th` to Cloudflare (Free plan), switch nameservers at your registrar.
2. In Cloudflare DNS, set `A f2.co.th → <VPS_IP>` and `A staging → <VPS_IP>` both **Proxied** (orange cloud).
3. SSL/TLS mode: **Full (strict)**.
4. Wait for propagation (`dig +short f2.co.th` returns a Cloudflare IP, not your VPS).
5. First `make prod-up` triggers Let's Encrypt HTTP-01 on the origin; certificate lands in `f2-website_traefik-letsencrypt` volume.
6. **After** Cloudflare is Active, run `sudo bash /opt/f2-website/scripts/firewall-cloudflare-only.sh apply` on the VPS to lock port 443 to Cloudflare's edge only.

Bare-VPS path (no Cloudflare) is also supported — just leave step 6 unrun. You lose edge CDN + DDoS, but Traefik's Let's Encrypt works either way.

---

## 3. `.env` secrets

Regenerate every secret — never reuse the dev values.

```bash
# On the VPS in /opt/f2-website
cp .env.example .env
```

Then fill in real values for:

| Key | How to generate |
| --- | --- |
| `POSTGRES_PASSWORD` | `openssl rand -base64 32` |
| `DATABASE_URL` | Mirror the password above |
| `JWT_SECRET` | `openssl rand -base64 48` |
| `SMTP_CRYPT_KEY` | `openssl rand -base64 48` (for pgcrypto SMTP encryption) |
| `ANTHROPIC_API_KEY` | From console.anthropic.com |
| `SMTP_HOST` / `SMTP_USER` / `SMTP_PASSWORD` | See § 4 — or leave blank and set via admin UI |
| `SMTP_FROM` | `F2 Co., Ltd. <info@f2.co.th>` |
| `SITE_URL` | `https://f2.co.th` |
| `NEXT_PUBLIC_SITE_URL` | `https://f2.co.th` |
| `NEXT_PUBLIC_API_BASE` | `https://f2.co.th/api` |
| `GHCR_OWNER` | Your GitHub org/user (lowercase) |
| `DOMAIN` | `f2.co.th` (staging: `staging.f2.co.th`) |
| `IMAGE_TAG` | Set by CI on deploy; leave `latest` for manual `make prod-up` |

`chmod 600 .env` — the file has your database password and JWT secret.

---

## 4. SMTP configuration

You have two paths — pick one:

### A. Admin-UI configured (recommended for production)

1. Leave `SMTP_HOST=""` (or omit) in `.env`.
2. Set `SMTP_CRYPT_KEY` to a fresh 48-byte base64 value.
3. First admin logs in, opens `/admin/settings/smtp`, enters the provider creds (host / port / user / password / from-address / TLS mode).
4. Save. Password is encrypted at rest via pgcrypto using `SMTP_CRYPT_KEY`.
5. Click **Send test** with the admin's own email; verify delivery.
6. Rotate creds by editing the admin form; no redeploy needed.

**Warning:** rotating `SMTP_CRYPT_KEY` invalidates the stored password. Re-enter via the admin UI immediately after rotation.

### B. `.env`-configured (dev + as fallback)

Set `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` / `SMTP_FROM` directly in `.env`. The admin UI still works but the DB row overrides `.env` when both are set.

For Gmail: create an app-password at [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) and use `smtp.gmail.com:587` with STARTTLS.

For SES: `email-smtp.<region>.amazonaws.com:587`, generate SMTP credentials in the SES console (not IAM keys).

---

## 5. Migrations

`docker compose up -d` does **not** run migrations. On first prod boot:

```bash
cd /opt/f2-website
make prod-up
# wait until postgres is healthy:
docker compose ps postgres
# then apply the schema:
make migrate
```

Subsequent deploys re-apply idempotently — no data loss risk.

---

## 6. First admin user

```bash
docker exec -it f2-postgres psql -U f2 -d f2_website <<'SQL'
INSERT INTO users (email, password_hash, full_name, role, is_active)
VALUES (
  'you@f2.co.th',
  crypt('temporary-password-you-will-reset', gen_salt('bf', 12)),
  'Your Name',
  'admin',
  true
);
SQL
```

Then visit `/admin/login/forgot`, request a reset, and pick a real password.

---

## 7. Verify deploy

```bash
make health BASE=https://f2.co.th
# should print PASS: 10 FAIL: 0

curl -sL https://f2.co.th/ | head -20                 # 200, contains F2 tagline
curl -sL https://f2.co.th/sitemap.xml | head -20      # valid XML with all locales
curl -sI https://f2.co.th/api/checklists/templates    # 401 (auth required, good)
```

---

## 8. External monitoring

Set up ONE of:

- **BetterStack** (recommended): 60s interval, 3 regions, alert to on-call phone + Slack. Configure one monitor per URL in `scripts/health-check.sh`.
- **UptimeRobot** free: 5-min interval, email alerts.

See [`docs/monitoring.md`](monitoring.md).

---

## 9. Backups

- Cron on the VPS: daily `pg_dump` (see [backup-and-restore.md](backup-and-restore.md)) at 03:00 Asia/Bangkok
- Cron: daily `make backup-uploads` at 03:15
- Off-host sync (rsync to a second VPS, or `aws s3 cp`) at 04:00
- Monthly restore drill — actually restore into a scratch container and verify counts match

---

## 10. Post-deploy sanity

- Log into `/admin` as your admin user
- Log into `/portal` as a customer contact (use the forgot-password flow if needed)
- Trigger a weekly summary email from `/admin/projects/<miskawaan-id>/report` — confirm it shows up in `notifications` table with `status='sent'`
- Kill a container (`docker kill f2-checklist-api`) and confirm compose restarts it within 30s
- Submit a lead through the public `/contact` form and confirm it lands in the `leads` table

---

## What's deliberately not in the box (yet)

- **Prometheus / Grafana / Loki** — deferred until scale demands it. `/healthz` + external ping is the v1 story.
- **APM / distributed tracing** — same reasoning.
- **Error tracking** (Sentry) — recommended next investment; the Next.js integration is one file.
- **Automated release notes** — CI tags with git sha; no changelog automation yet.
- **Blue/green deploys** — current strategy is rolling recreate. Zero-downtime deploys need a proxy tier we don't have.

If any of the above become blockers, see `memories/repo/project.md` for the "open roadmap" list and file an issue against the roadmap.
