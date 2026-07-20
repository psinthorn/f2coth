#!/bin/bash
# =============================================================================
#  F2 AssetHub — Network Discovery Probe  v1.0.0
#  Runs on one always-on Linux/Docker box per client site (NAS, mini-PC, or
#  the engineer's laptop during an audit visit).
#
#  Discovers: routers, switches, Wi-Fi APs, printers, NAS, CCTV, phones —
#  every live device on the configured subnets — via ARP/ping sweep + nmap
#  fingerprinting + optional SNMP (sysName/sysDescr/serial for managed gear).
#  Pushes findings to the AssetHub server over OUTBOUND HTTPS only.
#
#  ENV (see docker-compose.probe.yml):
#    F2_SERVER_URL   https://assethub.f2.co.th
#    F2_TOKEN        enrollment token (org/site scoped)
#    F2_CIDRS        comma-separated, e.g. "192.168.1.0/24,192.168.10.0/24"
#    F2_SNMP_COMMUNITY  optional, e.g. "public" (enables SNMP enrichment)
#    F2_INTERVAL_MIN    rescan interval when looping (default 360 = 6h)
#    F2_ONESHOT=1       run once and exit (audit-visit mode)
#  Requires: nmap, curl, jq; snmpget (net-snmp) optional. All in probe image.
# =============================================================================
set -u
: "${F2_SERVER_URL:?set F2_SERVER_URL}"; : "${F2_TOKEN:?set F2_TOKEN}"
: "${F2_CIDRS:?set F2_CIDRS e.g. 192.168.1.0/24}"
SNMP_COMMUNITY="${F2_SNMP_COMMUNITY:-}"
INTERVAL_MIN="${F2_INTERVAL_MIN:-360}"

# Preflight: fail fast with a clear message instead of cryptic mid-scan errors.
# (The probe Docker image ships these; a bare host run may not have them.)
MISSING=""
for BIN in nmap curl jq; do command -v "$BIN" >/dev/null 2>&1 || MISSING="$MISSING $BIN"; done
if [ -n "$MISSING" ]; then
  echo "[probe] ERROR: missing required tool(s):$MISSING" >&2
  echo "[probe]   install them, or run via docker-compose.probe.yml (image bundles them)." >&2
  echo "[probe]   e.g. macOS: brew install nmap jq   ·   Debian/Ubuntu: apt-get install -y nmap jq curl" >&2
  exit 3
fi

# Spool dir: /spool is a mounted volume inside the probe image; on a bare host it
# won't exist / be writable, so fall back to a temp dir (mirrors agents/collect.sh).
SPOOL_DIR="${F2_SPOOL_DIR:-/spool}"
mkdir -p "$SPOOL_DIR" 2>/dev/null || { SPOOL_DIR="/tmp/f2-assethub-spool"; mkdir -p "$SPOOL_DIR"; }

snmp_val() { # $1=ip $2=oid
  [ -n "$SNMP_COMMUNITY" ] || return 0
  snmpget -v2c -c "$SNMP_COMMUNITY" -t 1 -r 0 -Oqv "$1" "$2" 2>/dev/null | tr -d '"'
}

classify() { # crude type guess from nmap/SNMP hints: $1=vendor $2=ports $3=sysdescr
  local v="$(echo "$1 $3" | tr '[:upper:]' '[:lower:]')" p=",$2,"
  case "$v" in
    *ubiquiti*|*ruckus*|*aruba*|*tp-link*eap*|*unifi*|*mikrotik*wap*) echo ap; return;;
    *cisco*|*hp*procurve*|*aruba*switch*|*netgear*switch*|*switch*)   echo switch; return;;
    *mikrotik*|*routeros*|*fortinet*|*pfsense*|*router*)              echo router; return;;
    *synology*|*qnap*|*truenas*|*nas*)                                echo nas; return;;
    *canon*|*epson*|*brother*|*ricoh*|*kyocera*|*print*)              echo printer; return;;
    *hikvision*|*dahua*|*axis*|*camera*|*nvr*)                        echo camera; return;;
    *apple*iphone*|*android*)                                         echo phone; return;;
  esac
  case "$p" in
    *,9100,*|*,631,*) echo printer;; *,554,*) echo camera;;
    *,5000,*|*,5001,*) echo nas;; *) echo unknown;;
  esac
}

