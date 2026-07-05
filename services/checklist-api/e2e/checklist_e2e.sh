#!/usr/bin/env bash
# checklist-api end-to-end + CRUD probe.
#
# Runs against a live local stack. Requires:
#   - `make up` and migrations applied (through 041)
#   - Miskawaan customer + owner contact seeded (`slug='miskawaan-villas'`)
#   - JWT_SECRET readable from the repo root .env
#
# Usage:
#   bash services/checklist-api/e2e/checklist_e2e.sh
#
# Exit code is the number of failed checks. 50 pass / 0 fail is the
# green baseline; anything below means a regression against the state
# captured in the last pipeline run (see memories/repo/pipeline-runs.md).
#
# What we exercise:
#   1. Auth gates — no token, invalid token, wrong role, wrong audience
#   2. Templates CRUD + import
#   3. Projects CRUD + customer link + visibility flag
#   4. Module attach/detach/reorder + duplicate rejection
#   5. Item PATCH (status/note) + audit_log side effect
#   6. Photo upload (multipart) + serve back + MIME allowlist + traversal
#   7. Visit logs create + list
#   8. Report weekly / monthly / garbage-range fallback
#   9. Weekly summary email — enqueue against notification-api
#  10. Portal customer read-view + cross-customer isolation + visibility gate
#
# Cleans up its own residue on the Miskawaan project at the end.

set -u

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SECRET="$(grep '^JWT_SECRET=' "$REPO_ROOT/.env" | cut -d= -f2-)"
if [ -z "$SECRET" ]; then
    echo "JWT_SECRET not found in $REPO_ROOT/.env — abort." >&2
    exit 99
fi

CID=$(docker exec f2-postgres psql -U f2 -d f2_website -tAc "SELECT id FROM customers WHERE slug='miskawaan-villas';")
CONTACT=$(docker exec f2-postgres psql -U f2 -d f2_website -tAc "SELECT id FROM customer_contacts WHERE customer_id='$CID' LIMIT 1;")
ADMIN_UID=$(docker exec f2-postgres psql -U f2 -d f2_website -tAc "SELECT id FROM users WHERE role='admin' AND is_active=true LIMIT 1;")

if [ -z "$CID" ] || [ -z "$CONTACT" ] || [ -z "$ADMIN_UID" ]; then
    echo "Seed data missing (customer / contact / admin user). Run migrations first." >&2
    exit 98
fi

# Mint HS256 tokens with only the stdlib — avoids a pyjwt dependency on
# the developer's machine. Emits 5 env-var lines we source below.
python3 - <<PY > /tmp/checklist_e2e_tokens.env
import time, hmac, hashlib, base64, json
secret = """$SECRET""".strip()
def b64(x): return base64.urlsafe_b64encode(x).rstrip(b'=').decode()
def mint(claims):
    h = b64(json.dumps({"alg":"HS256","typ":"JWT"}).encode())
    p = b64(json.dumps(claims).encode())
    sig = b64(hmac.new(secret.encode(), f"{h}.{p}".encode(), hashlib.sha256).digest())
    return f"{h}.{p}.{sig}"
now = int(time.time())
print("ADMIN_TOKEN=" + mint({"sub":"$ADMIN_UID","role":"admin","iat":now,"exp":now+3600}))
print("EDITOR_TOKEN=" + mint({"sub":"$ADMIN_UID","role":"editor","iat":now,"exp":now+3600}))
print("VIEWER_TOKEN=" + mint({"sub":"$ADMIN_UID","role":"viewer","iat":now,"exp":now+3600}))
print("CUSTOMER_TOKEN=" + mint({"sub":"$CONTACT","aud":"customer","customer_id":"$CID","role":"owner","iat":now,"exp":now+3600}))
print("FOREIGN_CUSTOMER_TOKEN=" + mint({"sub":"deadbeef","aud":"customer","customer_id":"11111111-1111-1111-1111-111111111111","role":"owner","iat":now,"exp":now+3600}))
PY
# shellcheck disable=SC1091
source /tmp/checklist_e2e_tokens.env

BASE="${BASE:-http://localhost/api/checklists}"
PASS=0
FAIL=0

