# Cloudflare in front of the VPS

The go-live plan for `f2.co.th` (and `staging.f2.co.th`) with Cloudflare acting as edge CDN, DDoS filter, and single source of TLS.

Estimated time: **30–45 minutes** if you already own the `f2.co.th` domain.

---

## What you get

- **Global edge CDN** — Cloudflare Bangkok POP serves your cached pages in <30ms to Thai visitors
- **Free DDoS mitigation** — Cloudflare absorbs L3/L4 attacks; L7 rate limits at your Traefik middleware
- **Single origin** — only Cloudflare's edge can hit port 443 on the VPS; the internet at large cannot
- **Automatic TLS renewal** — Let's Encrypt on the origin + Cloudflare Universal SSL both handle renewals
- **Zero-cost tier** — `Free` plan covers everything F2 needs; upgrade only if you need Web Analytics Pro or Bot Fight Mode Enterprise

Trade-offs vs bare-VPS: one more external dependency (CF outage = your outage) and one more dashboard to look at when something's wrong. Worth it.

---

## Prerequisites

- Ownership of the `f2.co.th` domain at your current registrar (Namecheap / GoDaddy / whoever)
- VPS reachable at a public IP (`VPS_IP` below — get it with `curl ifconfig.me` from the VPS)
- `.env` populated per [production-readiness.md](production-readiness.md) § 3
- `make prod-up` at least once so Traefik has bootstrapped Let's Encrypt

---

## 1. Add site to Cloudflare (dashboard)