run_scan() {
  RUN_STARTED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  FINDINGS=""
  for CIDR in $(echo "$F2_CIDRS" | tr ',' ' '); do
    echo "[probe] scanning $CIDR ..."
    # host discovery + service/port fingerprint in XML, parse with nmap's grepable-ish output
    nmap -sn -PR -PE "$CIDR" -oG - 2>/dev/null | awk '/Up$/{print $2}' > /tmp/live.txt
    while read -r IP; do
      [ -n "$IP" ] || continue
      # MAC + vendor (needs same L2; root inside container with host network)
      LINE="$(nmap -sn -PR "$IP" -oG - 2>/dev/null | grep -m1 'MAC Address' || true)"
      MAC="$(echo "$LINE" | sed -n 's/.*MAC Address: \([0-9A-F:]*\).*/\1/p')"
      VENDOR="$(echo "$LINE" | sed -n 's/.*(\(.*\)).*/\1/p')"
      PORTS="$(nmap -Pn --top-ports 50 -T4 "$IP" -oG - 2>/dev/null | sed -n 's/.*Ports: //p' | tr ',' '\n' | awk -F/ '$2=="open"{printf "%s,",$1}' | sed 's/,$//')"
      HOSTN="$(getent hosts "$IP" 2>/dev/null | awk '{print $2}')"
      SYSDESCR="$(snmp_val "$IP" 1.3.6.1.2.1.1.1.0)"
      SYSNAME="$(snmp_val "$IP" 1.3.6.1.2.1.1.5.0)"
      SERIAL="$(snmp_val "$IP" 1.3.6.1.2.1.47.1.1.1.1.11.1)"
      TYPE="$(classify "$VENDOR" "$PORTS" "$SYSDESCR")"
      F="$(jq -nc --arg ip "$IP" --arg mac "$MAC" --arg vendor "$VENDOR" \
             --arg host "${SYSNAME:-$HOSTN}" --arg ports "$PORTS" \
             --arg sysdescr "$SYSDESCR" --arg serial "$SERIAL" --arg type "$TYPE" \
             '{ip:$ip, mac:$mac, vendor:$vendor, hostname:$host, open_ports:$ports,
               snmp_sysdescr:$sysdescr, serial_number:$serial, guessed_type:$type}')"
      FINDINGS="${FINDINGS}${F},"
      echo "[probe]  $IP  ${MAC:-??}  ${VENDOR:-?}  -> $TYPE"
    done < /tmp/live.txt
  done
  PAYLOAD="$(jq -nc --arg started "$RUN_STARTED" --arg cidrs "$F2_CIDRS" \
      --argjson findings "[${FINDINGS%,}]" \
      '{schema:"f2.assethub.discovery.v1", started_at:$started, cidrs:$cidrs, findings:$findings}')"
  if curl -fsS --max-time 60 -X POST "$F2_SERVER_URL/api/assethub/discovery" \
       -H "Authorization: Bearer $F2_TOKEN" -H "Content-Type: application/json" \
       -d "$PAYLOAD" >/dev/null; then
    echo "[probe] OK: $(echo "$PAYLOAD" | jq '.findings | length') findings sent."
  else
    SP="$SPOOL_DIR/discovery-$(date +%s).json"
    echo "$PAYLOAD" > "$SP"
    echo "[probe] WARN: server unreachable, spooled to $SP" >&2
  fi
  # flush old spool
  for F in "$SPOOL_DIR"/discovery-*.json; do
    [ -f "$F" ] || continue
    curl -fsS --max-time 60 -X POST "$F2_SERVER_URL/api/assethub/discovery" \
      -H "Authorization: Bearer $F2_TOKEN" -H "Content-Type: application/json" \
      --data-binary @"$F" >/dev/null && rm -f "$F"
  done
}

if [ "${F2_ONESHOT:-0}" = "1" ]; then run_scan; exit 0; fi
while true; do run_scan; echo "[probe] sleeping ${INTERVAL_MIN}m"; sleep $(( INTERVAL_MIN * 60 )); done