probe() {
    local method="$1" path="$2" token="$3" want="$4" body="${5:-}" desc="${6:-$method $path}"
    local hdrs=(-H "Accept: application/json")
    [ -n "$token" ] && hdrs+=(-H "Authorization: Bearer $token")
    local args=(-s -o /tmp/last_body.txt -w "%{http_code}" -X "$method" "$BASE$path")
    if [ -n "$body" ]; then
        hdrs+=(-H "Content-Type: application/json")
        args+=(-d "$body")
    fi
    local code
    code=$(curl "${hdrs[@]}" "${args[@]}")
    if [ "$code" = "$want" ]; then
        echo "  PASS  $code  $desc"
        PASS=$((PASS+1))
    else
        echo "  FAIL  $code (want $want)  $desc"
        echo "        body: $(head -c 200 /tmp/last_body.txt)"
        FAIL=$((FAIL+1))
    fi
}
json_get() { python3 -c "import json,sys; d=json.load(open('/tmp/last_body.txt')); print(d$1)" 2>/dev/null; }
pg() { docker exec f2-postgres psql -U f2 -d f2_website -tAc "$1"; }

# ── 1. Auth gates ─────────────────────────────────────────────────────
echo "=== Auth gates ==="
probe GET  "/templates"           ""                          401 "" "GET templates without token → 401"
probe GET  "/templates"           "invalid.jwt.token"         401 "" "GET templates with garbage token → 401"
probe GET  "/templates"           "$VIEWER_TOKEN"             200 "" "GET templates as viewer → 200"
probe POST "/admin/templates"     "$EDITOR_TOKEN"             403 '{"code":"Z","name_en":"","name_th":""}' "admin write as editor → 403"
probe POST "/admin/templates"     "$VIEWER_TOKEN"             403 '{"code":"Z","name_en":"","name_th":""}' "admin write as viewer → 403"
probe PATCH "/items/00000000-0000-0000-0000-000000000000" "$VIEWER_TOKEN" 403 '{"status":"pass"}' "item PATCH as viewer → 403"
probe GET  "/portal/projects"     "$ADMIN_TOKEN"              403 "" "portal endpoint with staff token → 403"
probe GET  "/portal/projects"     ""                          401 "" "portal endpoint without token → 401"

# ── 2. Templates CRUD ────────────────────────────────────────────────
echo "=== Templates CRUD ==="
probe GET "/templates" "$ADMIN_TOKEN" 200 "" "list templates"
TEMPLATE_ID=$(json_get "['templates'][0]['id']")
probe GET "/templates/$TEMPLATE_ID" "$ADMIN_TOKEN" 200 "" "get template with items"
probe POST "/admin/templates" "$ADMIN_TOKEN" 201 \
    '{"code":"E2E-TEST","name_en":"E2E Test","name_th":"ทดสอบ","sort_order":99}' \
    "create template"
NEW_TID=$(json_get "['id']")
probe PATCH "/admin/templates/$NEW_TID" "$ADMIN_TOKEN" 204 '{"name_en":"E2E Test Updated"}' "update template"
probe DELETE "/admin/templates/$NEW_TID" "$ADMIN_TOKEN" 204 "" "delete template"
probe POST "/admin/templates/import" "$ADMIN_TOKEN" 200 \
    '{"modules":[{"code":"E2E-IMPORT","name_en":"Import Test","name_th":"นำเข้า","sort":100,"items":[{"text_en":"one","text_th":"หนึ่ง","sort":1,"required":true},{"text_en":"two","text_th":"สอง","sort":2,"required":false}]}]}' \
    "import templates"
pg "DELETE FROM checklist_templates WHERE code='E2E-IMPORT';" > /dev/null

# ── 3. Projects CRUD ────────────────────────────────────────────────
echo "=== Projects CRUD ==="
probe GET "/projects" "$ADMIN_TOKEN" 200 "" "list projects"
PID=$(python3 -c "import json; d=json.load(open('/tmp/last_body.txt')); m=[p for p in d['projects'] if 'Miskawaan' in p['name']]; print(m[0]['id'] if m else '')")
probe GET "/projects/$PID" "$ADMIN_TOKEN" 200 "" "get project"
probe GET "/projects/$PID/board" "$ADMIN_TOKEN" 200 "" "get project board"
probe GET "/projects/$PID/progress" "$ADMIN_TOKEN" 200 "" "get project progress"
probe POST "/admin/projects" "$ADMIN_TOKEN" 201 \
    '{"client_name":"E2E Test","name":"E2E Test Project","status":"active","visible_to_customer":false}' \
    "create project"
