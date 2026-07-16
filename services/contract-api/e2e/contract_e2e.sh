#!/usr/bin/env bash
# contract_e2e.sh — smoke the contract lifecycle end-to-end against a running
# stack (make up). Requires an admin JWT in $TOKEN and the gateway at $BASE.
#
#   BASE=http://localhost TOKEN=<admin-jwt> bash e2e/contract_e2e.sh
#
# Exercises: create party → create contract (draft) → generate draft (watermark)
# → generate signing version (draft→sent) → upload signed scan (→signed) →
# activate (→active) → list expiring. Prints each step's HTTP status.
set -euo pipefail
BASE="${BASE:-http://localhost}"
API="$BASE/api/contracts"
AUTH=(-H "Authorization: Bearer ${TOKEN:?set TOKEN to an admin JWT}")
JSON=(-H "Content-Type: application/json")

say() { printf '\n=== %s ===\n' "$1"; }

say "template list (must include service-agreement)"
curl -fsS "${AUTH[@]}" "$API/templates?active=1" | tee /tmp/tmpls.json
TEMPLATE_ID=$(python3 -c 'import json,sys;print(next(t["id"] for t in json.load(open("/tmp/tmpls.json"))["templates"] if t["code"]=="service-agreement"))')

say "create party"
PARTY_ID=$(curl -fsS "${AUTH[@]}" "${JSON[@]}" -X POST "$API/parties" -d '{
  "legal_name_en":"Miskawaan Company Limited","legal_name_th":"บริษัท มิสกวัน จำกัด",
  "brand_name":"Miskawaan Beachfront Villas","tax_id":"0105549033541",
  "address":"67/28 Moo 1, Maenam, Koh Samui","notice_email":"ops@miskawaan.example"
}' | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])')
echo "party=$PARTY_ID"

say "create contract (draft)"
CREATED=$(curl -fsS "${AUTH[@]}" "${JSON[@]}" -X POST "$API/" -d "{
  \"template_id\":\"$TEMPLATE_ID\",\"party_id\":\"$PARTY_ID\",
  \"effective_date\":\"2026-08-01\",\"end_date\":\"2026-11-01\",\"fee_total\":45000,
  \"merge_data\":{\"term_months\":3,\"fee_monthly\":15000,\"fee_total\":45000,\"payment_terms\":\"advance\",\"service_area\":\"Koh Samui\"}
}")
echo "$CREATED"
CONTRACT_ID=$(echo "$CREATED" | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])')

say "generate draft (watermark on)"
curl -fsS "${AUTH[@]}" "${JSON[@]}" -X POST "$API/$CONTRACT_ID/generate" -d '{"watermark":true}'

say "generate signing version (draft -> sent)"
curl -fsS "${AUTH[@]}" "${JSON[@]}" -X POST "$API/$CONTRACT_ID/generate" -d '{"watermark":false}'

say "upload signed scan (-> signed)"
printf '%%PDF-1.4 fake signed scan' > /tmp/signed.pdf
curl -fsS "${AUTH[@]}" -X POST "$API/$CONTRACT_ID/files" -F "file=@/tmp/signed.pdf;type=application/pdf"

say "activate (-> active) with dates"
curl -fsS "${AUTH[@]}" "${JSON[@]}" -X POST "$API/$CONTRACT_ID/status" \
  -d '{"to":"active","effective_date":"2026-08-01","end_date":"2026-11-01","note":"countersigned"}'

say "detail (status timeline + files)"
curl -fsS "${AUTH[@]}" "$API/$CONTRACT_ID" | python3 -m json.tool

say "expiring within 120 days"
curl -fsS "${AUTH[@]}" "$API/?expiring=120" | python3 -c 'import json,sys;print(len(json.load(sys.stdin)["contracts"]),"contract(s)")'

echo -e "\nOK — full lifecycle exercised."
