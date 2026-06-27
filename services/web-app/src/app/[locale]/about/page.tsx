import type { Metadata } from "next";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { Building2, MapPin, Handshake, Users } from "lucide-react";
import { Link } from "@/i18n/routing";
import { pageAlternates, pageOpenGraph, pageBreadcrumb } from "@/lib/seo";
import { JsonLd, breadcrumbList } from "@/lib/schema";

export async function generateMetadata({
  params,
}: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "metadata.about" });
  const title = t("title");
  const description = t("description");
  return {
    title,
    description,
    alternates: pageAlternates(locale, "/about"),
    ...pageOpenGraph({ locale, path: "/about", title, description }),
  };
}

export default async function AboutPage({
  params,
}: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("about");
  const tCommon = await getTranslations("common");
  const breadcrumbs = pageBreadcrumb(
    locale,
    [{ name: t("title"), path: "/about" }],
    tCommon("home"),
  );

  return (
    <>
      <JsonLd data={breadcrumbList(breadcrumbs)} />
      <section className="bg-navy-50">
        <div className="container-page py-16">
          <p className="text-sm font-semibold uppercase tracking-wider text-accent-700">{t("kicker")}</p>
          <h1 className="mt-2 font-display text-4xl text-navy-900 sm:text-5xl">{t("title")}</h1>
          <p className="mt-4 max-w-3xl text-lg text-navy-700">{t("lead")}</p>
        </div>
      </section>

      <section className="container-page py-16 grid gap-8 md:grid-cols-2">
        <div className="card">
          <div className="flex items-start gap-3">
            <Building2 className="h-6 w-6 text-accent-700" />
            <div>
              <h3 className="text-lg font-semibold text-navy-900">{t("bangkok.title")}</h3>
              <p className="mt-2 text-sm text-navy-600">{t("bangkok.body")}</p>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="flex items-start gap-3">
            <MapPin className="h-6 w-6 text-accent-700" />
            <div>
              <h3 className="text-lg font-semibold text-navy-900">{t("samui.title")}</h3>
              <p className="mt-2 text-sm text-navy-600">{t("samui.body")}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="container-page pb-16">
        <h2 className="font-display text-3xl text-navy-900">{t("focusTitle")}</h2>
        <p className="mt-3 max-w-2xl text-navy-600">{t("focusBody")}</p>

        <div className="mt-10 grid gap-6 md:grid-cols-3">
          <div className="card">
            <Handshake className="h-6 w-6 text-accent-700" />
            <h3 className="mt-3 font-semibold text-navy-900">{t("partnerships.title")}</h3>
            <p className="mt-2 text-sm text-navy-600">{t("partnerships.body")}</p>
          </div>
          <div className="card">
            <Users className="h-6 w-6 text-accent-700" />
            <h3 className="mt-3 font-semibold text-navy-900">{t("clients.title")}</h3>
            <p className="mt-2 text-sm text-navy-600">{t("clients.body")}</p>
          </div>
          <div className="card">
            <Building2 className="h-6 w-6 text-accent-700" />
            <h3 className="mt-3 font-semibold text-navy-900">{t("products.title")}</h3>
            <p className="mt-2 text-sm text-navy-600">
              <Link href="/products" className="text-accent-700 hover:text-accent-900">{t("products.iaccLink")}</Link>
              {t("products.bodySuffix")}
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
