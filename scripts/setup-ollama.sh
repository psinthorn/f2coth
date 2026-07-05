#!/usr/bin/env bash
# scripts/setup-ollama.sh
# Installs Ollama on the host Mac (if not present), pulls the models
# used by the AI orchestrator pilot, and verifies each is reachable
# from the docker network.
#
# Models pulled match the ai_routing seed rows in migration 050:
#   phi4:14b            ticket_triage · docs_organizer · rag_chunker · rag_reranker
#   mistral-small3:24b  support_assistant primary
#   qwen2.5:32b         data_analyst primary · content_writer fallback
#   bge-m3              embeddings primary
#
# Run this on the host Mac (NOT inside a container).
# Usage: bash scripts/setup-ollama.sh

set -euo pipefail

MODELS=(
    "phi4:14b"
    "mistral-small3:24b"
    "qwen2.5:32b"
    "bge-m3"
)

info() { printf "\033[36m▸\033[0m %s\n" "$*"; }
ok()   { printf "\033[32m✓\033[0m %s\n" "$*"; }
warn() { printf "\033[33m!\033[0m %s\n" "$*"; }
fail() { printf "\033[31m✗\033[0m %s\n" "$*"; exit 1; }

# 1. Ollama install
if ! command -v ollama >/dev/null 2>&1; then
    info "Ollama not found — installing via official script"
    if [[ "$OSTYPE" == "darwin"* ]]; then
        info "macOS detected — please install the Ollama.app manually from https://ollama.com/download"
        info "  (the CLI ships inside the app bundle; auto-install requires Homebrew or manual DL)"
        fail "Install Ollama.app first, then re-run this script."
    else
        curl -fsSL https://ollama.com/install.sh | sh
    fi
else
    ok "Ollama already installed: $(ollama --version 2>&1 | head -1)"
fi

# 2. Verify daemon reachable
info "Checking Ollama daemon on http://localhost:11434"
if ! curl -fsS --max-time 3 http://localhost:11434/api/version >/dev/null; then
    warn "Daemon not responding — starting 'ollama serve' in background"
    nohup ollama serve >/tmp/ollama-serve.log 2>&1 &
    sleep 3
    curl -fsS --max-time 3 http://localhost:11434/api/version >/dev/null \
        || fail "Ollama daemon still not reachable. Check /tmp/ollama-serve.log"
fi
ok "Daemon reachable"

# 3. Pull each model (idempotent — ollama re-uses cached layers)
for m in "${MODELS[@]}"; do
    info "Pulling $m (this can be several GB — first time only)"
    ollama pull "$m" || fail "Failed to pull $m"
    ok "Pulled $m"
done

# 4. Verify reachable from docker (host.docker.internal)
info "Checking reachability from docker network"
if docker compose ps --quiet ai-orchestrator-api 2>/dev/null | grep -q .; then
    if docker compose exec -T ai-orchestrator-api \
        wget -qO- --timeout=3 http://host.docker.internal:11434/api/version >/dev/null 2>&1; then
        ok "ai-orchestrator-api can reach Ollama via host.docker.internal:11434"
    else
        warn "Container cannot reach Ollama — check that docker Desktop is running and host.docker.internal is resolvable."
    fi
else
    warn "ai-orchestrator-api is not running — skipping in-container reachability check."
    warn "Bring it up with: docker compose up -d ai-orchestrator-api"
fi

# 5. Print installed models
info "Installed models:"
ollama list

ok "Setup complete. Next: flip modules 'api.ai_orchestrator' and 'admin.ai' ON in /admin/features."
