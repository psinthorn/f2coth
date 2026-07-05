# Deployment Runbook

Stack: **Hetzner Cloud VPS (Singapore) + Cloudflare (free)**. One VPS runs the full docker-compose stack behind Traefik + Let's Encrypt; Cloudflare provides CDN, DDoS, and WAF.

| Env | Domain | Branch | VPS | Monthly |
|---|---|---|---|---|
| Staging | `staging.f2.co.th` | `staging` | Hetzner CPX21 (3 vCPU / 4 GB) | ~€6 |
| Production | `f2.co.th` | `main` | Hetzner CCX13 (2 dedicated vCPU / 8 GB) | ~€14 |

Deploys are triggered by pushes to those branches. GitHub Actions builds all 9 service images, pushes them to `ghcr.io/<GHCR_OWNER>/f2-<service>:<sha>`, SSHes to the VPS, and runs `scripts/deploy-remote.sh`.

Total budget: **~€21/mo (~$23)** + $1/mo B2 backups = **~$24/mo** for both environments.

---

## 1 · First-time server provisioning

Do this once per box (staging + prod).

### 1.1 Create the Hetzner server
- **Location:** Singapore (`sin1`) — ~25–40 ms to Thailand
- **Image:** Ubuntu 24.04
- **Type:** CCX13 for prod (dedicated vCPU, better tail latency for `ai-chat-api`), CPX21 for staging
- **SSH key:** upload your public key, disable password login
- **IPv4 + IPv6:** enable both
- **Cloud firewall:** allow inbound `22, 80, 443` only

Once created, note the assigned IPv4 and IPv6.

### 1.2 Harden
```bash
# As root on first login
adduser deploy && usermod -aG sudo deploy
rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw enable
apt update && apt install -y unattended-upgrades fail2ban
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/; s/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl reload sshd
```

### 1.3 Install Docker
```bash
curl -fsSL https://get.docker.com | sh
usermod -aG docker deploy
```

### 1.4 Prepare the app directory
```bash
sudo mkdir -p /opt/f2-website && sudo chown deploy:deploy /opt/f2-website
```

### 1.5 Create `/opt/f2-website/.env`

Copy from `.env.example` in the repo and fill in real values. **Never commit.**

Required per environment:

| Key | Staging | Production |
|---|---|---|
| `DOMAIN` | `staging.f2.co.th` | `f2.co.th` |
| `ACME_EMAIL` | `info@f2.co.th` | `info@f2.co.th` |
| `GHCR_OWNER` | `f2coltd` | `f2coltd` |
| `IMAGE_TAG` | `staging` (bootstrap) | `latest` (bootstrap) |
| `POSTGRES_PASSWORD` | strong random | strong random (different!) |
| `JWT_SECRET` | `openssl rand -base64 48` | `openssl rand -base64 48` |
| `ANTHROPIC_API_KEY` | real | real |
| `SMTP_*` | real | real |
| `NEXT_PUBLIC_SITE_URL` | `https://staging.f2.co.th` | `https://f2.co.th` |
| `NEXT_PUBLIC_API_BASE` | `https://staging.f2.co.th/api` | `https://f2.co.th/api` |
| `CORS_ALLOWED_ORIGINS` | `https://staging.f2.co.th` | `https://f2.co.th` |

---

## 2 · Cloudflare setup

Cloudflare is free and gives you: global CDN cache for static assets, DDoS protection, WAF rules, analytics, and origin IP hiding. Configure it once per domain.

### 2.1 Add the domain
1. Sign up at cloudflare.com, add `f2.co.th`
2. Cloudflare scans your existing DNS; verify all records copied over
3. Change your registrar's nameservers to the two CF nameservers shown
4. Wait for the dashboard to show "Active" (usually minutes)

### 2.2 DNS records
Add or verify:

| Type | Name | Value | Proxy |
|---|---|---|---|
| A | `f2.co.th` | prod IPv4 | 🟠 initially OFF, flip ON after cert issue |
| A | `www` | prod IPv4 | 🟠 same |
| A | `staging` | staging IPv4 | ⚪ leave OFF permanently (see below) |
| AAAA | `f2.co.th` | prod IPv6 | 🟠 |
| AAAA | `www` | prod IPv6 | 🟠 |
| MX | `f2.co.th` | your mail host | ⚪ |
| TXT | `f2.co.th` | SPF | ⚪ |

