import type { Metadata } from "next";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { pageAlternates, pageOpenGraph, pageBreadcrumb } from "@/lib/seo";
import { JsonLd, breadcrumbList } from "@/lib/schema";
import { cms } from "@/lib/api";
import CMSPageBody from "@/components/CMSPageBody";

export async function generateMetadata({
  params,
}: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "metadata.terms" });
  const page = await cms.getPage("terms", locale);
  const title = page?.seo_title || page?.title || t("title");
  const description = page?.seo_description || t("description");
  return {
    title,
    description,
    alternates: pageAlternates(locale, "/terms"),
    ...pageOpenGraph({ locale, path: "/terms", title, description }),
  };
}

export default async function TermsPage({
  params,
}: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("terms");
  const tCommon = await getTranslations("common");
  const page = await cms.getPage("terms", locale);

  const breadcrumbs = pageBreadcrumb(
    locale,
    [{ name: page?.title || t("title"), path: "/terms" }],
    tCommon("home"),
  );

  const cmsBody = page?.body_md?.trim();

  return (
    <section className="container-page py-16">
      <JsonLd data={breadcrumbList(breadcrumbs)} />
      <div className="prose-f2 mx-auto max-w-3xl">
        <h1 className="font-display text-4xl text-navy-900">{page?.title || t("title")}</h1>
        <p className="text-slate-500 text-sm">{t("lastUpdated")}</p>

        {cmsBody ? (
          <CMSPageBody markdown={cmsBody} />
        ) : (
          <>
            <h2>{t("acceptanceTitle")}</h2>
            <p>{t("acceptanceBody")}</p>

            <h2>{t("servicesTitle")}</h2>
            <p>{t("servicesBody")}</p>

            <h2>{t("accountTitle")}</h2>
            <p>{t("accountBody")}</p>

            <h2>{t("conductTitle")}</h2>
            <p>{t("conductBody")}</p>

            <h2>{t("ipTitle")}</h2>
            <p>{t("ipBody")}</p>

            <h2>{t("liabilityTitle")}</h2>
            <p>{t("liabilityBody")}</p>

            <h2>{t("governingLawTitle")}</h2>
            <p>{t("governingLawBody")}</p>

            <h2>{t("changesTitle")}</h2>
            <p>{t("changesBody")}</p>

            <h2>{t("contactTitle")}</h2>
            <p>
              {t("contactBody")}
              <a href="mailto:legal@f2.co.th" className="text-accent-600 underline">
                legal@f2.co.th
              </a>
              .
            </p>
          </>
        )}
      </div>
    </section>
  );
}
