import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Link } from "@/i18n/routing";
import { cms } from "@/lib/api";
import { ServiceIcon } from "@/lib/icons";
import { pageAlternates, pageOpenGraph, pageBreadcrumb, localizedUrl } from "@/lib/seo";
import { JsonLd, breadcrumbList, service as serviceSchema } from "@/lib/schema";
import { FAQ } from "@/components/FAQ";

type Props = { params: Promise<{ locale: string; slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  const services = await cms.listServices(locale);
  const s = services.find((x) => x.slug === slug);
  if (!s) return { title: "Service" };
  return {
    title: s.title,
    description: s.short_summary,
    alternates: pageAlternates(locale, `/services/${slug}`),
    ...pageOpenGraph({ locale, path: `/services/${slug}`, title: s.title, description: s.short_summary }),
  };
}

export default async function ServiceDetailPage({ params }: Props) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("services.detail");
  const tc = await getTranslations("common");
  const tServices = await getTranslations("services");

  const services = await cms.listServices(locale);
  const s = services.find((x) => x.slug === slug);
  if (!s) notFound();

  const related = services.filter((x) => x.slug !== s.slug).slice(0, 3);
  const breadcrumbs = pageBreadcrumb(
    locale,
    [
      { name: tServices("title"), path: "/services" },
      { name: s.title, path: `/services/${slug}` },
    ],
    tc("home"),
  );

  return (
    <>
      <JsonLd data={breadcrumbList(breadcrumbs)} />
      <JsonLd
        data={serviceSchema({
          name: s.title,
          description: s.description || s.short_summary,
          url: localizedUrl(locale, `/services/${slug}`),
        })}
      />
      <section className="bg-gradient-to-br from-navy-900 to-accent-800 text-white">
        <div className="container-page py-16">
          <Link href="/services" className="inline-flex items-center gap-1 text-sm text-navy-200 hover:text-white">
            <ArrowLeft className="h-3.5 w-3.5" /> {t("back")}
          </Link>
          <div className="mt-6 flex items-start gap-4">
            <div className="grid h-14 w-14 place-items-center rounded-2xl bg-white/10 text-accent-200">
              <ServiceIcon name={s.icon} className="h-7 w-7" />
            </div>
            <div>
              <h1 className="font-display text-3xl sm:text-5xl">{s.title}</h1>
              <p className="mt-3 max-w-2xl text-navy-200">{s.short_summary}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="container-page py-16">
        {/* AEO direct-answer paragraph — first thing after H1 so LLMs
             pick it as the citable summary. Falls back to short_summary
             so pages still render if the CMS row hasn't been filled. */}
        {s.intro && (
          <p className="max-w-3xl text-lg font-medium text-navy-800">{s.intro}</p>
        )}
        <div className={`prose-f2 max-w-3xl ${s.intro ? "mt-8" : ""}`}>
          <p className="text-lg">{s.description}</p>
        </div>
        <Link href={`/contact?service=${s.slug}`} className="mt-10 inline-flex btn-accent">
          {tc("talkToF2About", { topic: s.title })} <ArrowRight className="h-4 w-4" />
        </Link>
      </section>

      <FAQ items={s.faq} heading={t("faqHeading")} />

      {related.length > 0 && (
        <section className="container-page pb-20">
          <h2 className="font-display text-2xl text-navy-900">{t("related")}</h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            {related.map((r) => (
              <Link key={r.slug} href={`/services/${r.slug}`} className="card group">
                <div className="grid h-10 w-10 place-items-center rounded-lg bg-accent-50 text-accent-700">
                  <ServiceIcon name={r.icon} className="h-5 w-5" />
                </div>
                <h3 className="mt-3 font-semibold text-navy-900 group-hover:text-accent-700">{r.title}</h3>
                <p className="mt-1 text-sm text-navy-600">{r.short_summary}</p>
              </Link>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
