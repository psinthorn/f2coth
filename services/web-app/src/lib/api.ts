// Typed wrappers for the Go microservices, used by Server Components.
//
// In the browser, NEXT_PUBLIC_API_BASE points at Traefik (e.g. http://localhost/api).
// On the server (inside docker), we go straight to the service hostnames.

const SERVER_BASES = {
  cms: process.env.CMS_API_URL ?? "http://cms-api:8001",
  leads: process.env.LEAD_API_URL ?? "http://lead-api:8002",
  chat: process.env.AI_CHAT_API_URL ?? "http://ai-chat-api:8003",
  auth: process.env.AUTH_API_URL ?? "http://auth-api:8004",
  notif: process.env.NOTIFICATION_API_URL ?? "http://notification-api:8005",
} as const;

const PUBLIC_BASE =
  process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost/api";

export const apiBase = {
  serverCMS: `${SERVER_BASES.cms}/api/cms`,
  serverLeads: `${SERVER_BASES.leads}/api/leads`,
  serverChat: `${SERVER_BASES.chat}/api/chat`,
  serverAuth: `${SERVER_BASES.auth}/api/auth`,

  publicCMS: `${PUBLIC_BASE}/cms`,
  publicLeads: `${PUBLIC_BASE}/leads`,
  publicChat: `${PUBLIC_BASE}/chat`,
  publicAuth: `${PUBLIC_BASE}/auth`,
};

export type ServiceCategory = "core" | "support" | "opportunistic" | "marketing";

export interface FAQItem {
  q: string;
  a: string;
}

export interface ServiceItem {
  id: string;
  slug: string;
  title: string;
  short_summary: string;
  description: string;
  intro: string;
  faq: FAQItem[];
  icon: string | null;
  category: ServiceCategory;
  sort_order: number;
  // Freshness — used by the sitemap so search crawlers only re-fetch when
  // content actually changes. Optional so hand-rolled fallbackServices can
  // omit them without a compile error.
  created_at?: string;
  updated_at?: string;
}

