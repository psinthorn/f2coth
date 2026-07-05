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

  const [services, home] = await Promise.all([
    cms.listServices(locale),
    cms.getHome(locale),
  ]);
  const groups = (["core", "support", "marketing", "opportunistic"] as const).map((cat) => ({
    cat,
    items: services.filter((s) => s.category === cat),
  }));
  // Admin-editable hero copy from /admin/home-content wins over the i18n JSON.
  const c = (key: string, fallback: string) => home[key] ?? fallback;
  const kicker = c("services_page.kicker", t("kicker"));
  const title = c("services_page.title", t("title"));
  const subtitle = c("services_page.subtitle", t("subtitle"));
  const breadcrumbs = pageBreadcrumb(
    locale,
    [{ name: title, path: "/services" }],
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
      <section className="relative overflow-hidden bg-gradient-to-br from-navy-900 via-navy-800 to-accent-800 text-white">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-30 [background:radial-gradient(60%_60%_at_20%_20%,rgba(124,58,237,0.35),transparent),radial-gradient(50%_50%_at_80%_80%,rgba(15,23,42,0.4),transparent)]"
        />
        <div className="container-page relative py-20 sm:py-24">
          <p className="text-sm font-semibold uppercase tracking-wider text-accent-200">{kicker}</p>
          <h1 className="mt-3 font-display text-4xl sm:text-5xl lg:text-6xl">{title}</h1>
          <p className="mt-5 max-w-2xl text-lg text-navy-100">{subtitle}</p>
          <div className="mt-8 flex flex-wrap gap-2 text-xs text-navy-200">
            {(["core", "support", "marketing", "opportunistic"] as const).map((cat) => {
              const count = services.filter((s) => s.category === cat).length;
              if (!count) return null;
              return (
                <a
                  key={cat}
                  href={`#${cat}`}
                  className="rounded-full border border-white/20 bg-white/5 px-3 py-1 hover:bg-white/10"
                >
                  {t(`groups.${cat}`)} · {count}
                </a>
              );
            })}
          </div>
        </div>
      </section>

      {groups.map((g) =>
        g.items.length === 0 ? null : (
          <section key={g.cat} id={g.cat} className="container-page py-16 scroll-mt-16">
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
