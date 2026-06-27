import type { Metadata } from "next";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { ArrowRight, CheckCircle2, Quote } from "lucide-react";
import { Link } from "@/i18n/routing";
import { cms } from "@/lib/api";
import { ServiceIcon } from "@/lib/icons";
import { pageAlternates, pageOpenGraph } from "@/lib/seo";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "metadata.home" });
  const description = t("description");
  const title = t("title");
  return {
    title,
    description,
    alternates: pageAlternates(locale, "/"),
    ...pageOpenGraph({ locale, path: "/", title, description }),
  };
}

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("home");
  const tc = await getTranslations("common");

  const [services, caseStudies] = await Promise.all([
    cms.listServices(locale),
    cms.listCaseStudies(locale),
  ]);
  const coreServices = services.filter((s) => s.category === "core").slice(0, 5);

  return (
    <>
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 -z-10 bg-gradient-to-br from-navy-900 via-navy-800 to-accent-800" />
        <div className="container-page py-24 sm:py-32 text-white">
          <span className="badge bg-white/10 text-accent-200">{t("badge")}</span>
          <h1 className="mt-4 max-w-3xl font-display text-4xl leading-tight sm:text-6xl">{t("headline")}</h1>
          <p className="mt-6 max-w-2xl text-lg text-navy-200">{t("subhead")}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/contact" className="btn-accent">
              {t("ctaPrimary")} <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/case-studies" className="btn-ghost bg-white/10 text-white border-white/20 hover:bg-white/20">
              {t("ctaSecondary")}
            </Link>
          </div>
          <div className="mt-12 grid max-w-2xl grid-cols-1 gap-4 text-sm text-navy-200 sm:grid-cols-3">
            <div className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-accent-300" /> {t("trust.kohSamui")}</div>
            <div className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-accent-300" /> {t("trust.sameDay")}</div>
            <div className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-accent-300" /> {t("trust.partners")}</div>
          </div>
        </div>
      </section>

      <section className="container-page py-20">
        <div className="flex items-end justify-between flex-wrap gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wider text-accent-600">{t("services.kicker")}</p>
            <h2 className="mt-2 font-display text-3xl text-navy-900">{t("services.title")}</h2>
          </div>
          <Link href="/services" className="text-sm font-medium text-accent-700 hover:text-accent-900">
            {t("services.all8")} <ArrowRight className="inline h-3.5 w-3.5" />
          </Link>
        </div>

        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {coreServices.map((s) => (
            <Link key={s.slug} href={`/services/${s.slug}`} className="card group">
              <div className="grid h-11 w-11 place-items-center rounded-lg bg-accent-50 text-accent-700">
                <ServiceIcon name={s.icon} />
              </div>
              <h3 className="mt-4 text-lg font-semibold text-navy-900 group-hover:text-accent-700">{s.title}</h3>
              <p className="mt-2 text-sm text-navy-600">{s.short_summary}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="bg-navy-50 py-16">
        <div className="container-page">
          <p className="text-center text-sm font-semibold uppercase tracking-wider text-navy-500">
            {t("trustedBy.title")}
          </p>
          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
            {caseStudies.slice(0, 3).map((c) => (
              <Link key={c.slug} href={`/case-studies/${c.slug}`} className="card text-center">
                <p className="font-display text-lg text-navy-900">{c.client_name}</p>
                <p className="mt-1 text-xs uppercase tracking-wider text-navy-500">{c.industry}</p>
                {c.relationship_years && (
                  <p className="mt-3 text-2xl font-display text-accent-700">
                    {tc("yearsPartnershipShort", { years: c.relationship_years })}
                  </p>
                )}
              </Link>
            ))}
          </div>
        </div>
      </section>

      {caseStudies[0] && (
        <section className="container-page py-20">
          <div className="card overflow-hidden bg-gradient-to-br from-white to-navy-50 lg:p-12">
            <Quote className="h-8 w-8 text-accent-500" />
            <p className="mt-4 max-w-3xl font-display text-2xl text-navy-900 sm:text-3xl">
              &ldquo;{caseStudies[0].summary}&rdquo;
            </p>
            <p className="mt-4 text-sm text-navy-500">
              {caseStudies[0].client_name} &middot; {caseStudies[0].industry}
            </p>
            <Link href={`/case-studies/${caseStudies[0].slug}`} className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-accent-700">
              {tc("readMore")} <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </section>
      )}

      <section className="container-page pb-24">
        <div className="rounded-2xl bg-navy-900 px-8 py-16 text-center text-white">
          <h2 className="mx-auto max-w-2xl font-display text-3xl">{t("cta.title")}</h2>
          <p className="mx-auto mt-4 max-w-xl text-navy-300">{t("cta.subtitle")}</p>
          <Link href="/contact" className="mt-8 inline-flex btn-accent">{t("cta.button")}</Link>
        </div>
      </section>
    </>
  );
}
