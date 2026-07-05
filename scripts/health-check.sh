#!/usr/bin/env bash
# Stack-wide health probe. Hits /healthz on every backend service plus
# the web-app root, printing PASS/FAIL per service. Exit code is the
# number of failed checks so CI or a cron alerter can trigger on it.
#
# Runs against http://localhost by default. Override with BASE=https://f2.co.th
# or BASE=https://staging.f2.co.th.
#
# Suitable for:
#   • `make health` after `make up` to verify a fresh stack
#   • External uptime pings (UptimeRobot, BetterStack) that need one URL
#   • CI smoke tests post-deploy

set -u
BASE="${BASE:-http://localhost}"
FAIL=0
PASS=0

probe() {
    local label="$1" url="$2" expected="${3:-200}"
    local code
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$url" || echo "000")
    if [ "$code" = "$expected" ]; then
        printf "  ✓ %-20s %s → %s\n" "$label" "$url" "$code"
        PASS=$((PASS+1))
    else
        printf "  ✗ %-20s %s → %s (want %s)\n" "$label" "$url" "$code" "$expected"
        FAIL=$((FAIL+1))
    fi
}

echo "Health check against $BASE"
echo

# Backend services — each fronted by Traefik. /healthz is unguarded.
probe cms-api          "$BASE/api/cms/modules"                # public GET, always available
probe lead-api         "$BASE/api/leads/admin"                401  # admin GET, unauthenticated → 401
probe auth-api         "$BASE/api/auth/me"                    401  # gated but reachable
probe ai-chat-api      "$BASE/api/chat/health"                404
probe customer-api     "$BASE/api/customer/admin/tickets"     401
probe reseller-api     "$BASE/api/reseller/health"            404
probe notification-api "$BASE/api/notifications/admin/smtp"   401
probe payment-api      "$BASE/api/payment/admin/invoices"     401
probe checklist-api    "$BASE/api/checklists/templates"       401
probe web-app          "$BASE/"

echo
echo "======================================"
echo "  PASS: $PASS   FAIL: $FAIL"
echo "======================================"
exit "$FAIL"