**Important — HTTP-01 challenge:**
Traefik requests certs from Let's Encrypt via HTTP-01 (challenge served on :80). Cloudflare's proxy strips that unless you use DNS-01. The simple path:

1. First deploy: proxy **OFF** (grey cloud) → cert issues → verify `https://f2.co.th` works
2. Then flip proxy **ON** (orange cloud) → traffic goes through CF

Renewals: certs are 90 days. Traefik renews 30 days before expiry — but with CF proxy on, HTTP-01 still fails. Two options:
- **Option A (recommended):** enable Cloudflare "Full (strict)" SSL mode and use Cloudflare's Origin Certificate (15-year cert Cloudflare signs). Traefik-managed certs become unnecessary. See §2.4.
- **Option B:** switch Traefik to DNS-01 challenge (requires Cloudflare API token). Overkill for now.

### 2.3 SSL/TLS mode
- **SSL/TLS → Overview:** set to **Full (strict)**
- **SSL/TLS → Edge Certificates:**
  - Always Use HTTPS: **ON**
  - Automatic HTTPS Rewrites: **ON**
  - Min TLS Version: **1.2**
  - Opportunistic Encryption, TLS 1.3: **ON**
- **Speed → Optimization:**
  - Auto Minify (HTML/CSS/JS): **OFF** (Next.js already minifies; CF minify can break)
  - Brotli: **ON**
- **Caching → Configuration:**
  - Browser Cache TTL: **Respect Existing Headers**
  - Caching Level: **Standard**

### 2.4 Origin certificate (recommended, avoids Let's Encrypt renewal headache)
1. **SSL/TLS → Origin Server → Create Certificate**
2. Hostnames: `f2.co.th, *.f2.co.th`
3. Validity: 15 years
4. Copy the cert + key
5. On the VPS:
   ```bash
   sudo mkdir -p /opt/f2-website/certs
   sudo nano /opt/f2-website/certs/origin.crt   # paste cert
   sudo nano /opt/f2-website/certs/origin.key   # paste key
   sudo chown -R deploy:deploy /opt/f2-website/certs
   sudo chmod 600 /opt/f2-website/certs/origin.key
   ```
6. Follow-up: if you go this route, swap `letsencrypt` blocks in `docker-compose.prod.yml` for a file-provided TLS config. Ask Claude to do this rewrite when you're ready — it's ~15 lines. For now, stick with Let's Encrypt (HTTP-01) and flip CF proxy off during first cert issue.

### 2.5 Firewall rules (optional, prod hardening)
Rules → **Create rule**:
- Block requests to `/admin/*` where country ≠ TH (skip if you travel)
- Rate-limit `/api/leads` and `/api/consent` to 30 req / 10 min per IP (backup for the Traefik rate-limit)

### 2.6 Origin IP hiding (advanced, later)
Once everything works through Cloudflare, restrict Hetzner Cloud Firewall inbound `80, 443` to Cloudflare's IP ranges only. That way, direct-to-origin traffic (which bypasses CF WAF) is dropped. Ranges are at `https://www.cloudflare.com/ips-v4` and `-v6`.

**Trade-off:** Let's Encrypt HTTP-01 also gets blocked. Only do this after switching to Cloudflare Origin certs (§2.4) or DNS-01.

---

## 3 · GitHub configuration

Do this once per repo.

### 3.1 Repo variables (Settings → Secrets and variables → Actions → Variables)
- `GHCR_OWNER` — lowercase GitHub owner name (e.g. `f2coltd`)

### 3.2 Environments (Settings → Environments)
Create two: `staging` and `production`.

Each environment needs these **secrets**:

| Secret | Notes |
|---|---|
| `VPS_HOST` | Hetzner IPv4 (staging/prod as appropriate) |
| `VPS_USER` | `deploy` |
| `VPS_SSH_KEY` | private key (PEM). Generate with `ssh-keygen -t ed25519 -f f2-deploy` — put the pubkey in `/home/deploy/.ssh/authorized_keys` on the box, paste the private key here. |
| `VPS_PORT` | optional, defaults to 22 |

