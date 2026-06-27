# ai/prompts

Role prompts for the F2 corporate-website multi-agent pipeline.

## Agent memory / knowledge base

Before starting any pipeline run, agents should load the following memory files for project context:

| File | Contents |
|---|---|
| `docs/build-report.md` … `docs/phase-bc-report.md` | Phase-by-phase history of what shipped |
| `docs/security-review.md` | Current security status and open items |
| `docs/MULTILINGUAL.md` | Canonical bilingual contract |
| `database/migrations/` | Full schema (14 migrations) |

**Copilot / GitHub Copilot** also maintains persistent memory at:
- `/memories/repo/project.md` — stack, services, routes, conventions, open roadmap
- `/memories/repo/agents.md` — agent roster, pipeline order, hard rules
- `/memories/copilot-notes.md` — working notes, common mistakes, quick-start commands

## Pipeline order

1. **PM** — `agent-pm.md` *(orchestrator: intake, spec, pipeline routing)*
2. **Skills Manager** — `agent-skills.md` *(routes tasks & maintains capability registry)*
3. **Prompt Engineer** — `agent-prompt-engineer.md` *(writes/revises agent prompts & chatbot system prompt)*
4. **Designer** — `agent-designer.md`
5. **DBA** — `agent-dba.md`
6. **Backend** — `agent-backend.md`
7. **SEO / Optimization Engineer** — `agent-seo.md` *(pre-build: emit SEO requirements; post-build: PASS/FAIL audit across 11 disciplines)*
8. **Copy Writer** — `agent-copywriter.md` *(marketing + digital-marketing copy in EN+TH; runs after SEO pre-build, before Frontend)*
9. **Frontend** — `agent-frontend.md`
10. **QA** — `agent-qa.md`
11. **Security** — `agent-security.md`
12. **Performance** — `agent-performance.md`
13. **Legal** — `agent-legal.md`
14. **DevOps** — `agent-devops.md`
15. **Tracker** — `agent-tracker.md`
16. **Reporter** — `agent-reporter.md`

### Meta-agent roles

| Agent | When to invoke |
|---|---|
| **PM** | At the start of every run — converts a request into a spec and decides which agents to invoke. |
| **Skills Manager** | After PM routing — validates agent assignments and logs capability gaps. |
| **Prompt Engineer** | When creating a new agent, revising an existing prompt, or updating the chatbot system prompt. |
| **Performance** | After QA + Security — audits DB queries, Core Web Vitals, caching, observability gaps. Invoke for any new endpoint, page, or service. |
| **Legal** | After Performance — invoke whenever the feature touches personal data, user agreements, domain registration, SLA contracts, AI/chat, or billing. Thai PDPA + international law. |
| **SEO / Optimization Engineer** | Twice per public-surface change — pre-build to emit SEO requirements that the spec must include; post-build (after QA) to score the rendered page across 11 disciplines (Technical, On-page, AEO, GEO, LLMO, VSO, Local, Off-page, CRO, Image, Video). Skip for internal APIs and admin/portal routes. |
| **Copy Writer** | After Designer + after SEO pre-build, before Frontend — produces EN+TH marketing copy (titles, meta, headlines, body, CTAs, alt text, FAQ, transactional notifications) that satisfies all 11 SEO disciplines and brand voice. Bilingual native, never auto-translate. |

Each prompt is self-contained: a Claude session loaded with the prompt should be able to do its job without further context beyond the relevant code/diff.

To invoke manually: read the matching prompt, paste the diff or task, and follow the prompt's "Output format" section.
