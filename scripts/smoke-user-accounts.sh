#!/usr/bin/env bash
# Smoke test for the portal user-account module (migrations 071/072).
# Self-contained: seeds throwaway users (test-smoke*@example.com), asserts the
# key behaviours through the live API, then cleans up. Re-runnable.
#
# Usage:  bash smoke-user-accounts.sh
# Needs:  docker compose stack up; run from the repo root.
set -uo pipefail

BASE="${BASE:-http://localhost}"
PSQL=(docker compose exec -T postgres psql -U f2 -d f2_website -tAc)
PASS=0; FAIL=0
ok(){ echo "  ✅ $1"; PASS=$((PASS+1)); }
no(){ echo "  ❌ $1"; FAIL=$((FAIL+1)); }
chk(){ [ "$2" = "$3" ] && ok "$1 ($2)" || no "$1 (got '$2', want '$3')"; }

db(){ "${PSQL[@]}" "$1"; }
# /api/auth is Traefik-rate-limited to 10/min (burst 5). Pace every auth call so
# the smoke test never trips the limiter. Portal (/api/portal) is not limited.
pace(){ sleep 7; }
acurl(){ pace; curl -s "$@"; }
login(){ acurl -X POST "$BASE/api/auth/customer/login" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}"; }
claim(){ python3 -c "
import json,base64,sys
try:
  p=sys.argv[1].split('.')[1]; p+='='*(-len(p)%4)
  print(json.loads(base64.urlsafe_b64decode(p)).get(sys.argv[2],''))
except Exception: print('')" "$1" "$2"; }
jget(){ python3 -c "
import json,sys
try: print(json.load(sys.stdin).get(sys.argv[1],''))
except Exception: print('')" "$1"; }

echo "== cleanup any prior smoke data =="
db "DELETE FROM customer_contacts WHERE email LIKE 'test-smoke%@example.com';" >/dev/null

C1=$(db "SELECT id FROM customers WHERE is_active ORDER BY name LIMIT 1")
C2=$(db "SELECT id FROM customers WHERE is_active AND id<>'$C1' ORDER BY name LIMIT 1")

# ─────────────────────────────────────────────────────────────
echo "== 1. temp-password user: mcp gate (read ok, mutate blocked) =="
db "INSERT INTO customer_contacts (customer_id,email,password_hash,full_name,role,must_change_password)
    VALUES ('$C1','test-smoke-mcp@example.com',crypt('Temp1234ab',gen_salt('bf',10)),'Smoke MCP','member',TRUE);
    INSERT INTO contact_org_memberships (contact_id,customer_id,role,is_primary)
    SELECT id,'$C1','member',TRUE FROM customer_contacts WHERE email='test-smoke-mcp@example.com';" >/dev/null
L=$(login test-smoke-mcp@example.com Temp1234ab)
TOK=$(echo "$L" | jget access_token)
chk "login must_change_password flag" "$(claim "$TOK" mcp)" "True"
chk "GET /portal/me allowed"     "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/portal/me" -H "Authorization: Bearer $TOK")" "200"
chk "POST /portal/tickets blocked" "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/portal/tickets" -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' -d '{"subject":"x","body":"y","priority":"low"}')" "403"
chk "PATCH /portal/me blocked"   "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH "$BASE/api/portal/me" -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' -d '{"phone":"1"}')" "403"

echo "== 2. change-password clears mcp + revokes sessions =="
RT=$(echo "$L" | jget refresh_token)
chk "change-password" "$(acurl -o /dev/null -w '%{http_code}' -X POST "$BASE/api/auth/customer/change-password" -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' -d '{"current_password":"Temp1234ab","new_password":"NewPass99xy"}')" "200"
chk "old refresh token revoked" "$(acurl -o /dev/null -w '%{http_code}' -X POST "$BASE/api/auth/customer/refresh" -H 'Content-Type: application/json' -d "{\"refresh_token\":\"$RT\"}")" "401"
L2=$(login test-smoke-mcp@example.com NewPass99xy)
chk "re-login mcp cleared" "$(claim "$(echo "$L2" | jget access_token)" mcp)" "False"

echo "== 3. email verification loop (single-use) =="
CID=$(db "SELECT id FROM customer_contacts WHERE email='test-smoke-mcp@example.com'")
RAW=$(python3 -c "import secrets;print(secrets.token_hex(32))")
HSH=$(python3 -c "import hashlib,sys;print(hashlib.sha256(sys.argv[1].encode()).hexdigest())" "$RAW")
db "INSERT INTO password_resets (contact_id,token_hash,expires_at,purpose) VALUES ('$CID','$HSH',NOW()+INTERVAL '1 hour','verification');" >/dev/null
chk "verify-email redeem" "$(acurl -X POST "$BASE/api/auth/customer/verify-email" -H 'Content-Type: application/json' -d "{\"token\":\"$RAW\"}" | jget status)" "ok"
chk "email_verified_at stamped" "$(db "SELECT email_verified_at IS NOT NULL FROM customer_contacts WHERE id='$CID'")" "t"
chk "token replay rejected" "$(acurl -o /dev/null -w '%{http_code}' -X POST "$BASE/api/auth/customer/verify-email" -H 'Content-Type: application/json' -d "{\"token\":\"$RAW\"}")" "400"

echo "== 4. multi-org: switch survives token refresh =="
db "INSERT INTO contact_org_memberships (contact_id,customer_id,role,is_primary) VALUES ('$CID','$C2','member',FALSE) ON CONFLICT DO NOTHING;" >/dev/null
L3=$(login test-smoke-mcp@example.com NewPass99xy)
TOK3=$(echo "$L3" | jget access_token); RT3=$(echo "$L3" | jget refresh_token)
SW=$(acurl -X POST "$BASE/api/auth/customer/switch-org" -H "Authorization: Bearer $TOK3" -H 'Content-Type: application/json' -d "{\"customer_id\":\"$C2\"}")
chk "switch-org active = org2" "$(claim "$(echo "$SW" | jget access_token)" customer_id)" "$C2"
RF=$(acurl -X POST "$BASE/api/auth/customer/refresh" -H 'Content-Type: application/json' -d "{\"refresh_token\":\"$RT3\"}")
TOK4=$(echo "$RF" | jget access_token)
chk "refresh preserves org2 (bug #1)" "$(claim "$TOK4" customer_id)" "$C2"
chk "switch-org non-member 403" "$(acurl -o /dev/null -w '%{http_code}' -X POST "$BASE/api/auth/customer/switch-org" -H "Authorization: Bearer $TOK3" -H 'Content-Type: application/json' -d '{"customer_id":"00000000-0000-0000-0000-000000000000"}')" "403"

echo "== 5. profile self-edit (reuses refreshed token — no extra auth call) =="
chk "PATCH /portal/me" "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH "$BASE/api/portal/me" -H "Authorization: Bearer $TOK4" -H 'Content-Type: application/json' -d '{"job_title":"Tester","phone":"+66 1"}')" "204"

echo "== 6. portal upload attributes to contact, not staff (JWT split) =="
TID=$(curl -s -X POST "$BASE/api/portal/tickets" -H "Authorization: Bearer $TOK4" -H 'Content-Type: application/json' -d '{"subject":"__smoke__","body":"t","priority":"low"}' | jget id)
printf 'hi' > /tmp/smoke_up.txt
AID=$(curl -s -X POST "$BASE/api/portal/attachments" -H "Authorization: Bearer $TOK4" -F "file=@/tmp/smoke_up.txt;type=text/plain" -F "owner_type=ticket" -F "owner_id=$TID" -F "kind=document" | jget id)
chk "attachment.uploaded_by_contact set" "$(db "SELECT uploaded_by_contact_id IS NOT NULL FROM attachments WHERE id='$AID'")" "t"
chk "attachment.uploaded_by_user NULL"   "$(db "SELECT uploaded_by_user_id IS NULL FROM attachments WHERE id='$AID'")" "t"
db "DELETE FROM attachments WHERE id='$AID'; DELETE FROM ticket_messages WHERE ticket_id='$TID'; DELETE FROM tickets WHERE id='$TID';" >/dev/null
rm -f /tmp/smoke_up.txt

echo "== cleanup =="
db "DELETE FROM customer_contacts WHERE email LIKE 'test-smoke%@example.com';" >/dev/null

echo
echo "==================== RESULT: $PASS passed, $FAIL failed ===================="
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
