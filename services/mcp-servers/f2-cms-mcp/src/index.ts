#!/usr/bin/env -S npx tsx
// f2-cms-mcp — read-only view of F2 CMS content: services catalogue,
// blog posts, case studies, pages. All fields are JSONB {en, th} so
// tools return both locales together.
//
// Powers prompts like "หา service ที่พูดถึง PMS integration" or
// "list unpublished services ที่รอ SEO review".

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

const ListServicesArgs = z.object({
  category: z.enum(["core", "support", "marketing", "opportunistic"]).optional(),
  is_published: z.boolean().optional(),
  limit: z.number().int().positive().max(100).default(50),
});
const GetServiceArgs = z.object({ slug: z.string() });

const ListBlogArgs = z.object({
  is_published: z.boolean().optional(),
  tag: z.string().optional(),
  limit: z.number().int().positive().max(100).default(20),
});
const GetBlogArgs = z.object({ slug: z.string() });

const ListCaseStudiesArgs = z.object({
  is_published: z.boolean().optional(),
});
const GetCaseStudyArgs = z.object({ slug: z.string() });

const ListPagesArgs = z.object({
  is_published: z.boolean().optional(),
});

// ---------- server ----------

const server = new Server(
  { name: "f2-cms", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "list_services",
      description:
        "List services in the F2 catalogue, optionally filtered by category (core/support/marketing/opportunistic) or publication state.",
      inputSchema: {
        type: "object",
        properties: {
          category: {
            type: "string",
            enum: ["core", "support", "marketing", "opportunistic"],
          },
          is_published: { type: "boolean" },
          limit: { type: "number", default: 50 },
        },
      },
    },
    {
      name: "get_service",
      description:
        "Fetch a service by slug. Returns full JSONB fields (title, short_summary, description, intro, faq) in both EN and TH so a caller can compare, translate, or use as source material.",
      inputSchema: {
        type: "object",
        properties: { slug: { type: "string" } },
        required: ["slug"],
      },
    },
    {
      name: "list_blog_posts",
      description:
        "List blog posts, optionally filtered by publication state or a tag. Returns slug + titles + tags + publish state.",
      inputSchema: {
        type: "object",
        properties: {
          is_published: { type: "boolean" },
          tag: { type: "string" },
          limit: { type: "number", default: 20 },
        },
      },
    },
    {
      name: "get_blog_post",
      description:
        "Fetch a blog post by slug with full body_md in EN and TH.",
      inputSchema: {
        type: "object",
        properties: { slug: { type: "string" } },
        required: ["slug"],
      },
    },
    {
      name: "list_case_studies",
      description:
        "List case studies (SALA, Putahracsa, Miskawaan, ...) with the client name, industry, services used, and publication state.",
      inputSchema: {
        type: "object",
        properties: { is_published: { type: "boolean" } },
      },
    },
    {
      name: "get_case_study",
      description:
        "Fetch a case study by slug including challenge / solution / results / quote in both languages.",
      inputSchema: {
        type: "object",
        properties: { slug: { type: "string" } },
        required: ["slug"],
      },
    },
    {
      name: "list_pages",
      description:
        "List CMS pages (about, privacy, terms, dpa, ...) with slug + title + publish state.",
      inputSchema: {
        type: "object",
        properties: { is_published: { type: "boolean" } },
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const name = req.params.name;
  const args = req.params.arguments ?? {};
  try {
    switch (name) {
      case "list_services":
        return ok(await listServices(ListServicesArgs.parse(args)));
      case "get_service":
        return ok(await getService(GetServiceArgs.parse(args)));
      case "list_blog_posts":
        return ok(await listBlogPosts(ListBlogArgs.parse(args)));
      case "get_blog_post":
        return ok(await getBlogPost(GetBlogArgs.parse(args)));
      case "list_case_studies":
        return ok(await listCaseStudies(ListCaseStudiesArgs.parse(args)));
      case "get_case_study":
        return ok(await getCaseStudy(GetBlogArgs.parse(args)));
      case "list_pages":
        return ok(await listPages(ListPagesArgs.parse(args)));
      default:
        return err(`unknown tool: ${name}`);
    }
  } catch (e: unknown) {
    return err(e instanceof Error ? e.message : String(e));
  }
});

// ---------- queries ----------

async function listServices(a: z.infer<typeof ListServicesArgs>) {
  const conds: string[] = ["1=1"];
  const params: unknown[] = [];
  if (a.category) {
    params.push(a.category);
    conds.push(`category = $${params.length}`);
  }
  if (a.is_published !== undefined) {
    params.push(a.is_published);
    conds.push(`is_published = $${params.length}`);
  }
  params.push(a.limit);
  const { rows } = await pool.query(
    `SELECT slug, title, short_summary, icon, category, sort_order, is_published
       FROM services
      WHERE ${conds.join(" AND ")}
      ORDER BY category, sort_order, slug
      LIMIT $${params.length}`,
    params,
  );
  return rows;
}

async function getService(a: z.infer<typeof GetServiceArgs>) {
  const { rows } = await pool.query(
    `SELECT slug, title, short_summary, description, intro, faq,
            icon, category, sort_order, is_published, created_at, updated_at
       FROM services WHERE slug = $1`,
    [a.slug],
  );
  if (rows.length === 0) return { error: "service not found" };
  return rows[0];
}

async function listBlogPosts(a: z.infer<typeof ListBlogArgs>) {
  const conds: string[] = ["1=1"];
  const params: unknown[] = [];
  if (a.is_published !== undefined) {
    params.push(a.is_published);
    conds.push(`is_published = $${params.length}`);
  }
  if (a.tag) {
    params.push(a.tag);
    conds.push(`$${params.length} = ANY(tags)`);
  }
  params.push(a.limit);
  const { rows } = await pool.query(
    `SELECT slug, title, excerpt, tags, is_published, published_at, updated_at
       FROM blog_posts
      WHERE ${conds.join(" AND ")}
      ORDER BY published_at DESC NULLS LAST, created_at DESC
      LIMIT $${params.length}`,
    params,
  );
  return rows;
}

async function getBlogPost(a: z.infer<typeof GetBlogArgs>) {
  const { rows } = await pool.query(
    `SELECT slug, title, excerpt, body_md, cover_image_url, tags,
            is_published, published_at, created_at, updated_at
       FROM blog_posts WHERE slug = $1`,
    [a.slug],
  );
  if (rows.length === 0) return { error: "blog post not found" };
  return rows[0];
}

async function listCaseStudies(a: z.infer<typeof ListCaseStudiesArgs>) {
  const conds: string[] = ["1=1"];
  const params: unknown[] = [];
  if (a.is_published !== undefined) {
    params.push(a.is_published);
    conds.push(`is_published = $${params.length}`);
  }
  const { rows } = await pool.query(
    `SELECT slug, client_name, industry, location, relationship_years,
            services_used, is_published, sort_order
       FROM case_studies
      WHERE ${conds.join(" AND ")}
      ORDER BY sort_order, client_name`,
    params,
  );
  return rows;
}

async function getCaseStudy(a: z.infer<typeof GetBlogArgs>) {
  const { rows } = await pool.query(
    `SELECT slug, client_name, industry, location, relationship_years,
            summary, challenge, solution, results, quote_text, quote_author,
            hero_image_url, services_used, is_published, published_at
       FROM case_studies WHERE slug = $1`,
    [a.slug],
  );
  if (rows.length === 0) return { error: "case study not found" };
  return rows[0];
}

async function listPages(a: z.infer<typeof ListPagesArgs>) {
  const conds: string[] = ["1=1"];
  const params: unknown[] = [];
  if (a.is_published !== undefined) {
    params.push(a.is_published);
    conds.push(`is_published = $${params.length}`);
  }
  const { rows } = await pool.query(
    `SELECT slug, title, seo_title, seo_description, is_published, updated_at
       FROM pages
      WHERE ${conds.join(" AND ")}
      ORDER BY slug`,
    params,
  );
  return rows;
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
