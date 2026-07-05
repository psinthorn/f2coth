# AI Infrastructure: Cloud vs Local — Comparison + Hybrid Design

**Purpose**: decide F2's AI infrastructure strategy for the AI Section (see conversation on AI Orchestrator design). Goal is short-term cost efficiency with the ability to shift the mix later.

---

## 1. TL;DR

- **Local** wins on marginal cost after break-even, wins on data sovereignty, loses on absolute quality for reasoning-heavy tasks.
- **Cloud** wins on quality (Opus 4.7 has no local equivalent at 2026-Q1), wins on ops simplicity, loses on per-token cost at scale.
- **Recommended: hybrid from day one** — abstract behind a provider adapter, route each request to whichever backend fits the task. Start ~80% cloud / 20% local, migrate to ~40% cloud / 60% local once local pipelines are stable.
- **Break-even**: local pays off around **30 M–50 M input tokens/month**. F2's projected volume (~65 M/mo) sits above that, so the migration path is worth designing now even if we start cloud-heavy.

---

## 2. Cloud Subscription Base

**Providers on the table**: Anthropic API (primary), Voyage AI (embeddings), OpenAI as fallback.

### Strengths
- **Best-in-class quality**: Claude Opus 4.7 and Sonnet 4.6 have no open-source equivalent for complex reasoning, tool use, and long-context work
- **Zero ops burden**: no GPU driver, no model updates, no OOM debugging, no queue management
- **Prompt caching (Anthropic)**: 90% discount on repeated system prompts — huge for RAG + agent workloads with stable system prompt
- **Batch API**: 50% discount for non-latency-sensitive jobs (nightly RAG re-index, weekly summarization)
- **Latency floor is predictable**: sub-second first token for Haiku, 2–3s for Sonnet, 3–5s for Opus
- **Vision + tool-use built in**: for handover-packet OCR and structured extraction

### Weaknesses
- **Marginal cost never goes to zero** — every token costs money forever
- **Data leaves F2's infrastructure**: even with Anthropic's zero-retention API mode, customer content transits their servers
- **Vendor lock-in risk**: if Anthropic changes pricing / policy, F2 has to react
- **Network dependency**: outage upstream = service outage for F2 AI features
- **Cost cap governance is critical**: without budget guardrails a runaway loop can spend $$$$ in an hour

### Realistic monthly cost @ F2 projected usage

Assumptions from earlier design doc: 65 M input + 8 M output tokens/mo across all agents, ~70% covered by prompt caching.

| Model | Input tokens | Output tokens | Cost (2026-Q1 rates) |
|---|---|---|---|
| Opus 4.7 (orchestrator) | 15 M in / 2 M out | with 70% cache | ~$60 |
| Sonnet 4.6 (workers) | 30 M in / 4 M out | with cache | ~$135 |
| Haiku 4.5 (triage/RAG) | 20 M in / 2 M out | with cache | ~$16 |
| Voyage embeddings | 5 M | — | ~$0.60 |
| **Total cloud/mo** | | | **~$210** |

Without prompt caching this doubles to ~$450/mo.

---

## 3. Local Base

**Stack**: Ollama or vLLM on Apple Silicon (Metal) or NVIDIA GPU box.

### Hardware options (2026-Q1)

| Option | One-time | RAM/VRAM | Model ceiling (Q4-quant) | Power |
|---|---|---|---|---|
| **Existing Mac dev machine** | 0 | depends | 7B–13B fits on 16GB, 34B on 48GB | ~40 W idle, ~120 W under load |
| **Mac mini M4 Pro 48GB** | ~$1,800 | 48GB unified | Qwen 2.5 32B / Mistral Small 3 | ~40 W idle |
| **Mac Studio M4 Max 64GB** | ~$3,200 | 64GB unified | Llama 3.3 70B | ~60 W idle |
| **Mac Studio M2 Ultra 128GB** | ~$5,600 | 128GB unified | Llama 3.3 70B @ Q8, or 2 models loaded | ~80 W idle |
| **RTX 4090 24GB PC build** | ~$2,800 | 24 GB VRAM | Qwen 2.5 32B fits tight | ~100 W idle, 450 W load |
| **Dual RTX 4090** | ~$5,500 | 48 GB VRAM | Llama 3.3 70B split | ~200 W idle |
| **Cloud GPU rental (Vast.ai)** | $0 upfront | on demand | any | $0.40–$1.20/hr |

### Model options (2026-Q1) — realistic for F2 tasks

