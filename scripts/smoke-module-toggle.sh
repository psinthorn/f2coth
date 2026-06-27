#!/usr/bin/env bash
# smoke-module-toggle.sh — end-to-end check of the module-toggle pipeline.
#
# Verifies that toggling `public.blog` off via the admin API removes the
# section from BOTH the frontend (page returns 404) AND the public sitemap
# (URL drops out), and that toggling back restores everything. Same script
# can be reused for other public.* modules by editing MODULE_KEY +
# PAGE_PATH below.
#
# Requires the dev stack to be running (`make up`) and the env vars below:
#   JWT_SECRET       — must match the value in .env (HMAC for the admin JWT)
#   ADMIN_USER_ID    — UUID of an existing admin in the users table
#   F2_HOST          — base URL of Traefik (defaults to http://localhost)
#
# Exit codes:
#   0  every assertion passed
#   1  one or more assertions failed (CI should fail the build)
#   2  environment / prerequisite missing
set -euo pipefail

F2_HOST="${F2_HOST:-http://localhost}"
MODULE_KEY="public.blog"
PAGE_PATH="/blog"  # bare default-locale URL; redirects to /blog under "as-needed"

require() {
  if [[ -z "${!1:-}" ]]; then
    echo "smoke: $1 is required (see header)" >&2
    exit 2
  fi
}
require JWT_SECRET
require ADMIN_USER_ID

# Mint a short-lived admin JWT for the PATCH calls. Python is in every
# dev environment we target; avoids adding a heavier JWT CLI dependency.
TOKEN=$(python3 -c "
import hmac, hashlib, base64, json, time
def b64(b): return base64.urlsafe_b64encode(b).rstrip(b'=').decode()
h = b64(json.dumps({'alg':'HS256','typ':'JWT'},separators=(',',':')).encode())
p = b64(json.dumps({'sub':'$ADMIN_USER_ID','role':'admin','iss':'f2.co.th','exp':int(time.time())+600},separators=(',',':')).encode())
sig = b64(hmac.new(b'$JWT_SECRET',(h+'.'+p).encode(),hashlib.sha256).digest())
print(f'{h}.{p}.{sig}')
")

fail=0
assert_http() {
  local label="$1" expected="$2" url="$3"
  local got
  got=$(curl -s -o /dev/null -w '%{http_code}' "$url")
  if [[ "$got" == "$expected" ]]; then
    printf "  %-55s ✓ %s\n" "$label" "$got"
  else
    printf "  %-55s ✗ expected %s, got %s\n" "$label" "$expected" "$got" >&2
    fail=$((fail + 1))
  fi
}

assert_sitemap_contains() {
  local label="$1" needle="$2" mode="$3"   # mode = "present" | "absent"
  local sitemap
  sitemap=$(curl -s "$F2_HOST/sitemap.xml")
  if echo "$sitemap" | grep -q "$needle"; then
    if [[ "$mode" == "present" ]]; then
      printf "  %-55s ✓ contains %s\n" "$label" "$needle"
    else
      printf "  %-55s ✗ %s should be absent\n" "$label" "$needle" >&2
      fail=$((fail + 1))
    fi
  else
    if [[ "$mode" == "absent" ]]; then
      printf "  %-55s ✓ absent %s\n" "$label" "$needle"
    else
      printf "  %-55s ✗ %s should be present\n" "$label" "$needle" >&2
      fail=$((fail + 1))
    fi
  fi
}

toggle() {
  local enabled="$1"
  curl -s -X PATCH "$F2_HOST/api/cms/admin/modules/$MODULE_KEY" \
    -H "Authorization: Bearer $TOKEN" \
    -H 'Content-Type: application/json' \
    -d "{\"enabled\":$enabled}" > /dev/null
}

echo "=== Baseline: $MODULE_KEY should be enabled ==="
toggle true
sleep 2
assert_http       "baseline $PAGE_PATH"             "200" "$F2_HOST$PAGE_PATH"
assert_sitemap_contains "baseline sitemap has $PAGE_PATH" "$PAGE_PATH" "present"

echo ""
echo "=== Toggle OFF ==="
toggle false
# Frontend modules.ts uses cache: "no-store" → instant. API gate caches
# 30s but this script tests UI gating only.
sleep 2
assert_http       "after-off $PAGE_PATH"            "404" "$F2_HOST$PAGE_PATH"
assert_sitemap_contains "after-off sitemap drops $PAGE_PATH" "$PAGE_PATH" "absent"

echo ""
echo "=== Toggle ON again ==="
toggle true
sleep 2
assert_http       "restored $PAGE_PATH"             "200" "$F2_HOST$PAGE_PATH"
assert_sitemap_contains "restored sitemap has $PAGE_PATH" "$PAGE_PATH" "present"

echo ""
if [[ $fail -eq 0 ]]; then
  echo "smoke: all assertions passed ✓"
else
  echo "smoke: $fail assertion(s) failed ✗" >&2
  exit 1
fi
