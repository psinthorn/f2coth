# Agents — pipeline, hard rules, invocation

**Status:** stub. The full 12-agent pipeline lives in `ai/prompts/agent-<name>.md`. This file is the load-first summary so any AI agent knows the shape before diving in.

---

## The 4 hard rules (from CLAUDE.md — repeat here so no agent misses them)

1. **Prior-art check first** — scan existing handlers / components / tables / routes before writing anything new. Tag output: `REUSE | EXTEND | NEW`.
2. **Reuse over duplication** — one model per concept, one component per UI pattern, one SQL query per access pattern.
3. **Bilingual always** — every feature ships EN + TH in the same change. `npm run i18n-check` gates CI.
4. **No scope creep mid-run** — downstream agents flag issues as follow-ups, never silently expand scope.

---

## Pipeline (in order — skip layers that don't apply)

```
PM → Skills Manager → Prompt Engineer* → Designer* → DBA* →
Backend* → Frontend* → QA → Security → Performance* → Legal* → DevOps* → Tracker → Reporter
```

`*` = layer only runs when it's touched. Each has a prompt at `ai/prompts/agent-<name>.md`. Load that file when invoking the layer.

---

## Where each agent's responsibilities land

- **PM** — scope, acceptance criteria, non-goals. Doesn't write code.
- **Prompt Engineer** — refines the request into token-efficient specs before handing off.
- **Designer** — Tailwind, layout, mobile-first. Touches `web-app/src/components/*` and CSS.
- **DBA** — writes the next-numbered migration. Never edits an applied migration; ships a new one instead.
- **Backend** — Go service + handlers + middleware. Owns the API contract.
- **Frontend** — React pages + client helpers (`admin-api.ts` / `portal-api.ts` / domain-specific).
- **QA** — table-driven Go tests + Playwright specs. Runs `make test` + `make i18n-check`.
- **Security** — auth gates, PDPA/DSR compliance, secrets hygiene, XSS/SQLi review.
- **Performance** — index review, N+1 hunt, bundle size on frontend touches.
- **Legal** — terms, privacy, DPA content when public-legal pages change.
- **DevOps** — docker-compose entries, Makefile SERVICES list, prod overlay, healthchecks.
- **Tracker** — updates `pipeline-runs.md` (this repo) at end of run.
- **Reporter** — final summary back to human.

---

## Write-back after every run

Tracker + Reporter must update:
- `memories/repo/pipeline-runs.md` — append the run record (newest at top, follow the format of previous entries).
- `memories/repo/project.md` — bump routes / migrations / open-items if changed.
- `memories/repo/entities.md` — update client entitlements / service catalogue / module registry if changed.

Skip write-back only if truly nothing changed at the memory layer (rare — even a bug fix usually updates the "last verified" line).