E2E_PID=$(json_get "['id']")
probe PATCH "/admin/projects/$E2E_PID" "$ADMIN_TOKEN" 204 '{"status":"paused"}' "update project status"

# ── 4. Module lifecycle ────────────────────────────────────────
echo "=== Module lifecycle ==="
probe POST "/projects/$E2E_PID/modules" "$ADMIN_TOKEN" 201 \
    "{\"template_id\":\"$TEMPLATE_ID\"}" "attach first module"
PM1=$(json_get "['id']")
T2_ID=$(pg "SELECT id FROM checklist_templates WHERE code='B';")
probe POST "/projects/$E2E_PID/modules" "$ADMIN_TOKEN" 201 \
    "{\"template_id\":\"$T2_ID\"}" "attach second module"
PM2=$(json_get "['id']")
probe POST "/projects/$E2E_PID/modules" "$ADMIN_TOKEN" 409 \
    "{\"template_id\":\"$TEMPLATE_ID\"}" "attach dup → 409"
probe PATCH "/projects/$E2E_PID/modules/reorder" "$ADMIN_TOKEN" 204 \
    "{\"order\":[\"$PM2\",\"$PM1\"]}" "reorder modules"
probe DELETE "/projects/$E2E_PID/modules/$PM2" "$ADMIN_TOKEN" 204 "" "detach module"

# ── 5. Item PATCH + audit ────────────────────────────────────
echo "=== Item PATCH + audit log ==="
ITEM_ID=$(pg "SELECT pi.id FROM project_items pi JOIN project_modules pm ON pm.id=pi.project_module_id WHERE pm.id='$PM1' ORDER BY pi.sort_order LIMIT 1;")
pg "DELETE FROM audit_log WHERE resource_id='$ITEM_ID';" > /dev/null
probe PATCH "/items/$ITEM_ID" "$EDITOR_TOKEN" 204 '{"status":"pass","note":"e2e note"}' "editor sets pass + note"
probe PATCH "/items/$ITEM_ID" "$EDITOR_TOKEN" 400 '{"status":"nope"}' "invalid status → 400"
AR=$(pg "SELECT COUNT(*) FROM audit_log WHERE resource_type='project_item' AND resource_id='$ITEM_ID';")
if [ "$AR" = "1" ]; then echo "  PASS  audit_log row written for status change"; PASS=$((PASS+1)); else echo "  FAIL  expected 1 audit row, got $AR"; FAIL=$((FAIL+1)); fi
probe PATCH "/items/$ITEM_ID" "$EDITOR_TOKEN" 204 '{"status":"pass"}' "PATCH same status (no-op audit)"
AR2=$(pg "SELECT COUNT(*) FROM audit_log WHERE resource_type='project_item' AND resource_id='$ITEM_ID';")
if [ "$AR2" = "1" ]; then echo "  PASS  no duplicate audit for same-status PATCH"; PASS=$((PASS+1)); else echo "  FAIL  expected 1 audit row after no-op, got $AR2"; FAIL=$((FAIL+1)); fi

# ── 6. Photo upload ──────────────────────────────────────────
echo "=== Photo upload ==="
head -c 2048 /dev/urandom > /tmp/checklist_e2e_fake.jpg
UP=$(curl -s -o /tmp/last_body.txt -w "%{http_code}" \
    -H "Authorization: Bearer $EDITOR_TOKEN" \
    -F "file=@/tmp/checklist_e2e_fake.jpg;type=image/jpeg" \
    "$BASE/uploads")
if [ "$UP" = "201" ]; then
    echo "  PASS  $UP  upload photo"; PASS=$((PASS+1))
    URL=$(json_get "['url']")
    probe GET "${URL#/api/checklists}" "" 200 "" "GET uploaded photo (public)"