| Model | Size (Q4) | Fits on | Best use | Quality tier |
|---|---|---|---|---|
| Phi-4 14B | ~9 GB | any Mac 16GB+ | Classification, RAG chunker | Haiku-ish |
| Mistral Small 3 24B | ~15 GB | Mac 32GB+ | Chat, code, summarization | Haiku++ |
| Qwen 2.5 32B | ~20 GB | Mac 48GB+ / 24GB VRAM | Coding, tool-use, JSON output | Sonnet-lite |
| Llama 3.3 70B | ~40 GB | Mac 64GB+ / 48GB VRAM | General purpose | Sonnet-lite/mid |
| Nemotron 70B | ~40 GB | same as above | RAG-tuned, long context | Sonnet-mid |

**Reality check**: no open-source model in 2026-Q1 matches Opus 4.7 for multi-step agentic reasoning, and top open models fall roughly between Haiku 4.5 and Sonnet 4.6 depending on task.

### Strengths
- **Marginal cost approaches zero** — after hardware + electricity, tokens are free
- **Data sovereignty**: nothing leaves F2's premises → strongest PDPA/DPA story for hotel clients
- **Offline resilient**: works during Anthropic outages
- **Prompt caching / long context is free** — no per-token penalty for feeding whole SOP into prompt
- **Fine-tuning path**: can train a small model on F2's own patterns later
- **Latency for short prompts often better on M-series** (no network round-trip)

### Weaknesses
- **Ops burden**: model updates, driver issues, OOM crashes, queue backlogs are now F2's problem
- **Quality ceiling**: no local model equals Opus for complex reasoning today
- **Concurrency**: 1 GPU/Mac serves one big generation at a time; queue builds up under load
- **Upfront capex**: $1,800–$5,600 before generating a single token
- **Model management churn**: new open-source SOTA models drop every 2–3 months; keeping up is real work
- **Embedding quality gap**: local embeddings (BGE, nomic) are ~85–90% of Voyage's; RAG recall suffers a bit

### Realistic monthly cost @ same volume

Assumptions: Mac Studio M4 Max 64GB (~$3,200), 24 mo amortization, ~$0.15/kWh Thailand electricity, 15 h/day at ~100 W active load = 45 kWh/mo.

| Item | Cost/mo |
|---|---|
| Hardware amortized (24 mo) | ~$135 |
| Electricity (100 W avg × 15 h/day × 30 d × $0.15/kWh) | ~$7 |
| Cloud embeddings (kept on Voyage — local ones are weaker) | ~$1 |
| Cloud escalation to Opus for hard tasks (~5% of volume) | ~$15 |
| Model updates + ops labor (hidden cost, 4 h/mo × $30/h) | ~$120 |
| **Total local-heavy/mo** | **~$278** |

**Yes, cloud is actually cheaper in this scenario for pure token cost — because Anthropic's prompt caching is aggressive and F2's volume isn't massive yet.** Local only wins when volume climbs OR when data sovereignty becomes non-negotiable.

---

## 4. Break-even Analysis

Where does local become cheaper than cloud purely on tokens?

Local cost is roughly flat with volume (~$135 hardware + electricity). Cloud scales linearly.

| Monthly input tokens | Cloud (with cache) | Local (M4 Max) | Winner |
|---|---|---|---|
| 20 M | ~$65 | ~$150 | Cloud |
| 50 M | ~$160 | ~$155 | Tie — break-even |
| 100 M | ~$325 | ~$165 | Local |
| 500 M | ~$1,600 | ~$210 | Local (huge margin) |

**F2's projected volume (65 M/mo) is just past break-even for raw tokens** — but only if we assume the local model can actually do the work Opus was doing. Since it can't for the orchestrator tier, hybrid wins.

---

## 5. Capability Comparison — task by task

