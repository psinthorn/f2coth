#!/bin/bash
# =============================================================================
#  F2 AssetHub — Computer Inventory Collector (Linux + macOS)  v1.0.0
#  F2 Co., Ltd. · f2.co.th
#
#  Auto-detects the OS and collects: brand, model, serial, CPU, RAM, disks,
#  OS/version, network interfaces (MAC/IP), installed software, and network
#  role: domain / workgroup / standalone. Pushes JSON to the AssetHub server
#  (outbound HTTPS only — works with a cloud server, no VPN needed).
#
#  USAGE
#    export F2_SERVER_URL="https://assethub.f2.co.th"
#    export F2_TOKEN="<enrollment token for this client org>"
#    sudo ./collect.sh              # sudo optional; improves serial/dmi data on Linux
#    ./collect.sh --dry-run         # print JSON, do not send
#
#  SCHEDULING (optional, daily 09:00)
#    Linux : echo '0 9 * * * root F2_SERVER_URL=... F2_TOKEN=... /opt/f2/collect.sh' > /etc/cron.d/f2-collect
#    macOS : use launchd plist or: crontab -e -> 0 9 * * * F2_SERVER_URL=... F2_TOKEN=... /opt/f2/collect.sh
#
#  Windows machines: use collect.ps1 (this script will tell you if run under
#  Git-Bash/WSL on Windows). iOS/Android cannot run scripts — use the probe +
#  /enroll web form (see spec §7).
# =============================================================================
set -u
VERSION="1.0.0"
SERVER_URL="${F2_SERVER_URL:-}"
TOKEN="${F2_TOKEN:-}"
DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1
SPOOL_DIR="${F2_SPOOL_DIR:-${HOME}/.f2-assethub/spool}"
mkdir -p "$SPOOL_DIR" 2>/dev/null || SPOOL_DIR="/tmp/f2-assethub-spool"; mkdir -p "$SPOOL_DIR"

# ---------- helpers ----------
esc() { # JSON-escape a string
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | tr -d '\000-\010\013\014\016-\037' | tr '\n\t\r' '   '
}
num() { # emit a number or 0
  case "${1:-}" in (''|*[!0-9.]*) printf '0';; (*) printf '%s' "$1";; esac
}
have() { command -v "$1" >/dev/null 2>&1; }

OS_FAMILY="$(uname -s)"
case "$OS_FAMILY" in
  Linux)  PLATFORM="linux" ;;
  Darwin) PLATFORM="macos" ;;
  MINGW*|MSYS*|CYGWIN*)
    echo "This looks like Windows — run collect.ps1 instead:" >&2
    echo "  powershell -ExecutionPolicy Bypass -File collect.ps1" >&2
    exit 2 ;;
  *) PLATFORM="unknown" ;;
esac

HOSTNAME_V="$(hostname 2>/dev/null || echo unknown)"
COLLECTED_AT="$(date +%Y-%m-%dT%H:%M:%S%z | sed 's/\([0-9][0-9]\)$/:\1/')"
ARCH="$(uname -m)"
KERNEL="$(uname -r)"

BRAND=""; MODEL=""; SERIAL=""; OS_NAME=""; OS_VER=""; CPU=""; RAM_MB=0
NET_ROLE="standalone"; NET_NAME=""; LOGGED_USER="${SUDO_USER:-$(whoami)}"
UPTIME_H=0; DEVICE_TYPE="computer"

