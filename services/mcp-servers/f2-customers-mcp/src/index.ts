#!/usr/bin/env -S npx tsx
// f2-customers-mcp — read-only view of customers, tickets, and systems
// exposed to Claude Code via MCP. Backs the "หาลูกค้าที่..." /
// "ตั๋วที่เปิดอยู่..." style prompts.
//
// Safety: session is set to read-only at connect; every query goes
// through the same pool. See README.md § Safety model.

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

// Belt + braces: force every session on this pool to read-only. Even if
// a tool ships with an accidentally destructive SQL string, Postgres
// will refuse. Set on connect via a per-client hook.
pool.on("connect", (client) => {
  client.query("SET default_transaction_read_only = on").catch(() => {});
});

// ---------- tool schemas (zod) ----------

const ListCustomersArgs = z.object({
  is_active: z.boolean().optional(),
  service_slug: z.string().optional(),
  showcase_state: z
    .enum(["none", "consent", "live", "expiring", "expired"])
    .optional(),
  q: z.string().optional().describe("substring match on name or slug"),
  limit: z.number().int().positive().max(200).default(50),
});

const GetCustomerArgs = z.object({
  id_or_slug: z.string(),
});

const ListTicketsArgs = z.object({
  status: z
    .enum(["open", "in_progress", "waiting_customer", "resolved", "closed"])
    .optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  customer_slug: z.string().optional(),
  limit: z.number().int().positive().max(200).default(50),
});

const GetTicketArgs = z.object({
  id: z.string().uuid(),
});

// ---------- server ----------

const server = new Server(
  { name: "f2-customers", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "list_customers",
      description:
        "List F2 customers. Optionally filter by active state, a service slug they use, showcase state, or a substring on name/slug. Returns basic profile plus showcase flags.",
      inputSchema: {
        type: "object",
        properties: {
          is_active: { type: "boolean" },
          service_slug: {
            type: "string",
            description:
              "e.g. domain-hosting, dns-management, business-email — matches any element of services_used",
          },
          showcase_state: {
            type: "string",
            enum: ["none", "consent", "live", "expiring", "expired"],
          },
          q: { type: "string" },
          limit: { type: "number", default: 50 },
        },
      },
    },
    {
      name: "get_customer",
      description:
        "Fetch a single customer by id (uuid) or slug, including contact info, services used, showcase/consent status, notes, and account manager.",
      inputSchema: {
        type: "object",
        properties: { id_or_slug: { type: "string" } },
        required: ["id_or_slug"],
      },
    },
    {
      name: "list_tickets",
      description:
        "List support tickets, optionally filtered by status, priority, or customer slug. Latest activity first.",
      inputSchema: {
        type: "object",
        properties: {
          status: {
            type: "string",
            enum: [
              "open",
              "in_progress",
              "waiting_customer",
              "resolved",
              "closed",
            ],
          },
          priority: {
            type: "string",
            enum: ["low", "normal", "high", "urgent"],
          },
          customer_slug: { type: "string" },
          limit: { type: "number", default: 50 },
        },
      },
    },
    {
      name: "get_ticket",
      description:
        "Fetch a ticket including its full message thread (public messages only; internal notes excluded).",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const name = req.params.name;
  const args = req.params.arguments ?? {};

  try {
    switch (name) {
      case "list_customers":
        return ok(await listCustomers(ListCustomersArgs.parse(args)));
      case "get_customer":
        return ok(await getCustomer(GetCustomerArgs.parse(args)));
      case "list_tickets":
        return ok(await listTickets(ListTicketsArgs.parse(args)));
      case "get_ticket":
        return ok(await getTicket(GetTicketArgs.parse(args)));
      default:
        return err(`unknown tool: ${name}`);
    }
  } catch (e: unknown) {
    return err(e instanceof Error ? e.message : String(e));
  }
});

// ---------- SQL implementations ----------

async function listCustomers(a: z.infer<typeof ListCustomersArgs>) {
  const conds: string[] = ["1=1"];
  const params: unknown[] = [];
  if (a.is_active !== undefined) {
    params.push(a.is_active);
    conds.push(`c.is_active = $${params.length}`);
  }
  if (a.service_slug) {
    params.push(a.service_slug);
    conds.push(`$${params.length} = ANY(c.services_used)`);
  }
  if (a.q) {
    params.push(`%${a.q}%`);
    conds.push(`(c.name ILIKE $${params.length} OR c.slug ILIKE $${params.length})`);
  }
  // showcase_state is computed in JS after the query since it depends on NOW()
  params.push(a.limit);
  const { rows } = await pool.query(
    `SELECT c.id::text, c.slug, c.name, c.industry, c.services_used,
            c.is_active, c.notes,
            c.show_on_website, c.consent_granted_at, c.consent_expires_at,
            u.full_name AS account_manager
       FROM customers c
       LEFT JOIN users u ON u.id = c.account_manager_id
      WHERE ${conds.join(" AND ")}
      ORDER BY c.is_active DESC, c.name
      LIMIT $${params.length}`,
    params,
  );
  const out = rows.map((r) => ({ ...r, showcase_state: computeShowcase(r) }));
  return a.showcase_state
    ? out.filter((r) => r.showcase_state === a.showcase_state)
    : out;
}

