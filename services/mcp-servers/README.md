# F2 MCP Servers

Four MCP (Model Context Protocol) servers that let F2 team members talk
to the F2 platform through **Claude Code** (covered by the Claude Max
plan) without spending Anthropic API tokens.

## Why this exists

The `ai-orchestrator-api` service (migration 050) uses the **Anthropic
API** — every token is billable and counts against the $150/mo pilot
budget. That is right for automated / customer-facing workflows.

**Claude Max plan** covers a different product: interactive use of
Claude via Claude Code and claude.ai. It cannot proxy for the API.

These MCP servers close the loop: F2 team members open Claude Code
(billed under Max), and it can now read + draft F2 platform data
directly. Zero API cost for the team's day-to-day workflow.

## The four servers

| Server | Access | Tools |
| --- | --- | --- |
| **f2-customers-mcp** | read-only Postgres | list_customers, get_customer, list_tickets, get_ticket |
| **f2-cms-mcp** | read-only Postgres | list_services, get_service, list_blog_posts, get_blog_post, list_case_studies, list_pages |
| **f2-analytics-mcp** | read-only Postgres | ai_usage_summary, ai_usage_by_task, lead_stats, revenue_summary |
| **f2-content-mcp** | read + write Postgres (unpublished only) | draft_blog_post, draft_service_update, draft_case_study |

Every write from `f2-content-mcp` is forced to `is_published=FALSE`
and tagged `ai_drafted=TRUE`. A human still has to publish from
`/admin/*`.

## Install

Runs on Node 20+. Each server is a standalone package.

```bash
cd services/mcp-servers
for d in f2-*-mcp; do (cd "$d" && npm install); done
```

## Configure Claude Code

Copy the block below into `~/.claude/settings.json` (user-level) OR
`.claude/settings.json` in this repo (project-level, checked in).
Adjust `DATABASE_URL` if your Postgres isn't on the default port.

```json
{
  "mcpServers": {
    "f2-customers": {
      "command": "node",
      "args": ["node_modules/tsx/dist/cli.mjs", "src/index.ts"],
      "cwd": "services/mcp-servers/f2-customers-mcp",
      "env": { "DATABASE_URL": "postgres://f2:f2@localhost:5432/f2_website" }
    },
    "f2-cms": {
      "command": "node",
      "args": ["node_modules/tsx/dist/cli.mjs", "src/index.ts"],
      "cwd": "services/mcp-servers/f2-cms-mcp",
      "env": { "DATABASE_URL": "postgres://f2:f2@localhost:5432/f2_website" }
    },
    "f2-analytics": {
      "command": "node",
      "args": ["node_modules/tsx/dist/cli.mjs", "src/index.ts"],
      "cwd": "services/mcp-servers/f2-analytics-mcp",
      "env": { "DATABASE_URL": "postgres://f2:f2@localhost:5432/f2_website" }
    },
    "f2-content": {
      "command": "node",
      "args": ["node_modules/tsx/dist/cli.mjs", "src/index.ts"],
      "cwd": "services/mcp-servers/f2-content-mcp",
      "env": { "DATABASE_URL": "postgres://f2:f2@localhost:5432/f2_website" }
    }
  }
}
```

**Why `node <path>` and not `node_modules/.bin/tsx`?**
Claude Code resolves the `command` field **before** applying `cwd`, so
a relative binary path fails with `ENOENT: no such file or directory,
posix_spawn 'node_modules/.bin/tsx'`. `node` is always in `$PATH`, and
once it launches inside the resolved `cwd` it can happily load the
tsx CLI at `node_modules/tsx/dist/cli.mjs`.

**Why not `npx tsx`?** — `npx` writes install-progress lines to stdout
on first invocation, which corrupts the JSON-RPC framing the MCP
client expects.

The project ships an equivalent [`.mcp.json`](../../.mcp.json) at the
repo root — copy from there if this README drifts.

Restart Claude Code after editing settings. Verify with `/mcp` inside
Claude Code — you should see all four servers listed as connected.

## Example prompts

Once connected, try these in Claude Code:

- "หาลูกค้าที่ consent showcase จะหมดใน 60 วัน"
- "สรุปการใช้งาน AI เดือนนี้แยกตาม provider"
- "ตั๋วซัพพอร์ตที่ยังเปิดอยู่ของ SALA มีอะไรบ้าง"
- "ร่าง blog post EN + TH เรื่อง DNS management จาก service data ที่เรามี" — จะไปเรียก `f2-cms:get_service` แล้ว `f2-content:draft_blog_post`
- "list every managed client ที่ใช้ business-email"

## Safety model

- Read-only servers use `SET default_transaction_read_only=on` at session
  start — literally cannot write even if the code has a bug
- Write server (`f2-content-mcp`) hard-codes `is_published=FALSE` on every
  INSERT/UPDATE and refuses to publish
- Every write logs to `audit_log` with `actor_email='claude-code-mcp'`
- No decrypted credentials, no PII of customer contacts is ever returned

## Development

Each server can be run standalone for manual testing:

```bash
cd services/mcp-servers/f2-customers-mcp
DATABASE_URL=postgres://f2:f2@localhost:5432/f2_website npx tsx src/index.ts
```

Then use an MCP inspector (or hand-craft JSON-RPC over stdio) to probe.