# ---------- Linux collection ----------
if [ "$PLATFORM" = "linux" ]; then
  # DMI (works unprivileged via /sys on most distros)
  BRAND="$(cat /sys/class/dmi/id/sys_vendor 2>/dev/null || true)"
  MODEL="$(cat /sys/class/dmi/id/product_name 2>/dev/null || true)"
  SERIAL="$(cat /sys/class/dmi/id/product_serial 2>/dev/null || true)"
  [ -z "$SERIAL" ] && have dmidecode && SERIAL="$(dmidecode -s system-serial-number 2>/dev/null | head -1)"
  . /etc/os-release 2>/dev/null || true
  OS_NAME="${NAME:-Linux}"; OS_VER="${VERSION_ID:-$(uname -r)}"
  CPU="$(grep -m1 'model name' /proc/cpuinfo 2>/dev/null | cut -d: -f2- | sed 's/^ *//')"
  [ -z "$CPU" ] && CPU="$(lscpu 2>/dev/null | grep -m1 'Model name' | cut -d: -f2- | sed 's/^ *//')"
  RAM_MB=$(( $(grep -m1 MemTotal /proc/meminfo | awk '{print $2}') / 1024 ))
  UPTIME_H=$(( $(cut -d. -f1 /proc/uptime) / 3600 ))
  # servers vs desktops (rough)
  if [ -d /sys/class/net ] && ! ls /sys/class/net | grep -qE '^(wl|ww)'; then
    systemd-detect-virt -q 2>/dev/null && DEVICE_TYPE="server"
  fi
  # ----- network role: domain / workgroup / standalone -----
  if have realm && realm list 2>/dev/null | grep -q 'domain-name'; then
    NET_ROLE="domain"; NET_NAME="$(realm list 2>/dev/null | awk -F': ' '/domain-name/{print $2; exit}')"
  elif have net && net ads testjoin >/dev/null 2>&1; then
    NET_ROLE="domain"; NET_NAME="$(net ads info 2>/dev/null | awk -F': ' '/Realm/{print $2; exit}')"
  elif [ -f /etc/samba/smb.conf ] && grep -qiE '^\s*workgroup\s*=' /etc/samba/smb.conf; then
    NET_ROLE="workgroup"; NET_NAME="$(grep -iE '^\s*workgroup\s*=' /etc/samba/smb.conf | head -1 | cut -d= -f2 | tr -d ' ')"
  fi

# ---------- macOS collection ----------
elif [ "$PLATFORM" = "macos" ]; then
  HW="$(system_profiler SPHardwareDataType 2>/dev/null)"
  BRAND="Apple"
  MODEL="$(echo "$HW" | awk -F': ' '/Model Name/{print $2; exit}')"
  MODELID="$(echo "$HW" | awk -F': ' '/Model Identifier/{print $2; exit}')"
  [ -n "$MODELID" ] && MODEL="$MODEL ($MODELID)"
  SERIAL="$(echo "$HW" | awk -F': ' '/Serial Number/{print $2; exit}')"
  CPU="$(echo "$HW" | awk -F': ' '/Chip|Processor Name/{print $2; exit}')"
  RAM_GB="$(echo "$HW" | awk -F': ' '/Memory/{print $2; exit}' | grep -o '[0-9]*' | head -1)"
  RAM_MB=$(( ${RAM_GB:-0} * 1024 ))
  OS_NAME="macOS $(sw_vers -productName 2>/dev/null | sed 's/macOS //')"
  OS_NAME="macOS"; OS_VER="$(sw_vers -productVersion 2>/dev/null)"
  BOOT_S="$(sysctl -n kern.boottime 2>/dev/null | awk -F'[ ,]' '{print $4}')"
  [ -n "${BOOT_S:-}" ] && UPTIME_H=$(( ( $(date +%s) - BOOT_S ) / 3600 ))
  # ----- network role -----
  if have dsconfigad && dsconfigad -show 2>/dev/null | grep -q 'Active Directory Domain'; then
    NET_ROLE="domain"; NET_NAME="$(dsconfigad -show | awk -F'= ' '/Active Directory Domain/{print $2; exit}')"
  fi
fi

