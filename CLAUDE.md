# CLAUDE.md — F2 Website Project Manifest
<!-- Auto-loaded by Claude Code and GitHub Copilot on session start -->
<!-- Last updated: 2026-06-27 -->

This file is the **single entry point** for any AI agent (Claude, Copilot, GPT) working on this repo.
Read this first. Then load the memory files listed under § Memory.

---

## What this project is

**F2 Co., Ltd.** (`f2.co.th`) — Thailand's IT partner for luxury hospitality.
Corporate website + customer portal + admin console, built as a microservices monorepo.

| Layer | Tech |
|---|---|
| Frontend | Next.js 16 (App Router) · TypeScript · Tailwind · Lucide |
| Backend | Go 1.22 · Chi · pgx/v5 · JWT HS256 |
| Database | PostgreSQL 16 · 19 migrations |
| Gateway | Traefik v2.11 |
| i18n | next-intl v4 (pinned) · EN (default) + TH · 982 keys |
| AI chatbot | Claude `claude-sonnet-4-6` via `ai-chat-api` |
| CI | GitHub Actions · `.github/workflows/build.yml` |
| Module toggles | `modules` table + `pkg/modulegate` middleware + `/admin/features` UI |

---

## Memory — load these files for full context

```
memories/repo/project.md    → Stack, services, routes, conventions, open roadmap
memories/repo/agents.md     → 12-agent pipeline, hard rules, how to invoke
memories/repo/entities.md   → Client facts, service catalogue, DB entity map
memories/repo/pipeline-runs.md → Run history (episodic log)
memories/copilot-notes.md   → Working notes, common mistakes, quick-start
```

---

## Services & ports

| Service | Port | Owns |
|---|---|---|
| `cms-api` | 8001 | Content, domain pricing, hosting plans |
| `lead-api` | 8002 | Contact form, lead CRM |
| `ai-chat-api` | 8003 | Claude chatbot |
| `auth-api` | 8004 | Staff + customer JWT auth |
| `notification-api` | 8005 | SMTP email worker |
| `customer-api` | 8006 | Portal, tickets, SLA, assets |
| `reseller-api` | 8007 | Domain availability + order registration |

---

## 4 hard rules (all agents, always)

1. **Prior-art check first** — scan existing handlers/components/tables/routes before writing anything new. Tag output: `REUSE | EXTEND | NEW`.
2. **Reuse over duplication** — one model per concept, one component per UI pattern, one SQL query per access pattern.
3. **Bilingual always** — every feature ships EN + TH in the same change. `npm run i18n-check` enforces key parity (CI gate).
4. **No scope creep mid-run** — downstream agents flag issues as follow-ups, never silently expand scope.

---

## Prior-art lookup — where to search

| What you need | Where to look |
|---|---|
| Existing API endpoint | `services/*/internal/handlers/*.go` + `cmd/server/main.go` |
| Existing DB table/column | `database/migrations/*.sql` (19 files, read in order) |
| Existing UI component | `services/web-app/src/components/*.tsx` |
| Existing route/page | `services/web-app/src/app/[locale]/` |
| Existing API helper/type | `services/web-app/src/lib/api.ts`, `admin-api.ts`, `modules.ts` |
| Existing middleware | `services/*/internal/middleware/*.go` (canonical `pkg/modulegate/`) |
| Existing translation key | `services/web-app/messages/en.json` |
| Live feature inventory | `/admin/features` page (live data from `modules` table) — check before building any new feature |
| Next migration number | `database/migrations/` — currently at `019_modules_and_audit_log.sql` → next is `020_` |

---

## Common commands

```bash
make up            # Start full stack (dev)
make prod-up       # Start with production overlay
make ci            # Full local CI: tidy + fmt + test + i18n-check
make test          # Go tests across all 7 services
make i18n-check    # Verify EN ↔ TH key parity (740 keys)
make migrate       # Re-apply all DB migrations
```

---

## Agent pipeline

```
PM → Skills Manager → Prompt Engineer* → Designer* → DBA* →
Backend* → Frontend* → QA → Security → Performance* → Legal* → DevOps* → Tracker → Reporter
```
`*` = only when that layer is touched. Load `ai/prompts/agent-<name>.md` for each agent.

---

## Memory write-back (after each pipeline run)

After Reporter produces the final summary, update:
- `memories/repo/pipeline-runs.md` — append run record
- `memories/repo/project.md` — update routes/migrations/open-items if changed
- `memories/repo/entities.md` — update client entitlements/service catalogue if changed
