// Single source of truth for every JSON-LD block on f2.co.th.
//
// Why centralised: per docs/seo-specs.md §12 and ai/prompts/agent-seo.md
// hard rule #3, schema must come from one place so the Organization /
// LocalBusiness entity stays byte-identical across pages (LLMs and
// Knowledge Graph deduplicate by exact match). Never paste raw JSON-LD
// into a page component — extend a builder here instead.
//
// Usage:
//   import { JsonLd, organization, webSite } from "@/lib/schema";
//   <JsonLd data={organization()} />

import React from "react";

// ─────────────────────────────────────────────
// Central constants — change once, propagate everywhere.
// NAP (Name / Address / Phone) consistency is a Local-SEO hard rule.
// ─────────────────────────────────────────────

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://f2.co.th";

export const F2_ORG = {
  legalName: "F2 Co., Ltd.",
  brandName: "F2",
  url: SITE_URL,
  logo: `${SITE_URL}/logo.png`,
  email: "info@f2.co.th",
  // Registered office. Bophut tambon, Ko Samui amphoe, Surat Thani province.
  street: "9/38 Moo 6, Bophut",
  locality: "Koh Samui",
  region: "Surat Thani",
  postalCode: "84320",
  country: "TH",
  // Contact channels. Phone in E.164 with country code so click-to-call
  // works internationally and so LLMs / Knowledge Graph can normalise it.
  phone: "+66-64-027-0528",
  privacyEmail: "privacy@f2.co.th",
  supportEmail: "support@f2.co.th",
  // Social / partner sameAs links help LLMs disambiguate the entity.
  sameAs: [
    "https://www.linkedin.com/company/f2-co-ltd",
    // Add Facebook / YouTube / Microsoft Partner / THNIC partner pages as those exist.
  ],
  // Service areas (drives Local SEO query coverage). Home market first.
  areaServed: ["Koh Samui", "Surat Thani", "Phuket", "Krabi", "Hua Hin", "Bangkok"],
  // Founding year, used in copyright and Organization.foundingDate.
  foundingYear: 2003,
} as const;

// ─────────────────────────────────────────────
// <JsonLd> server component — emits one <script type="application/ld+json">.
// Always pass a plain object; never pre-stringify.
// ─────────────────────────────────────────────