1. Sign up / log in at [dash.cloudflare.com](https://dash.cloudflare.com/).
2. **Add site** → enter `f2.co.th` → **Free plan** → **Continue**.
3. Cloudflare scans your existing DNS. Confirm the records it found are correct. You should see:
   - `A f2.co.th → <old-hosting-IP>` (probably wrong now — will fix in step 3)
   - `MX f2.co.th → <mail-provider>` (leave this alone; Cloudflare doesn't proxy MX)
4. Cloudflare gives you **two nameservers** (e.g. `ns1.cloudflare.com`, `ns2.cloudflare.com`).
5. At your **registrar**, replace the current nameservers with those two.
6. Wait 5–60 minutes for propagation. Cloudflare emails you when the site is `Active`.

---

## 2. DNS records — the F2 topology

Once Cloudflare is `Active`, go to **DNS → Records** and set these:

| Type | Name | Content | Proxy | TTL | Purpose |
|------|------|---------|-------|-----|---------|
| A    | `f2.co.th`         | `<VPS_IP>` | ✅ Proxied | Auto | Main site |
| A    | `staging`          | `<VPS_IP>` | ✅ Proxied | Auto | Staging environment |
| CNAME | `www`             | `f2.co.th` | ✅ Proxied | Auto | Redirect www → apex |
| A    | `direct` (optional) | `<VPS_IP>` | ⚫ DNS only | Auto | Direct-to-origin for debugging; do not publish |
| MX   | `f2.co.th`         | (your mail host) | ⚫ DNS only | Auto | Mail — must NOT be proxied |
| TXT  | `f2.co.th`         | `v=spf1 ...` | ⚫ DNS only | Auto | SPF |

**Rules:**

- **Proxied (orange cloud)** on `f2.co.th`, `staging`, and `www`. That's what routes traffic through Cloudflare's edge and hides your VPS IP.
- **DNS only (grey cloud)** on `MX`, `SPF`, `DKIM`, `DMARC`, and any diagnostic subdomain. If you proxy mail, mail breaks.

---

## 3. SSL/TLS mode

**SSL/TLS → Overview → Encryption mode: Full (strict)**.

That means:

- Browser ↔ Cloudflare uses Cloudflare's Universal SSL (auto-issued, free)
- Cloudflare ↔ your VPS uses the Let's Encrypt cert Traefik already terminates

**"Full (strict)"** requires your origin cert to be valid and match the hostname. Let's Encrypt issues one automatically the first time Traefik boots after DNS points at the VPS — no extra work on your side.

If you want an even longer-lived cert on the origin (15-year Cloudflare Origin CA cert), see § 8 "Optional: Origin CA cert."

---

## 4. Firewall — lock port 443 to Cloudflare only

The whole point of putting Cloudflare in front is that only Cloudflare should ever reach your VPS on 443. Anything else is probably a scanner or a leaked-IP-based attack.

Run this on the VPS **after Cloudflare is Active** (not before — you'll lock yourself out):

```bash
sudo bash /opt/f2-website/scripts/firewall-cloudflare-only.sh apply
```

The script (shipped in this branch) does:

- Fetches the current Cloudflare edge IPs from `cloudflare.com/ips-v4` and `/ips-v6`
- Sets `ufw` (or `iptables`) rules: **allow 443/tcp from each CF range**, deny all other 443 traffic
- Keeps port `22/tcp` open to the world so you can still SSH (add your own IP allow-list on 22 separately if you want)
- Prints the resulting rules for review

Roll back at any time:

```bash
sudo bash /opt/f2-website/scripts/firewall-cloudflare-only.sh clear
```

Cron to re-apply monthly (Cloudflare occasionally adds new ranges):

```
0 3 15 * * root /opt/f2-website/scripts/firewall-cloudflare-only.sh apply >/dev/null
```

---

## 5. Cloudflare rules to configure

### Speed → Optimization

- **Auto Minify** (JS, CSS, HTML) — off. Next.js already ships minified output; a double minifier occasionally breaks things.
- **Brotli** — on.
- **Rocket Loader** — off. Breaks Next.js hydration.
- **Early Hints** — on. Cheap free win for LCP.

### Caching → Configuration

- **Browser Cache TTL** — Respect existing headers (Next.js sends the right ones).
- **Always Online** — on. Cloudflare serves a stale copy when your VPS is down.

### Caching → Cache Rules (Rules → Cache Rules → Create rule)

Static asset caching is essential; the OG images and sitemap benefit especially:

| Rule name | If URL matches | Then |
|---|---|---|
| Cache OG images | `/opengraph-image` or `*/opengraph-image` | Cache eligibility: Eligible for cache · Edge TTL: 1 hour |
| Cache sitemap | `/sitemap.xml` | Edge TTL: 30 minutes |
| Cache robots + llms | `/robots.txt`, `/llms.txt`, `/llms-full.txt` | Edge TTL: 30 minutes |
| Cache _next static | `/_next/static/*` | Edge TTL: 1 year (Next hashes filenames) |
| Bypass API | `/api/*` | Bypass cache — API responses must not be cached at edge |
| Bypass admin/portal | `/admin/*` or `/portal/*` | Bypass cache — session-dependent |

### Security → Bots

- **Bot Fight Mode** — on. Free-tier version blocks obvious scrapers.
- **Verified Bots** — allow Googlebot, Bingbot, GPTBot, ClaudeBot, PerplexityBot etc. (for AEO/GEO — you *want* these indexing).

### Security → WAF → Managed Rules

- Free plan gives you the OWASP Core Rule Set. Turn on.
- Set the sensitivity to **Medium**. High false-positives on admin form submissions.

### Security → Settings

- **Security Level** — Medium.
- **Challenge Passage** — 30 minutes.

### Rules → Page Rules (or the newer Rules → Configuration Rules)

- `f2.co.th/admin*` and `f2.co.th/portal*` — **Security Level: High**. Extra scrutiny on backoffice URLs.
- `www.f2.co.th/*` — **Forwarding URL: 301, `https://f2.co.th/$1`**. Canonical single-host.

---

## 6. Verify

From your laptop:

```bash
dig +short f2.co.th
# Expect: two Cloudflare IPs (104.x or 172.x range), NOT your VPS IP

curl -sIL https://f2.co.th/ | head
# Expect: `Server: cloudflare`, `CF-Ray: <id>`, HTTP/2 200

curl -sI https://f2.co.th/opengraph-image?_bust=$(date +%s)
# Expect: `Cache-Status: MISS` first hit → `HIT` on subsequent hits

curl -sIL https://<VPS_IP>/ --resolve f2.co.th:443:<VPS_IP>
# Expect: connection refused OR ssl handshake failure
# (proves firewall lockdown works — only CF can reach origin)
```

From the VPS:

```bash
sudo ufw status | head -20
# Expect: 443/tcp allowed from each of ~15 Cloudflare ranges, DENY from any others

docker exec f2-traefik cat /letsencrypt/acme.json | jq '.letsencrypt.Certificates[].domain'
# Expect: {"main":"f2.co.th"} — cert issued for the real host, not a CF hostname
```

---

## 7. Staging environment (same pattern)

Point `staging.f2.co.th` at the same VPS. If you use a second VPS for staging, use a second A record with its own IP.

The `.github/workflows/deploy.yml` on this branch pushes to `staging.f2.co.th` when you push to the `staging` branch, and to `f2.co.th` when you push to `main`. Both go through Cloudflare identically.

---

## 8. Optional: Cloudflare Origin CA cert (15-year cert on the origin)

If you'd rather not have Let's Encrypt renewals happening on the origin, you can issue a Cloudflare Origin CA cert that lives for 15 years and is trusted by Cloudflare's edge (only).

1. **SSL/TLS → Origin Server → Create Certificate → RSA 2048 → 15 years → Create**.
2. Save the cert as `/etc/traefik/origin.crt` and the key as `/etc/traefik/origin.key` on the VPS.
3. Add to Traefik's dynamic config (see `traefik/dynamic/origin-cert.yml` shipped in this branch — currently commented out).
4. Remove the `--certificatesresolvers.letsencrypt.*` flags from `docker-compose.prod.yml`.

Trade-off: valid only behind Cloudflare. If you ever bypass Cloudflare (e.g. for `direct.f2.co.th`), browsers will show a warning.

Most people don't do this. Let's Encrypt on the origin works fine.

---

## 9. Runbook — Cloudflare is having issues

- **CF is up but slow** — check `dash.cloudflare.com/<zone>/analytics/traffic`. If real users are affected, temporarily set the site to **Development Mode** (Caching → Configuration → Development Mode: On) — bypasses CF cache for 3 hours.
- **CF is down entirely** — set your DNS records to **DNS only** (grey cloud) via `dash.cloudflare.com`. Traffic flows directly to the VPS. Firewall will still block! Run `scripts/firewall-cloudflare-only.sh clear` on the VPS to open 443 to the world temporarily. Restore both after the incident.
- **CF blocking legitimate users** — Cloudflare Dashboard → Security → Events → Manage Detected Issues. Whitelist the false-positive rule.

---

## 10. Cost

- **Cloudflare Free** — $0/month. Everything above works on Free.
- **VPS** — unchanged.
- **Total marginal cost of adding Cloudflare** — $0.

If you ever need it, **Pro** ($20/month per domain) adds Web Analytics Pro, image optimization, mobile optimization, and higher rate-limit rules. Skip unless you have a specific reason.

---

## What we don't do

- **Cloudflare Workers** — no serverless functions at the edge. Everything runs on your VPS.
- **Cloudflare R2** — no object storage yet. Photo uploads live on the VPS's `checklist-uploads` volume.
- **Cloudflare Access** — no zero-trust auth in front of `/admin`. Your JWT + Traefik rate limits are the story there.

Any of these can be layered on later without changing the current setup.
