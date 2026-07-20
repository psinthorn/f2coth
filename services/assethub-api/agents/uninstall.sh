#!/bin/sh
# =============================================================================
#  F2 AssetHub — Uninstall / Cleanup (Linux + macOS)  v1.0.0
#  F2 Co., Ltd. · f2.co.th
#
#  Removes ONLY what the F2 tools put on this machine:
#    • packages the probe auto-installed (read from the install manifest, so a
#      tool the box already had is never touched)
#    • the spool + state directories (~/.f2-assethub, /tmp/f2-assethub*)
#    • temp scripts the installer dropped in $TMPDIR/tmp
#  It does NOT remove tools you installed yourself, and creates no cron/tasks
#  to clean (the collector/probe never schedule anything automatically).
#
#  USAGE
#    curl -fsSL https://assethub.f2.co.th/api/assethub/collector/uninstall.sh | sh
#  ENV
#    F2_KEEP_DEPS=1     keep nmap/jq etc. — only delete F2 files/dirs
#    F2_STATE_DIR=path  state dir to read the manifest from (match install)
# =============================================================================
set -u

STATE_DIR="${F2_STATE_DIR:-${HOME}/.f2-assethub}"
[ -d "$STATE_DIR" ] || [ -f "$STATE_DIR/installed-deps" ] || {
  # fall back to the alt location the installer uses when HOME isn't writable
  [ -d /tmp/f2-assethub ] && STATE_DIR="/tmp/f2-assethub"
}

SUDO=""
if [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1; then SUDO="sudo"; fi

remove_pkgs() { # $1=mgr, rest=packages
  mgr="$1"; shift
  case "$mgr" in
    apt-get) $SUDO apt-get remove -y "$@" ;;
    apk)     $SUDO apk del "$@" ;;
    dnf)     $SUDO dnf remove -y "$@" ;;
    yum)     $SUDO yum remove -y "$@" ;;
    pacman)  $SUDO pacman -Rs --noconfirm "$@" ;;
    zypper)  $SUDO zypper --non-interactive remove "$@" ;;
    brew)    brew uninstall "$@" ;;
    *) return 1 ;;
  esac
}

# ---- remove the packages WE installed (only) ------------------------------
MANIFEST="$STATE_DIR/installed-deps"
if [ "${F2_KEEP_DEPS:-0}" = "1" ]; then
  echo "[uninstall] F2_KEEP_DEPS=1 — leaving installed packages in place." >&2
elif [ -f "$MANIFEST" ]; then
  MGR="$(sed -n 's/^mgr=//p' "$MANIFEST")"
  PKGS="$(sed -n 's/^pkgs=//p' "$MANIFEST")"
  if [ -n "$MGR" ] && [ -n "$PKGS" ]; then
    echo "[uninstall] removing F2-installed package(s) via $MGR:$PKGS" >&2
    remove_pkgs "$MGR" $PKGS || echo "[uninstall] WARN: package removal reported an error — remove manually if needed." >&2
  else
    echo "[uninstall] manifest present but empty — nothing to remove." >&2
  fi
else
  echo "[uninstall] no install manifest found — the probe installed nothing, or it ran elsewhere." >&2
  echo "[uninstall]   (pass F2_STATE_DIR=… if you set a custom state dir at install time.)" >&2
fi

# ---- remove F2 files / dirs -----------------------------------------------
for d in "$STATE_DIR" "${HOME}/.f2-assethub" /tmp/f2-assethub /tmp/f2-assethub-spool; do
  [ -e "$d" ] && { echo "[uninstall] removing $d" >&2; rm -rf "$d"; }
done
# installer temp copies
rm -f "${TMPDIR:-/tmp}"/f2-*.sh "${TMPDIR:-/tmp}"/f2-collect.sh 2>/dev/null || true

echo "[uninstall] done. (Downloaded collect.sh/discover.sh in your working dir, if any, were left for you to delete.)" >&2
