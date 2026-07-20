#!/bin/sh
# =============================================================================
#  F2 AssetHub — Universal Installer (Linux + macOS)  v1.0.0
#  F2 Co., Ltd. · f2.co.th
#
#  ONE command: auto-detects the OS, picks the right tool, downloads it, and
#  runs it. The chosen tool self-installs its own dependencies (the probe pulls
#  nmap/jq via the box's package manager). Windows machines use install.ps1.
#
#  USAGE
#    curl -fsSL https://assethub.f2.co.th/api/assethub/collector/install.sh \
#      | F2_SERVER_URL="https://assethub.f2.co.th" F2_TOKEN="<token>" sh
#
#  TOOL SELECTION (auto)
#    default            → collect.sh  (inventory THIS machine)
#    F2_CIDRS set        → discover.sh (network probe / sweep those subnets)
#    F2_MODE=collector|probe  → force either explicitly
#  All F2_* env vars pass straight through to the chosen tool.
# =============================================================================
set -eu

SERVER_URL="${F2_SERVER_URL:-}"
[ -n "$SERVER_URL" ]      || { echo "[install] ERROR: set F2_SERVER_URL" >&2; exit 2; }
[ -n "${F2_TOKEN:-}" ]    || { echo "[install] ERROR: set F2_TOKEN" >&2; exit 2; }
BASE="${SERVER_URL%/}/api/assethub/collector"

# ---- detect OS ------------------------------------------------------------
OS="$(uname -s 2>/dev/null || echo unknown)"
case "$OS" in
  Linux)  PLATFORM="linux" ;;
  Darwin) PLATFORM="macos" ;;
  CYGWIN*|MINGW*|MSYS*)
    echo "[install] Windows shell detected — use the PowerShell installer instead:" >&2
    echo "[install]   \$env:F2_SERVER_URL=\"$SERVER_URL\"; \$env:F2_TOKEN=\"…\"; irm $BASE/install.ps1 | iex" >&2
    exit 2 ;;
  *) echo "[install] ERROR: unsupported OS: $OS" >&2; exit 2 ;;
esac

# ---- choose tool ----------------------------------------------------------
MODE="${F2_MODE:-}"
[ -n "$MODE" ] || { [ -n "${F2_CIDRS:-}" ] && MODE="probe" || MODE="collector"; }
case "$MODE" in
  collector) SCRIPT="collect.sh" ;;
  probe)     SCRIPT="discover.sh" ;;
  *) echo "[install] ERROR: F2_MODE must be 'collector' or 'probe'" >&2; exit 2 ;;
esac
echo "[install] os=$PLATFORM  mode=$MODE  tool=$SCRIPT" >&2

# ---- download -------------------------------------------------------------
have() { command -v "$1" >/dev/null 2>&1; }
TMP="$(mktemp 2>/dev/null || echo "/tmp/f2-$SCRIPT.$$")"
if   have curl; then curl -fsSL "$BASE/$SCRIPT" -o "$TMP"
elif have wget; then wget -qO "$TMP" "$BASE/$SCRIPT"
else echo "[install] ERROR: need curl or wget to download $SCRIPT" >&2; exit 3; fi

# ---- run (tool installs its own deps; F2_* env inherited) -----------------
echo "[install] running $SCRIPT ..." >&2
exec bash "$TMP"