else
    echo "  FAIL  $UP  upload photo"; FAIL=$((FAIL+1))
fi
BAD=$(curl -s -o /tmp/last_body.txt -w "%{http_code}" \
    -H "Authorization: Bearer $EDITOR_TOKEN" \
    -F "file=@/tmp/checklist_e2e_fake.jpg;type=application/octet-stream" \
    "$BASE/uploads")
if [ "$BAD" = "400" ]; then echo "  PASS  $BAD  reject non-image MIME"; PASS=$((PASS+1)); else echo "  FAIL  $BAD  expected 400 for bad MIME"; FAIL=$((FAIL+1)); fi
probe GET "/uploads/../etc/passwd" "" 404 "" "path traversal → 404"

# ── 7. Visit logs ────────────────────────────────────────────
echo "=== Visit logs ==="
probe POST "/projects/$PID/visits" "$EDITOR_TOKEN" 201 \
    '{"visit_date":"2026-07-04","summary":"e2e test visit","billable":true,"amount":1500}' \
    "editor creates visit"
probe GET "/projects/$PID/visits" "$ADMIN_TOKEN" 200 "" "list visits"

# ── 8. Reports ───────────────────────────────────────────────
echo "=== Reports ==="
probe GET "/projects/$PID/report?range=weekly" "$ADMIN_TOKEN" 200 "" "weekly report"
probe GET "/projects/$PID/report?range=monthly&date=2026-07-04" "$ADMIN_TOKEN" 200 "" "monthly report"
probe GET "/projects/$PID/report?range=garbage" "$ADMIN_TOKEN" 200 "" "garbage range falls back"

# ── 9. Weekly summary email ──────────────────────────────────
echo "=== Weekly summary email ==="
probe POST "/admin/projects/$PID/send-weekly-summary" "$ADMIN_TOKEN" 200 "" "send weekly summary (Miskawaan)"
probe POST "/admin/projects/$E2E_PID/send-weekly-summary" "$ADMIN_TOKEN" 400 "" "send on unlinked project → 400"
probe POST "/admin/projects/$PID/send-weekly-summary" "$EDITOR_TOKEN" 403 "" "editor cannot send weekly summary"

# ── 10. Portal endpoints ─────────────────────────────────────
echo "=== Portal (customer) endpoints ==="
probe GET "/portal/projects" "$CUSTOMER_TOKEN" 200 "" "customer lists own projects"
probe GET "/portal/projects/$PID" "$CUSTOMER_TOKEN" 200 "" "customer gets own project"
probe GET "/portal/projects/$PID/board" "$CUSTOMER_TOKEN" 200 "" "customer gets own board"
probe GET "/portal/projects/$PID/progress" "$CUSTOMER_TOKEN" 200 "" "customer gets own progress"
probe GET "/portal/projects/$PID" "$FOREIGN_CUSTOMER_TOKEN" 404 "" "foreign customer → 404 (isolation)"
probe GET "/portal/projects/$PID/board" "$FOREIGN_CUSTOMER_TOKEN" 404 "" "foreign customer board → 404"
pg "UPDATE projects SET visible_to_customer=false WHERE id='$PID';" > /dev/null
probe GET "/portal/projects/$PID" "$CUSTOMER_TOKEN" 404 "" "hidden project not visible in portal"
pg "UPDATE projects SET visible_to_customer=true WHERE id='$PID';" > /dev/null

# ── 11. Cleanup ──────────────────────────────────────────────
echo "=== Cleanup ==="
probe DELETE "/admin/projects/$E2E_PID" "$ADMIN_TOKEN" 204 "" "delete e2e project"
pg "DELETE FROM visit_logs WHERE summary='e2e test visit';" > /dev/null
pg "UPDATE project_items SET status='pending', note=NULL, checked_at=NULL, checked_by=NULL WHERE note='e2e note';" > /dev/null
pg "DELETE FROM audit_log WHERE resource_type='project_item' AND changes->>'note' = 'e2e note';" > /dev/null

echo
echo "======================================"
echo "  PASS: $PASS   FAIL: $FAIL"
echo "======================================"
exit "$FAIL"
