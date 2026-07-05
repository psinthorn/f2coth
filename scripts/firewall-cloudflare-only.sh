#!/usr/bin/env bash
# scripts/firewall-cloudflare-only.sh
#
# Locks port 443 on the host to Cloudflare's edge ranges only. Run this
# on the VPS AFTER Cloudflare is Active and proxying (§ 4 of
# docs/cloudflare-setup.md). Running before Cloudflare is set up will
# lock you out of your own :443.
#
# What it does:
#   • Fetches the current CF IPv4 + IPv6 ranges
#   • Uses ufw (preferred) if available, falls back to raw iptables/ip6tables
#   • Allows :443/tcp from each CF range, denies all other :443
#   • Leaves :22/tcp (SSH) open — layer your own SSH allow-list separately
#   • Leaves :80/tcp open — Traefik uses it for LE HTTP-01 challenge renewal
#     (LE HTTP-01 fires from Let's Encrypt validation servers, not CF)
#
# Usage:
#   sudo ./scripts/firewall-cloudflare-only.sh apply     # lock down
#   sudo ./scripts/firewall-cloudflare-only.sh clear     # undo (open :443 to world)
#   sudo ./scripts/firewall-cloudflare-only.sh status    # show current 443 rules
#
# Cron on the VPS (monthly, keeps IP list current):
#   0 3 15 * * root /opt/f2-website/scripts/firewall-cloudflare-only.sh apply >/dev/null

set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
    echo "must run as root" >&2
    exit 2
fi

ACTION="${1:-status}"
CF_TAG="cloudflare-edge"

fetch_cf_ips() {
    if ! v4=$(curl -sSf https://www.cloudflare.com/ips-v4); then
        echo "failed to fetch CF IPv4 list" >&2; exit 3
    fi
    if ! v6=$(curl -sSf https://www.cloudflare.com/ips-v6); then
        echo "failed to fetch CF IPv6 list" >&2; exit 3
    fi
    echo "$v4"
    echo "$v6"
}

have_ufw() { command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; }

case "$ACTION" in
apply)
    echo "→ Fetching current Cloudflare IP ranges…"
    ranges=$(fetch_cf_ips)
    count=$(echo "$ranges" | wc -l | tr -d ' ')
    echo "  got $count ranges"

    if have_ufw; then
        echo "→ Using ufw"
        # Wipe any existing rules tagged as CF (identified by comment)
        while read -r line; do
            n=$(echo "$line" | awk '{print $1}' | tr -d '[]')
            [ -n "$n" ] && ufw --force delete "$n" || true
        done < <(ufw status numbered | grep "$CF_TAG" | tac)

        # Allow each CF range on 443
        while IFS= read -r cidr; do
            [ -z "$cidr" ] && continue
            ufw allow proto tcp from "$cidr" to any port 443 comment "$CF_TAG" >/dev/null
        done <<< "$ranges"

        # Explicitly deny 443 from anywhere else. ufw defaults to deny incoming
        # but stating it explicitly makes the intent visible in `ufw status`.
        ufw deny 443/tcp comment "$CF_TAG deny" >/dev/null || true

        echo "→ Rules applied. Current state:"
        ufw status numbered | grep -E "443|$CF_TAG" | head -30
    else
        echo "→ ufw not active, falling back to iptables"
        # Wipe old CF chain
        iptables  -w -F CF-EDGE 2>/dev/null || iptables  -w -N CF-EDGE
        ip6tables -w -F CF-EDGE 2>/dev/null || ip6tables -w -N CF-EDGE

        # Ensure input chain jumps to CF-EDGE for 443 traffic
        iptables  -w -C INPUT -p tcp --dport 443 -j CF-EDGE 2>/dev/null || \
            iptables  -w -I INPUT -p tcp --dport 443 -j CF-EDGE
        ip6tables -w -C INPUT -p tcp --dport 443 -j CF-EDGE 2>/dev/null || \
            ip6tables -w -I INPUT -p tcp --dport 443 -j CF-EDGE

        while IFS= read -r cidr; do
            [ -z "$cidr" ] && continue
            if [[ "$cidr" == *:* ]]; then
                ip6tables -w -A CF-EDGE -s "$cidr" -j ACCEPT
            else
                iptables  -w -A CF-EDGE -s "$cidr" -j ACCEPT
            fi
        done <<< "$ranges"

        iptables  -w -A CF-EDGE -j DROP
        ip6tables -w -A CF-EDGE -j DROP
        echo "→ Rules applied. Current chain:"
        iptables  -w -L CF-EDGE -n --line-numbers | head -20
    fi
    echo "✓ Port 443 is now Cloudflare-only."
    ;;

clear)
    if have_ufw; then
        while read -r line; do
            n=$(echo "$line" | awk '{print $1}' | tr -d '[]')
            [ -n "$n" ] && ufw --force delete "$n" || true
        done < <(ufw status numbered | grep "$CF_TAG" | tac)
        ufw allow 443/tcp comment "post-CF-cleanup" >/dev/null
    else
        iptables  -w -F CF-EDGE 2>/dev/null || true
        ip6tables -w -F CF-EDGE 2>/dev/null || true
        iptables  -w -D INPUT -p tcp --dport 443 -j CF-EDGE 2>/dev/null || true
        ip6tables -w -D INPUT -p tcp --dport 443 -j CF-EDGE 2>/dev/null || true
        iptables  -w -X CF-EDGE 2>/dev/null || true
        ip6tables -w -X CF-EDGE 2>/dev/null || true
    fi
    echo "✓ Port 443 is open to the world again."
    ;;

status)
    if have_ufw; then
        ufw status numbered | grep -E "443|$CF_TAG" | head -30
    else
        iptables -w -L CF-EDGE -n --line-numbers 2>/dev/null | head -20 || echo "no CF-EDGE chain"
    fi
    ;;

*)
    echo "usage: $0 {apply|clear|status}" >&2
    exit 2
    ;;
esac