| Task | Cloud pick | Local pick | Verdict |
|---|---|---|---|
| Orchestrator (multi-step planning) | Opus 4.7 | Llama 3.3 70B | **Cloud** — quality gap too big to ignore |
| Content Writer (blog, marketing EN+TH) | Sonnet 4.6 | Qwen 2.5 32B | **Cloud** — Thai native quality still favors Claude |
| Data Analyst (SQL, summarize) | Sonnet 4.6 | Qwen 2.5 32B | **Either** — Qwen strong at code + JSON output |
| Support Assistant (portal chat) | Haiku 4.5 | Mistral Small 3 | **Local** viable after prompt tuning |
| Ticket Triage (classify + label) | Haiku 4.5 | Phi-4 14B | **Local** — trivially handled |
| Docs Organizer (dedup, tag) | Haiku 4.5 | Phi-4 14B | **Local** — high volume, low complexity |
| System Auditor (cron classification) | Haiku 4.5 | Phi-4 14B | **Local** — nightly batch fits perfectly |
| RAG chunker + reranker | Haiku 4.5 | BGE-m3 + Phi-4 | **Local** |
| Embeddings | Voyage-3 | BGE-m3 (multilingual) | **Cloud initially, local later** |
| Handover Compiler (structured docs) | Sonnet 4.6 | Qwen 2.5 32B | **Either** — Qwen good at JSON output |
| Consultant (RFP, strategy) | Opus 4.7 | (none competitive) | **Cloud** |

**Pattern**: hard reasoning + creative EN/TH bilingual → cloud. Classification, dedup, cron batch → local. **Roughly 40–50% of token volume can move local without noticeable quality loss.**

---

## 6. Hybrid Architecture — the switchable adapter

The whole point: never bake the provider choice into business logic. All AI calls go through one interface. A config table (or admin UI) decides which backend serves which task.

```
┌────────────────────────────────────────────────────────────────┐
│              Existing services (agents, RAG, chat)             │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────┐
│         ai-orchestrator-api — Provider Adapter Layer           │
│                                                                │
│   task_type ─┐                                                 │
│              ├──► routingTable (DB) ──► provider + model       │
│   role ──────┘                                                 │
│                                                                │
│   ProviderClient interface:                                    │
│     • generate(messages, model, tools, ...)                    │
│     • embed(texts, model)                                      │
│     • stream(messages, model, ...)                             │
│                                                                │
│   Implementations:                                             │
│     • AnthropicClient   → api.anthropic.com                    │
│     • OpenAIClient      → api.openai.com                       │
│     • OllamaClient      → http://ollama:11434 (local box)      │
│     • VLLMClient        → http://vllm:8000                     │
│                                                                │
│   Every call:                                                  │
│     1) Consult routing table by (task, tier, sensitivity)      │
│     2) Call chosen provider                                    │
│     3) On error → fallback provider (configurable per task)    │
│     4) Log tokens + latency + cost to ai_usage_log             │
└────────────────────────────────────────────────────────────────┘
```

### Routing table (data-driven, not code-driven)

```sql
CREATE TABLE ai_routing (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_type      TEXT NOT NULL,      -- 'orchestrator' / 'content_writer' / 'triage' / ...
    tier           TEXT NOT NULL,      -- 'primary' / 'fallback' / 'batch'
    provider       TEXT NOT NULL,      -- 'anthropic' / 'ollama' / 'openai' / 'vllm'
    model          TEXT NOT NULL,      -- 'claude-opus-4-7' / 'llama-3.3-70b-instruct' / ...
    max_tokens_in  INT,
    max_tokens_out INT,
    enabled        BOOLEAN NOT NULL DEFAULT true,
    sort_order     INT NOT NULL DEFAULT 0,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (task_type, tier)
);

-- Example seed
INSERT INTO ai_routing (task_type, tier, provider, model) VALUES
('orchestrator',    'primary',  'anthropic', 'claude-opus-4-7'),
('orchestrator',    'fallback', 'anthropic', 'claude-sonnet-4-6'),
('content_writer',  'primary',  'anthropic', 'claude-sonnet-4-6'),
('content_writer',  'fallback', 'ollama',    'qwen2.5:32b'),
('ticket_triage',   'primary',  'ollama',    'phi4:14b'),
('ticket_triage',   'fallback', 'anthropic', 'claude-haiku-4-5'),
('docs_organizer',  'primary',  'ollama',    'phi4:14b'),
('rag_chunker',     'primary',  'ollama',    'phi4:14b'),
('embeddings',      'primary',  'voyage',    'voyage-3'),
('embeddings',      'fallback', 'ollama',    'bge-m3');
```

### Admin UI — `/admin/ai/routing`

Table view where staff toggle provider per task at runtime, no deploy needed. Similar UX to `/admin/features` module toggle.

- Green rows = local (free)
- Blue rows = cloud (paid)
- Switch dropdown per task
- Test-shot button — send a canned prompt to that route to verify

### Runtime switching mechanics