async function getCustomer(a: z.infer<typeof GetCustomerArgs>) {
  const { rows } = await pool.query(
    `SELECT c.id::text, c.slug, c.name, c.industry,
            c.primary_contact_name, c.primary_contact_email, c.primary_contact_phone,
            c.services_used, c.notes, c.is_active,
            c.show_on_website, c.website_display_name, c.website_industry_label,
            c.consent_granted_at, c.consent_granted_by, c.consent_expires_at,
            c.consent_notes,
            u.full_name AS account_manager, u.email AS account_manager_email,
            c.created_at, c.updated_at
       FROM customers c
       LEFT JOIN users u ON u.id = c.account_manager_id
      WHERE c.slug = $1 OR c.id::text = $1
      LIMIT 1`,
    [a.id_or_slug],
  );
  if (rows.length === 0) return { error: "customer not found" };
  const c = rows[0];
  return { ...c, showcase_state: computeShowcase(c) };
}

async function listTickets(a: z.infer<typeof ListTicketsArgs>) {
  const conds: string[] = ["1=1"];
  const params: unknown[] = [];
  if (a.status) {
    params.push(a.status);
    conds.push(`t.status = $${params.length}`);
  }
  if (a.priority) {
    params.push(a.priority);
    conds.push(`t.priority = $${params.length}`);
  }
  if (a.customer_slug) {
    params.push(a.customer_slug);
    conds.push(`c.slug = $${params.length}`);
  }
  params.push(a.limit);
  const { rows } = await pool.query(
    `SELECT t.id::text, t.subject, t.status, t.priority,
            t.related_service_slug, t.last_activity_at, t.created_at,
            c.slug AS customer_slug, c.name AS customer_name,
            u.full_name AS assigned_to
       FROM tickets t
       JOIN customers c ON c.id = t.customer_id
       LEFT JOIN users u ON u.id = t.assigned_to_user_id
      WHERE ${conds.join(" AND ")}
      ORDER BY t.last_activity_at DESC
      LIMIT $${params.length}`,
    params,
  );
  return rows;
}

async function getTicket(a: z.infer<typeof GetTicketArgs>) {
  const { rows: tRows } = await pool.query(
    `SELECT t.id::text, t.subject, t.status, t.priority,
            t.related_service_slug, t.last_activity_at, t.created_at,
            c.slug AS customer_slug, c.name AS customer_name
       FROM tickets t
       JOIN customers c ON c.id = t.customer_id
      WHERE t.id = $1`,
    [a.id],
  );
  if (tRows.length === 0) return { error: "ticket not found" };
  const { rows: mRows } = await pool.query(
    `SELECT m.body, m.created_at,
            COALESCE(u.full_name, cc.full_name) AS author,
            CASE WHEN m.author_user_id IS NOT NULL THEN 'staff' ELSE 'customer' END AS author_kind
       FROM ticket_messages m
       LEFT JOIN users u ON u.id = m.author_user_id
       LEFT JOIN customer_contacts cc ON cc.id = m.author_contact_id
      WHERE m.ticket_id = $1 AND m.internal = FALSE
      ORDER BY m.created_at`,
    [a.id],
  );
  return { ticket: tRows[0], messages: mRows };
}

// ---------- helpers ----------

function computeShowcase(c: {
  show_on_website?: boolean;
  consent_granted_at?: string | null;
  consent_expires_at?: string | null;
}): "none" | "consent" | "live" | "expiring" | "expired" {
  const now = Date.now();
  const exp = c.consent_expires_at ? Date.parse(c.consent_expires_at) : null;
  if (exp !== null && exp <= now) return "expired";
  if (!c.consent_granted_at) return "none";
  if (!c.show_on_website) return "consent";
  if (exp !== null && exp - now < 30 * 24 * 3600 * 1000) return "expiring";
  return "live";
}

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

// ---------- boot ----------

const transport = new StdioServerTransport();
await server.connect(transport);
