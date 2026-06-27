#!/usr/bin/env bash
# sync-modulegate.sh — propagate pkg/modulegate/modulegate.go to every
# service that uses GateModule. Add a service to CONSUMERS below to wire
# it up. With --check the script exits non-zero if any copy has drifted
# from the canonical source (use this in CI to fail PRs that edited the
# per-service copies directly).
#
# Usage:
#   scripts/sync-modulegate.sh         # write copies
#   scripts/sync-modulegate.sh --check # verify only, no writes
set -euo pipefail

cd "$(dirname "$0")/.."

CANONICAL="pkg/modulegate/modulegate.go"
if [[ ! -f "$CANONICAL" ]]; then
  echo "sync-modulegate: $CANONICAL missing" >&2
  exit 1
fi

# Each consumer service that has wired GateModule. Add new services here.
CONSUMERS=(
  services/auth-api/internal/middleware/modulegate.go
  services/lead-api/internal/middleware/modulegate.go
  services/cms-api/internal/middleware/modulegate.go
  services/ai-chat-api/internal/middleware/modulegate.go
  services/reseller-api/internal/middleware/modulegate.go
)

CHECK_ONLY=0
if [[ "${1:-}" == "--check" ]]; then
  CHECK_ONLY=1
fi

drift=0
for target in "${CONSUMERS[@]}"; do
  if [[ $CHECK_ONLY -eq 1 ]]; then
    if [[ ! -f "$target" ]] || ! diff -q "$CANONICAL" "$target" >/dev/null 2>&1; then
      echo "  drift: $target" >&2
      drift=$((drift + 1))
    fi
  else
    mkdir -p "$(dirname "$target")"
    cp "$CANONICAL" "$target"
    echo "  → $target"
  fi
done

if [[ $CHECK_ONLY -eq 1 ]]; then
  if [[ $drift -gt 0 ]]; then
    echo "sync-modulegate: $drift file(s) out of sync with $CANONICAL — run scripts/sync-modulegate.sh" >&2
    exit 1
  fi
  echo "sync-modulegate: all ${#CONSUMERS[@]} copies match $CANONICAL"
fi
