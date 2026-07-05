#!/usr/bin/env bash
# Diagnostic wrapper for MCP servers — captures env + stderr to
# /tmp/mcp-<name>-<ts>.log so we can see why Claude Code's spawn dies.
#
# Usage in .mcp.json:
#   "command": "services/mcp-servers/run-with-logs.sh",
#   "args": ["f2-customers-mcp"]
#
# The wrapper picks the server dir from $1, sets DATABASE_URL from the
# child env, and runs the local tsx CLI via the current node binary.

set -uo pipefail

SERVER="${1:-}"
if [[ -z "$SERVER" ]]; then
  echo "usage: run-with-logs.sh <server-dir-name>" >&2
  exit 2
fi

# Repo root = one level above services/mcp-servers/ (the script's dir).
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVER_DIR="$SCRIPT_DIR/$SERVER"

LOG="/tmp/mcp-${SERVER}.log"
{
  echo "==== $(date -u +%Y-%m-%dT%H:%M:%SZ) BOOT ===="
  echo "  cwd=$PWD"
  echo "  server_dir=$SERVER_DIR"
  echo "  PATH=$PATH"
  echo "  node=$(command -v node || echo MISSING)"
  echo "  node -v: $(node -v 2>&1 || echo N/A)"
  echo "  DATABASE_URL=${DATABASE_URL:-UNSET}"
  echo "  args after \$1: $*"
} >> "$LOG" 2>&1

cd "$SERVER_DIR" || { echo "cd failed: $SERVER_DIR" >> "$LOG"; exit 3; }

if [[ ! -f node_modules/tsx/dist/cli.mjs ]]; then
  echo "tsx cli.mjs missing in $SERVER_DIR" >> "$LOG"
  exit 4
fi

# Preserve stdout as JSON-RPC channel; send stderr to log only.
exec node node_modules/tsx/dist/cli.mjs src/index.ts 2>>"$LOG"
