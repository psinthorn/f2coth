# ai/prompts

Role prompts for the F2 corporate-website multi-agent pipeline.

## Pipeline order

1. PM (orchestrator — defined in repo root `CLAUDE.md` if/when added)
2. **Designer** — `agent-designer.md`
3. **DBA** — `agent-dba.md`
4. **Backend** — `agent-backend.md`
5. **Frontend** — `agent-frontend.md`
6. **QA** — `agent-qa.md`
7. **Security** — `agent-security.md`
8. **DevOps** — `agent-devops.md`
9. **Tracker** — `agent-tracker.md`
10. **Reporter** — `agent-reporter.md`

Each prompt is self-contained: a Claude session loaded with the prompt should be able to do its job without further context beyond the relevant code/diff.

To invoke manually: read the matching prompt, paste the diff or task, and follow the prompt's "Output format" section.