export function JsonLd({ data }: { data: object }) {
  // Use suppressHydrationWarning because the JSON payload is identical on
  // server and client but React's whitespace normaliser sometimes warns.
  return (
    <script
      type="application/ld+json"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}

// ─────────────────────────────────────────────
// Schema builders. Each returns a plain object ready for <JsonLd>.
// All builders set @context once (schema.org) so callers stay terse.
// ─────────────────────────────────────────────

const ctx = "https://schema.org";

/** Organization — site-wide identity. Emit once from the root layout. */
export function organization() {
  return {
    "@context": ctx,
    "@type": "Organization",
    "@id": `${SITE_URL}/#organization`,
    name: F2_ORG.legalName,
    alternateName: F2_ORG.brandName,
    url: F2_ORG.url,
    logo: F2_ORG.logo,
    email: F2_ORG.email,
    foundingDate: String(F2_ORG.foundingYear),
    sameAs: F2_ORG.sameAs,
    contactPoint: [contactPoint("customer support", F2_ORG.supportEmail, F2_ORG.phone)],
  };
}

/** LocalBusiness — extends Organization with physical address + geo. */
export function localBusiness() {
  return {
    "@context": ctx,
    "@type": "LocalBusiness",
    "@id": `${SITE_URL}/#localbusiness`,
    name: F2_ORG.legalName,
    image: F2_ORG.logo,
    url: F2_ORG.url,
    telephone: F2_ORG.phone,
    email: F2_ORG.email,
    address: {
      "@type": "PostalAddress",
      streetAddress: F2_ORG.street,
      addressLocality: F2_ORG.locality,
      addressRegion: F2_ORG.region,
      postalCode: F2_ORG.postalCode,
      addressCountry: F2_ORG.country,
    },
    areaServed: F2_ORG.areaServed.map((name) => ({ "@type": "Place", name })),
    // openingHoursSpecification TBD when ops confirms.
  };
}

/** WebSite — enables the SERP site-links search box. */
export function webSite() {
  return {
    "@context": ctx,
    "@type": "WebSite",
    "@id": `${SITE_URL}/#website`,
    url: SITE_URL,
    name: F2_ORG.legalName,
    publisher: { "@id": `${SITE_URL}/#organization` },
    inLanguage: ["en", "th"],
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${SITE_URL}/search?q={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
  };
}

/** BreadcrumbList — one per non-home page. items in order, leaf last. */
export function breadcrumbList(items: Array<{ name: string; url: string }>) {
  return {
    "@context": ctx,
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

/** Service — for each /services/{slug} page. */
export function service(args: {
  name: string;
  description: string;
  url: string;
  serviceType?: string;
  areaServed?: string[];
}) {
  return {
    "@context": ctx,
    "@type": "Service",
    name: args.name,
    description: args.description,
    url: args.url,
    serviceType: args.serviceType ?? args.name,
    provider: { "@id": `${SITE_URL}/#organization` },
    areaServed: (args.areaServed ?? F2_ORG.areaServed).map((name) => ({
      "@type": "Place",
      name,
    })),
  };
}

/**
 * Article — long-form content that isn't a blog post: case studies,
 * technical write-ups, hospitality-industry pieces. `about` accepts
 * schema.org Thing-name strings (e.g. an industry vertical) and is what
 * generative engines use to categorise the piece.
 */
export function article(args: {
  url: string;
  headline: string;
  description: string;
  image?: string;
  datePublished?: string;
  dateModified?: string;
  authorName?: string;   // omit for publisher-authored pieces
  about?: string;
  inLanguage: "en" | "th";
}) {
  const author =
    args.authorName
      ? { "@type": "Person", name: args.authorName }
      : { "@id": `${SITE_URL}/#organization` };
  return {
    "@context": ctx,
    "@type": "Article",
    mainEntityOfPage: { "@type": "WebPage", "@id": args.url },
    headline: args.headline,
    description: args.description,
    image: args.image,
    datePublished: args.datePublished,
    dateModified: args.dateModified ?? args.datePublished,
    author,
    publisher: { "@id": `${SITE_URL}/#organization` },
    about: args.about,
    inLanguage: args.inLanguage,
  };
}

/** BlogPosting — for each /blog/{slug}. */
export function blogPosting(args: {
  url: string;
  headline: string;
  description: string;
  datePublished: string;
  dateModified?: string;
  image?: string;
  authorName: string;
  authorUrl?: string;
  inLanguage: "en" | "th";
}) {
  return {
    "@context": ctx,
    "@type": "BlogPosting",
    mainEntityOfPage: { "@type": "WebPage", "@id": args.url },
    headline: args.headline,
    description: args.description,
    image: args.image,
    datePublished: args.datePublished,
    dateModified: args.dateModified ?? args.datePublished,
    author: {
      "@type": "Person",
      name: args.authorName,
      url: args.authorUrl,
    },
    publisher: { "@id": `${SITE_URL}/#organization` },
    inLanguage: args.inLanguage,
  };
}

/** Person — author bylines, team pages. */
export function person(args: {
  name: string;
  url?: string;
  jobTitle?: string;
  sameAs?: string[];
  image?: string;
}) {
  return {
    "@context": ctx,
    "@type": "Person",
    name: args.name,
    url: args.url,
    jobTitle: args.jobTitle,
    sameAs: args.sameAs,
    image: args.image,
    worksFor: { "@id": `${SITE_URL}/#organization` },
  };
}

/** FAQPage — wraps a list of Q→A pairs. */
export function faqPage(items: Array<{ question: string; answer: string }>) {
  return {
    "@context": ctx,
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };
}

/** HowTo — procedure pages, setup guides, migration walkthroughs. */
export function howTo(args: {
  name: string;
  description: string;
  totalTime?: string;             // ISO-8601 duration e.g. "PT30M"
  estimatedCost?: { currency: string; value: string };
  steps: Array<{ name: string; text: string; url?: string; image?: string }>;
}) {
  return {
    "@context": ctx,
    "@type": "HowTo",
    name: args.name,
    description: args.description,
    totalTime: args.totalTime,
    estimatedCost: args.estimatedCost
      ? {
          "@type": "MonetaryAmount",
          currency: args.estimatedCost.currency,
          value: args.estimatedCost.value,
        }
      : undefined,
    step: args.steps.map((s, i) => ({
      "@type": "HowToStep",
      position: i + 1,
      name: s.name,
      text: s.text,
      url: s.url,
      image: s.image,
    })),
  };
}

/** ImageObject — hero / OG images, image-search candidates. */
export function imageObject(args: {
  url: string;
  width?: number;
  height?: number;
  caption?: string;
  creditText?: string;
}) {
  return {
    "@context": ctx,
    "@type": "ImageObject",
    contentUrl: args.url,
    url: args.url,
    width: args.width,
    height: args.height,
    caption: args.caption,
    creditText: args.creditText,
  };
}

/** VideoObject — embedded videos. Required fields per Google guidelines. */
export function videoObject(args: {
  name: string;
  description: string;
  thumbnailUrl: string;
  uploadDate: string;             // ISO-8601 date
  contentUrl?: string;            // self-hosted .mp4
  embedUrl?: string;              // YouTube / Vimeo embed
  duration?: string;              // ISO-8601 duration e.g. "PT2M30S"
  transcript?: string;
}) {
  return {
    "@context": ctx,
    "@type": "VideoObject",
    name: args.name,
    description: args.description,
    thumbnailUrl: args.thumbnailUrl,
    uploadDate: args.uploadDate,
    contentUrl: args.contentUrl,
    embedUrl: args.embedUrl,
    duration: args.duration,
    transcript: args.transcript,
  };
}

/** ContactPoint — used inside Organization; helper for clarity. */
export function contactPoint(
  contactType: string,
  email?: string,
  phone?: string,
  availableLanguage: string[] = ["en", "th"],
) {
  return {
    "@type": "ContactPoint",
    contactType,
    email,
    telephone: phone,
    availableLanguage,
  };
}

/** Product + Offer — domain plans, hosting plans. */
export function productOffer(args: {
  name: string;
  description: string;
  sku?: string;
  url: string;
  image?: string;
  price: string;                  // string per schema.org spec
  priceCurrency: string;          // e.g. "THB"
  availability?: "InStock" | "OutOfStock" | "PreOrder";
}) {
  return {
    "@context": ctx,
    "@type": "Product",
    name: args.name,
    description: args.description,
    sku: args.sku,
    image: args.image,
    url: args.url,
    brand: { "@id": `${SITE_URL}/#organization` },
    offers: {
      "@type": "Offer",
      url: args.url,
      priceCurrency: args.priceCurrency,
      price: args.price,
      availability: `https://schema.org/${args.availability ?? "InStock"}`,
    },
  };
}