# ---------- interfaces (both platforms) ----------
IFACES_JSON=""
if [ "$PLATFORM" = "linux" ]; then
  for IF in $(ls /sys/class/net 2>/dev/null | grep -v '^lo$'); do
    MAC="$(cat /sys/class/net/$IF/address 2>/dev/null)"
    [ "$MAC" = "00:00:00:00:00:00" ] && continue
    IPS="$(ip -4 -o addr show "$IF" 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | paste -sd, -)"
    TYPE="ethernet"; case "$IF" in wl*) TYPE="wifi";; esac
    IPS_J=""; OLDIFS=$IFS; IFS=','
    for ip in $IPS; do [ -n "$ip" ] && IPS_J="${IPS_J}\"$(esc "$ip")\","; done; IFS=$OLDIFS
    IFACES_JSON="${IFACES_JSON}{\"name\":\"$(esc "$IF")\",\"mac\":\"$(esc "$MAC")\",\"ipv4\":[${IPS_J%,}],\"type\":\"$TYPE\"},"
  done
elif [ "$PLATFORM" = "macos" ]; then
  for IF in $(networksetup -listallhardwareports 2>/dev/null | awk '/Device/{print $2}'); do
    MAC="$(ifconfig "$IF" 2>/dev/null | awk '/ether/{print $2; exit}')"
    [ -z "$MAC" ] && continue
    IP4="$(ipconfig getifaddr "$IF" 2>/dev/null || true)"
    TYPE="ethernet"; networksetup -listallhardwareports | grep -B1 "Device: $IF" | grep -qi wi-fi && TYPE="wifi"
    IPJ=""; [ -n "$IP4" ] && IPJ="\"$(esc "$IP4")\""
    IFACES_JSON="${IFACES_JSON}{\"name\":\"$(esc "$IF")\",\"mac\":\"$(esc "$MAC")\",\"ipv4\":[${IPJ}],\"type\":\"$TYPE\"},"
  done
fi
IFACES_JSON="[${IFACES_JSON%,}]"

# ---------- disks ----------
DISKS_JSON=""
if [ "$PLATFORM" = "linux" ] && have lsblk; then
  while read -r NAME SIZE MODEL_D; do
    GB=$(( SIZE / 1024 / 1024 / 1024 ))
    [ "$GB" -eq 0 ] && continue
    DISKS_JSON="${DISKS_JSON}{\"model\":\"$(esc "${MODEL_D:-$NAME}")\",\"size_gb\":$GB,\"free_gb\":0},"
  done <<EOF_LSBLK
$(lsblk -bdno NAME,SIZE,MODEL 2>/dev/null | grep -vE '^(loop|ram|sr)')
EOF_LSBLK
  ROOT_FREE_GB="$(df -Pk / 2>/dev/null | awk 'NR==2{printf "%d", $4/1024/1024}')"
elif [ "$PLATFORM" = "macos" ]; then
  SIZE_GB="$(df -Pk / 2>/dev/null | awk 'NR==2{printf "%d", $2/1024/1024}')"
  FREE_GB="$(df -Pk / 2>/dev/null | awk 'NR==2{printf "%d", $4/1024/1024}')"
  DISKS_JSON="{\"model\":\"$(esc "Internal (APFS)")\",\"size_gb\":$(num "$SIZE_GB"),\"free_gb\":$(num "$FREE_GB")},"
fi
DISKS_JSON="[${DISKS_JSON%,}]"

# ---------- software list ----------
SW_JSON=""
add_sw() { SW_JSON="${SW_JSON}{\"name\":\"$(esc "$1")\",\"version\":\"$(esc "$2")\",\"vendor\":\"$(esc "${3:-}")\"},"; }
if [ "$PLATFORM" = "linux" ]; then
  if have dpkg-query; then
    while IFS='|' read -r n v; do [ -n "$n" ] && add_sw "$n" "$v"; done <<EOF_SW
$(dpkg-query -W -f='${Package}|${Version}\n' 2>/dev/null)
EOF_SW
  elif have rpm; then
    while IFS='|' read -r n v; do [ -n "$n" ] && add_sw "$n" "$v"; done <<EOF_SW
