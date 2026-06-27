import type { Metadata } from "next";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { ArrowRight } from "lucide-react";
import { Link } from "@/i18n/routing";
import { cms } from "@/lib/api";
import { pageAlternates, pageOpenGraph, pageBreadcrumb } from "@/lib/seo";
import { JsonLd, breadcrumbList } from "@/lib/schema";

export async function generateMetadata({
  params,
}: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "metadata.caseStudies" });
  const title = t("title");
  const description = t("description");
  return {
    title,
    description,
    alternates: pageAlternates(locale, "/case-studies"),
    ...pageOpenGraph({ locale, path: "/case-studies", title, description }),
  };
}

export default async function CaseStudiesPage({
  params,
}: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("caseStudies");
  const tc = await getTranslations("common");

  const studies = await cms.listCaseStudies(locale);
  const breadcrumbs = pageBreadcrumb(
    locale,
    [{ name: t("title"), path: "/case-studies" }],
    tc("home"),
  );
  return (
    <>
      <JsonLd data={breadcrumbList(breadcrumbs)} />
      <section className="bg-navy-50">
        <div className="container-page py-16">
          <p className="text-sm font-semibold uppercase tracking-wider text-accent-700">{t("kicker")}</p>
          <h1 className="mt-2 font-display text-4xl text-navy-900 sm:text-5xl">{t("title")}</h1>
          <p className="mt-4 max-w-2xl text-navy-600">{t("subtitle")}</p>
        </div>
      </section>

      <section className="container-page py-16">
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {studies.map((c) => (
            <Link key={c.slug} href={`/case-studies/${c.slug}`} className="card group flex flex-col">
              <p className="text-xs font-semibold uppercase tracking-wider text-accent-700">{c.industry}</p>
              <h2 className="mt-2 font-display text-2xl text-navy-900 group-hover:text-accent-800">
                {c.client_name}
              </h2>
              {c.location && <p className="mt-1 text-sm text-navy-500">{c.location}</p>}
              <p className="mt-4 text-sm text-navy-700 flex-1">{c.summary}</p>
              {c.relationship_years && (
                <p className="mt-4 inline-flex items-center text-sm font-semibold text-accent-700">
                  {tc("yearsPartnership", { years: c.relationship_years })}
                </p>
              )}
              <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-navy-700">
                {t("readCaseStudy")} <ArrowRight className="h-3.5 w-3.5" />
              </span>
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}
