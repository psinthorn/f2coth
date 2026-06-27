import type { Metadata } from "next";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { ArrowRight } from "lucide-react";
import { Link } from "@/i18n/routing";
import { cms } from "@/lib/api";
import { ServiceIcon } from "@/lib/icons";
import { pageAlternates, pageOpenGraph, pageBreadcrumb, localizedUrl } from "@/lib/seo";
import { JsonLd, breadcrumbList, service as serviceSchema } from "@/lib/schema";

export async function generateMetadata({
  params,
}: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "metadata.services" });
  const title = t("title");
  const description = t("description");
  return {
    title,
    description,
    alternates: pageAlternates(locale, "/services"),
    ...pageOpenGraph({ locale, path: "/services", title, description }),
  };
}

export default async function ServicesPage({
  params,
}: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("services");
  const tc = await getTranslations("common");

  const services = await cms.listServices(locale);
  const groups = (["core", "support", "opportunistic"] as const).map((cat) => ({
    cat,
    items: services.filter((s) => s.category === cat),
  }));
  const breadcrumbs = pageBreadcrumb(
    locale,
    [{ name: t("title"), path: "/services" }],
    tc("home"),
  );

  return (
    <>
      <JsonLd data={breadcrumbList(breadcrumbs)} />
      {/* Emit a Service schema per listed item so the list page surfaces
          all services to crawlers in one pass (each /services/{slug}
          emits its own canonical block too). */}
      {services.map((s) => (
        <JsonLd
          key={s.slug}
          data={serviceSchema({
            name: s.title,
            description: s.short_summary,
            url: localizedUrl(locale, `/services/${s.slug}`),
          })}
        />
      ))}
      <section className="bg-navy-50">
        <div className="container-page py-16">
          <p className="text-sm font-semibold uppercase tracking-wider text-accent-700">{t("kicker")}</p>
          <h1 className="mt-2 font-display text-4xl text-navy-900 sm:text-5xl">{t("title")}</h1>
          <p className="mt-4 max-w-2xl text-navy-600">{t("subtitle")}</p>
        </div>
      </section>

      {groups.map((g) =>
        g.items.length === 0 ? null : (
          <section key={g.cat} className="container-page py-16">
            <h2 className="font-display text-2xl text-navy-900">{t(`groups.${g.cat}`)}</h2>
            <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {g.items.map((s) => (
                <Link key={s.slug} href={`/services/${s.slug}`} className="card group">
                  <div className="grid h-11 w-11 place-items-center rounded-lg bg-accent-50 text-accent-700">
                    <ServiceIcon name={s.icon} />
                  </div>
                  <h3 className="mt-4 text-lg font-semibold text-navy-900 group-hover:text-accent-700">
                    {s.title}
                  </h3>
                  <p className="mt-2 text-sm text-navy-600">{s.short_summary}</p>
                  <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-accent-700">
                    {tc("learnMore")} <ArrowRight className="h-3.5 w-3.5" />
                  </span>
                </Link>
              ))}
            </div>
          </section>
        ),
      )}
    </>
  );
}
