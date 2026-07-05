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
  const t = await getTranslations({ locale, namespace: "metadata.dpa" });
  const page = await cms.getPage("dpa", locale);
  const title = page?.seo_title || page?.title || t("title");
  const description = page?.seo_description || t("description");
  return {
    title,
    description,
    alternates: pageAlternates(locale, "/dpa"),
    ...pageOpenGraph({ locale, path: "/dpa", title, description }),
    // DPA is a B2B legal document — keep it indexable so prospective hotel
    // clients can find it, but exclude from the main crawl priority.
    robots: { index: true, follow: false },
  };
}

export default async function DPAPage({
  params,
}: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("dpa");
  const tCommon = await getTranslations("common");
  const page = await cms.getPage("dpa", locale);

  const breadcrumbs = pageBreadcrumb(
    locale,
    [{ name: page?.title || t("title"), path: "/dpa" }],
    tCommon("home"),
  );

  const cmsBody = page?.body_md?.trim();
  if (cmsBody) {
    return (
      <section className="container-page py-16">
        <JsonLd data={breadcrumbList(breadcrumbs)} />
        <div className="prose-f2 mx-auto max-w-3xl">
          <h1 className="font-display text-4xl text-navy-900">{page?.title || t("title")}</h1>
          <p className="text-slate-500 text-sm">{t("lastUpdated")}</p>
          <CMSPageBody markdown={cmsBody} />
        </div>
      </section>
    );
  }

  return (
    <section className="container-page py-16">
      <JsonLd data={breadcrumbList(breadcrumbs)} />
      <div className="prose-f2 mx-auto max-w-3xl">
        <h1 className="font-display text-4xl text-navy-900">{page?.title || t("title")}</h1>
        <p className="text-slate-500 text-sm">{t("lastUpdated")}</p>
        <p className="rounded-lg border border-accent-200 bg-accent-50 px-4 py-3 text-sm text-accent-800">
          {t("lead")}
        </p>

        <h2>{t("partiesTitle")}</h2>
        <p>{t("partiesBody")}</p>

        <h2>{t("definitionsTitle")}</h2>
        <p>{t("definitionsBody")}</p>

        <h2>{t("subjectTitle")}</h2>
        <p>{t("subjectBody")}</p>

        <h2>{t("dataTypesTitle")}</h2>
        <p>{t("dataTypesBody")}</p>
        <ul>
          <li>{t("dataTypesItem1")}</li>
          <li>{t("dataTypesItem2")}</li>
          <li>{t("dataTypesItem3")}</li>
          <li>{t("dataTypesItem4")}</li>
        </ul>

        <h2>{t("subjectsTitle")}</h2>
        <p>{t("subjectsBody")}</p>

        <h2>{t("durationTitle")}</h2>
        <p>{t("durationBody")}</p>

        <h2>{t("processorObligTitle")}</h2>

        <h3>{t("p1Title")}</h3>
        <p>{t("p1Body")}</p>

        <h3>{t("p2Title")}</h3>
        <p>{t("p2Body")}</p>

        <h3>{t("p3Title")}</h3>
        <p>{t("p3Body")}</p>

        <h3>{t("p4Title")}</h3>
        <p>{t("p4Body")}</p>

        <h3>{t("p5Title")}</h3>
        <p>{t("p5Body")}</p>

        <h3>{t("p6Title")}</h3>
        <p>{t("p6Body")}</p>

        <h2>{t("controllerTitle")}</h2>
        <p>{t("controllerBody")}</p>

        <h2>{t("subProcTitle")}</h2>
        <p>{t("subProcIntro")}</p>

        <div className="not-prose overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-navy-50 text-left">
                <th className="border border-navy-100 px-3 py-2 font-semibold text-navy-900">{t("spColName")}</th>
                <th className="border border-navy-100 px-3 py-2 font-semibold text-navy-900">{t("spColPurpose")}</th>
                <th className="border border-navy-100 px-3 py-2 font-semibold text-navy-900">{t("spColTransfer")}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border border-navy-100 px-3 py-2 align-top font-medium text-navy-800">{t("sp1Name")}</td>
                <td className="border border-navy-100 px-3 py-2 text-navy-700">{t("sp1Purpose")}</td>
                <td className="border border-navy-100 px-3 py-2 text-navy-700">{t("sp1Transfer")}</td>
              </tr>
              <tr className="bg-slate-50">
                <td className="border border-navy-100 px-3 py-2 align-top font-medium text-navy-800">{t("sp2Name")}</td>
                <td className="border border-navy-100 px-3 py-2 text-navy-700">{t("sp2Purpose")}</td>
                <td className="border border-navy-100 px-3 py-2 text-navy-700">{t("sp2Transfer")}</td>
              </tr>
              <tr>
                <td className="border border-navy-100 px-3 py-2 align-top font-medium text-navy-800">{t("sp3Name")}</td>
                <td className="border border-navy-100 px-3 py-2 text-navy-700">{t("sp3Purpose")}</td>
                <td className="border border-navy-100 px-3 py-2 text-navy-700">{t("sp3Transfer")}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <h2>{t("transfersTitle")}</h2>
        <p>{t("transfersBody")}</p>

        <h2>{t("deletionTitle")}</h2>
        <p>{t("deletionBody")}</p>

        <h2>{t("breachTitle")}</h2>
        <p>{t("breachBody")}</p>

        <h2>{t("governingLawTitle")}</h2>
        <p>{t("governingLawBody")}</p>

        <h2>{t("signaturesTitle")}</h2>
        <p>{t("signaturesBody")}</p>

        <div className="mt-6 rounded-lg border border-navy-100 bg-navy-50 px-4 py-4">
          <h2 className="!mt-0 text-base">{t("contactTitle")}</h2>
          <p className="!mb-0">
            {t("contactBody")}
            <a href="mailto:legal@f2.co.th" className="text-accent-600 underline">
              legal@f2.co.th
            </a>
            .
          </p>
        </div>
      </div>
    </section>
  );
}
