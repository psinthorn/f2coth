# Backup & restore — Postgres

This playbook covers the PostgreSQL data that backs every F2 service. The
database is the system of record for:

- Customer / contact / domain / SLA records (`customer-api`)
- Leads + contact-form submissions (`lead-api`)
- DSR submissions (`auth-api`) — **legal evidence under PDPA**
- `audit_log` — actor + diff trail across DSR + module toggles + future
  resources; also **legal evidence**
- CMS content (`cms-api`)
- AI chat sessions (`ai-chat-api`)
- Reseller domain orders (`reseller-api`)
- Module toggle state (`modules`)

Losing the volume means losing all of the above. Treat backups as a P0
operational responsibility.

---

## Where the data lives

- **Container:** `f2-postgres` (image `postgres:16-alpine`)
- **Docker volume:** `f2-website_postgres-data`
- **Data dir inside container:** `/var/lib/postgresql/data`
- **DB name:** `f2_website`
- **DB user:** value of `${POSTGRES_USER}` in `.env` (default `f2`)

---

## Daily backup (recommended)

Run from the repo root on the host:

```bash
TS=$(date +%Y%m%d-%H%M%S)
mkdir -p backups
docker exec f2-postgres pg_dump -U "${POSTGRES_USER:-f2}" -d f2_website \
  --no-owner --no-privileges --format=custom \
  > "backups/f2_website-${TS}.dump"
```

Output is a custom-format pg_dump (compressed, supports parallel restore).
A 30-day rotating retention is reasonable for F2's volume:

```bash
find backups -name 'f2_website-*.dump' -mtime +30 -delete
```

Schedule both via cron on the host:

```cron
0 2 * * * cd /path/to/f2-website && bash scripts/backup.sh >> /var/log/f2-backup.log 2>&1
```

(`scripts/backup.sh` is left as a TODO — script the two commands above.)

### Off-host copy

The daily dump is useless if the host dies. Sync `backups/` to an
off-host store every day:

- S3 / B2: `aws s3 sync backups s3://f2-postgres-backups/`
- Rsync to another machine: `rsync -a backups/ ops@backup-host:f2-postgres-backups/`

---

## Verify a backup is restorable (monthly)

A backup that has never been tested is not a backup. Once a month:

```bash
docker run --rm -d --name pgcheck -e POSTGRES_PASSWORD=test \
  -v "$(pwd)/backups:/backups:ro" postgres:16-alpine

# wait ~5s for it to come up, then:
docker exec pgcheck pg_restore -U postgres -d postgres --create \
  /backups/f2_website-<LATEST>.dump

docker exec pgcheck psql -U postgres -d f2_website \
  -c "SELECT COUNT(*) FROM data_subject_requests; SELECT COUNT(*) FROM audit_log;"

docker rm -f pgcheck
```

Both counts should match production. Anything else = investigate.

---

## Restore in an incident

**STOP all services first** so they don't write to a half-restored DB:

```bash
docker compose stop auth-api lead-api cms-api ai-chat-api notification-api customer-api reseller-api web-app
```

Then restore:

```bash
# WARNING: destroys current DB contents.
docker exec f2-postgres dropdb -U "${POSTGRES_USER:-f2}" --if-exists f2_website
docker exec f2-postgres createdb -U "${POSTGRES_USER:-f2}" f2_website
cat backups/f2_website-<TS>.dump \
  | docker exec -i f2-postgres pg_restore -U "${POSTGRES_USER:-f2}" -d f2_website
docker compose start auth-api lead-api cms-api ai-chat-api notification-api customer-api reseller-api web-app
```

Audit the restore via the same SELECTs as the monthly verification.

---

## What backups do NOT cover

- **Application code** — that lives in git, not the DB volume.
- **Docker images** — rebuild from source via `make build`.
- **TLS certificates** (`f2-website_traefik-letsencrypt` volume) — Traefik
  re-issues from Let's Encrypt automatically on first boot after restore,
  so no separate backup needed.
- **In-flight HTTP requests / chat sessions** — lost when the DB is
  restored to an earlier point. Customers may need to re-submit.

---

## Open improvements

- Script `scripts/backup.sh` + add to crontab (no script committed yet).
- WAL-archiving for point-in-time recovery (current strategy is daily snapshots only).
- Encrypted backups (e.g. `gpg --symmetric`) before off-host sync.
