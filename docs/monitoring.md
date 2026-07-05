# Monitoring & observability

The minimum viable ops story: every service exposes `/healthz`, we run a stack-wide probe script for local smoke tests, and Docker restarts unhealthy containers automatically. External uptime pinging is a paid dependency — we recommend BetterStack or UptimeRobot pointed at the aggregator endpoints below.

---

## Local health probe

```bash
make health              # against http://localhost (dev)
BASE=https://staging.f2.co.th make health
BASE=https://f2.co.th    make health
```

Exit code is the number of failed services, so this is safe for CI + cron alerts.

---

## Docker healthchecks

Every service in `docker-compose.yml` has a `healthcheck:` block that hits its own `/healthz` (or reachable proxy) every 30s. Unhealthy containers are restarted automatically per `restart: unless-stopped`.

To inspect the current state:

```bash
docker compose ps                          # STATUS column shows (healthy)/(unhealthy)
docker inspect --format='{{.State.Health.Status}}' f2-checklist-api
```

---

## External uptime monitoring (pick one)

### BetterStack (recommended)

- Sign up at betterstack.com, create a "Uptime" monitor.
- URL: `https://f2.co.th/api/checklists/templates`
- Expected HTTP status: `401` (proves the service is up + auth-gate reachable)
- Check interval: 60s from 3 regions
- Alert channels: email + Slack + phone for P0
- Set up a monitor per service using the URLs in `scripts/health-check.sh`.

### UptimeRobot (cheaper alternative)

- Free tier: 50 monitors, 5-minute interval
- Use "Keyword" monitor type against `/api/cms/modules` with `"key"` as the required keyword
- Free tier alerts by email only; upgrade for SMS

---

## What we don't have yet (deliberate)

- **Prometheus / Grafana / Loki** — a proper metrics + logs stack is a multi-week investment. Deferred until we hit a scale problem that healthcheck+external-ping can't diagnose.
- **APM / distributed tracing** — same reasoning.
- **Error tracking (Sentry / Rollbar)** — recommended next step. Frontend integration is `npm install @sentry/nextjs` + one file; Go services can use `sentry-go`.

If any of the above become blockers, the migration path is: add Prometheus `/metrics` endpoints per service, docker-compose in `prom/prometheus` + `grafana/grafana`, and point BetterStack alerts at Grafana webhooks. Same probe surface, one more layer of detail.

---

## Runbook — a service is unhealthy

1. `docker compose ps` — is the container actually running? If `Exit 1`, check `docker compose logs <service> --tail=200`.
2. Container running but `/healthz` returns 5xx: usually DB reachability. `docker compose logs postgres` — is it healthy? `make db-shell` to confirm.
3. Container running, `/healthz` OK, but real endpoints fail: likely a code bug post-deploy. Roll back via `IMAGE_TAG=<prev-sha> docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d`.
4. Entire stack down: SSH to VPS, `cd /opt/f2-website`, `docker compose ps`. If Docker daemon itself is unhealthy, `sudo systemctl restart docker`. Compose will bring everything back — data is on the `pgdata` and `checklist-uploads` volumes.
