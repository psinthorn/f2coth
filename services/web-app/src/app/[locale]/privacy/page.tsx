import type { Metadata } from "next";
import { setRequestLocale, getTranslations } from "next-intl/server";
import DSRForm from "./DSRForm";
import { pageAlternates, pageOpenGraph, pageBreadcrumb } from "@/lib/seo";
import { JsonLd, breadcrumbList } from "@/lib/schema";
import { cms } from "@/lib/api";
import CMSPageBody from "@/components/CMSPageBody";

export async function generateMetadata({
  params,
}: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "metadata.privacy" });
  const page = await cms.getPage("privacy", locale);
  const title = page?.seo_title || page?.title || t("title");
  const description = page?.seo_description || t("description");
  return {
    title,
    description,
    alternates: pageAlternates(locale, "/privacy"),
    ...pageOpenGraph({ locale, path: "/privacy", title, description }),
    robots: { index: true, follow: true },
  };
}

export default async function PrivacyPage({
  params,
}: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("privacy");
  const tCommon = await getTranslations("common");
  const page = await cms.getPage("privacy", locale);

  const breadcrumbs = pageBreadcrumb(
    locale,
    [{ name: page?.title || t("title"), path: "/privacy" }],
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
            <p>{t("lead")}</p>

            <h2>{t("controllerTitle")}</h2>
            <p>{t("controllerBody")}</p>

            <h2>{t("collectTitle")}</h2>
            <p>{t("collectBody")}</p>
            <ul>
              <li>{t("collectItem1")}</li>
              <li>{t("collectItem2")}</li>
              <li>{t("collectItem3")}</li>
              <li>{t("collectItem4")}</li>
            </ul>

            <h2>{t("basisTitle")}</h2>
            <p>{t("basisBody")}</p>

            <h2>{t("useTitle")}</h2>
            <p>{t("useBody")}</p>

            <h2>{t("retentionTitle")}</h2>
            <p>{t("retentionBody")}</p>

            <h2>{t("crossBorderTitle")}</h2>
            <p>{t("crossBorderBody")}</p>

            <h2>{t("breachTitle")}</h2>
            <p>{t("breachBody")}</p>

            <h2>{t("cookieTitle")}</h2>
            <p>{t("cookieBody")}</p>

            <h2>{t("rightsTitle")}</h2>
            <p>{t("rightsBody")}</p>
            <ul>
              <li>{t("right1")}</li>
              <li>{t("right2")}</li>
              <li>{t("right3")}</li>
              <li>{t("right4")}</li>
              <li>{t("right5")}</li>
              <li>{t("right6")}</li>
            </ul>
          </>
        )}

        {/* DSR form is always shown regardless of CMS overrides — it's a
            statutory PDPA feature, not editorial content. */}
        <div id="dsr" className="mt-10 scroll-mt-24">
          <h2>{t("dsrTitle")}</h2>
          <p>{t("dsrBody")}</p>
          <DSRForm locale={locale} />
        </div>

        <h2>{t("contactTitle")}</h2>
        <p>
          {t("contactBody")}
          <a href="mailto:privacy@f2.co.th" className="text-accent-600 underline">
            privacy@f2.co.th
          </a>
          .
        </p>
      </div>
    </section>
  );
}
