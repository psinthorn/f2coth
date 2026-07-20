#!/bin/sh
# =============================================================================
#  F2 AssetHub — All-in-one Runner (Linux + macOS)  v1.0.0
#  F2 Co., Ltd. · f2.co.th
#
#  One script that does the whole job on THIS box:
#    1. OS check          (Linux / macOS; Windows → run.ps1)
#    2. Server preflight  (is the AssetHub server reachable + module on?)
#    3. Fetch tools       (collect.sh always; discover.sh when F2_CIDRS is set —
#                          each self-installs its own deps: the probe pulls nmap/jq)
#    4. Collect this box  + (optional) probe the LAN, and push both.
#
#  Prefer the individual tools (collect.sh / discover.sh / install.sh) when you
#  only need one job; use this when you want "run everything here" in one go.
#
#  USAGE
#    curl -fsSL https://assethub.f2.co.th/api/assethub/collector/run.sh \
#      | F2_SERVER_URL="https://assethub.f2.co.th" F2_TOKEN="<token>" sh
#    # add F2_CIDRS="192.168.1.0/24" to also sweep the LAN.
#
#  DAEMON / SCHEDULING
#    F2_DAEMON=1   stay resident: poll the server and run when it says to
#                  (operator "Scan now" in admin, or the token's rescan
#                  interval). Poll cadence comes from the server per token.
#    Otherwise runs once and exits (audit-visit / cron mode).
# =============================================================================
set -u

SERVER_URL="${F2_SERVER_URL:-}"
[ -n "$SERVER_URL" ]   || { echo "[run] ERROR: set F2_SERVER_URL" >&2; exit 2; }
[ -n "${F2_TOKEN:-}" ] || { echo "[run] ERROR: set F2_TOKEN" >&2; exit 2; }
BASE="${SERVER_URL%/}/api/assethub/collector"
API="${SERVER_URL%/}/api/assethub"

# ---- OS check -------------------------------------------------------------
OS="$(uname -s 2>/dev/null || echo unknown)"
case "$OS" in
  Linux|Darwin) : ;;
  CYGWIN*|MINGW*|MSYS*)
    echo "[run] Windows shell detected — use run.ps1 instead." >&2; exit 2 ;;
  *) echo "[run] ERROR: unsupported OS: $OS" >&2; exit 2 ;;
esac

have() { command -v "$1" >/dev/null 2>&1; }
DL="" ; have curl && DL="curl -fsSL -o" ; [ -z "$DL" ] && have wget && DL="wget -qO"
[ -n "$DL" ] || { echo "[run] ERROR: need curl or wget" >&2; exit 3; }

# ---- server preflight (fail fast on a bad URL / disabled module) ----------
preflight() {
  if have curl; then curl -fsS -m 10 -o /dev/null "$BASE/collect.sh"
  else wget -q -T 10 -O /dev/null "$BASE/collect.sh"; fi
}
if ! preflight; then
  echo "[run] ERROR: cannot reach $BASE/collect.sh — check F2_SERVER_URL and that" >&2
  echo "[run]   the machine has outbound access and the AssetHub module is enabled." >&2
  exit 4
fi

WORK="$(mktemp -d 2>/dev/null || echo /tmp/f2-run.$$)"; mkdir -p "$WORK"
fetch() { $DL "$WORK/$1" "$BASE/$1"; }
fetch collect.sh
[ -n "${F2_CIDRS:-}" ] && fetch discover.sh

# ---- one pass: inventory this box, optionally sweep the LAN ---------------
run_once() {
  echo "[run] collecting this machine ..." >&2
  F2_ONESHOT=1 bash "$WORK/collect.sh" || echo "[run] WARN: collector returned non-zero" >&2
  if [ -n "${F2_CIDRS:-}" ]; then
    echo "[run] probing $F2_CIDRS ..." >&2
    F2_ONESHOT=1 bash "$WORK/discover.sh" || echo "[run] WARN: probe returned non-zero" >&2
  fi
}

# ---- oneshot vs daemon ----------------------------------------------------
if [ "${F2_DAEMON:-0}" != "1" ]; then
  run_once
  echo "[run] done (oneshot)." >&2
  exit 0
fi

echo "[run] daemon mode — polling $API/agent/poll" >&2
poll() { # echoes "run poll_min"; falls back to a safe default on error
  body="$(curl -fsS -m 15 -H "Authorization: Bearer $F2_TOKEN" "$API/agent/poll" 2>/dev/null)" || { echo "false 5"; return; }
  r=$(printf '%s' "$body" | sed -n 's/.*"run":[ ]*\(true\|false\).*/\1/p')
  p=$(printf '%s' "$body" | sed -n 's/.*"poll_min":[ ]*\([0-9]*\).*/\1/p')
  echo "${r:-false} ${p:-5}"
}
while true; do
  set -- $(poll); DECISION="$1"; POLL_MIN="$2"
  if [ "$DECISION" = "true" ]; then
    run_once
    curl -fsS -m 15 -X POST -H "Authorization: Bearer $F2_TOKEN" "$API/agent/ack" >/dev/null 2>&1 \
      || echo "[run] WARN: ack failed" >&2
  fi
  case "$POLL_MIN" in ''|*[!0-9]*) POLL_MIN=5 ;; esac
  sleep $(( POLL_MIN * 60 ))
done