$(rpm -qa --qf '%{NAME}|%{VERSION}-%{RELEASE}\n' 2>/dev/null)
EOF_SW
  elif have pacman; then
    while read -r n v; do [ -n "$n" ] && add_sw "$n" "$v"; done <<EOF_SW
$(pacman -Q 2>/dev/null)
EOF_SW
  fi
elif [ "$PLATFORM" = "macos" ]; then
  for APP in /Applications/*.app; do
    [ -d "$APP" ] || continue
    NAMEA="$(basename "$APP" .app)"
    VERA="$(defaults read "$APP/Contents/Info" CFBundleShortVersionString 2>/dev/null || echo "")"
    add_sw "$NAMEA" "$VERA"
  done
  if have brew; then
    while read -r n v; do [ -n "$n" ] && add_sw "$n" "$v" "homebrew"; done <<EOF_SW
$(brew list --versions 2>/dev/null)
EOF_SW
  fi
fi
SW_JSON="[${SW_JSON%,}]"

# ---------- assemble payload ----------
PAYLOAD="{
 \"schema\":\"f2.assethub.v1\",
 \"collected_at\":\"$(esc "$COLLECTED_AT")\",
 \"collector\":{\"name\":\"collect.sh\",\"version\":\"$VERSION\"},
 \"device\":{
  \"hostname\":\"$(esc "$HOSTNAME_V")\",
  \"device_type\":\"$DEVICE_TYPE\",
  \"brand\":\"$(esc "$BRAND")\",
  \"model\":\"$(esc "$MODEL")\",
  \"serial_number\":\"$(esc "$SERIAL")\",
  \"os\":{\"name\":\"$(esc "$OS_NAME")\",\"version\":\"$(esc "$OS_VER")\",\"kernel\":\"$(esc "$KERNEL")\",\"arch\":\"$(esc "$ARCH")\"},
  \"cpu\":\"$(esc "$CPU")\",
  \"ram_mb\":$(num "$RAM_MB"),
  \"network_role\":\"$NET_ROLE\",
  \"domain_or_workgroup_name\":\"$(esc "$NET_NAME")\",
  \"interfaces\":$IFACES_JSON,
  \"disks\":$DISKS_JSON,
  \"software\":$SW_JSON,
  \"logged_in_user\":\"$(esc "$LOGGED_USER")\",
  \"uptime_hours\":$(num "$UPTIME_H")
 }
}"

# ---------- send / spool ----------
if [ "$DRY_RUN" -eq 1 ]; then
  printf '%s\n' "$PAYLOAD"
  echo "--dry-run: not sent. host=$HOSTNAME_V serial=${SERIAL:-n/a} role=$NET_ROLE${NET_NAME:+ ($NET_NAME)}" >&2
  exit 0
fi
if [ -z "$SERVER_URL" ] || [ -z "$TOKEN" ]; then
  echo "ERROR: set F2_SERVER_URL and F2_TOKEN (or use --dry-run)." >&2; exit 1
fi

send_file() { # $1 = file with payload
  curl -fsS --max-time 30 -X POST "$SERVER_URL/api/assethub/ingest" \
       -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
       --data-binary @"$1" >/dev/null 2>&1
}

# flush spool first, then send current
for F in "$SPOOL_DIR"/*.json; do
  [ -f "$F" ] || continue
  send_file "$F" && rm -f "$F"
done
TMP="$SPOOL_DIR/$(date +%s)-$$.json"
printf '%s' "$PAYLOAD" > "$TMP"
if send_file "$TMP"; then
  rm -f "$TMP"
  echo "OK: inventory sent for $HOSTNAME_V (role=$NET_ROLE${NET_NAME:+, $NET_NAME})"
else
  echo "WARN: server unreachable — spooled to $TMP (will retry on next run)" >&2
fi
