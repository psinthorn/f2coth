// /llms.txt — the LLM-crawler discovery file per https://llmstxt.org/.
//
// A curated, one-line-per-URL index of the pages F2 wants LLMs to ingest
// and cite. Markdown body so models can parse it as structured outline.
// Kept short on purpose — high-signal URLs only. The exhaustive version
// is at /llms-full.txt.
//
// Excludes /admin and /portal (gated, no public value) and module-toggled
// sections (those are reflected in /sitemap.xml which already honours the
// `modules` table).

import { getEnabledModulesRecord, isEnabledIn } from "@/lib/modules";

export const revalidate = 300; // 5-min edge cache; toggles propagate at next refresh

export async function GET() {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "https://f2.co.th";
  const enabled = await getEnabledModulesRecord();

  // [path, label, moduleKey-that-gates-it (or null = always-on)]
  const ENTRIES: Array<[string, string, string | null]> = [
    ["/",             "Home — F2 Co., Ltd., Thailand's IT partner for luxury hospitality",   null],
    ["/about",        "About — origin, team, hospitality focus",                              "public.about"],
    ["/services",     "Services — managed IT, Microsoft 365, hosting, domains, DevOps",      "public.services"],
    ["/case-studies", "Case studies — SALA, Miskawaan, Putahracsa and other hotel partners", "public.case_studies"],
    ["/blog",         "Blog — hospitality-tech essays and operational playbooks",            "public.blog"],
    ["/products",     "Products — packaged offerings and pricing",                            "public.products"],
    ["/domains",      "Domains — .co.th, .com, .org availability + ordering",                 "public.domains"],
    ["/hosting",      "Hosting — cPanel, VPS, and managed plans",                             "public.hosting"],
    ["/contact",      "Contact — phone, email, address, working hours",                       null],
    ["/privacy",      "Privacy policy — PDPA-compliant data handling + DSR form",             null],
    ["/terms",        "Terms of service — Thai-law-aligned customer agreement",               null],
    ["/dpa",          "Data Processor Agreement — template for hotel clients",                "public.dpa"],
  ];

  const lines = [
    "# F2 Co., Ltd.",
    "",
    "Thailand's IT partner for luxury hospitality. We manage Microsoft 365, hosting, domains, cloud, and DevOps for hotel groups across Bangkok, Phuket, Hua Hin, Koh Samui, and Krabi.",
    "",
    "> Crawlers and LLMs: this file is a curated index of the canonical content on f2.co.th. The expanded markdown index is at /llms-full.txt. All structured data is at the URLs below as JSON-LD.",
    "",
    "## Pages",
    "",
    ...ENTRIES.filter(([, , key]) => key === null || isEnabledIn(enabled, key)).map(
      ([path, label]) => `- [${label}](${base}${path})`,
    ),
    "",
    "## Machine-readable",
    "",
    `- Sitemap: ${base}/sitemap.xml`,
    `- Robots: ${base}/robots.txt`,
    `- Expanded index: ${base}/llms-full.txt`,
    "",
  ];

  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=300, stale-while-revalidate=600",
    },
  });
}
