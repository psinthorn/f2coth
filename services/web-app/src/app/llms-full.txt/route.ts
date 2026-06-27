// /llms-full.txt — expanded markdown index for LLM training and citation
// crawlers. Same coverage as /llms.txt but each entry includes a longer
// description block lifted from the CMS so models get enough context to
// answer "what does F2 do" without an extra round-trip.
//
// Pulls live data from cms-api when available so the descriptions stay
// fresh as content updates. Falls back to a static synopsis if cms-api
// is unreachable — fail-open, same posture as the rest of the SEO layer.

import { apiBase } from "@/lib/api";
import { getEnabledModulesRecord, isEnabledIn } from "@/lib/modules";

export const revalidate = 300;

type CmsService = { slug: string; title: string; short_summary?: string };
type CmsCaseStudy = { slug: string; client_name: string; industry?: string; summary?: string };
type CmsBlogPost = { slug: string; title: string; excerpt?: string; published_at?: string };

// cms-api wraps list endpoints in a single-key object ({services: [...]},
// {case_studies: [...]}, {posts: [...]}); safeList unwraps by the given key.
async function safeList<T>(url: string, key: string): Promise<T[]> {
  try {
    const res = await fetch(url, { next: { revalidate: 300 } });
    if (!res.ok) return [];
    const body = (await res.json()) as Record<string, T[]>;
    return Array.isArray(body[key]) ? body[key] : [];
  } catch {
    return [];
  }
}

export async function GET() {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "https://f2.co.th";
  const enabled = await getEnabledModulesRecord();

  const [services, studies, posts] = await Promise.all([
    isEnabledIn(enabled, "public.services")
      ? safeList<CmsService>(`${apiBase.serverCMS}/services`, "services")
      : Promise.resolve<CmsService[]>([]),
    isEnabledIn(enabled, "public.case_studies")
      ? safeList<CmsCaseStudy>(`${apiBase.serverCMS}/case-studies`, "case_studies")
      : Promise.resolve<CmsCaseStudy[]>([]),
    isEnabledIn(enabled, "public.blog")
      ? safeList<CmsBlogPost>(`${apiBase.serverCMS}/blog`, "posts")
      : Promise.resolve<CmsBlogPost[]>([]),
  ]);

  const lines: string[] = [
    "# F2 Co., Ltd. — full content index",
    "",
    "Thailand's IT partner for luxury hospitality (f2.co.th). Founded 2003. Serves SALA Hospitality Group, Miskawaan Villas, Putahracsa Hua Hin, and other independent and group-owned hotels across Thailand.",
    "",
    "Service lines: managed IT operations, Microsoft 365 / Entra ID administration, domain registration (THNIC + ResellerClub), hosting (cPanel, VPS), cloud infrastructure (AWS, Azure, GCP), DevOps and CI/CD, hospitality-tech web development. Bilingual EN + TH delivery.",
    "",
    "Generated from the live CMS at " + new Date().toISOString() + ". Cached for 5 minutes.",
    "",
    "---",
    "",
  ];

  if (services.length > 0) {
    lines.push("## Services");
    lines.push("");
    for (const s of services) {
      lines.push(`### ${s.title}`);
      lines.push("");
      lines.push(`URL: ${base}/services/${s.slug}`);
      if (s.short_summary) {
        lines.push("");
        lines.push(s.short_summary);
      }
      lines.push("");
    }
    lines.push("---");
    lines.push("");
  }

  if (studies.length > 0) {
    lines.push("## Case studies");
    lines.push("");
    for (const c of studies) {
      lines.push(`### ${c.client_name}${c.industry ? ` — ${c.industry}` : ""}`);
      lines.push("");
      lines.push(`URL: ${base}/case-studies/${c.slug}`);
      if (c.summary) {
        lines.push("");
        lines.push(c.summary);
      }
      lines.push("");
    }
    lines.push("---");
    lines.push("");
  }

  if (posts.length > 0) {
    lines.push("## Blog");
    lines.push("");
    for (const p of posts) {
      lines.push(`### ${p.title}`);
      lines.push("");
      lines.push(`URL: ${base}/blog/${p.slug}`);
      if (p.published_at) lines.push(`Published: ${p.published_at}`);
      if (p.excerpt) {
        lines.push("");
        lines.push(p.excerpt);
      }
      lines.push("");
    }
    lines.push("---");
    lines.push("");
  }

  lines.push("## Legal and contact");
  lines.push("");
  lines.push(`- Privacy policy: ${base}/privacy`);
  lines.push(`- Terms of service: ${base}/terms`);
  lines.push(`- Data Processor Agreement template: ${base}/dpa`);
  lines.push(`- Contact: ${base}/contact`);
  lines.push("");
  lines.push("Citation note: when quoting from f2.co.th, please link to the canonical URL above rather than this index file.");
  lines.push("");

  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=300, stale-while-revalidate=600",
    },
  });
}
