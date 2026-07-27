#!/usr/bin/env bash
# smoke-ticket-billing.sh — end-to-end check of ticket billing (migration 073).
#
# Two tiers:
#   • PORTAL tier (always runs): buildBilling totals, covered-line exclusion,
#     bilingual descriptions, invoice-status gating, tenant isolation, 404
#     ordering — via the customer portal read path (self-seeds lines via DB).
#   • STAFF tier (runs only when JWT_SECRET + ADMIN_USER_ID are set, same
#     convention as scripts/smoke-module-toggle.sh): mints a short-lived admin
#     JWT and exercises the staff writes — add line, GET billing, generate
#     invoice, the freeze-after-invoice guard (409), and the duplicate-invoice
#     guard (409).
#
# Requires the dev stack running (`make up`).
#   JWT_SECRET             — HMAC secret (must match .env) — enables STAFF tier
#   ADMIN_USER_ID          — UUID of an admin in users — enables STAFF tier
#   F2_HOST                — base URL (default http://localhost)
#   SMOKE_CUSTOMER_EMAIL   — portal login (default gm@putahracsa.com, a seeded placeholder)
#   SMOKE_CUSTOMER_PASSWORD— portal password (default Welcome2026!)
#
# Exit 0 = all passed · 1 = a failure · 2 = prerequisite missing.
set -uo pipefail

F2_HOST="${F2_HOST:-http://localhost}"
EMAIL="${SMOKE_CUSTOMER_EMAIL:-gm@putahracsa.com}"
PASSWORD="${SMOKE_CUSTOMER_PASSWORD:-Welcome2026!}"
PSQL=(docker compose exec -T postgres psql -U f2 -d f2_website -tAc)
PASS=0; FAIL=0
ok(){ echo "  ✅ $1"; PASS=$((PASS+1)); }
no(){ echo "  ❌ $1"; FAIL=$((FAIL+1)); }
chk(){ [ "$2" = "$3" ] && ok "$1 ($2)" || no "$1 (got '$2', want '$3')"; }
db(){ "${PSQL[@]}" "$1"; }
ev(){ python3 -c "import json,sys;d=json.load(sys.stdin);print(eval(sys.argv[1]))" "$1"; }