export interface CaseStudyItem {
  id: string;
  slug: string;
  client_name: string;
  industry: string;
  location: string | null;
  relationship_years: number | null;
  hero_image_url: string | null;
  summary: string;
  challenge: string;
  solution: string;
  results: string;
  quote_text: string | null;
  quote_author: string | null;
  services_used: string[];
  published_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface BlogPostItem {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  body_md: string;
  cover_image_url: string | null;
  author_name: string;
  tags: string[];
  published_at: string | null;
  updated_at?: string;
}

export interface DomainPricingItem {
  id: string;
  tld: string;
  registry: "thnic" | "resellerclub";
  register_price_thb: number;
  renew_price_thb: number;
  transfer_price_thb: number;
  privacy_included: boolean;
  is_thai_only: boolean;
  grace_period_days: number;
  redemption_period_days: number;
  grace_fee_thb: number;
  redemption_fee_thb: number;
  notes: string;
  sort_order: number;
}

export interface PublicClientItem {
  slug: string;
  display_name: string;
  industry_label: string;
  logo_url: string | null;
  services_used: string[];
  sort_order: number;
}

export interface HostingPlanItem {
  id: string;
  slug: string;
  name: string;
  tagline: string;
  price_thb_monthly: number;
  price_thb_annually: number;
  storage_gb: number;
  sites_included: number;
  emails_included: number;
  bandwidth_label: string;
  ssl_included: boolean;
  daily_backups: boolean;
  perks: string[];
  is_featured: boolean;
  sort_order: number;
}

async function getJSON<T>(url: string, locale?: string): Promise<T> {
  // Next's fetch cache keys on URL only — headers are ignored. Two locales
  // hitting the same URL would collide on the cache and one would poison the
  // other with the wrong-language content. Append the locale as a query param
  // so cache entries stay per-locale. The backend ignores unknown params.
  const cacheKeyedURL = locale
    ? `${url}${url.includes("?") ? "&" : "?"}_loc=${encodeURIComponent(locale)}`
    : url;
  const res = await fetch(cacheKeyedURL, {
    next: { revalidate: 60 },
    headers: locale ? { "Accept-Language": locale } : undefined,
  });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return (await res.json()) as T;
}

// ----- CMS reads (server-side) -----
// Each method accepts an optional `locale` ("en" | "th"). When set, we forward
// it as Accept-Language to cms-api so the backend resolves COALESCE-style
// content from JSONB i18n columns (Phase 3B).

export const cms = {
  async listServices(locale?: string) {
    try {
      const data = await getJSON<{ services: ServiceItem[] }>(
        `${apiBase.serverCMS}/services`,
        locale,
      );
      return data.services ?? [];
    } catch {
      return fallbackServices;
    }
  },

  async listCaseStudies(locale?: string) {
    try {
      const data = await getJSON<{ case_studies: CaseStudyItem[] }>(
        `${apiBase.serverCMS}/case-studies`,
        locale,
      );
      return data.case_studies ?? [];
    } catch {
      return fallbackCaseStudies;
    }
  },

  async listPublicClients(locale?: string): Promise<PublicClientItem[]> {
    // No fallback: if the endpoint is 404 (module off) or throws, an empty
    // list is the safe answer — the page renders the empty state and no
    // client name leaks without a live consent record backing it.
    try {
      const data = await getJSON<{ clients: PublicClientItem[] }>(
        `${apiBase.serverCMS}/clients`,
        locale,
      );
      return data.clients ?? [];
    } catch {
      return [];
    }
  },

  async getCaseStudy(slug: string, locale?: string) {
    try {
      return await getJSON<CaseStudyItem>(
        `${apiBase.serverCMS}/case-studies/${slug}`,
        locale,
      );
    } catch {
      return fallbackCaseStudies.find((c) => c.slug === slug) ?? null;
    }
  },

  async listBlogPosts(locale?: string) {
    try {
      const data = await getJSON<{ posts: BlogPostItem[] }>(
        `${apiBase.serverCMS}/blog`,
        locale,
      );
      return data.posts ?? [];
    } catch {
      return [];
    }
  },

  async getBlogPost(slug: string, locale?: string) {
    try {
      return await getJSON<BlogPostItem>(
        `${apiBase.serverCMS}/blog/${slug}`,
        locale,
      );
    } catch {
      return null;
    }
  },

  async listDomainPricing(locale?: string) {
    try {
      const data = await getJSON<{ domain_pricing: DomainPricingItem[] }>(
        `${apiBase.serverCMS}/domain-pricing`,
        locale,
      );
      return data.domain_pricing ?? [];
    } catch {
      return [];
    }
  },

  async listHostingPlans(locale?: string) {
    try {
      const data = await getJSON<{ hosting_plans: HostingPlanItem[] }>(
        `${apiBase.serverCMS}/hosting-plans`,
        locale,
      );
      return data.hosting_plans ?? [];
    } catch {
      return [];
    }
  },

  // Landing page copy (hero, CTAs, section titles) resolved on the server for
  // the requested locale. Returns {} on failure so the page can fall back to
  // its i18n JSON defaults.
  async getHome(locale?: string): Promise<Record<string, string>> {
    try {
      return await getJSON<Record<string, string>>(
        `${apiBase.serverCMS}/home`,
        locale,
      );
    } catch {
      return {};
    }
  },

  // Static CMS page (about, privacy, terms, dpa, custom slugs). Returns
  // locale-resolved fields — or null if the page is missing / unpublished,
  // so the caller can fall back to its i18n JSON layout.
  async getPage(slug: string, locale?: string) {
    try {
      return await getJSON<{
        id: string;
        slug: string;
        title: string;
        body_md: string;
        seo_title: string | null;
        seo_description: string | null;
        is_published: boolean;
        created_at: string;
        updated_at: string;
      }>(`${apiBase.serverCMS}/pages/${slug}`, locale);
    } catch {
      return null;
    }
  },
};

// ----- Static fallbacks so the site renders even if the API is down -----
// Mirror what 007_seed_data.sql inserts.

export const fallbackServices: ServiceItem[] = [
  { id: "1", slug: "it-management", title: "IT Management Partner",
    short_summary: "End-to-end IT operations for hotels, villas, and resorts — single point of contact, hospitality-grade SLAs.",
    description: "F2 acts as your in-house IT department. We design, deploy, monitor, and support every layer of your property's technology — from the cabling in the walls to the apps on your guests' phones. Same-day on-site response on Samui; remote-first elsewhere in Thailand.",
    intro: "", faq: [], icon: "Server", category: "core", sort_order: 10 },
  { id: "2", slug: "digital-transformation", title: "Digital Transformation",
    short_summary: "Roadmaps and execution to modernise property operations, guest experience, and back-office workflows.",
    description: "We assess your current stack, identify the highest-ROI changes, and then actually build them. Typical engagements: PMS modernisation, contactless check-in, paperless F&B ops, AI-assisted reservations.",
    intro: "", faq: [], icon: "Sparkles", category: "core", sort_order: 20 },
  { id: "3", slug: "ai-driven-solutions", title: "AI-Driven Solutions",
    short_summary: "Practical AI for hospitality — chat concierge, intelligent enquiry handling, ops copilots.",
    description: "F2 builds and operates AI workflows that fit your brand voice. Powered by Anthropic Claude and OpenAI, integrated with your PMS, booking engine, and CRM. Outcomes-first, not hype-first.",
    intro: "", faq: [], icon: "Bot", category: "core", sort_order: 30 },
  { id: "4", slug: "domain-hosting", title: "Domain & Hosting",
    short_summary: "Reliable domain registration and managed hosting via our ResellerClub partnership.",
    description: "Single-vendor management of your .com, .co.th, and country-specific domains, plus high-uptime managed hosting tuned for hospitality websites and booking engines. DNS, SSL, email — handled.",
    intro: "", faq: [], icon: "Globe", category: "core", sort_order: 40 },
  { id: "5", slug: "iacc-saas", title: "iACC — Tour Operator SaaS",
    short_summary: "Multi-tenant accounting and operations platform for tour operators and travel agencies.",
    description: "iACC is F2's own SaaS product: bookings, payments, agents, allotments, fleets — all in one place, mobile-friendly. Visit iacc.f2.co.th.",
    intro: "", faq: [], icon: "LayoutDashboard", category: "core", sort_order: 50 },
  { id: "6", slug: "it-support-msp", title: "IT Management & MSP Services",
    short_summary: "24/7 monitoring, helpdesk, and managed services for distributed hospitality operations.",
    description: "We sit on top of your stack and keep it running. Helpdesk, monitoring, patching, backups, vendor management. Tiered SLAs from business-hours to 24/7 white-glove.",
    intro: "", faq: [], icon: "Headset", category: "support", sort_order: 60 },
  { id: "7", slug: "cybersecurity", title: "Cybersecurity",
    short_summary: "Firewall, intrusion detection, guest network isolation, CCTV, and PCI-aware POS hardening.",
    description: "Hospitality is a high-value target. We deploy and operate the security controls your insurers and brand standards expect — without making the guest WiFi feel like an enterprise VPN.",
    intro: "", faq: [], icon: "ShieldCheck", category: "support", sort_order: 70 },
  { id: "8", slug: "hardware-solar", title: "Hardware & Solar (Samui)",
    short_summary: "IT hardware via SiS Distribution, plus solar cell installation for our Samui clients.",
    description: "Through our SiS Distribution partnership we source enterprise networking, servers, and POS hardware at distributor pricing. On Koh Samui we also offer turnkey solar installations.",
    intro: "", faq: [], icon: "Sun", category: "opportunistic", sort_order: 80 },
];

export const fallbackCaseStudies: CaseStudyItem[] = [
  { id: "cs1", slug: "sala-hospitality", client_name: "SALA Hospitality Group",
    industry: "Luxury Hotels & Resorts", location: "Thailand (8 properties)",
    relationship_years: 10, hero_image_url: null,
    summary: "A decade of trusted domain and Domain Privacy management across SALA's 8 luxury properties. Low-touch, high-trust, never-missed.",
    challenge: "SALA's 8 luxury properties — Samui, Phuket, Bangkok, Ayutthaya, Khao Yai — operate as recognisable global brands (Condé Nast, DestinAsian). Eight properties means many domains: primary brand sites, sub-brands, country-specific TLDs, and protected name variants. Award-winning brands need unimpeachable domain hygiene: no expired registrations, no DNS surprises, no exposed registrant data inviting spam or social-engineering.",
    solution: "F2 manages SALA's complete domain portfolio under our ResellerClub partnership: registration and renewals, DNS hosting and configuration, and Domain Privacy / WhoisGuard on every name to mask registrant details. Consolidated invoicing in Thai Baht. Single point of contact for any domain action — whether it's a quick A-record change or moving a name between registrars.",
    results: "Zero domain-related incidents in 10+ years. Every SALA-owned domain shielded by Domain Privacy. No renewal ever missed. Consolidated billing simplifies SALA's vendor management — one PO covers the entire estate's domain operations.",
    quote_text: null, quote_author: null,
    services_used: ["domain-hosting"] },
  { id: "cs2", slug: "putahracsa-hua-hin", client_name: "Putahracsa Hua Hin",
    industry: "Boutique Luxury Resort", location: "Hua Hin, Thailand",
    relationship_years: 10, hero_image_url: null,
    summary: "Five Star Alliance boutique resort, 67 rooms, multiple F&B outlets, managed remotely from F2's Koh Samui base.",
    challenge: "Design-focused boutique hotel where technology must be invisible to guests but reliable for operations. Multiple F&B outlets need integrated POS. Geographically distant from Thailand's main IT-services market, requiring a partner that operates effectively without a local on-site office.",
    solution: "Full IT operations managed remotely from F2's Koh Samui base: POS integration across 3 F&B outlets and the spa, property-wide WiFi, Microsoft 365, domain & hosting, and on-site visits as needed. Hardware sourced through SiS.",
    results: "Seamless operations across all outlets. 10+ years, zero vendor changes. Five Star Alliance standards maintained. Proves F2's remote-management model works beyond Koh Samui — opening the Hua Hin / Pranburi / Gulf Coast corridor.",
    quote_text: null, quote_author: null,
    services_used: ["it-management","domain-hosting","cybersecurity","hardware-solar"] },
  { id: "cs3", slug: "miskawaan-villas", client_name: "Miskawaan Beachfront Villas",
    industry: "Ultra-Luxury Private Villas", location: "Maenam Beach, Koh Samui",
    relationship_years: null, hero_image_url: null,
    summary: "F2's newest client. Microsoft 365 administration under a one-year SLA — March 2026 to March 2027 — for the team behind TripAdvisor's #1 specialty lodging on Koh Samui.",
    challenge: "Miskawaan's growing team needed proper Microsoft 365 administration — user provisioning, mailboxes, security policies, and licence optimisation — handled by an experienced partner rather than as a side-task for in-house staff. As TripAdvisor's #1 specialty lodging on Koh Samui, an email outage or compromised account would land directly on guest reviews.",
    solution: "F2 took over Microsoft 365 administration under a one-year SLA running March 2026 – March 2027. Scope: tenant administration, full user lifecycle (joiners / movers / leavers), mailbox and shared-resource configuration, conditional access and MFA enforcement, licence optimisation across M365 plans, helpdesk for staff M365 questions, and quarterly compliance reviews. On-call response within SLA.",
    results: "SLA active from March 2026 to March 2027. Performance against SLA reported quarterly; renewal review scheduled for January 2027.",
    quote_text: null, quote_author: null,
    services_used: ["it-support-msp","it-management"] },
];
