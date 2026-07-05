#!/usr/bin/env -S npx tsx
// f2-content-mcp — the ONE write-capable MCP server. Lets Claude Code
// draft content into the F2 CMS (blog posts, service intro/faq updates,
// case studies) — but every write is hard-forced is_published=FALSE and
// tagged in audit_log with actor_email='claude-code-mcp' so an F2 human
// still has to review + publish from /admin/*.
//
// Design constraints (per Claude Max plan integration plan):
//   • Never sets is_published=TRUE
//   • Never mutates published_at
//   • Never touches customer PII, credentials, invoices, users
//   • Writes an audit_log row for every INSERT/UPDATE
//   • All content fields accept en + th (JSONB) — TH is optional but
//     encouraged since bilingual is F2 policy

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

const ACTOR_EMAIL = "claude-code-mcp";

// ---------- schemas ----------

// i18n text: en required, th optional.
const I18nText = z.object({
  en: z.string().min(1),
  th: z.string().optional(),
});

const DraftBlogArgs = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .describe("kebab-case, unique across blog_posts"),
  title: I18nText,
  excerpt: I18nText,
  body_md: I18nText,
  tags: z.array(z.string()).default([]),
  cover_image_url: z.string().url().optional(),
});

const FAQItem = z.object({
  q: z.string(),
  a: z.string(),
});
const DraftServiceUpdateArgs = z.object({
  slug: z.string().describe("existing service slug"),
  intro_en: z.string().optional(),
  intro_th: z.string().optional(),
  faq_en: z.array(FAQItem).optional(),
  faq_th: z.array(FAQItem).optional(),
});

const DraftCaseStudyArgs = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  client_name: z.string(),
  industry: z.string().optional(),
  location: z.string().optional(),
  relationship_years: z.number().int().positive().optional(),
  summary: I18nText,
  challenge: I18nText,
  solution: I18nText,
  results: I18nText,
  quote_text: I18nText.optional(),
  quote_author: z.string().optional(),
  services_used: z.array(z.string()).default([]),
});

// ---------- server ----------

