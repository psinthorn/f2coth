#!/usr/bin/env bash
# scripts/refresh-cloudflare-ips.sh
#
# Fetches the current Cloudflare edge IP ranges and rewrites the
# `forwardedHeaders.trustedIPs=` lines in docker-compose.{prod,staging}.yml.
#
# Cloudflare occasionally adds new ranges; if the compose files fall behind,
# requests from those new edges are treated as untrusted and rate-limit
# middleware sees the CF IP instead of the real client.
#
# Usage:
#   ./scripts/refresh-cloudflare-ips.sh              # rewrite files in place
#   ./scripts/refresh-cloudflare-ips.sh --check      # exit 1 if out of date
#
# Recommended cron on the VPS (monthly):
#   0 3 1 * * cd /opt/f2-website && ./scripts/refresh-cloudflare-ips.sh --check \
#             || (./scripts/refresh-cloudflare-ips.sh && \
#                 docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d traefik)

set -euo pipefail

MODE="${1:-write}"

v4=$(curl -sSf https://www.cloudflare.com/ips-v4 | tr '\n' ',' | sed 's/,$//')
v6=$(curl -sSf https://www.cloudflare.com/ips-v6 | tr '\n' ',' | sed 's/,$//')
combined="${v4},${v6}"

if [ -z "$v4" ] || [ -z "$v6" ]; then
  echo "::error::failed to fetch Cloudflare IP lists" >&2
  exit 2
fi

files=(
  "docker-compose.prod.yml"
  "docker-compose.staging.yml"
)

drift=0
for f in "${files[@]}"; do
  if [ ! -f "$f" ]; then
    echo "::warning::missing $f" >&2
    continue
  fi
  current=$(grep -oE 'forwardedHeaders\.trustedIPs=[^"]+' "$f" | head -1 | cut -d= -f2- || true)
  if [ "$current" != "$combined" ]; then
    drift=1
    if [ "$MODE" = "--check" ]; then
      echo "::warning::$f is out of date with Cloudflare IPs"
    else
      # Replace every occurrence of the trustedIPs= line
      # (works for both web and websecure entrypoints)
      sed -i.bak -E "s|(forwardedHeaders\.trustedIPs=)[^\"'[:space:]]+|\1${combined}|g" "$f"
      rm -f "${f}.bak"
      echo "→ updated $f"
    fi
  fi
done

if [ "$MODE" = "--check" ]; then
  [ "$drift" = 0 ] && echo "Cloudflare IPs current." || exit 1
fi
