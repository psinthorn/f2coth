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
7. **Frontend** — `agent-frontend.md`
8. **QA** — `agent-qa.md`
9. **Security** — `agent-security.md`
10. **Performance** — `agent-performance.md`
11. **Legal** — `agent-legal.md`
12. **DevOps** — `agent-devops.md`
13. **Tracker** — `agent-tracker.md`
14. **Reporter** — `agent-reporter.md`

### Meta-agent roles

| Agent | When to invoke |
|---|---|
| **PM** | At the start of every run — converts a request into a spec and decides which agents to invoke. |
| **Skills Manager** | After PM routing — validates agent assignments and logs capability gaps. |
| **Prompt Engineer** | When creating a new agent, revising an existing prompt, or updating the chatbot system prompt. |
| **Performance** | After QA + Security — audits DB queries, Core Web Vitals, caching, observability gaps. Invoke for any new endpoint, page, or service. |
| **Legal** | After Performance — invoke whenever the feature touches personal data, user agreements, domain registration, SLA contracts, AI/chat, or billing. Thai PDPA + international law. |

Each prompt is self-contained: a Claude session loaded with the prompt should be able to do its job without further context beyond the relevant code/diff.

To invoke manually: read the matching prompt, paste the diff or task, and follow the prompt's "Output format" section.