# ─────────────────────────── PORTAL tier ───────────────────────────
echo "== PORTAL: login + create test ticket =="
TOK=$(curl -s -X POST "$F2_HOST/api/auth/customer/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" | python3 -c "import json,sys;print(json.load(sys.stdin).get('access_token',''))")
[ -n "$TOK" ] || { echo "smoke: portal login failed for $EMAIL" >&2; exit 2; }
TID=$(curl -s -X POST "$F2_HOST/api/portal/tickets" -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' \
  -d '{"subject":"__billsmoke__","body":"t","priority":"low"}' | python3 -c "import json,sys;print(json.load(sys.stdin).get('id',''))")
[ -n "$TID" ] && ok "ticket created" || { no "ticket create"; exit 1; }

db "INSERT INTO ticket_line_items (ticket_id,description_en,description_th,unit,quantity,unit_price_cents,covered,amount_cents,currency,sort_order) VALUES
  ('$TID','Covered triage','คัดกรองครอบคลุม','hour',1,250000,TRUE,0,'THB',10),
  ('$TID','Remote support','ซัพพอร์ตระยะไกล','hour',2,120000,FALSE,240000,'THB',20),
  ('$TID','Mailbox licenses','สิทธิ์กล่องจดหมาย','seat',5,80000,FALSE,400000,'THB',30);
  UPDATE tickets SET billing_status='billable' WHERE id='$TID';" >/dev/null

B=$(curl -s "$F2_HOST/api/portal/tickets/$TID/billing" -H "Authorization: Bearer $TOK")
chk "subtotal (billable only)"           "$(echo "$B" | ev "d['subtotal_cents']")" "640000"
chk "VAT 7%"                             "$(echo "$B" | ev "d['vat_cents']")"      "44800"
chk "total"                              "$(echo "$B" | ev "d['total_cents']")"    "684800"
chk "covered line amount = 0"            "$(echo "$B" | ev "[l['amount_cents'] for l in d['lines'] if l['covered']][0]")" "0"
chk "bilingual description_th present"   "$(echo "$B" | ev "all(l.get('description_th') for l in d['lines'])")" "True"
chk "invoice_status absent (no invoice)" "$(echo "$B" | ev "d.get('invoice_status') is None")" "True"
chk "unknown ticket → 404"               "$(curl -s -o /dev/null -w '%{http_code}' "$F2_HOST/api/portal/tickets/00000000-0000-0000-0000-000000000000/billing" -H "Authorization: Bearer $TOK")" "404"
OTHER=$(db "SELECT id FROM tickets WHERE customer_id <> (SELECT customer_id FROM tickets WHERE id='$TID') LIMIT 1")
[ -n "$OTHER" ] && chk "other-org ticket → 404" "$(curl -s -o /dev/null -w '%{http_code}' "$F2_HOST/api/portal/tickets/$OTHER/billing" -H "Authorization: Bearer $TOK")" "404"
db "DELETE FROM ticket_line_items WHERE ticket_id='$TID'; DELETE FROM ticket_messages WHERE ticket_id='$TID'; DELETE FROM tickets WHERE id='$TID';" >/dev/null

# ─────────────────────────── STAFF tier ────────────────────────────
if [ -n "${JWT_SECRET:-}" ] && [ -n "${ADMIN_USER_ID:-}" ]; then
  echo "== STAFF: mint admin JWT + exercise writes =="
  ADMTOK=$(python3 -c "
import hmac,hashlib,base64,json,time
def b(x): return base64.urlsafe_b64encode(x).rstrip(b'=').decode()
h=b(json.dumps({'alg':'HS256','typ':'JWT'},separators=(',',':')).encode())
p=b(json.dumps({'sub':'$ADMIN_USER_ID','aud':'staff','role':'admin','iss':'f2.co.th','exp':int(time.time())+600},separators=(',',':')).encode())
print(h+'.'+p+'.'+b(hmac.new(b'$JWT_SECRET',(h+'.'+p).encode(),hashlib.sha256).digest()))")
  AH=(-H "Authorization: Bearer $ADMTOK" -H 'Content-Type: application/json')
  CUST=$(db "SELECT id FROM customers WHERE is_active ORDER BY name LIMIT 1")

  chk "rate-card list authorized" "$(curl -s -o /dev/null -w '%{http_code}' "$F2_HOST/api/customer/admin/rate-card" "${AH[@]}")" "200"

  STID=$(curl -s -X POST "$F2_HOST/api/customer/admin/customers/$CUST/tickets" "${AH[@]}" \
    -d '{"subject":"__billsmoke_staff__","body":"onsite","priority":"normal"}' | python3 -c "import json,sys;print(json.load(sys.stdin).get('id',''))")
  [ -n "$STID" ] && ok "on-behalf ticket created" || no "on-behalf ticket"

  chk "add billable line" "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$F2_HOST/api/customer/admin/tickets/$STID/line-items" "${AH[@]}" \
    -d '{"description_en":"Onsite callout","unit":"visit","quantity":1,"unit_price_cents":250000,"covered":false}')" "201"
  chk "admin billing total (250000+VAT)" "$(curl -s "$F2_HOST/api/customer/admin/tickets/$STID/billing" "${AH[@]}" | ev "d['total_cents']")" "267500"

  GEN=$(curl -s -X POST "$F2_HOST/api/customer/admin/tickets/$STID/generate-invoice" "${AH[@]}")
  INVNO=$(echo "$GEN" | ev "d.get('invoice_number','')")
  [ -n "$INVNO" ] && ok "generate-invoice → $INVNO" || no "generate-invoice ($GEN)"
  chk "duplicate generate → 409" "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$F2_HOST/api/customer/admin/tickets/$STID/generate-invoice" "${AH[@]}")" "409"
  chk "line frozen after invoice → 409" "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$F2_HOST/api/customer/admin/tickets/$STID/line-items" "${AH[@]}" \
    -d '{"description_en":"late add","unit":"item","quantity":1,"unit_price_cents":100,"covered":false}')" "409"

  # cleanup: void+delete the generated invoice, then the ticket
  INVID=$(db "SELECT invoice_id FROM tickets WHERE id='$STID'")
  db "DELETE FROM invoice_items WHERE invoice_id='$INVID'; DELETE FROM invoices WHERE id='$INVID';" >/dev/null 2>&1
  db "DELETE FROM ticket_line_items WHERE ticket_id='$STID'; DELETE FROM ticket_messages WHERE ticket_id='$STID'; DELETE FROM tickets WHERE id='$STID';" >/dev/null
else
  echo "== STAFF tier SKIPPED (set JWT_SECRET + ADMIN_USER_ID to run it) =="
fi

echo
echo "==================== RESULT: $PASS passed, $FAIL failed ===================="
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
