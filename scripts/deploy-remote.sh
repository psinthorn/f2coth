#!/usr/bin/env bash
# scripts/deploy-remote.sh
#
# Runs on the target VPS from /opt/f2-website.
# Called by .github/workflows/deploy.yml — DO NOT run by hand unless you
# know what you're doing (it will pull tagged images and restart the stack).
#
# Env expected (set by the caller):
#   IMAGE_TAG      git sha to deploy
#   ENVIRONMENT    "staging" | "production"
#   GHCR_OWNER     GHCR owner (e.g. f2coltd)
#   GHCR_USER      GitHub actor
#   GHCR_TOKEN     GITHUB_TOKEN (short-lived, provided by Actions)
#
# .env must already exist on the server at /opt/f2-website/.env with all
# app secrets filled in. This script rewrites two lines only:
#   IMAGE_TAG=<sha>
#   GHCR_OWNER=<owner>

set -euo pipefail

cd /opt/f2-website

: "${IMAGE_TAG:?IMAGE_TAG required}"
: "${ENVIRONMENT:?ENVIRONMENT required}"
: "${GHCR_OWNER:?GHCR_OWNER required}"

echo "→ Deploying $ENVIRONMENT @ $IMAGE_TAG"

# ------------------------------------------------------------------
# 1. Pick overlay
# ------------------------------------------------------------------
case "$ENVIRONMENT" in
  production) OVERLAY=docker-compose.prod.yml ;;
  staging)    OVERLAY=docker-compose.staging.yml ;;
  *) echo "unknown ENVIRONMENT=$ENVIRONMENT" >&2; exit 2 ;;
esac

COMPOSE=(docker compose -f docker-compose.yml -f "$OVERLAY" --env-file .env)

# ------------------------------------------------------------------
# 2. Ensure .env exists, patch IMAGE_TAG + GHCR_OWNER
# ------------------------------------------------------------------
if [ ! -f .env ]; then
  echo "::error:: /opt/f2-website/.env not found — provision it first (see docs/deploy.md)" >&2
  exit 3
fi

# Idempotent replace-or-append for a single KEY=VALUE line.
set_env() {
  local key="$1" val="$2"
  if grep -qE "^${key}=" .env; then
    sed -i "s|^${key}=.*|${key}=${val}|" .env
  else
    printf '\n%s=%s\n' "$key" "$val" >> .env
  fi
}
set_env IMAGE_TAG   "$IMAGE_TAG"
set_env GHCR_OWNER  "$GHCR_OWNER"

# ------------------------------------------------------------------
# 3. Login to GHCR (private packages need this even for pull)
# ------------------------------------------------------------------
if [ -n "${GHCR_TOKEN:-}" ]; then
  echo "$GHCR_TOKEN" | docker login ghcr.io -u "${GHCR_USER:-x}" --password-stdin >/dev/null
fi

# ------------------------------------------------------------------
# 4. Pull, run DB migrations, bring up
# ------------------------------------------------------------------
echo "→ Pulling images"
"${COMPOSE[@]}" pull

echo "→ Ensuring postgres is up before migrating"
"${COMPOSE[@]}" up -d postgres
# Wait for healthcheck to flip
for i in {1..30}; do
  status=$(docker inspect --format='{{.State.Health.Status}}' f2-postgres 2>/dev/null || echo starting)
  [ "$status" = "healthy" ] && break
  sleep 2
done

echo "→ Applying migrations (idempotent — files use CREATE TABLE IF NOT EXISTS etc.)"
for f in $(ls database/migrations/*.sql | sort); do
  echo "   apply $f"
  "${COMPOSE[@]}" exec -T postgres psql \
    -U "$(grep -E '^POSTGRES_USER=' .env | cut -d= -f2)" \
    -d "$(grep -E '^POSTGRES_DB=' .env | cut -d= -f2)" \
    -v ON_ERROR_STOP=1 < "$f" > /dev/null || {
      echo "::warning::migration $f returned non-zero (may already be applied)"
    }
done

echo "→ Bringing stack up"
"${COMPOSE[@]}" up -d --remove-orphans

echo "→ Pruning old images"
docker image prune -f --filter "until=168h" >/dev/null

echo "✅ Deploy complete: $ENVIRONMENT @ $IMAGE_TAG"
"${COMPOSE[@]}" ps
