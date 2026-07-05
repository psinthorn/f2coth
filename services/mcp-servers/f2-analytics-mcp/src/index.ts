#!/usr/bin/env -S npx tsx
// f2-analytics-mcp — read-only aggregates across the F2 platform:
// AI orchestrator usage, lead pipeline stats, and invoice / revenue
// summaries. Meant for questions like:
//   "สรุปการใช้งาน AI เดือนนี้แยกตาม provider"
//   "leads เข้ามากี่ราย 7 วันย้อนหลัง"
//   "ยอด invoice ที่ยังไม่ได้จ่ายเท่าไหร่"

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import pg from "pg";
import { z } from "zod";

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });
pool.on("connect", (client) => {
  client.query("SET default_transaction_read_only = on").catch(() => {});
});

// ---------- schemas ----------

const PeriodArgs = z.object({
  period: z
    .enum(["today", "7d", "30d", "mtd", "ytd"])
    .default("mtd")
    .describe("today | 7d | 30d | mtd (month-to-date) | ytd (year-to-date)"),
});

const LeadStatsArgs = PeriodArgs.extend({
  group_by: z.enum(["status", "source"]).default("status"),
});

const RevenueSummaryArgs = PeriodArgs.extend({});

// ---------- server ----------

const server = new Server(
  { name: "f2-analytics", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "ai_usage_summary",
      description:
        "Total AI spend and call count for a period. Includes provider mix (cloud vs local) and % of $150 monthly budget consumed.",
      inputSchema: {
        type: "object",
        properties: {
          period: {
            type: "string",
            enum: ["today", "7d", "30d", "mtd", "ytd"],
            default: "mtd",
          },
        },
      },
    },
    {
      name: "ai_usage_by_task",
      description:
        "Break AI spend down by task_type (orchestrator, content_writer, ticket_triage, ...) for the period.",
      inputSchema: {
        type: "object",
        properties: {
          period: {
            type: "string",
            enum: ["today", "7d", "30d", "mtd", "ytd"],
            default: "mtd",
          },
        },
      },
    },
    {
      name: "lead_stats",
      description:
        "Count leads for a period, grouped by status or source. Answers 'how many leads came in from the contact form last month'.",
      inputSchema: {
        type: "object",
        properties: {
          period: {
            type: "string",
            enum: ["today", "7d", "30d", "mtd", "ytd"],
            default: "30d",
          },
          group_by: {
            type: "string",
            enum: ["status", "source"],
            default: "status",
          },
        },
      },
    },
    {
      name: "revenue_summary",
      description:
        "Invoice + payment aggregates for a period: issued amount, paid amount, outstanding, and per-status breakdown.",
      inputSchema: {
        type: "object",
        properties: {
          period: {
            type: "string",
            enum: ["today", "7d", "30d", "mtd", "ytd"],
            default: "mtd",
          },
        },
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const name = req.params.name;
  const args = req.params.arguments ?? {};
  try {
    switch (name) {
      case "ai_usage_summary":
        return ok(await aiUsageSummary(PeriodArgs.parse(args)));
      case "ai_usage_by_task":
        return ok(await aiUsageByTask(PeriodArgs.parse(args)));
      case "lead_stats":
        return ok(await leadStats(LeadStatsArgs.parse(args)));
      case "revenue_summary":
        return ok(await revenueSummary(RevenueSummaryArgs.parse(args)));
      default:
        return err(`unknown tool: ${name}`);
    }
  } catch (e: unknown) {
    return err(e instanceof Error ? e.message : String(e));
  }
});

// ---------- queries ----------

function periodClause(period: string): string {
  switch (period) {
    case "today":
      return "at >= date_trunc('day', NOW())";
    case "7d":
      return "at >= NOW() - INTERVAL '7 days'";
    case "30d":
      return "at >= NOW() - INTERVAL '30 days'";
    case "ytd":
      return "at >= date_trunc('year', NOW())";
    case "mtd":
    default:
      return "at >= date_trunc('month', NOW())";
  }
}

function periodClauseCol(period: string, col: string): string {
  return periodClause(period).replace(/\bat\b/g, col);
}

async function aiUsageSummary(a: z.infer<typeof PeriodArgs>) {
  const clause = periodClause(a.period);
  const { rows: total } = await pool.query(
    `SELECT COALESCE(SUM(cost_usd),0)::float AS cost_usd,
            COALESCE(SUM(tokens_in),0)::int AS tokens_in,
            COALESCE(SUM(tokens_out),0)::int AS tokens_out,
            COUNT(*)::int AS calls
       FROM ai_usage_log WHERE ${clause}`,
  );
  const { rows: byProvider } = await pool.query(
    `SELECT provider, COUNT(*)::int AS calls,
            COALESCE(SUM(cost_usd),0)::float AS cost_usd
       FROM ai_usage_log WHERE ${clause}
      GROUP BY provider ORDER BY cost_usd DESC`,
  );
  const budget = 150; // pilot cap; keep in sync with .env AI_BUDGET_ALERT_USD
  return {
    period: a.period,
    ...total[0],
    budget_usd: budget,
    pct_used: budget > 0 ? (total[0].cost_usd / budget) * 100 : null,
    by_provider: byProvider,
  };
}

async function aiUsageByTask(a: z.infer<typeof PeriodArgs>) {
  const clause = periodClause(a.period);
  const { rows } = await pool.query(
    `SELECT task_type, provider, model,
            COUNT(*)::int AS calls,
            COALESCE(SUM(tokens_in),0)::int AS tokens_in,
            COALESCE(SUM(tokens_out),0)::int AS tokens_out,
            COALESCE(SUM(cost_usd),0)::float AS cost_usd,
            COALESCE(AVG(latency_ms),0)::int AS avg_latency_ms
       FROM ai_usage_log WHERE ${clause}
      GROUP BY task_type, provider, model
      ORDER BY cost_usd DESC, calls DESC`,
  );
  return { period: a.period, rows };
}

async function leadStats(a: z.infer<typeof LeadStatsArgs>) {
  const clause = periodClauseCol(a.period, "created_at");
  const col = a.group_by;
  const { rows } = await pool.query(
    `SELECT ${col} AS bucket, COUNT(*)::int AS count
       FROM leads WHERE ${clause}
      GROUP BY ${col} ORDER BY count DESC`,
  );
  const { rows: total } = await pool.query(
    `SELECT COUNT(*)::int AS total FROM leads WHERE ${clause}`,
  );
  return { period: a.period, group_by: col, total: total[0].total, buckets: rows };
}

async function revenueSummary(a: z.infer<typeof RevenueSummaryArgs>) {
  const clause = periodClauseCol(a.period, "issued_at");
  const { rows } = await pool.query(
    `SELECT status,
            COUNT(*)::int AS count,
            COALESCE(SUM(amount_total_cents),0)::bigint AS total_cents,
            COALESCE(SUM(amount_paid_cents),0)::bigint AS paid_cents
       FROM invoices WHERE ${clause}
      GROUP BY status ORDER BY total_cents DESC`,
  );
  const { rows: total } = await pool.query(
    `SELECT COALESCE(SUM(amount_total_cents),0)::bigint AS issued_cents,
            COALESCE(SUM(amount_paid_cents),0)::bigint AS paid_cents,
            COALESCE(SUM(amount_total_cents - amount_paid_cents)
                     FILTER (WHERE status IN ('issued','partially_paid','overdue')),0)::bigint
                AS outstanding_cents
       FROM invoices WHERE ${clause}`,
  );
  return { period: a.period, totals: total[0], by_status: rows };
}

// ---------- helpers + boot ----------

function ok(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}
function err(msg: string) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: JSON.stringify({ error: msg }) }],
  };
}

const transport = new StdioServerTransport();
await server.connect(transport);