Recommended: enable **required reviewers** on `production` so a human approves prod deploys.

---

## 4 · Deploying

### Automatic
- Push to `staging` branch → deploys to `staging.f2.co.th`
- Push to `main` → deploys to `f2.co.th`

### Manual
Actions → **Deploy** → **Run workflow** → pick environment.

### Manual from server (fallback)
```bash
ssh deploy@<vps>
cd /opt/f2-website
export IMAGE_TAG=<sha> ENVIRONMENT=production GHCR_OWNER=f2coltd
./scripts/deploy-remote.sh
```

---

## 5 · Rollback

Every deploy tags the image with the git sha. To roll back:

```bash
ssh deploy@<vps>
cd /opt/f2-website
sed -i 's|^IMAGE_TAG=.*|IMAGE_TAG=<previous-sha>|' .env
make prod-up      # or staging-up
```

Or re-run a prior successful workflow: Actions → pick run → **Re-run all jobs**.

---

## 6 · Backups

Postgres data lives in the `pgdata` docker volume. Nightly dump + rotate + offsite to Backblaze B2 (~$1/mo).

```bash
# /etc/cron.d/f2-backup on the VPS (as deploy user)
0 3 * * * deploy /opt/f2-website/scripts/backup.sh
```

Ask Claude to generate `scripts/backup.sh` when you're ready to set this up (pg_dump + rclone to B2).

Restore:
```bash
gunzip < f2-2026-07-01.sql.gz | docker exec -i f2-postgres psql -U f2 -d f2_website
```

---

## 7 · Cloudflare IP list drift

Cloudflare occasionally adds new IP ranges. If they add one and we haven't updated `docker-compose.prod.yml`, requests from that range are treated as untrusted and rate-limits fire on CF's IP instead of the real client's.

Monthly cron on the VPS:
```bash
# /etc/cron.d/f2-cf-ips
0 3 1 * * deploy cd /opt/f2-website && ./scripts/refresh-cloudflare-ips.sh --check \
          || (./scripts/refresh-cloudflare-ips.sh && \
              docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d traefik)
```

Or run manually:
```bash
cd /opt/f2-website && ./scripts/refresh-cloudflare-ips.sh
git diff docker-compose.*.yml   # review + commit
```

---

## 8 · Health checks after deploy

The workflow smoke-tests:
- `GET /` → 200/301
- `GET /api/cms/health`
- `GET /api/auth/health`

Manual verification:
- `https://<domain>/` loads EN
- `https://<domain>/th` loads TH
- `/admin` login works
- `/admin/features` lists modules
- Contact form submit → email in `sales@`
- Chatbot returns a response

---

## 9 · Common gotchas

**"Cert issue failed."** Cloudflare proxy is likely on — flip the DNS record to grey cloud, wait 2 min for propagation, deploy, wait for cert, then flip back to orange.

**Let's Encrypt rate-limit (5 duplicate certs / week).** If you're testing, add `--certificatesresolvers.letsencrypt.acme.caserver=https://acme-staging-v02.api.letsencrypt.org/directory` to Traefik args temporarily.

**Rate-limit hitting Cloudflare's IPs instead of real clients.** `docker exec f2-traefik traefik version` — you should be on v2.11. Then verify `docker logs f2-traefik | grep ClientAddress` — it should show real IPs, not `104.x.x.x` / `172.x.x.x`. If not, the `forwardedHeaders.trustedIPs=` list is stale — run `./scripts/refresh-cloudflare-ips.sh`.

**Migration failed mid-deploy.** The migration step is idempotent. Check `docker logs f2-postgres` and re-run `./scripts/deploy-remote.sh` with the same `IMAGE_TAG`.

**Out of disk after weeks of deploys.** `docker image prune -af --filter "until=336h"` (14 days).

**Postgres port 5432 exposed on staging.** Intentional — bound to `127.0.0.1` only. `ssh -L 5432:localhost:5432 deploy@<vps>` to inspect.

**Staging shows up in Google.** It shouldn't — `X-Robots-Tag: noindex,nofollow` is set on all staging responses via Traefik middleware. If it does, verify: `curl -I https://staging.f2.co.th/ | grep -i robots`.