const server = new Server(
  { name: "f2-content", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "draft_blog_post",
      description:
        "Create a new UNPUBLISHED blog post draft. slug must be new (kebab-case). Provide EN + TH content when possible. is_published is forced FALSE — an F2 human publishes from /admin/blog after review.",
      inputSchema: {
        type: "object",
        properties: {
          slug: { type: "string", pattern: "^[a-z0-9-]+$" },
          title: {
            type: "object",
            properties: { en: { type: "string" }, th: { type: "string" } },
            required: ["en"],
          },
          excerpt: {
            type: "object",
            properties: { en: { type: "string" }, th: { type: "string" } },
            required: ["en"],
          },
          body_md: {
            type: "object",
            properties: { en: { type: "string" }, th: { type: "string" } },
            required: ["en"],
          },
          tags: { type: "array", items: { type: "string" } },
          cover_image_url: { type: "string" },
        },
        required: ["slug", "title", "excerpt", "body_md"],
      },
    },
    {
      name: "draft_service_update",
      description:
        "Update the intro paragraph and/or FAQ of an existing service. Does NOT change is_published. Use to enrich services still marked unpublished after migration 048/049. Provide EN + TH.",
      inputSchema: {
        type: "object",
        properties: {
          slug: { type: "string" },
          intro_en: { type: "string" },
          intro_th: { type: "string" },
          faq_en: {
            type: "array",
            items: {
              type: "object",
              properties: { q: { type: "string" }, a: { type: "string" } },
              required: ["q", "a"],
            },
          },
          faq_th: {
            type: "array",
            items: {
              type: "object",
              properties: { q: { type: "string" }, a: { type: "string" } },
              required: ["q", "a"],
            },
          },
        },
        required: ["slug"],
      },
    },
    {
      name: "draft_case_study",
      description:
        "Create a new UNPUBLISHED case study (challenge / solution / results / optional quote). Requires signed extended-consent letter on file for the client — server does NOT verify this; F2 team must confirm before publishing from /admin/case-studies.",
      inputSchema: {
        type: "object",
        properties: {
          slug: { type: "string" },
          client_name: { type: "string" },
          industry: { type: "string" },
          location: { type: "string" },
          relationship_years: { type: "number" },
          summary: {
            type: "object",
            properties: { en: { type: "string" }, th: { type: "string" } },
            required: ["en"],
          },
          challenge: {
            type: "object",
            properties: { en: { type: "string" }, th: { type: "string" } },
            required: ["en"],
          },
          solution: {
            type: "object",
            properties: { en: { type: "string" }, th: { type: "string" } },
            required: ["en"],
          },
          results: {
            type: "object",
            properties: { en: { type: "string" }, th: { type: "string" } },
            required: ["en"],
          },
          services_used: { type: "array", items: { type: "string" } },
        },
        required: ["slug", "client_name", "summary", "challenge", "solution", "results"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const name = req.params.name;
  const args = req.params.arguments ?? {};
  try {
    switch (name) {
      case "draft_blog_post":
        return ok(await draftBlogPost(DraftBlogArgs.parse(args)));
      case "draft_service_update":
        return ok(await draftServiceUpdate(DraftServiceUpdateArgs.parse(args)));
      case "draft_case_study":
        return ok(await draftCaseStudy(DraftCaseStudyArgs.parse(args)));
      default:
        return err(`unknown tool: ${name}`);
    }
  } catch (e: unknown) {
    return err(e instanceof Error ? e.message : String(e));
  }
});

// ---------- write implementations (all is_published=FALSE) ----------

async function draftBlogPost(a: z.infer<typeof DraftBlogArgs>) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO blog_posts (slug, title, excerpt, body_md, cover_image_url, tags, is_published)
       VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb, $5, $6, FALSE)
       RETURNING id::text, slug`,
      [
        a.slug,
        JSON.stringify(a.title),
        JSON.stringify(a.excerpt),
        JSON.stringify(a.body_md),
        a.cover_image_url ?? null,
        a.tags,
      ],
    );
    const id = rows[0].id;
    await writeAudit(client, "blog_post", id, "ai_draft_create", {
      slug: a.slug,
      title_en: a.title.en,
      has_th: !!a.title.th,
      tags: a.tags,
    });
    await client.query("COMMIT");
    return {
      status: "draft_created",
      id,
      slug: a.slug,
      is_published: false,
      review_url: `/admin/blog/${a.slug}`,
      note: "Draft saved. Review + publish from admin.",
    };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function draftServiceUpdate(a: z.infer<typeof DraftServiceUpdateArgs>) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Existence check — refuse a silent no-op.
    const { rows: check } = await client.query(
      `SELECT id::text FROM services WHERE slug = $1`,
      [a.slug],
    );
    if (check.length === 0) {
      throw new Error(`service '${a.slug}' not found`);
    }
    const id = check[0].id;

    // Merge intro / faq JSONB rather than overwrite — allows adding
    // just TH when EN already exists, and vice versa.
    if (a.intro_en !== undefined || a.intro_th !== undefined) {
      const patch: Record<string, string> = {};
      if (a.intro_en !== undefined) patch.en = a.intro_en;
      if (a.intro_th !== undefined) patch.th = a.intro_th;
      await client.query(
        `UPDATE services SET intro = intro || $2::jsonb WHERE id = $1::uuid`,
        [id, JSON.stringify(patch)],
      );
    }
    if (a.faq_en !== undefined || a.faq_th !== undefined) {
      const patch: Record<string, unknown> = {};
      if (a.faq_en !== undefined) patch.en = a.faq_en;
      if (a.faq_th !== undefined) patch.th = a.faq_th;
      await client.query(
        `UPDATE services SET faq = faq || $2::jsonb WHERE id = $1::uuid`,
        [id, JSON.stringify(patch)],
      );
    }

    await writeAudit(client, "service", id, "ai_draft_update", {
      slug: a.slug,
      updated_fields: {
        intro_en: a.intro_en !== undefined,
        intro_th: a.intro_th !== undefined,
        faq_en: a.faq_en !== undefined,
        faq_th: a.faq_th !== undefined,
      },
    });

    await client.query("COMMIT");
    return {
      status: "draft_updated",
      slug: a.slug,
      review_url: `/admin/services/${a.slug}`,
      note: "Draft saved. is_published unchanged — publish from admin when ready.",
    };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function draftCaseStudy(a: z.infer<typeof DraftCaseStudyArgs>) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO case_studies
         (slug, client_name, industry, location, relationship_years,
          summary, challenge, solution, results,
          quote_text, quote_author, services_used,
          is_published)
       VALUES
         ($1,$2,$3,$4,$5,
          $6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,
          $10::jsonb,$11,$12,
          FALSE)
       RETURNING id::text, slug`,
      [
        a.slug,
        a.client_name,
        a.industry ?? null,
        a.location ?? null,
        a.relationship_years ?? null,
        JSON.stringify(a.summary),
        JSON.stringify(a.challenge),
        JSON.stringify(a.solution),
        JSON.stringify(a.results),
        a.quote_text ? JSON.stringify(a.quote_text) : null,
        a.quote_author ?? null,
        a.services_used,
      ],
    );
    const id = rows[0].id;
    await writeAudit(client, "case_study", id, "ai_draft_create", {
      slug: a.slug,
      client_name: a.client_name,
      services_used: a.services_used,
    });
    await client.query("COMMIT");
    return {
      status: "draft_created",
      id,
      slug: a.slug,
      is_published: false,
      review_url: `/admin/case-studies/${a.slug}`,
      note: "Draft saved. CONFIRM signed extended-consent letter is on file before publishing.",
    };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

// ---------- shared audit + boot ----------

async function writeAudit(
  client: pg.PoolClient,
  resourceType: string,
  resourceId: string,
  action: string,
  changes: Record<string, unknown>,
) {
  await client.query(
    `INSERT INTO audit_log (resource_type, resource_id, actor_id, actor_email, action, changes)
     VALUES ($1, $2, NULL, $3, $4, $5::jsonb)`,
    [resourceType, resourceId, ACTOR_EMAIL, action, JSON.stringify(changes)],
  );
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

const transport = new StdioServerTransport();
await server.connect(transport);
