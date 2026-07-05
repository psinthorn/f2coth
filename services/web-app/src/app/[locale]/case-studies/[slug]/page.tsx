import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { ArrowLeft, ArrowRight, CheckCircle2, Quote } from "lucide-react";
import { Link } from "@/i18n/routing";
import { cms } from "@/lib/api";
import { pageAlternates, pageOpenGraph, pageBreadcrumb, localizedUrl } from "@/lib/seo";
import { JsonLd, breadcrumbList, article } from "@/lib/schema";

type Props = { params: Promise<{ locale: string; slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  const c = await cms.getCaseStudy(slug, locale);
  if (!c) return { title: "Case study" };
  const title = `${c.client_name} — case study`;
  return {
    title,
    description: c.summary,
    alternates: pageAlternates(locale, `/case-studies/${slug}`),
    // OG image comes from the sibling opengraph-image.tsx (dynamic,
    // brand-styled 1200×630). We deliberately don't pass hero_image_url
    // here so social cards stay visually consistent site-wide.
    ...pageOpenGraph({
      locale,
      path: `/case-studies/${slug}`,
      title,
      description: c.summary,
    }),
  };
}

export default async function CaseStudyPage({ params }: Props) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("caseStudies.detail");
  const tc = await getTranslations("common");
  const tCaseStudies = await getTranslations("caseStudies");

  const c = await cms.getCaseStudy(slug, locale);
  if (!c) notFound();

  const breadcrumbs = pageBreadcrumb(
    locale,
    [
      { name: tCaseStudies("title"), path: "/case-studies" },
      { name: c.client_name, path: `/case-studies/${slug}` },
    ],
    tc("home"),
  );

  // Article schema — centralized builder so shape stays consistent with
  // blog posts and any future long-form content. The client's testimonial
  // (quote_author) does not make the client the *author* of the article —
  // F2 authored it as a publisher piece, so we intentionally omit
  // authorName here and let the builder default author to the Organization.
  const articleSchema = article({
    url: localizedUrl(locale, `/case-studies/${slug}`),
    headline: `${c.client_name} — case study`,
    description: c.summary,
    image: c.hero_image_url ?? undefined,
    datePublished: c.published_at ?? c.created_at,
    dateModified: c.updated_at,
    about: c.industry,
    inLanguage: locale as "en" | "th",
  });

  return (
    <>
      <JsonLd data={breadcrumbList(breadcrumbs)} />
      <JsonLd data={articleSchema} />
      <section className="bg-gradient-to-br from-navy-900 to-accent-800 text-white">
        <div className="container-page py-16">
          <Link href="/case-studies" className="inline-flex items-center gap-1 text-sm text-navy-200 hover:text-white">
            <ArrowLeft className="h-3.5 w-3.5" /> {t("back")}
          </Link>
          <p className="mt-4 text-sm font-semibold uppercase tracking-wider text-accent-200">{c.industry}</p>
          <h1 className="mt-2 font-display text-4xl sm:text-6xl">{c.client_name}</h1>
          {c.location && <p className="mt-2 text-navy-200">{c.location}</p>}
          {c.relationship_years && (
            <p className="mt-6 inline-flex rounded-full bg-white/10 px-4 py-2 text-sm">
              <CheckCircle2 className="mr-2 h-4 w-4 text-accent-300" />
              {tc("yearsPartnership", { years: c.relationship_years })}
            </p>
          )}
        </div>
      </section>

      <article className="container-page py-16 grid gap-12 lg:grid-cols-3">
        <div className="lg:col-span-2 prose-f2">
          <p className="text-lg leading-relaxed">{c.summary}</p>

          <h2>{t("challenge")}</h2>
          <p>{c.challenge}</p>

          <h2>{t("solution")}</h2>
          <p>{c.solution}</p>

          <h2>{t("results")}</h2>
          <p>{c.results}</p>

          {c.quote_text && (
            <blockquote className="not-prose mt-8 rounded-2xl border-l-4 border-accent-500 bg-navy-50 p-6">
              <Quote className="h-6 w-6 text-accent-600" />
              <p className="mt-2 font-display text-xl text-navy-900">&ldquo;{c.quote_text}&rdquo;</p>
              {c.quote_author && <p className="mt-3 text-sm text-navy-500">— {c.quote_author}</p>}
            </blockquote>
          )}
        </div>

        <aside className="space-y-6">
          <div className="card">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-navy-500">{t("servicesUsed")}</h3>
            <ul className="mt-3 space-y-2 text-sm">
              {c.services_used.map((slug) => (
                <li key={slug}>
                  <Link href={`/services/${slug}`} className="text-navy-700 hover:text-accent-700">
                    {slug.replace(/-/g, " ")}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div className="card bg-navy-900 text-white border-navy-900">
            <h3 className="font-display text-lg">{t("ctaTitle")}</h3>
            <p className="mt-2 text-sm text-navy-200">{t("ctaBody")}</p>
            <Link href="/contact" className="mt-4 inline-flex btn-accent">
              {tc("talkToF2")} <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </aside>
      </article>
    </>
  );
}