- Every 30 seconds the orchestrator reads routing table into memory
- No restart required to flip a task from cloud → local
- Fallback triggers on: 5xx from provider, timeout > 30s, model unavailable
- Ops can drain cloud calls by flipping all tiers to local — useful for cost emergencies

### Cost/usage tracking

```sql
CREATE TABLE ai_usage_log (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    task_type      TEXT NOT NULL,
    provider       TEXT NOT NULL,
    model          TEXT NOT NULL,
    tokens_in      INT NOT NULL,
    tokens_out     INT NOT NULL,
    cache_hit_tokens INT DEFAULT 0,
    cost_usd       NUMERIC(10,6),
    latency_ms     INT,
    session_id     UUID,
    actor_id       UUID,
    error          TEXT
);

-- Dashboard queries answer "how much did we spend this month" and
-- "would we save by moving X off cloud" in one SQL.
```

---

## 7. Recommended path for F2

### Phase A — Cloud-first foundation (Weeks 1–4)
- Deploy the adapter layer with 1 provider only: Anthropic
- Every route = cloud, but the routing table exists
- Wire up prompt caching + batch API to squeeze cloud cost
- Track `ai_usage_log` religiously
- **Cost**: ~$210/mo, **Ops**: near-zero
- **Deliverable**: everything works, know exactly what each task costs

### Phase B — Add local as fallback (Weeks 5–6)
- Install Ollama on existing Mac (or new Mac mini if budget allows)
- Add Phi-4 14B + Mistral Small 3 24B
- Route only the cheap tasks to local: `ticket_triage`, `docs_organizer`, `rag_chunker`
- Keep everything else on cloud
- **Cost**: ~$180/mo (small savings), **Ops**: ~2 h setup + 1 h/mo maintenance
- **Deliverable**: proof that the adapter switches cleanly

### Phase C — Expand local coverage (Weeks 7–10)
- Add Qwen 2.5 32B for `data_analyst`, `handover_compiler`, `content_writer_fallback`
- Move batch/cron jobs (nightly RAG re-index, weekly summarizer) to local
- Only orchestrator + consultant + primary content writer stay on cloud
- **Cost**: ~$140/mo cloud + ~$8 electricity + hardware amortized
- **Deliverable**: 40–50% of token volume on local, quality parity for those routes

### Phase D — Optimize for load (Month 4+)
- Watch `ai_usage_log` — anything spending >$30/mo on cloud that could go local?
- Consider fine-tuning Qwen on F2's writing style if content quality matters
- Consider upgrading local hardware if queue depth becomes a bottleneck
- **Cost**: variable, but capped by hardware, not usage
- **Deliverable**: sustainable cost structure that scales with F2's headcount, not customer count

---

## 8. Concrete first-steps (once decision is made)

If F2 approves this path, the actual buildable items in order:

1. **Migration 050**: `ai_routing` table + `ai_usage_log` table + seed rows
2. **New Go service**: `ai-orchestrator-api` extending existing `ai-chat-api` skeleton (port 8009)
   - `internal/providers/anthropic.go` (existing pattern from `ai-chat-api/internal/claude/client.go`)
   - `internal/providers/ollama.go` (new)
   - `internal/providers/openai.go` (fallback stub)
   - `internal/router/router.go` — reads `ai_routing` table, dispatches
   - `internal/logger/usage.go` — writes `ai_usage_log`
3. **Admin UI**: `/admin/ai/routing` + `/admin/ai/usage` (cost dashboard)
4. **Ollama setup script**: `scripts/setup-ollama.sh` — install, pull models, health-check
5. **Docker Compose service**: `ollama` container (or host-run) with network route

Estimated build: ~6 hours end-to-end for Phase A + adapter shell + admin routing UI. Local integration (Phase B onwards) adds ~4 hours per phase.

---

## 9. Decisions still pending

1. **Hardware for local**: use existing Mac / buy Mac mini M4 Pro / buy Mac Studio / GPU PC?
2. **Initial routing table**: default all cloud (safest) or start with triage on local from day one?
3. **Ollama vs vLLM**: Ollama simpler and Metal-native for Mac; vLLM better for concurrency on NVIDIA
4. **Embeddings provider**: keep Voyage cloud (quality) or move to BGE-m3 local (free but ~10% recall drop)?
5. **Budget alert threshold**: email when spend crosses $X/mo? default $150?

**My picks if left to me**: existing Mac for now → Ollama → route triage + docs_organizer local from day one → Voyage stays cloud → alert at $150/mo. Reversible via the routing table, so wrong picks are cheap to correct.
